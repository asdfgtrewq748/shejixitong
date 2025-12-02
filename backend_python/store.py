from typing import List, Dict, Any, Optional
from pydantic import BaseModel

class Store:
    def __init__(self):
        self.boundary: List[Dict[str, float]] = []  # [{"x": 1, "y": 2}, ...]
        self.boreholes: List[Dict[str, Any]] = []
        self.borehole_coordinates: List[Dict[str, Any]] = []
        self.borehole_layer_data: List[Dict[str, Any]] = []
        self.geology: Dict[str, Any] = {}
        self.scores: Dict[str, Any] = {}
        self.design: Dict[str, Any] = {}

    def clear(self):
        self.__init__()

store = Store()
