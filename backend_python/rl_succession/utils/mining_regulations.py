"""
采矿工作规程约束模块
基于《煤矿安全规程》《煤矿井下工作面安全技术规范》等标准
"""
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from enum import Enum
import numpy as np


class MiningMethod(Enum):
    """采煤方法"""
    LONGWALL_FULL = "走向长壁全部垮落法"
    LONGWALL_FILL = "走向长壁充填法"
    INCLINE_LONGWALL = "倾斜长壁法"
    ROOM_PILLAR = "房柱式"
    TOP_COAL_CAVING = "放顶煤"


class EquipmentType(Enum):
    """综采设备类型"""
    SHEARER = "采煤机"
    HYDRAULIC_SUPPORT = "液压支架"
    AFC = "前部刮板输送机"
    BSL = "后部刮板输送机"
    CRUSHER = "破碎机"
    BELT = "带式输送机"
    EMULSION_PUMP = "乳化液泵站"
    ELECTRIC_SYSTEM = "供电系统"


@dataclass
class MiningRegulationConfig:
    """采矿规程约束配置"""

    # ============ 工作面设计规范 ============
    # 工作面长度限制 (m)
    min_face_length: float = 100.0  # 最小工作面长度
    max_face_length: float = 350.0  # 最大工作面长度（大采高一般不超过300m）
    recommended_face_length: Tuple[float, float] = (150.0, 280.0)  # 推荐长度范围

    # 推进长度限制 (m)
    min_advance_length: float = 500.0   # 最小推进长度
    max_advance_length: float = 3500.0  # 最大推进长度

    # 煤层厚度限制 (m)
    min_thickness: float = 0.8   # 薄煤层下限
    thin_coal_threshold: float = 1.3   # 薄煤层上限
    medium_coal_threshold: float = 3.5  # 中厚煤层上限
    thick_coal_threshold: float = 8.0   # 厚煤层上限

    # ============ 安全间距要求 ============
    # 工作面最小安全间距 (m)
    min_safe_distance: float = 300.0  # 两个在采工作面最小距离
    min_goaf_distance: float = 50.0   # 工作面距采空区最小距离

    # 跳采间隔要求
    skip_mining_distance: float = 200.0  # 跳采时留设煤柱宽度

    # ============ 采掘比例约束 ============
    # 采掘比 (回采进度/掘进进度)
    max_mining_tunneling_ratio: float = 1.5  # 最大采掘比
    min_mining_tunneling_ratio: float = 0.5  # 最小采掘比
    recommended_ratio: float = 1.0  # 推荐采掘比

    # 同时作业工作面限制
    max_simultaneous_mining_faces: int = 2    # 最多同时回采工作面数
    max_simultaneous_prep_faces: int = 4      # 最多同时准备工作面数
    max_tunneling_faces: int = 6              # 最多同时掘进头数

    # ============ 生产能力约束 ============
    # 日产量约束 (万吨/天)
    max_daily_output_per_face: float = 3.0  # 单工作面日产量上限
    min_daily_output_per_face: float = 0.5  # 单工作面日产量下限

    # 月推进速度 (m/月)
    min_monthly_advance: float = 60.0   # 最低月推进
    max_monthly_advance: float = 350.0  # 最高月推进（高效矿井可达300m以上）
    recommended_advance: float = 100.0   # 推荐月推进

    # ============ 掘进速度约束 ============
    # 综掘机月进尺 (m/月)
    roadheader_monthly_rate: float = 300.0
    # 炮掘月进尺 (m/月)
    drilling_blasting_monthly_rate: float = 150.0
    # 顺槽掘进速度 (m/月)
    entry_tunneling_rate: float = 200.0
    # 开切眼掘进速度 (m/月)
    cut_tunneling_rate: float = 150.0

    # ============ 设备搬家约束 ============
    # 设备搬家时间 (天)
    equipment_disassembly_days: int = 15    # 设备拆除时间
    equipment_transport_days: int = 10       # 设备运输时间（与距离相关）
    equipment_installation_days: int = 20    # 设备安装时间
    equipment_testing_days: int = 5          # 设备调试时间
    min_relocation_days: int = 45            # 最短搬家周期
    max_relocation_days: int = 90            # 最长搬家周期

    # 设备搬家速度 (m/天) - 井下运输速度
    equipment_transport_speed: float = 50.0

    # ============ 通风约束 ============
    # 风量要求 (m³/min)
    min_face_air_volume: float = 600.0   # 工作面最低风量
    min_air_velocity: float = 0.25       # 最低风速 (m/s)
    max_air_velocity: float = 4.0        # 最高风速 (m/s)

    # 通风能力利用率
    max_ventilation_utilization: float = 0.85  # 最大通风能力利用率

    # ============ 顶板管理约束 ============
    # 初次来压步距 (m)
    first_weighting_interval: float = 40.0
    first_weighting_variance: float = 5.0

    # 周期来压步距 (m)
    periodic_weighting_interval: float = 15.0
    periodic_weighting_variance: float = 3.0

    # 端头支护距离 (m)
    end_support_distance: float = 20.0

    # ============ 瓦斯约束 ============
    # 瓦斯等级相关
    low_gas_threshold: float = 5.0       # 低瓦斯矿井阈值 (m³/min)
    high_gas_threshold: float = 40.0     # 高瓦斯矿井阈值 (m³/min)

    # 瓦斯抽采率要求
    min_gas_drainage_rate: float = 0.3   # 最低抽采率

    # ============ 水文地质约束 ============
    # 涌水量限制 (m³/h)
    max_water_inflow: float = 300.0

    # 探放水超前距离 (m)
    water_detection_distance: float = 60.0

    # ============ 工期约束 ============
    # 工作面准备工期 (月)
    min_prep_period: int = 3   # 最短准备期
    max_prep_period: int = 18  # 最长准备期
    recommended_prep_period: int = 6  # 推荐准备期

    # 末采期要求
    end_mining_period_days: int = 30  # 末采期天数

    # ============ 接续约束 ============
    # 接续提前量 (月)
    succession_lead_time: int = 3  # 接续工作面需提前准备的月数
    min_ready_faces: int = 1  # 最少待采工作面数
    recommended_ready_faces: int = 2  # 推荐待采工作面数


