"""
矿井工作面接续仿真环境
"""
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional
from copy import deepcopy
import numpy as np

from ..utils.state import WorkfaceState, MineState, encode_state, get_state_dim
from ..utils.reward import calculate_reward, RewardConfig


@dataclass
class EnvironmentConfig:
    """环境配置"""
    workface_data: List[Dict]           # 工作面数据
    monthly_target: float = 100000      # 月产量目标 (吨)
    max_steps: int = 120                # 最大时间步 (月)
    ventilation_capacity: float = 5000  # 通风能力
    transport_capacity: float = 1000    # 运输能力
    max_workfaces: int = 30             # 最大工作面数量

    # 生产参数
    monthly_tunneling_rate: float = 200.0   # 月掘进速度 (m)
    monthly_advance_rate: float = 100.0     # 月推进速度 (m)
    equipment_move_speed: float = 100.0     # 设备搬家速度 (m/天)
    coal_density: float = 1.4               # 煤炭密度 (t/m³)

    # 随机性参数
    enable_stochasticity: bool = True       # 是否启用随机性
    geology_variance: float = 0.1           # 地质条件波动
    failure_probability: float = 0.05       # 设备故障概率
    tunneling_variance: float = 0.15        # 掘进进度波动


class ActionType:
    """动作类型"""
    WAIT = 0                   # 等待（维持当前状态）
    START_PREP = 1             # 开始准备某工作面
    START_MINING = 2           # 开始回采某工作面
    MOVE_EQUIPMENT = 3         # 设备搬家到某工作面


