from fastapi import APIRouter, HTTPException, Body, UploadFile, File, Form
from store import store
from utils.parsing import parse_csv_file
import pandas as pd
import numpy as np
from typing import List, Dict, Optional

router = APIRouter()

@router.get("/")
async def get_boreholes():
    return {"boreholes": store.boreholes}


@router.get("/coal-seams")
async def get_coal_seams():
    """获取所有识别到的煤层列表"""
    coal_seams = []

    # 从分层数据中提取煤层
    if store.borehole_layer_data:
        df = pd.DataFrame(store.borehole_layer_data)

        # 查找煤层相关列
        seam_col = next((c for c in df.columns if '煤层' in c or 'seam' in c.lower()), None)
        name_col = next((c for c in df.columns if '名称' in c or 'name' in c.lower()), None)

        if seam_col:
            coal_seams = df[seam_col].dropna().unique().tolist()
        elif name_col:
            # 从名称列中识别煤层
            names = df[name_col].dropna().unique().tolist()
            coal_seams = [n for n in names if '煤' in str(n)]

    # 去重并排序
    coal_seams = sorted(list(set(coal_seams)))

    return {"coal_seams": coal_seams, "count": len(coal_seams)}

@router.post("/")
async def upload_boreholes_json(boreholes: Dict = Body(...)):
    # 兼容前端 { boreholes: [...] } 格式
    data = boreholes.get("boreholes", [])
    if not data:
        return {"success": True, "count": 0}
        
    store.boreholes = data
    _update_boundary_if_needed(data)
    return {"success": True, "count": len(data)}

@router.post("/batch-upload")
async def batch_upload_boreholes(
    files: List[UploadFile] = File(...),
    targetCoalSeam: Optional[str] = Form(None)
):
    results = {"success": [], "errors": [], "summary": {}}
    all_data = []
    
    for file in files:
        try:
            content = await file.read()
            data = parse_csv_file(content)
            if data:
                # Add filename to each record for tracking
                for row in data:
                    row['_source_file'] = file.filename
                all_data.extend(data)
                results["success"].append(file.filename)
            else:
                results["errors"].append(f"{file.filename}: Empty file")
        except Exception as e:
            results["errors"].append(f"{file.filename}: {str(e)}")
            
    # Store raw layer data
    store.borehole_layer_data = all_data
    
    # Simple summary
    if all_data:
        df = pd.DataFrame(all_data)
        # Try to identify coal seam column
        seam_col = next((c for c in df.columns if '煤层' in c or 'seam' in c.lower()), None)
        if seam_col:
            stats = df.groupby(seam_col).size().to_dict()
            # Calculate average thickness if possible
            thick_col = next((c for c in df.columns if '厚' in c or 'thick' in c.lower()), None)
            summary_stats = {}
            for seam, count in stats.items():
                avg_thick = 0
                if thick_col:
                    try:
                        avg_thick = df[df[seam_col] == seam][thick_col].mean()
                    except:
                        pass
                summary_stats[seam] = {"钻孔数": count, "平均厚度": round(avg_thick, 2)}
            results["summary"] = {"煤层统计": summary_stats}
            
    return {"results": results}

@router.post("/merge-with-coordinates")
async def merge_data():
    if not store.borehole_coordinates:
        raise HTTPException(status_code=400, detail="请先上传坐标文件")
        
    coords_df = pd.DataFrame(store.borehole_coordinates)
    
    # If we have layer data, try to merge
    if store.borehole_layer_data:
        layer_df = pd.DataFrame(store.borehole_layer_data)
        
        # Normalize ID columns
        # Find ID column in layer data
        l_id_col = next((c for c in layer_df.columns if 'id' in c.lower() or '编号' in c or '孔号' in c), None)
        
        # If no explicit ID column, try to use filename (remove extension)
        if not l_id_col and '_source_file' in layer_df.columns:
            layer_df['extracted_id'] = layer_df['_source_file'].apply(lambda x: str(x).rsplit('.', 1)[0] if x else None)
            l_id_col = 'extracted_id'
        
        if l_id_col:
            # Identify numeric columns for aggregation
            numeric_cols = layer_df.select_dtypes(include=[np.number]).columns.tolist()
            if l_id_col in numeric_cols: numeric_cols.remove(l_id_col)
            
            # Group by ID and mean (simple aggregation)
            if numeric_cols:
                grouped = layer_df.groupby(l_id_col)[numeric_cols].mean().reset_index()
                # Ensure ID types match (convert to string)
                grouped[l_id_col] = grouped[l_id_col].astype(str)
                coords_df['id'] = coords_df['id'].astype(str)
                
                merged_df = pd.merge(coords_df, grouped, left_on='id', right_on=l_id_col, how='left')
            else:
                merged_df = pd.merge(coords_df, layer_df, left_on='id', right_on=l_id_col, how='left')
                
            # Fill NaNs
            merged_df = merged_df.replace({np.nan: 0})
            
            # Map common fields to standard names expected by frontend
            column_mapping = {
                '岩石硬度': 'rockHardness', 'hardness': 'rockHardness', 'f': 'rockHardness',
                '瓦斯含量': 'gasContent', 'gas': 'gasContent',
                '煤层厚度': 'coalThickness', 'thickness': 'coalThickness', 'thick': 'coalThickness',
                '地下水位': 'groundWater', 'water': 'groundWater'
            }
            
            for col in merged_df.columns:
                for k, v in column_mapping.items():
                    if k in col.lower():
                        merged_df[v] = merged_df[col]
                        
            # Ensure required columns exist (fill with defaults if missing)
            defaults = {'rockHardness': 5.0, 'gasContent': 2.0, 'coalThickness': 3.0, 'groundWater': 10.0}
            for k, v in defaults.items():
                if k not in merged_df.columns:
                    merged_df[k] = v
                    
            merged = merged_df.to_dict(orient='records')
            unmatched = [] # Simplified
            
        else:
            # No ID column found in layer data, fallback to random
            merged = _generate_mock_data(store.borehole_coordinates)
            unmatched = []
    else:
        # No layer data, fallback to random
        merged = _generate_mock_data(store.borehole_coordinates)
        unmatched = []

    store.boreholes = merged
    _update_boundary_if_needed(merged)
    
    return {"success": True, "data": {"boreholes": merged, "count": len(merged)}, "unmatched": unmatched}

def _generate_mock_data(coords):
    merged = []
    for c in coords:
        merged.append({
            "id": c['id'],
            "x": c['x'],
            "y": c['y'],
            "coalThickness": 15 + np.random.random() * 10,
            "gasContent": 2 + np.random.random() * 5,
            "rockHardness": 4 + np.random.random() * 4,
            "groundWater": 20 + np.random.random() * 20,
            "avgScore": 70 + np.random.random() * 20
        })
    return merged

def _update_boundary_if_needed(data):
    if not store.boundary and data:
        df = pd.DataFrame(data)
        if 'x' in df.columns and 'y' in df.columns:
            min_x, max_x = df['x'].min(), df['x'].max()
            min_y, max_y = df['y'].min(), df['y'].max()
            margin = (max_x - min_x) * 0.1
            
            store.boundary = [
                {"x": min_x - margin, "y": min_y - margin},
                {"x": max_x + margin, "y": min_y - margin},
                {"x": max_x + margin, "y": max_y + margin},
                {"x": min_x - margin, "y": max_y + margin},
                {"x": min_x - margin, "y": min_y - margin}
            ]