@dataclass
class DetailedTimeSchedule:
    """详细时间计划"""

    @dataclass
    class TunnelingPhase:
        """掘进阶段"""
        name: str
        start_date: str  # YYYY-MM-DD
        end_date: str
        start_day: int   # 从计划开始的天数
        end_day: int
        length: float    # 掘进长度 (m)
        rate: float      # 日进尺 (m/天)
        crew: str        # 作业队组

    @dataclass
    class MiningPhase:
        """回采阶段"""
        name: str
        start_date: str
        end_date: str
        start_day: int
        end_day: int
        advance: float   # 推进长度 (m)
        daily_advance: float  # 日推进 (m/天)
        daily_output: float   # 日产量 (吨)
        monthly_output: float # 月产量 (吨)

    @dataclass
    class EquipmentRelocation:
        """设备搬家"""
        from_face: str
        to_face: str
        start_date: str
        end_date: str
        start_day: int
        end_day: int
        distance: float  # 搬家距离 (m)
        phases: List[Dict]  # 各阶段详情

    @dataclass
    class VentilationChange:
        """通风系统变化"""
        date: str
        day: int
        event: str  # 事件类型
        description: str
        affected_faces: List[str]
        air_volume_before: float
        air_volume_after: float


@dataclass
class WorkfaceDetailedPlan:
    """工作面详细计划"""
    workface_id: str
    workface_name: str

    # 基本参数
    length: float           # 工作面长度 (m)
    advance_length: float   # 推进长度 (m)
    coal_thickness: float   # 煤厚 (m)
    reserves: float         # 可采储量 (万吨)
    geological_score: float # 地质评分

    # 空间位置
    center_x: float
    center_y: float

    # 掘进计划
    transport_entry_plan: DetailedTimeSchedule.TunnelingPhase  # 运输顺槽
    return_entry_plan: DetailedTimeSchedule.TunnelingPhase     # 回风顺槽
    cut_plan: DetailedTimeSchedule.TunnelingPhase              # 开切眼

    # 设备安装计划
    equipment_installation: Dict  # 设备安装详情

    # 回采计划
    mining_plan: DetailedTimeSchedule.MiningPhase

    # 关键时间节点
    prep_start_day: int      # 准备开始天数
    prep_start_date: str     # 准备开始日期
    tunneling_complete_day: int   # 掘进完成天数
    tunneling_complete_date: str  # 掘进完成日期
    equipment_ready_day: int  # 设备安装完成天数
    equipment_ready_date: str # 设备安装完成日期
    mining_start_day: int    # 回采开始天数
    mining_start_date: str   # 回采开始日期
    mining_end_day: int      # 回采结束天数
    mining_end_date: str     # 回采结束日期

    # 产量计划
    monthly_production_plan: List[Dict]  # 按月产量计划
    weekly_production_plan: List[Dict]   # 按周产量计划

    # 特殊工序时间
    first_weighting_day: int     # 初次来压预计天数
    periodic_weighting_days: List[int]  # 周期来压预计天数
    end_mining_start_day: int    # 末采开始天数


