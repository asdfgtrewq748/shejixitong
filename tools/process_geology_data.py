import os
import pandas as pd
import json
import re

# Configuration
INPUT_DIR = r'd:\xiangmu\shejixitong\input\各个钻孔-补充'
COORD_FILE = r'd:\xiangmu\shejixitong\input\敏东钻孔对应坐标.csv'
OUTPUT_FILE = r'd:\xiangmu\shejixitong\frontend\public\model_data.json'

# Standard Coal Seams Order
STANDARD_COALS = [
    "15-4煤", "15-5上煤", "15-5下煤", "15-7煤", 
    "16-1煤", "16-2上煤", "16-2下煤", 
    "16-3上煤", "16-3中煤", "16-3煤", "16-4煤"
]

def normalize_name(name):
    if pd.isna(name): return ""
    return str(name).strip()

def process():
    print("Starting data processing...")
    
    # 1. Load Coordinates
    try:
        # Try reading with GBK first (common for Chinese CSVs)
        coords_df = pd.read_csv(COORD_FILE, encoding='gbk')
    except:
        coords_df = pd.read_csv(COORD_FILE, encoding='utf-8')
        
    coords_map = {}
    for _, row in coords_df.iterrows():
        # Clean borehole name
        name = str(row.iloc[0]).strip()
        try:
            x = float(row.iloc[1])
            y = float(row.iloc[2])
            coords_map[name] = {'x': x, 'y': y}
        except:
            continue
            
    print(f"Loaded coordinates for {len(coords_map)} boreholes.")

    # 2. Process Each Borehole
    boreholes_data = []
    
    if not os.path.exists(INPUT_DIR):
        print(f"Error: Input directory {INPUT_DIR} does not exist.")
        return

    files = os.listdir(INPUT_DIR)
    
    for f in files:
        if not f.endswith('.csv'): continue
        bh_name = os.path.splitext(f)[0]
        
        # Skip if no coordinates
        if bh_name not in coords_map:
            # print(f"Warning: No coordinates for {bh_name}")
            continue
            
        file_path = os.path.join(INPUT_DIR, f)
        try:
            # Try different encodings
            try:
                df = pd.read_csv(file_path, encoding='gbk')
            except:
                df = pd.read_csv(file_path, encoding='utf-8')
        except Exception as e:
            print(f"Error reading {f}: {e}")
            continue

        # Normalize columns
        name_col = next((c for c in df.columns if "名称" in c), None)
        thick_col = next((c for c in df.columns if "厚度" in c), None)
        
        if not name_col or not thick_col:
            print(f"Skipping {f}: Columns not found")
            continue

        # Extract layers
        layers = []
        for _, row in df.iterrows():
            l_name = normalize_name(row[name_col])
            try:
                l_thick = float(row[thick_col])
            except:
                l_thick = 0
            layers.append({'name': l_name, 'thickness': l_thick})

        # 3. Align to Standard Sequence
        bins = {}
        bins["Overburden"] = 0
        for i, coal in enumerate(STANDARD_COALS):
            bins[coal] = 0
            if i < len(STANDARD_COALS) - 1:
                bins[f"Interburden_{i}"] = 0 
        bins["Underburden"] = 0
        
        active_coal_index = -1 
        
        # Reverse layers if needed? 
        # Usually CSVs are top-down (1 is top). 
        # Let's assume top-down.
        
        for l in layers:
            name = l['name']
            thickness = l['thickness']
            
            # Check if this layer is a standard coal
            matched_coal_idx = -1
            for idx, coal in enumerate(STANDARD_COALS):
                if coal in name: 
                    matched_coal_idx = idx
                    break
            
            if matched_coal_idx != -1:
                if matched_coal_idx > active_coal_index:
                    active_coal_index = matched_coal_idx
                    bins[STANDARD_COALS[active_coal_index]] += thickness
                elif matched_coal_idx == active_coal_index:
                     bins[STANDARD_COALS[active_coal_index]] += thickness
                else:
                     # Out of order or duplicate
                     if active_coal_index == -1:
                         bins["Overburden"] += thickness
                     elif active_coal_index < len(STANDARD_COALS) - 1:
                         bins[f"Interburden_{active_coal_index}"] += thickness
                     else:
                         bins["Underburden"] += thickness
            else:
                # Not a coal seam (Rock)
                if active_coal_index == -1:
                    bins["Overburden"] += thickness
                elif active_coal_index < len(STANDARD_COALS) - 1:
                    bins[f"Interburden_{active_coal_index}"] += thickness
                else:
                    bins["Underburden"] += thickness

        bh_data = {
            'id': bh_name,
            'x': coords_map[bh_name]['x'],
            'y': coords_map[bh_name]['y'],
            'layers': bins
        }
        boreholes_data.append(bh_data)

    # 4. Output JSON
    sequence_names = ["Overburden"]
    sequence_labels = ["表土层 (Overburden)"]
    
    for i, coal in enumerate(STANDARD_COALS):
        sequence_names.append(coal)
        sequence_labels.append(f"{coal}")
        
        if i < len(STANDARD_COALS) - 1:
            ib_name = f"Interburden_{i}"
            sequence_names.append(ib_name)
            sequence_labels.append(f"岩层 (Rock {i+1})")
            
    sequence_names.append("Underburden")
    sequence_labels.append("基底 (Underburden)")
    
    output = {
        "standard_sequence": sequence_names,
        "sequence_labels": sequence_labels,
        "boreholes": boreholes_data
    }
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"Successfully processed {len(boreholes_data)} boreholes.")
    print(f"Data saved to {OUTPUT_FILE}")

if __name__ == '__main__':
    process()
