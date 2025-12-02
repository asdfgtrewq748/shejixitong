from fastapi import APIRouter, UploadFile, File, HTTPException
from utils.parsing import parse_csv_file, normalize_columns
from store import store

router = APIRouter()

@router.post("/boundary")
async def upload_boundary(file: UploadFile = File(...)):
    try:
        content = await file.read()
        raw_data = parse_csv_file(content)
        boundary = normalize_columns(raw_data, 'boundary')
        
        if not boundary:
            raise HTTPException(status_code=400, detail="无法解析边界数据")
            
        # 确保闭合
        if boundary[0] != boundary[-1]:
            boundary.append(boundary[0])
            
        store.boundary = boundary
        return {"success": True, "data": {"boundary": boundary}}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/borehole-coordinates")
async def upload_coordinates(file: UploadFile = File(...)):
    try:
        content = await file.read()
        raw_data = parse_csv_file(content)
        coords = normalize_columns(raw_data, 'coordinate')
        
        if not coords:
            # 获取列名以便调试
            columns = list(raw_data[0].keys()) if raw_data else "No data"
            raise HTTPException(status_code=400, detail=f"无法解析坐标数据。检测到的列名: {columns}。请确保包含 id, x, y 相关列。")
            
        store.borehole_coordinates = coords
        return {"success": True, "count": len(coords)}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=f"处理失败: {str(e)}")