class MiningRegulationChecker:
    """采矿规程检查器"""

    def __init__(self, config: MiningRegulationConfig = None):
        self.config = config or MiningRegulationConfig()
        self.violations = []
        self.warnings = []

    def check_workface_design(self, workface: Dict) -> Dict:
        """检查工作面设计是否符合规程"""
        self.violations = []
        self.warnings = []

        length = workface.get('length', 0)
        advance = workface.get('advance_length', workface.get('width', 0))
        thickness = workface.get('avgThickness', workface.get('thickness', 0))

        # 检查工作面长度
        if length < self.config.min_face_length:
            self.violations.append(f"工作面长度{length}m小于最小限制{self.config.min_face_length}m")
        elif length > self.config.max_face_length:
            self.violations.append(f"工作面长度{length}m超过最大限制{self.config.max_face_length}m")
        elif not (self.config.recommended_face_length[0] <= length <= self.config.recommended_face_length[1]):
            self.warnings.append(f"工作面长度{length}m不在推荐范围{self.config.recommended_face_length}")

        # 检查推进长度
        if advance < self.config.min_advance_length:
            self.warnings.append(f"推进长度{advance}m小于推荐最小值{self.config.min_advance_length}m")
        elif advance > self.config.max_advance_length:
            self.violations.append(f"推进长度{advance}m超过最大限制{self.config.max_advance_length}m")

        # 检查煤厚
        coal_type = self._get_coal_type(thickness)

        return {
            'valid': len(self.violations) == 0,
            'violations': self.violations,
            'warnings': self.warnings,
            'coal_type': coal_type,
            'recommendations': self._get_recommendations(workface),
        }

    def _get_coal_type(self, thickness: float) -> str:
        """获取煤层类型"""
        if thickness < self.config.thin_coal_threshold:
            return "薄煤层"
        elif thickness < self.config.medium_coal_threshold:
            return "中厚煤层"
        elif thickness < self.config.thick_coal_threshold:
            return "厚煤层"
        else:
            return "特厚煤层"

    def _get_recommendations(self, workface: Dict) -> List[str]:
        """获取设计建议"""
        recommendations = []
        thickness = workface.get('avgThickness', 2.0)

        if thickness > self.config.medium_coal_threshold:
            recommendations.append("建议采用放顶煤采煤法或大采高采煤法")

        if thickness < self.config.thin_coal_threshold:
            recommendations.append("建议采用薄煤层综采设备或刨煤机")

        return recommendations

    def check_simultaneous_operations(self, state: Dict) -> Dict:
        """检查同时作业约束"""
        self.violations = []
        self.warnings = []

        mining_count = state.get('mining_faces', 0)
        preparing_count = state.get('preparing_faces', 0)
        tunneling_count = state.get('tunneling_faces', 0)

        # 检查回采工作面数
        if mining_count > self.config.max_simultaneous_mining_faces:
            self.violations.append(
                f"同时回采工作面{mining_count}个超过限制{self.config.max_simultaneous_mining_faces}个"
            )

        # 检查准备工作面数
        if preparing_count > self.config.max_simultaneous_prep_faces:
            self.warnings.append(
                f"同时准备工作面{preparing_count}个超过推荐{self.config.max_simultaneous_prep_faces}个"
            )

        # 检查掘进头数
        if tunneling_count > self.config.max_tunneling_faces:
            self.warnings.append(
                f"同时掘进头{tunneling_count}个超过推荐{self.config.max_tunneling_faces}个"
            )

        return {
            'valid': len(self.violations) == 0,
            'violations': self.violations,
            'warnings': self.warnings,
        }

    def check_succession_status(self, mining_faces: List[Dict], ready_faces: List[Dict]) -> Dict:
        """检查接续状态"""
        self.violations = []
        self.warnings = []

        # 检查是否有接续工作面
        if len(mining_faces) > 0 and len(ready_faces) < self.config.min_ready_faces:
            self.warnings.append(
                f"待采工作面{len(ready_faces)}个小于最低要求{self.config.min_ready_faces}个"
            )

        if len(ready_faces) < self.config.recommended_ready_faces:
            self.warnings.append(
                f"待采工作面{len(ready_faces)}个小于推荐数量{self.config.recommended_ready_faces}个"
            )

        # 检查在采工作面剩余采期
        for face in mining_faces:
            remaining_months = face.get('remaining_months', 0)
            if remaining_months <= self.config.succession_lead_time and len(ready_faces) == 0:
                self.violations.append(
                    f"工作面{face.get('id')}剩余{remaining_months}个月，但无接续工作面"
                )

        return {
            'valid': len(self.violations) == 0,
            'violations': self.violations,
            'warnings': self.warnings,
        }

    def calculate_equipment_relocation_time(
        self,
        distance: float,
        equipment_type: str = 'full_mechanized'
    ) -> Dict:
        """计算设备搬家时间"""
        config = self.config

        # 基础时间
        disassembly = config.equipment_disassembly_days
        installation = config.equipment_installation_days
        testing = config.equipment_testing_days

        # 运输时间（与距离相关）
        transport = max(
            config.equipment_transport_days,
            int(distance / config.equipment_transport_speed) + 1
        )

        total_days = disassembly + transport + installation + testing

        # 确保在合理范围内
        total_days = max(config.min_relocation_days, min(total_days, config.max_relocation_days))

        return {
            'total_days': total_days,
            'phases': {
                'disassembly': {
                    'name': '设备拆除',
                    'days': disassembly,
                    'start_day': 0,
                    'end_day': disassembly,
                },
                'transport': {
                    'name': '设备运输',
                    'days': transport,
                    'start_day': disassembly,
                    'end_day': disassembly + transport,
                    'distance': distance,
                },
                'installation': {
                    'name': '设备安装',
                    'days': installation,
                    'start_day': disassembly + transport,
                    'end_day': disassembly + transport + installation,
                },
                'testing': {
                    'name': '设备调试',
                    'days': testing,
                    'start_day': disassembly + transport + installation,
                    'end_day': total_days,
                },
            },
        }

    def calculate_tunneling_schedule(
        self,
        transport_length: float,
        return_length: float,
        cut_length: float,
        tunneling_method: str = 'roadheader'
    ) -> Dict:
        """计算掘进工程进度"""
        config = self.config

        # 根据掘进方式确定速度
        if tunneling_method == 'roadheader':
            entry_rate = config.roadheader_monthly_rate
        else:
            entry_rate = config.drilling_blasting_monthly_rate

        cut_rate = config.cut_tunneling_rate

        # 计算工期
        transport_months = transport_length / entry_rate
        return_months = return_length / entry_rate

        # 两顺槽可并行掘进
        parallel_months = max(transport_months, return_months)

        # 开切眼需在顺槽贯通后开始
        cut_months = cut_length / cut_rate

        total_months = parallel_months + cut_months
        total_days = int(total_months * 30)

        return {
            'total_days': total_days,
            'total_months': round(total_months, 1),
            'phases': {
                'transport_entry': {
                    'name': '运输顺槽',
                    'length': transport_length,
                    'rate': round(entry_rate, 1),
                    'days': int(transport_months * 30),
                    'start_day': 0,
                    'end_day': int(parallel_months * 30),
                    'parallel': True,
                },
                'return_entry': {
                    'name': '回风顺槽',
                    'length': return_length,
                    'rate': round(entry_rate, 1),
                    'days': int(return_months * 30),
                    'start_day': 0,
                    'end_day': int(parallel_months * 30),
                    'parallel': True,
                },
                'cut': {
                    'name': '开切眼',
                    'length': cut_length,
                    'rate': round(cut_rate, 1),
                    'days': int(cut_months * 30),
                    'start_day': int(parallel_months * 30),
                    'end_day': total_days,
                    'parallel': False,
                },
            },
        }

    def calculate_mining_schedule(
        self,
        face_length: float,
        advance_length: float,
        thickness: float,
        geological_score: float,
        coal_density: float = 1.4
    ) -> Dict:
        """计算回采进度计划"""
        config = self.config

        # 根据地质条件调整推进速度
        geology_factor = geological_score / 75.0
        base_advance = config.recommended_advance * geology_factor

        # 根据煤厚调整（厚煤层推进较慢）
        thickness_factor = 1.0 if thickness <= 3.5 else 0.8
        daily_advance = base_advance / 30 * thickness_factor

        # 日产量
        daily_output = daily_advance * face_length * thickness * coal_density
        monthly_output = daily_output * 30

        # 总工期
        total_days = int(advance_length / daily_advance)
        total_months = total_days / 30

        # 初次来压和周期来压
        first_weighting = int(config.first_weighting_interval / daily_advance)
        periodic_interval = int(config.periodic_weighting_interval / daily_advance)

        periodic_weightings = []
        current_day = first_weighting
        while current_day < total_days:
            periodic_weightings.append(current_day)
            current_day += periodic_interval

        # 末采期
        end_mining_start = total_days - config.end_mining_period_days

        # 按月分解产量
        monthly_plan = []
        remaining_advance = advance_length
        month = 1
        cumulative_advance = 0

        while remaining_advance > 0:
            month_advance = min(base_advance * thickness_factor, remaining_advance)
            month_output = month_advance * face_length * thickness * coal_density

            cumulative_advance += month_advance
            remaining_advance -= month_advance

            monthly_plan.append({
                'month': month,
                'advance': round(month_advance, 1),
                'cumulative_advance': round(cumulative_advance, 1),
                'output': round(month_output, 0),
                'cumulative_output': round(cumulative_advance * face_length * thickness * coal_density, 0),
                'completion_rate': round(cumulative_advance / advance_length * 100, 1),
            })
            month += 1

        # 按周分解产量
        weekly_plan = []
        week_days = 7
        remaining_days = total_days
        week = 1
        cumulative_days = 0

        while remaining_days > 0:
            week_advance = min(daily_advance * week_days, remaining_advance)
            week_output = week_advance * face_length * thickness * coal_density

            cumulative_days += week_days
            remaining_days -= week_days

            if week <= 52:  # 只记录前52周
                weekly_plan.append({
                    'week': week,
                    'advance': round(daily_advance * week_days, 1),
                    'output': round(week_output, 0),
                })
            week += 1

        return {
            'total_days': total_days,
            'total_months': round(total_months, 1),
            'daily_advance': round(daily_advance, 2),
            'monthly_advance': round(base_advance * thickness_factor, 1),
            'daily_output': round(daily_output, 0),
            'monthly_output': round(monthly_output, 0),
            'total_output': round(advance_length * face_length * thickness * coal_density, 0),
            'first_weighting_day': first_weighting,
            'periodic_weighting_days': periodic_weightings[:10],  # 前10次周期来压
            'end_mining_start_day': end_mining_start,
            'monthly_plan': monthly_plan,
            'weekly_plan': weekly_plan[:12],  # 前12周
        }


