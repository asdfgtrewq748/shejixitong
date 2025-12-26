"""Calibrate ODI predictions against measured subsidence lines.

Workflow:
- Load workface polygon (1-工作面四个圈定坐标点.xlsx)
- Load borehole coords (0-地质钻孔坐标.xlsx) + per-borehole layers (1-地质钻孔/*.csv)
- Compute ODI using current calculator (surface_subsidence scenario)
- Interpolate ODI to measured points (测线1/2/3.xlsx)
- Fit linear regression measured = a * odi + b, report metrics
- Save detailed CSV to docs/measured_calibration.csv
"""

import sys
from pathlib import Path
from typing import List, Dict
import pandas as pd
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
BASE = REPO_ROOT / "代码实现逻辑" / "8-代码实现逻辑" / "附件" / "地表下沉"

sys.path.append(str(REPO_ROOT / "backend_python"))
from utils.odi_calculator import ODICalculator, ScenarioType  # type: ignore
from routers.disturbance import calculate_geo_params_from_layers  # type: ignore


def safe_float(val, default=0.0):
    if pd.isna(val):
        return default
    s = str(val).strip()
    while ".." in s:
        s = s.replace("..", ".")
    try:
        return float(s)
    except Exception:
        return default


def load_workface() -> List[Dict]:
    df = pd.read_excel(BASE / "1-工作面四个圈定坐标点.xlsx")
    # 列名兼容
    x_col = next(c for c in df.columns if "x" in str(c).lower())
    y_col = next(c for c in df.columns if "y" in str(c).lower())
    coords = []
    for _, row in df.iterrows():
        coords.append({"id": str(row.get(df.columns[0])), "x": float(row[x_col]), "y": float(row[y_col])})
    return coords


def load_boreholes() -> List[Dict]:
    coords_df = pd.read_excel(BASE / "0-地质钻孔坐标.xlsx")
    # 取两列数值作为 x,y
    num_cols = [c for c in coords_df.columns if pd.api.types.is_numeric_dtype(coords_df[c]) or coords_df[c].dtype == object]
    # 第二列 x，第三列 y（按文件观察）
    boreholes = {}
    for _, row in coords_df.iterrows():
        bid = str(row.iloc[0]).strip()
        boreholes[bid] = {
            "id": bid,
            "x": float(row.iloc[1]),
            "y": float(row.iloc[2]),
        }

    layer_dir = BASE / "1-地质钻孔"
    for bid, info in boreholes.items():
        layer_file = layer_dir / f"{bid}.csv"
        if not layer_file.exists():
            continue
        df = pd.read_csv(layer_file)
        df.columns = [str(c).strip() for c in df.columns]
        layers = []
        for _, row in df.iterrows():
            layers.append({
                "sequence": int(row.iloc[0]) if not pd.isna(row.iloc[0]) else len(layers) + 1,
                "name": str(row.iloc[1]).strip(),
                "thickness": safe_float(row.iloc[2], 0),
            })
        geo_params = calculate_geo_params_from_layers(layers)
        info.update(geo_params)
    return list(boreholes.values())


def load_measured() -> pd.DataFrame:
    frames = []
    for f in sorted((BASE / "2-实测点数据").glob("*.xlsx")):
        df = pd.read_excel(f)
        df["source_file"] = f.name
        frames.append(df)
    df_all = pd.concat(frames, ignore_index=True)
    # 列: X, Y, 实测地表下沉值/m；文件中 X≈北向(y), Y≈东向(x)，需交换以匹配工作面坐标
    df_all["x"] = df_all[df_all.columns[2]]  # Y列
    df_all["y"] = df_all[df_all.columns[1]]  # X列
    df_all.rename(columns={df_all.columns[3]: "subsidence"}, inplace=True)
    return df_all


def idw_value(points: List[Dict], x: float, y: float, field: str = "odi") -> float:
    power = 2
    wsum = 0.0
    vsum = 0.0
    for pt in points:
        dx = x - pt["x"]
        dy = y - pt["y"]
        dist = (dx * dx + dy * dy) ** 0.5
        if dist < 1e-6:
            return float(pt.get(field, 0.0))
        w = 1.0 / (dist ** power)
        wsum += w
        vsum += w * float(pt.get(field, 0.0))
    return vsum / wsum if wsum > 0 else 0.0


def main():
    workface = load_workface()
    boreholes = load_boreholes()
    measured = load_measured()

    calc = ODICalculator(ScenarioType.SURFACE_SUBSIDENCE)
    calc.load_workface_coords(workface)
    calc.load_borehole_data(boreholes)
    results = calc.calculate_all()

    # 准备插值列表（只保留 odi 和 odi_normalized）
    interp_points = [{"x": r["x"], "y": r["y"], "odi": r.get("odi", 0.0), "odi_normalized": r.get("odi_normalized", 0.0)} for r in results]

    preds = []
    for _, row in measured.iterrows():
        x, y = float(row["x"]), float(row["y"])
        odi = idw_value(interp_points, x, y, "odi")
        odi_n = idw_value(interp_points, x, y, "odi_normalized")
        preds.append((odi, odi_n))

    measured["odi_pred"] = [p[0] for p in preds]
    measured["odi_norm_pred"] = [p[1] for p in preds]

    # 回归：实测下沉 = a * odi + b
    y_true = measured["subsidence"].to_numpy(float)
    X = np.column_stack([measured["odi_pred"].to_numpy(float), np.ones(len(measured))])
    coef, *_ = np.linalg.lstsq(X, y_true, rcond=None)
    pred_subs = X @ coef
    resid = y_true - pred_subs
    ss_res = np.sum(resid ** 2)
    ss_tot = np.sum((y_true - y_true.mean()) ** 2)
    r2 = 1 - ss_res / ss_tot if ss_tot != 0 else 1.0
    mae = np.mean(np.abs(resid))
    rmse = np.sqrt(np.mean(resid ** 2))

    print("=== Measured vs ODI calibration ===")
    print(f"points: {len(measured)}  workface vertices: {len(workface)}  boreholes: {len(boreholes)}")
    print(f"subsidence = a*odi + b => a={coef[0]:.6f}, b={coef[1]:.6f}")
    print(f"R2={r2:.6f}  MAE={mae:.6f}  RMSE={rmse:.6f}")
    print("sample pred (subsidence_pred vs actual):")
    print(np.column_stack([pred_subs[:5], y_true[:5]]))

    measured["subs_pred"] = pred_subs
    measured["subs_resid"] = resid
    out_path = REPO_ROOT / "docs" / "measured_calibration.csv"
    measured.to_csv(out_path, index=False, encoding="utf-8-sig")
    print(f"Saved detailed results to {out_path}")

    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
