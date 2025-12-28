import pandas as pd
import os

folder = r"e:\xiangmu\shejixitong\代码实现逻辑\8-代码实现逻辑\附件\地表下沉\2-实测点数据"
files = ["测线1.xlsx", "测线2.xlsx", "测线3.xlsx"]

for f in files:
    path = os.path.join(folder, f)
    print(f"--- {f} ---")
    try:
        df = pd.read_excel(path)
        print(df.head())
        print(df.columns.tolist())
    except Exception as e:
        print(f"Error reading {f}: {e}")