class VentilationPlanner:
    """通风系统规划"""

    def __init__(self, config: MiningRegulationConfig = None):
        self.config = config or MiningRegulationConfig()

    def calculate_face_air_requirement(
        self,
        face_length: float,
        thickness: float,
        daily_advance: float,
        gas_emission: float = 5.0  # m³/min
    ) -> Dict:
        """计算工作面风量需求"""
        config = self.config

        # 按人员需求计算
        max_workers = 30  # 工作面最多人数
        air_per_person = 4  # m³/min·人
        air_by_person = max_workers * air_per_person

        # 按瓦斯涌出量计算
        safe_gas_concentration = 0.01  # 1%
        air_by_gas = gas_emission / safe_gas_concentration

        # 按风速计算
        section_area = face_length * thickness * 0.8  # 有效通风断面
        air_by_velocity = section_area * config.min_air_velocity * 60

        # 取最大值
        required_air = max(
            air_by_person,
            air_by_gas,
            air_by_velocity,
            config.min_face_air_volume
        )

        return {
            'required_air_volume': round(required_air, 0),
            'calculation_basis': {
                'by_personnel': round(air_by_person, 0),
                'by_gas': round(air_by_gas, 0),
                'by_velocity': round(air_by_velocity, 0),
                'minimum': config.min_face_air_volume,
            },
            'section_area': round(section_area, 1),
            'recommended_velocity': round(required_air / section_area / 60, 2),
        }

    def plan_ventilation_changes(
        self,
        mining_schedule: List[Dict],
        total_capacity: float = 10000  # 矿井总风量 m³/min
    ) -> List[Dict]:
        """规划通风系统调整"""
        changes = []

        current_used = 0
        active_faces = []

        for event in sorted(mining_schedule, key=lambda x: x['start_day']):
            face_id = event['workface_id']
            required_air = event.get('required_air', 1000)

            if event['event_type'] == 'mining_start':
                # 新增回采工作面
                if current_used + required_air > total_capacity * self.config.max_ventilation_utilization:
                    changes.append({
                        'day': event['start_day'],
                        'event': '通风能力紧张',
                        'severity': 'warning',
                        'description': f'新增工作面{face_id}后通风能力利用率超过{self.config.max_ventilation_utilization*100}%',
                        'action': '需要调整通风系统或限制同时回采工作面数',
                    })

                active_faces.append(face_id)
                current_used += required_air

                changes.append({
                    'day': event['start_day'],
                    'event': '通风系统调整',
                    'severity': 'info',
                    'description': f'工作面{face_id}开始回采，调整风量分配',
                    'air_volume_before': current_used - required_air,
                    'air_volume_after': current_used,
                    'utilization': round(current_used / total_capacity * 100, 1),
                })

            elif event['event_type'] == 'mining_end':
                # 工作面回采结束
                if face_id in active_faces:
                    active_faces.remove(face_id)
                current_used -= required_air

                changes.append({
                    'day': event['end_day'],
                    'event': '通风系统调整',
                    'severity': 'info',
                    'description': f'工作面{face_id}回采结束，释放风量',
                    'air_volume_before': current_used + required_air,
                    'air_volume_after': current_used,
                    'utilization': round(current_used / total_capacity * 100, 1),
                })

        return changes