class MineSuccessionEnv:
    """矿井工作面接续仿真环境"""

    def __init__(self, config: EnvironmentConfig):
        self.config = config
        self.workfaces: List[WorkfaceState] = []
        self.state: Optional[MineState] = None
        self.step_count = 0
        self.reward_config = RewardConfig()

        # 初始化工作面
        self._init_workfaces(config.workface_data)

        # 计算空间维度
        self.observation_space_dim = get_state_dim(config.max_workfaces)
        self.action_space_dim = 1 + 3 * len(self.workfaces)  # WAIT + 3种动作 × 工作面数

    def _init_workfaces(self, workface_data: List[Dict]):
        """从设计数据初始化工作面"""
        self.workfaces = []
        for wf_data in workface_data:
            # 计算储量
            length = wf_data.get('length', 200)
            width = wf_data.get('width', 1000)
            thickness = wf_data.get('avgThickness', 2.0)
            reserves = length * width * thickness * self.config.coal_density / 10000  # 万吨

            wf = WorkfaceState(
                id=wf_data.get('id', f"WF-{len(self.workfaces)+1:02d}"),
                status=0,  # 初始状态：待准备
                length=length,
                advance_length=width,
                current_advance=0,
                avg_thickness=thickness,
                avg_score=wf_data.get('avgScore', 75),
                reserves=reserves,
                center_x=wf_data.get('center_x', 0),
                center_y=wf_data.get('center_y', 0),
                transport_lane_length=width,
                return_lane_length=width,
                cut_length=length,
                transport_lane_progress=0,
                return_lane_progress=0,
                cut_progress=0,
                equipment_installed=False,
            )
            self.workfaces.append(wf)

    def reset(self) -> np.ndarray:
        """重置环境"""
        self.step_count = 0

        # 重置所有工作面状态
        for wf in self.workfaces:
            wf.status = 0
            wf.current_advance = 0
            wf.transport_lane_progress = 0
            wf.return_lane_progress = 0
            wf.cut_progress = 0
            wf.equipment_installed = False
            wf.prep_start_time = None
            wf.mining_start_time = None
            wf.estimated_end_time = None

        # 初始化全局状态
        self.state = MineState(
            current_step=0,
            workfaces=self.workfaces,
            equipment_location=None,
            equipment_status=0,
            equipment_arrival_time=None,
            monthly_production=0,
            cumulative_production=0,
            production_target=self.config.monthly_target,
            ventilation_capacity=self.config.ventilation_capacity,
            transport_capacity=self.config.transport_capacity,
            cumulative_cost=0,
            cumulative_revenue=0,
        )

        return encode_state(self.state, self.config.max_workfaces)

    def step(self, action: int) -> Tuple[np.ndarray, float, bool, Dict]:
        """
        执行一步

        Args:
            action: 动作索引

        Returns:
            (observation, reward, done, info)
        """
        # 解析动作
        action_type, target_id = self._decode_action(action)

        # 保存当前状态用于计算奖励
        prev_state = deepcopy(self.state)

        # 状态转移
        self._transition(action_type, target_id)

        # 计算奖励
        reward = calculate_reward(
            prev_state, action_type, target_id,
            self.state, self.reward_config
        )

        # 更新步数
        self.step_count += 1

        # 判断终止
        done = self._is_terminal()

        # 额外信息
        info = {
            'step': self.step_count,
            'monthly_production': self.state.monthly_production,
            'cumulative_production': self.state.cumulative_production,
            'mining_faces': len([wf for wf in self.state.workfaces if wf.status == 3]),
            'ready_faces': len([wf for wf in self.state.workfaces if wf.status == 2]),
            'completed_faces': len([wf for wf in self.state.workfaces if wf.status == 4]),
        }

        return encode_state(self.state, self.config.max_workfaces), reward, done, info

    def _decode_action(self, action: int) -> Tuple[int, Optional[str]]:
        """解析动作索引"""
        n_workfaces = len(self.workfaces)

        if action == 0:
            return ActionType.WAIT, None

        action -= 1

        if action < n_workfaces:
            return ActionType.START_PREP, self.workfaces[action].id

        action -= n_workfaces

        if action < n_workfaces:
            return ActionType.START_MINING, self.workfaces[action].id

        action -= n_workfaces

        if action < n_workfaces:
            return ActionType.MOVE_EQUIPMENT, self.workfaces[action].id

        return ActionType.WAIT, None

    def _transition(self, action_type: int, target_id: Optional[str]):
        """状态转移"""
        # 1. 执行动作
        if action_type == ActionType.START_PREP and target_id:
            wf = self._get_workface(target_id)
            if wf and wf.status == 0:
                wf.status = 1  # 准备中
                wf.prep_start_time = self.state.current_step

        elif action_type == ActionType.START_MINING and target_id:
            wf = self._get_workface(target_id)
            if wf and wf.status == 2 and wf.equipment_installed:
                wf.status = 3  # 在采
                wf.mining_start_time = self.state.current_step
                self.state.equipment_status = 1  # 生产中

        elif action_type == ActionType.MOVE_EQUIPMENT and target_id:
            wf = self._get_workface(target_id)
            if wf and wf.status == 2 and not wf.equipment_installed:
                if self.state.equipment_status == 0:  # 设备空闲
                    self.state.equipment_status = 2  # 搬家中
                    # 计算搬家时间
                    move_distance = self._calculate_move_distance(target_id)
                    move_days = move_distance / self.config.equipment_move_speed
                    move_months = max(1, int(move_days / 30))
                    self.state.equipment_arrival_time = self.state.current_step + move_months

        # 2. 时间推进
        self.state.current_step += 1

        # 3. 检查设备到达
        if (self.state.equipment_status == 2 and
            self.state.equipment_arrival_time and
            self.state.current_step >= self.state.equipment_arrival_time):
            # 找到目标工作面并安装设备
            for wf in self.state.workfaces:
                if wf.status == 2 and not wf.equipment_installed:
                    wf.equipment_installed = True
                    self.state.equipment_location = wf.id
                    self.state.equipment_status = 0  # 空闲
                    self.state.equipment_arrival_time = None
                    break

        # 4. 更新所有工作面状态
        for wf in self.state.workfaces:
            self._update_workface_progress(wf)

        # 5. 计算当月产量
        self.state.monthly_production = self._calculate_monthly_production()
        self.state.cumulative_production += self.state.monthly_production

    def _get_workface(self, wf_id: str) -> Optional[WorkfaceState]:
        """获取工作面"""
        for wf in self.state.workfaces:
            if wf.id == wf_id:
                return wf
        return None

    def _calculate_move_distance(self, target_id: str) -> float:
        """计算设备搬家距离"""
        if self.state.equipment_location is None:
            return 500.0  # 默认距离

        source_wf = self._get_workface(self.state.equipment_location)
        target_wf = self._get_workface(target_id)

        if source_wf and target_wf:
            return np.sqrt((source_wf.center_x - target_wf.center_x)**2 +
                          (source_wf.center_y - target_wf.center_y)**2)
        return 500.0

    def _update_workface_progress(self, wf: WorkfaceState):
        """更新工作面进度"""
        if wf.status == 1:  # 准备中
            # 计算月掘进进度
            monthly_progress = self.config.monthly_tunneling_rate

            # 添加随机波动
            if self.config.enable_stochasticity:
                factor = np.random.normal(1.0, self.config.tunneling_variance)
                monthly_progress *= max(0.5, factor)

            # 更新巷道掘进进度
            wf.transport_lane_progress += monthly_progress / wf.transport_lane_length
            wf.return_lane_progress += monthly_progress / wf.return_lane_length

            # 当两条顺槽完成后开始切眼
            if wf.transport_lane_progress >= 1.0 and wf.return_lane_progress >= 1.0:
                wf.cut_progress += monthly_progress / wf.cut_length

            # 限制进度不超过1
            wf.transport_lane_progress = min(1.0, wf.transport_lane_progress)
            wf.return_lane_progress = min(1.0, wf.return_lane_progress)
            wf.cut_progress = min(1.0, wf.cut_progress)

            # 检查是否准备完成
            if all([wf.transport_lane_progress >= 1.0,
                    wf.return_lane_progress >= 1.0,
                    wf.cut_progress >= 1.0]):
                wf.status = 2  # 待采

        elif wf.status == 3:  # 在采
            # 计算月推进量
            monthly_advance = self.config.monthly_advance_rate

            # 地质条件影响
            geology_factor = wf.avg_score / 75.0  # 评分75为基准

            # 添加随机波动
            if self.config.enable_stochasticity:
                random_factor = np.random.normal(1.0, self.config.geology_variance)
                monthly_advance *= geology_factor * max(0.5, random_factor)

                # 设备故障
                if np.random.random() < self.config.failure_probability:
                    monthly_advance *= 0.5  # 故障导致产量减半
            else:
                monthly_advance *= geology_factor

            wf.current_advance += monthly_advance

            # 检查是否回采完成
            if wf.current_advance >= wf.advance_length:
                wf.status = 4  # 已采
                wf.current_advance = wf.advance_length
                self.state.equipment_status = 0  # 设备空闲
                self.state.equipment_location = wf.id

    def _calculate_monthly_production(self) -> float:
        """计算当月产量"""
        production = 0.0

        for wf in self.state.workfaces:
            if wf.status == 3:  # 在采
                # 月产量 = 月推进量 × 工作面长度 × 煤厚 × 密度
                monthly_advance = min(
                    self.config.monthly_advance_rate,
                    wf.advance_length - wf.current_advance + self.config.monthly_advance_rate
                )
                production += monthly_advance * wf.length * wf.avg_thickness * self.config.coal_density

        return production

    def _is_terminal(self) -> bool:
        """判断是否终止"""
        # 条件1：所有工作面开采完成
        if all(wf.status == 4 for wf in self.state.workfaces):
            return True

        # 条件2：超过最大时间步
        if self.step_count >= self.config.max_steps:
            return True

        # 条件3：无法继续（陷入死锁）
        if self._is_deadlock():
            return True

        return False

    def _is_deadlock(self) -> bool:
        """检查是否陷入死锁"""
        # 如果没有在采工作面，且没有待采工作面，且还有未完成的工作面
        mining = any(wf.status == 3 for wf in self.state.workfaces)
        ready = any(wf.status == 2 for wf in self.state.workfaces)
        preparing = any(wf.status == 1 for wf in self.state.workfaces)
        pending = any(wf.status == 0 for wf in self.state.workfaces)
        completed = all(wf.status == 4 for wf in self.state.workfaces)

        if completed:
            return False

        # 如果没有任何活动且还有未完成的工作面
        if not mining and not ready and not preparing and pending:
            return False  # 还可以开始准备

        if not mining and not ready and not preparing and not pending:
            return True  # 真正的死锁

        return False

    def get_valid_action_mask(self) -> np.ndarray:
        """生成合法动作掩码"""
        n_workfaces = len(self.workfaces)
        mask = np.zeros(1 + 3 * n_workfaces, dtype=np.float32)

        # WAIT 总是合法的
        mask[0] = 1.0

        for i, wf in enumerate(self.state.workfaces):
            # START_PREP: 只有"待准备"状态的工作面
            if wf.status == 0:
                if self._can_start_prep(wf):
                    mask[1 + i] = 1.0

            # START_MINING: 只有"待采"状态且设备就位
            if wf.status == 2 and wf.equipment_installed:
                if self.state.equipment_status == 0:  # 设备空闲
                    mask[1 + n_workfaces + i] = 1.0

            # MOVE_EQUIPMENT: 设备空闲且目标工作面准备完成但设备未安装
            if wf.status == 2 and not wf.equipment_installed:
                if self.state.equipment_status == 0:
                    mask[1 + 2 * n_workfaces + i] = 1.0

        return mask

    def _can_start_prep(self, wf: WorkfaceState) -> bool:
        """检查是否可以开始准备工作面"""
        # 基本检查：状态必须是待准备
        if wf.status != 0:
            return False

        # 可以添加更多约束，如：
        # - 同时准备的工作面数量限制
        # - 相邻工作面约束
        preparing_count = sum(1 for w in self.state.workfaces if w.status == 1)
        if preparing_count >= 3:  # 最多同时准备3个工作面
            return False

        return True

    def render(self) -> Dict:
        """渲染当前状态（返回可视化数据）"""
        return {
            'step': self.state.current_step,
            'workfaces': [
                {
                    'id': wf.id,
                    'status': wf.status,
                    'status_name': ['待准备', '准备中', '待采', '在采', '已采'][wf.status],
                    'progress': wf.current_advance / wf.advance_length if wf.advance_length > 0 else 0,
                    'prep_progress': (wf.transport_lane_progress + wf.return_lane_progress + wf.cut_progress) / 3,
                    'reserves': wf.reserves,
                    'center_x': wf.center_x,
                    'center_y': wf.center_y,
                }
                for wf in self.state.workfaces
            ],
            'equipment': {
                'location': self.state.equipment_location,
                'status': ['空闲', '生产中', '搬家中'][self.state.equipment_status],
            },
            'production': {
                'monthly': self.state.monthly_production,
                'cumulative': self.state.cumulative_production,
                'target': self.state.production_target,
            }
        }


def create_env_from_design(design_result: Dict) -> MineSuccessionEnv:
    """从工作面设计结果创建RL环境"""
    workface_data = []

    panels = design_result.get('panels', [])
    for panel in panels:
        workface_data.append({
            'id': panel.get('id', f"WF-{len(workface_data)+1:02d}"),
            'length': panel.get('length', 200),
            'width': panel.get('width', 1000),
            'center_x': panel.get('center_x', 0),
            'center_y': panel.get('center_y', 0),
            'avgThickness': panel.get('avgThickness', 2.0),
            'avgScore': panel.get('avgScore', 75),
        })

    config = EnvironmentConfig(
        workface_data=workface_data,
        monthly_target=design_result.get('monthly_target', 100000),
        max_steps=design_result.get('max_steps', 120),
    )

    return MineSuccessionEnv(config)
