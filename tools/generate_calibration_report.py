"""Generate calibration report for ODI using provided validation dataset.

Reads ODI计算最终结果.xlsx, recomputes ODI using current scenario weights and
calibration coefficients in backend_python.utils.odi_calculator, and prints
error metrics. Optionally writes a diff CSV for inspection.
"""

import sys
from pathlib import Path
import pandas as pd
import numpy as np


def main():
    repo_root = Path(__file__).resolve().parents[1]
    sys.path.append(str(repo_root / "backend_python"))

    try:
        from utils.odi_calculator import SCENARIO_WEIGHTS, SURFACE_CALIBRATION
    except Exception as exc:  # pragma: no cover
        print(f"[ERROR] failed to import calculator: {exc}")
        return 1

    data_path = repo_root / "代码实现逻辑" / "8-代码实现逻辑" / "附件" / "地表下沉" / "3-验证数据" / "ODI计算最终结果.xlsx"
    if not data_path.exists():
        print(f"[ERROR] validation file not found: {data_path}")
        return 1

    df = pd.read_excel(data_path)

    # Use surface subsidence weights
    w = SCENARIO_WEIGHTS.get("surface_subsidence") or SCENARIO_WEIGHTS.get(next(iter(SCENARIO_WEIGHTS)))
    wd, wo, wf = w["wd"], w["wo"], w["wf"]

    # Aggregate indicators
    Smax, DSmax, Ks, Dsmax, As, Hf, Kw, Bf, Af = [df[c].to_numpy(float) for c in ["Smax", "DSmax", "Kσ", "Dσmax", "Aσ", "Hf", "Kw", "Bf", "Af"]]
    g = wd * (Smax + DSmax) + wo * (Ks + Dsmax + As) + wf * (Hf + Kw + Bf + Af)

    # Apply calibration
    a = SURFACE_CALIBRATION.get("scale", 1.0)
    b = SURFACE_CALIBRATION.get("bias", 0.0)
    pred = g * a + b

    y = df["ODI"].to_numpy(float)
    resid = y - pred
    ss_res = np.sum(resid ** 2)
    ss_tot = np.sum((y - y.mean()) ** 2)
    r2 = 1 - ss_res / ss_tot if ss_tot != 0 else 1.0
    mae = np.mean(np.abs(resid))
    rmse = np.sqrt(np.mean(resid ** 2))

    print("=== Calibration Report ===")
    print(f"Data rows: {len(df)}  File: {data_path.name}")
    print(f"Weights: wd={wd:.3f}, wo={wo:.3f}, wf={wf:.3f}")
    print(f"Calibration: scale={a:.6f}, bias={b:.6f}")
    print(f"R2={r2:.6f}  MAE={mae:.6f}  RMSE={rmse:.6f}")
    print(f"Pred sample: {pred[:5].round(6)}")
    print(f"Actual sample: {y[:5].round(6)}")

    # Save detailed diff
    out_csv = repo_root / "docs" / "calibration_diff.csv"
    df_out = df.copy()
    df_out["ODI_pred"] = pred
    df_out["ODI_diff"] = y - pred
    df_out.to_csv(out_csv, index=False, encoding="utf-8-sig")
    print(f"Saved diff to {out_csv}")

    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