def create_default_regulation_config() -> MiningRegulationConfig:
    """创建默认的采矿规程配置"""
    return MiningRegulationConfig()


def validate_succession_plan(
    plan: Dict,
    workfaces: List[Dict],
    config: MiningRegulationConfig = None
) -> Dict:
    """验证接续方案是否符合规程"""
    if config is None:
        config = MiningRegulationConfig()

    checker = MiningRegulationChecker(config)
    all_violations = []
    all_warnings = []

    # 检查每个工作面设计
    for wf in workfaces:
        result = checker.check_workface_design(wf)
        all_violations.extend(result['violations'])
        all_warnings.extend(result['warnings'])

    # 检查接续安排
    schedule = plan.get('workface_schedule', {})

    # 检查时间冲突和安全间距
    for wf1_id, wf1_schedule in schedule.items():
        for wf2_id, wf2_schedule in schedule.items():
            if wf1_id >= wf2_id:
                continue

            # 检查是否同时回采
            if (wf1_schedule.get('mining_start') is not None and
                wf2_schedule.get('mining_start') is not None):

                wf1 = next((w for w in workfaces if w.get('id') == wf1_id), None)
                wf2 = next((w for w in workfaces if w.get('id') == wf2_id), None)

                if wf1 and wf2:
                    distance = np.sqrt(
                        (wf1.get('center_x', 0) - wf2.get('center_x', 0))**2 +
                        (wf1.get('center_y', 0) - wf2.get('center_y', 0))**2
                    )

                    if distance < config.min_safe_distance:
                        # 检查时间是否重叠
                        # 简化检查：假设回采期12个月
                        start1 = wf1_schedule['mining_start']
                        start2 = wf2_schedule['mining_start']

                        if abs(start1 - start2) < 12:  # 时间重叠
                            all_warnings.append(
                                f"工作面{wf1_id}和{wf2_id}距离{distance:.0f}m，"
                                f"小于安全距离{config.min_safe_distance}m，且回采时间重叠"
                            )

    return {
        'valid': len(all_violations) == 0,
        'violations': all_violations,
        'warnings': all_warnings,
        'violation_count': len(all_violations),
        'warning_count': len(all_warnings),
    }
