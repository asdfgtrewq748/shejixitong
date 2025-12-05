"""
数据存储模块 - 支持SQLite持久化
"""
import json
import sqlite3
import os
from typing import List, Dict, Any, Optional
from contextlib import contextmanager
from datetime import datetime

# 数据库文件路径
DB_PATH = os.getenv("MINING_DB_PATH", "mining_data.db")


def init_database():
    """初始化数据库表"""
    with get_db_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT DEFAULT 'default',
                boundary TEXT DEFAULT '[]',
                boreholes TEXT DEFAULT '[]',
                borehole_coordinates TEXT DEFAULT '[]',
                borehole_layer_data TEXT DEFAULT '[]',
                geology_model TEXT DEFAULT '{}',
                scores TEXT DEFAULT '{}',
                design_result TEXT DEFAULT '{}',
                coord_offset TEXT DEFAULT '{"x": 0, "y": 0}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # 确保有默认项目
        cursor = conn.execute("SELECT id FROM projects WHERE name = 'default'")
        if cursor.fetchone() is None:
            conn.execute("INSERT INTO projects (name) VALUES ('default')")

        conn.commit()


@contextmanager
def get_db_connection():
    """获取数据库连接的上下文管理器"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


class Store:
    """数据存储类 - 支持SQLite持久化"""

    def __init__(self, project_name: str = 'default'):
        self.project_name = project_name
        self._ensure_project_exists()

    def _ensure_project_exists(self):
        """确保项目存在"""
        with get_db_connection() as conn:
            cursor = conn.execute(
                "SELECT id FROM projects WHERE name = ?",
                (self.project_name,)
            )
            if cursor.fetchone() is None:
                conn.execute(
                    "INSERT INTO projects (name) VALUES (?)",
                    (self.project_name,)
                )
                conn.commit()

    def _get_field(self, field: str) -> Any:
        """从数据库获取字段"""
        with get_db_connection() as conn:
            cursor = conn.execute(
                f"SELECT {field} FROM projects WHERE name = ?",
                (self.project_name,)
            )
            row = cursor.fetchone()
            if row:
                value = row[0]
                if value:
                    return json.loads(value)
        return [] if field in ('boundary', 'boreholes', 'borehole_coordinates', 'borehole_layer_data') else {}

    def _set_field(self, field: str, value: Any):
        """设置数据库字段"""
        with get_db_connection() as conn:
            conn.execute(
                f"UPDATE projects SET {field} = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?",
                (json.dumps(value, ensure_ascii=False), self.project_name)
            )
            conn.commit()

    # ============ 属性访问器 ============

    @property
    def boundary(self) -> List[Dict[str, float]]:
        return self._get_field('boundary')

    @boundary.setter
    def boundary(self, value: List[Dict[str, float]]):
        self._set_field('boundary', value)

    @property
    def boreholes(self) -> List[Dict[str, Any]]:
        return self._get_field('boreholes')

    @boreholes.setter
    def boreholes(self, value: List[Dict[str, Any]]):
        self._set_field('boreholes', value)

    @property
    def borehole_coordinates(self) -> List[Dict[str, Any]]:
        return self._get_field('borehole_coordinates')

    @borehole_coordinates.setter
    def borehole_coordinates(self, value: List[Dict[str, Any]]):
        self._set_field('borehole_coordinates', value)

    @property
    def borehole_layer_data(self) -> List[Dict[str, Any]]:
        return self._get_field('borehole_layer_data')

    @borehole_layer_data.setter
    def borehole_layer_data(self, value: List[Dict[str, Any]]):
        self._set_field('borehole_layer_data', value)

    @property
    def geology_model(self) -> Dict[str, Any]:
        return self._get_field('geology_model')

    @geology_model.setter
    def geology_model(self, value: Dict[str, Any]):
        self._set_field('geology_model', value)

    @property
    def scores(self) -> Dict[str, Any]:
        return self._get_field('scores')

    @scores.setter
    def scores(self, value: Dict[str, Any]):
        self._set_field('scores', value)

    @property
    def design_result(self) -> Dict[str, Any]:
        return self._get_field('design_result')

    @design_result.setter
    def design_result(self, value: Dict[str, Any]):
        self._set_field('design_result', value)

    @property
    def coord_offset(self) -> Dict[str, float]:
        return self._get_field('coord_offset')

    @coord_offset.setter
    def coord_offset(self, value: Dict[str, float]):
        self._set_field('coord_offset', value)

    # ============ 方法 ============

    def clear(self):
        """清空当前项目数据"""
        with get_db_connection() as conn:
            conn.execute("""
                UPDATE projects SET
                    boundary = '[]',
                    boreholes = '[]',
                    borehole_coordinates = '[]',
                    borehole_layer_data = '[]',
                    geology_model = '{}',
                    scores = '{}',
                    design_result = '{}',
                    coord_offset = '{"x": 0, "y": 0}',
                    updated_at = CURRENT_TIMESTAMP
                WHERE name = ?
            """, (self.project_name,))
            conn.commit()

    def get_normalized_boundary(self) -> List[Dict[str, float]]:
        """获取归一化后的边界"""
        boundary = self.boundary
        if not boundary:
            return []

        min_x = min(p['x'] for p in boundary)
        min_y = min(p['y'] for p in boundary)

        if min_x > 100 or min_y > 100:
            self.coord_offset = {'x': min_x, 'y': min_y}
            return [{'x': p['x'] - min_x, 'y': p['y'] - min_y} for p in boundary]

        return boundary.copy()

    def get_normalized_boreholes(self) -> List[Dict[str, Any]]:
        """获取归一化后的钻孔数据"""
        boreholes = self.boreholes
        if not boreholes:
            return []

        offset = self.coord_offset
        offset_x = offset.get('x', 0)
        offset_y = offset.get('y', 0)

        if offset_x > 0 or offset_y > 0:
            return [{
                **bh,
                'x': bh.get('x', 0) - offset_x,
                'y': bh.get('y', 0) - offset_y
            } for bh in boreholes]

        return boreholes.copy()

    def get_project_info(self) -> Dict[str, Any]:
        """获取项目信息"""
        with get_db_connection() as conn:
            cursor = conn.execute(
                "SELECT name, created_at, updated_at FROM projects WHERE name = ?",
                (self.project_name,)
            )
            row = cursor.fetchone()
            if row:
                return {
                    'name': row['name'],
                    'created_at': row['created_at'],
                    'updated_at': row['updated_at'],
                    'boundary_points': len(self.boundary),
                    'boreholes_count': len(self.boreholes),
                    'has_design': bool(self.design_result)
                }
        return {}


# 初始化数据库
init_database()

# 默认存储实例
store = Store()
