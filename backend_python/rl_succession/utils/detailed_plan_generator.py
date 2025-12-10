"""
详细接续计划生成器
基于采矿工作规程，生成贴近现场的详细开采计划
"""
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timedelta
from enum import Enum
import numpy as np

from .mining_regulations import (
    MiningRegulationConfig,
    MiningRegulationChecker,
    VentilationPlanner
)


class WorkPhase(Enum):
    """工序阶段"""
    SURVEY = "测量放线"
    TRANSPORT_ENTRY = "运输顺槽掘进"
    RETURN_ENTRY = "回风顺槽掘进"
    CUT_HOLE = "开切眼掘进"
    ENTRY_CONNECTION = "联巷施工"
    EQUIPMENT_CHAMBER = "机电硐室"
    DRAINAGE = "排水系统"
    VENTILATION_INSTALL = "通风设施安装"
    EQUIPMENT_TRANSPORT = "设备运输"
    SUPPORT_INSTALL = "支架安装"
    SHEARER_INSTALL = "采煤机安装"
    AFC_INSTALL = "刮板输送机安装"
    BELT_INSTALL = "皮带安装"
    ELECTRIC_INSTALL = "供电系统安装"
    COMMISSIONING = "联合试运转"
    FIRST_MINING = "初采"
    NORMAL_MINING = "正常回采"
    PERIODIC_WEIGHTING = "周期来压"
    END_MINING = "末采"
    EQUIPMENT_WITHDRAWAL = "设备回撤"


@dataclass
class WorkProcedure:
    """工序定义"""
    phase: WorkPhase
    name: str
    start_day: int
    end_day: int
    duration_days: int
    parallel_with: List[str] = field(default_factory=list)  # 可并行的工序
    depends_on: List[str] = field(default_factory=list)     # 前置工序
    resources: Dict = field(default_factory=dict)           # 所需资源
    description: str = ""
    milestones: List[Dict] = field(default_factory=list)    # 关键节点
    risks: List[str] = field(default_factory=list)          # 风险点
    safety_measures: List[str] = field(default_factory=list) # 安全措施


@dataclass
class DailyPlan:
    """日计划"""
    day: int
    date: str
    shift_plans: List[Dict]  # 三班计划
    target_advance: float    # 计划进尺
    target_output: float     # 计划产量
    active_procedures: List[str]  # 进行中的工序
    key_events: List[str]    # 关键事件
    safety_reminders: List[str]  # 安全提示


@dataclass
class WeeklyPlan:
    """周计划"""
    week: int
    start_date: str
    end_date: str
    target_advance: float
    target_output: float
    key_milestones: List[str]
    equipment_maintenance: List[str]
    safety_focus: List[str]


@dataclass
class MonthlyPlan:
    """月计划"""
    month: int
    year_month: str
    target_advance: float
    target_output: float
    cumulative_advance: float
    cumulative_output: float
    completion_rate: float
    key_events: List[Dict]
    resource_allocation: Dict
    cost_estimate: Dict


class DetailedPlanGenerator:
    """详细计划生成器"""

    def __init__(
        self,
        config: MiningRegulationConfig = None,
        start_date: str = None
    ):
        self.config = config or MiningRegulationConfig()
        self.checker = MiningRegulationChecker(self.config)
        self.ventilation = VentilationPlanner(self.config)

        # 设置开始日期
        if start_date:
            self.start_date = datetime.strptime(start_date, "%Y-%m-%d")
        else:
            self.start_date = datetime.now()

    def generate_detailed_plan(
        self,
        workfaces: List[Dict],
        succession_order: List[str],
        monthly_target: float = 100000
    ) -> Dict:
        """
        生成详细接续计划

        Args:
            workfaces: 工作面列表
            succession_order: 开采顺序
            monthly_target: 月产量目标（吨）

        Returns:
            详细计划
        """
        # 创建工作面索引
        wf_index = {wf['id']: wf for wf in workfaces}

        # 1. 生成每个工作面的详细计划
        workface_plans = {}
        current_day = 0
        equipment_available_day = 0  # 设备可用时间

        for order_idx, wf_id in enumerate(succession_order):
            if wf_id not in wf_index:
                continue

            wf = wf_index[wf_id]

            # 计算准备开始时间（考虑接续提前量）
            if order_idx == 0:
                prep_start_day = 0
            else:
                # 需要在前一个工作面回采结束前完成准备
                prev_wf_id = succession_order[order_idx - 1]
                if prev_wf_id in workface_plans:
                    prev_mining_end = workface_plans[prev_wf_id]['mining_end_day']
                    # 接续提前量（月）
                    lead_time_days = self.config.succession_lead_time * 30
                    prep_start_day = max(current_day, prev_mining_end - lead_time_days - 180)
                else:
                    prep_start_day = current_day

            # 生成工作面详细计划
            wf_plan = self._generate_workface_plan(
                wf,
                prep_start_day,
                equipment_available_day,
                monthly_target
            )

            workface_plans[wf_id] = wf_plan

            # 更新设备可用时间
            equipment_available_day = wf_plan['key_dates']['equipment_withdrawal_day']
            current_day = wf_plan['key_dates']['prep_start_day']

        # 2. 生成整体时间线
        timeline = self._generate_timeline(workface_plans, succession_order)

        # 3. 生成关键路径分析
        critical_path = self._analyze_critical_path(workface_plans, succession_order)

        # 4. 生成资源需求计划
        resource_plan = self._generate_resource_plan(workface_plans)

        # 5. 生成风险分析
        risk_analysis = self._analyze_risks(workface_plans, workfaces)

        # 6. 生成月度计划汇总
        monthly_summary = self._generate_monthly_summary(workface_plans)

        # 7. 生成甘特图数据（增强版）
        gantt_data = self._generate_enhanced_gantt(workface_plans)

        return {
            'succession_order': succession_order,
            'workface_plans': workface_plans,
            'timeline': timeline,
            'critical_path': critical_path,
            'resource_plan': resource_plan,
            'risk_analysis': risk_analysis,
            'monthly_summary': monthly_summary,
            'gantt_data': gantt_data,
            'summary': self._generate_summary(workface_plans, succession_order),
            'start_date': self.start_date.strftime("%Y-%m-%d"),
        }

    def _generate_workface_plan(
        self,
        wf: Dict,
        prep_start_day: int,
        equipment_available_day: int,
        monthly_target: float
    ) -> Dict:
        """生成单个工作面的详细计划"""

        wf_id = wf.get('id', 'Unknown')
        length = wf.get('length', 200)
        advance_length = wf.get('width', wf.get('advance_length', 1000))
        thickness = wf.get('avgThickness', 2.0)
        score = wf.get('avgScore', 75)

        # ========== 准备阶段工序 ==========
        procedures = []
        current_day = prep_start_day

        # 1. 测量放线（3天）
        survey = WorkProcedure(
            phase=WorkPhase.SURVEY,
            name="测量放线",
            start_day=current_day,
            end_day=current_day + 3,
            duration_days=3,
            description="工作面位置测量、中腰线标定",
            resources={'测量人员': 3, '仪器设备': 1},
            safety_measures=["检查顶板稳定性", "设置警戒标志"]
        )
        procedures.append(survey)
        current_day += 3

        # 2. 掘进工程（运输顺槽 + 回风顺槽并行）
        tunneling_schedule = self.checker.calculate_tunneling_schedule(
            transport_length=advance_length,
            return_length=advance_length,
            cut_length=length,
            tunneling_method='roadheader'
        )

        # 运输顺槽
        transport_entry = WorkProcedure(
            phase=WorkPhase.TRANSPORT_ENTRY,
            name="运输顺槽掘进",
            start_day=current_day,
            end_day=current_day + tunneling_schedule['phases']['transport_entry']['days'],
            duration_days=tunneling_schedule['phases']['transport_entry']['days'],
            parallel_with=["回风顺槽掘进"],
            description=f"长度{advance_length}m，综掘机施工",
            resources={'综掘机': 1, '掘进队': 1, '支护材料': advance_length * 2},
            milestones=self._generate_tunneling_milestones(advance_length, current_day),
            safety_measures=[
                "超前支护不少于循环进尺",
                "瓦斯检测每班不少于3次",
                "定期进行顶板离层监测"
            ],
            risks=["遇断层可能影响进度", "瓦斯涌出量变化"]
        )
        procedures.append(transport_entry)

        # 回风顺槽
        return_entry = WorkProcedure(
            phase=WorkPhase.RETURN_ENTRY,
            name="回风顺槽掘进",
            start_day=current_day,
            end_day=current_day + tunneling_schedule['phases']['return_entry']['days'],
            duration_days=tunneling_schedule['phases']['return_entry']['days'],
            parallel_with=["运输顺槽掘进"],
            description=f"长度{advance_length}m，综掘机施工",
            resources={'综掘机': 1, '掘进队': 1, '支护材料': advance_length * 2},
            milestones=self._generate_tunneling_milestones(advance_length, current_day),
            safety_measures=[
                "确保通风系统正常",
                "加强顶板管理",
                "做好防治水工作"
            ]
        )
        procedures.append(return_entry)

        entry_end_day = current_day + tunneling_schedule['phases']['transport_entry']['days']

        # 3. 开切眼
        cut_start = entry_end_day
        cut_schedule = tunneling_schedule['phases']['cut']
        cut_hole = WorkProcedure(
            phase=WorkPhase.CUT_HOLE,
            name="开切眼掘进",
            start_day=cut_start,
            end_day=cut_start + cut_schedule['days'],
            duration_days=cut_schedule['days'],
            depends_on=["运输顺槽掘进", "回风顺槽掘进"],
            description=f"长度{length}m，需贯通两条顺槽",
            resources={'掘进队': 2, '支护材料': length * 3},
            milestones=[
                {'day': cut_start + cut_schedule['days'] // 2, 'event': '切眼掘进过半'},
                {'day': cut_start + cut_schedule['days'], 'event': '切眼贯通'}
            ],
            safety_measures=[
                "贯通前30m加强支护",
                "做好瓦斯检查和通风管理",
                "贯通时人员撤离"
            ]
        )
        procedures.append(cut_hole)

        tunneling_end_day = cut_start + cut_schedule['days']

        # 4. 联巷及硐室施工（与切眼并行）
        connection_entry = WorkProcedure(
            phase=WorkPhase.ENTRY_CONNECTION,
            name="联巷施工",
            start_day=entry_end_day,
            end_day=entry_end_day + 15,
            duration_days=15,
            parallel_with=["开切眼掘进"],
            description="运输巷与回风巷联络巷、溜煤眼",
            resources={'掘进队': 1},
        )
        procedures.append(connection_entry)

        # 5. 机电硐室
        chamber = WorkProcedure(
            phase=WorkPhase.EQUIPMENT_CHAMBER,
            name="机电硐室施工",
            start_day=entry_end_day,
            end_day=entry_end_day + 20,
            duration_days=20,
            parallel_with=["开切眼掘进", "联巷施工"],
            description="泵站硐室、配电点硐室",
            resources={'施工队': 1},
        )
        procedures.append(chamber)

        prep_end_day = tunneling_end_day

        # ========== 安装阶段 ==========
        # 等待设备可用
        equipment_start_day = max(prep_end_day, equipment_available_day)

        # 设备搬家时间
        relocation = self.checker.calculate_equipment_relocation_time(
            distance=500,  # 默认距离
            equipment_type='full_mechanized'
        )

        # 6. 设备运输
        equipment_transport = WorkProcedure(
            phase=WorkPhase.EQUIPMENT_TRANSPORT,
            name="设备运输",
            start_day=equipment_start_day,
            end_day=equipment_start_day + relocation['phases']['transport']['days'],
            duration_days=relocation['phases']['transport']['days'],
            depends_on=["开切眼掘进"],
            description="综采设备从上一工作面运至本工作面",
            resources={'运输队': 2, '平板车': 5},
            milestones=[
                {'day': equipment_start_day + 3, 'event': '采煤机到位'},
                {'day': equipment_start_day + 5, 'event': '支架运输开始'},
                {'day': equipment_start_day + relocation['phases']['transport']['days'], 'event': '设备运输完成'}
            ]
        )
        procedures.append(equipment_transport)

        install_start = equipment_start_day + relocation['phases']['transport']['days']

        # 7. 支架安装
        support_install_days = relocation['phases']['installation']['days']
        support_install = WorkProcedure(
            phase=WorkPhase.SUPPORT_INSTALL,
            name="液压支架安装",
            start_day=install_start,
            end_day=install_start + support_install_days,
            duration_days=support_install_days,
            depends_on=["设备运输"],
            description=f"安装{int(length/1.75)}架液压支架",
            resources={'安装队': 2, '起重设备': 2},
            milestones=self._generate_support_install_milestones(length, install_start),
            safety_measures=[
                "支架安装严格按顺序",
                "初撑力必须达到规定值",
                "安装过程中注意顶板管理"
            ]
        )
        procedures.append(support_install)

        # 8. 采煤机安装（与支架安装部分并行）
        shearer_start = install_start + 5
        shearer_install = WorkProcedure(
            phase=WorkPhase.SHEARER_INSTALL,
            name="采煤机安装调试",
            start_day=shearer_start,
            end_day=shearer_start + 7,
            duration_days=7,
            parallel_with=["液压支架安装"],
            description="双滚筒采煤机安装、调试",
            resources={'机修队': 1, '电工': 3},
        )
        procedures.append(shearer_install)

        # 9. 刮板输送机安装
        afc_install = WorkProcedure(
            phase=WorkPhase.AFC_INSTALL,
            name="刮板输送机安装",
            start_day=install_start,
            end_day=install_start + 10,
            duration_days=10,
            parallel_with=["液压支架安装"],
            description="前、后部刮板输送机安装",
            resources={'安装队': 1},
        )
        procedures.append(afc_install)

        # 10. 联合试运转
        install_end = install_start + support_install_days
        commissioning_start = install_end
        commissioning = WorkProcedure(
            phase=WorkPhase.COMMISSIONING,
            name="联合试运转",
            start_day=commissioning_start,
            end_day=commissioning_start + relocation['phases']['testing']['days'],
            duration_days=relocation['phases']['testing']['days'],
            depends_on=["液压支架安装", "采煤机安装调试", "刮板输送机安装"],
            description="全系统联合调试、试运行",
            resources={'技术人员': 5, '操作工': 10},
            milestones=[
                {'day': commissioning_start + 2, 'event': '单机试运转完成'},
                {'day': commissioning_start + 4, 'event': '联合试运转完成'},
                {'day': commissioning_start + relocation['phases']['testing']['days'], 'event': '验收合格'}
            ],
            safety_measures=[
                "试运转前全面安全检查",
                "确保各安全保护装置灵敏可靠",
                "制定试运转安全措施"
            ]
        )
        procedures.append(commissioning)

        commissioning_end = commissioning_start + relocation['phases']['testing']['days']

        # ========== 回采阶段 ==========
        mining_schedule = self.checker.calculate_mining_schedule(
            face_length=length,
            advance_length=advance_length,
            thickness=thickness,
            geological_score=score
        )

        mining_start_day = commissioning_end
        mining_end_day = mining_start_day + mining_schedule['total_days']

        # 11. 初采
        first_weighting_day = mining_start_day + mining_schedule['first_weighting_day']
        first_mining = WorkProcedure(
            phase=WorkPhase.FIRST_MINING,
            name="初采阶段",
            start_day=mining_start_day,
            end_day=first_weighting_day,
            duration_days=mining_schedule['first_weighting_day'],
            depends_on=["联合试运转"],
            description=f"初次来压前推进约{self.config.first_weighting_interval}m",
            milestones=[
                {'day': mining_start_day, 'event': '正式开机回采'},
                {'day': mining_start_day + 7, 'event': '采煤机运行稳定'},
                {'day': first_weighting_day, 'event': '初次来压'}
            ],
            safety_measures=[
                "加强顶板观测",
                "初撑力监测",
                "专人值守",
                "初次来压期间控制推进速度"
            ],
            risks=[
                "初次来压步距可能与预测偏差",
                "顶板可能局部破碎"
            ]
        )
        procedures.append(first_mining)

        # 12. 正常回采
        normal_mining = WorkProcedure(
            phase=WorkPhase.NORMAL_MINING,
            name="正常回采",
            start_day=first_weighting_day,
            end_day=mining_schedule['end_mining_start_day'] + mining_start_day,
            duration_days=mining_schedule['end_mining_start_day'] - mining_schedule['first_weighting_day'],
            depends_on=["初采阶段"],
            description=f"日推进{mining_schedule['daily_advance']}m，日产{mining_schedule['daily_output']}吨",
            resources={'采煤队': 3, '支护工': 6, '电工': 2, '机修工': 2},
            milestones=self._generate_mining_milestones(
                advance_length, mining_start_day,
                mining_schedule['daily_advance'],
                mining_schedule['periodic_weighting_days']
            ),
            safety_measures=[
                "坚持正规循环作业",
                "周期来压期间加强支护",
                "保持工作面平直",
                "及时处理片帮冒顶"
            ]
        )
        procedures.append(normal_mining)

        # 13. 末采
        end_mining_start = mining_schedule['end_mining_start_day'] + mining_start_day
        end_mining = WorkProcedure(
            phase=WorkPhase.END_MINING,
            name="末采阶段",
            start_day=end_mining_start,
            end_day=mining_end_day,
            duration_days=self.config.end_mining_period_days,
            depends_on=["正常回采"],
            description="贯通前30m，降低推进速度，加强支护",
            milestones=[
                {'day': end_mining_start, 'event': '进入末采阶段'},
                {'day': mining_end_day - 10, 'event': '距贯通10m'},
                {'day': mining_end_day, 'event': '回采结束'}
            ],
            safety_measures=[
                "控制推进速度",
                "加强超前支护",
                "做好贯通准备",
                "制定贯通安全技术措施"
            ]
        )
        procedures.append(end_mining)

        # 14. 设备回撤
        withdrawal_days = self.config.equipment_disassembly_days
        equipment_withdrawal = WorkProcedure(
            phase=WorkPhase.EQUIPMENT_WITHDRAWAL,
            name="设备回撤",
            start_day=mining_end_day,
            end_day=mining_end_day + withdrawal_days,
            duration_days=withdrawal_days,
            depends_on=["末采阶段"],
            description="综采设备拆除、回撤",
            resources={'回撤队': 2, '运输队': 2},
            milestones=[
                {'day': mining_end_day + 3, 'event': '采煤机回撤完成'},
                {'day': mining_end_day + 10, 'event': '支架回撤过半'},
                {'day': mining_end_day + withdrawal_days, 'event': '设备回撤完成'}
            ],
            safety_measures=[
                "制定专项回撤方案",
                "加强支护确保安全通道",
                "做好防灭火工作"
            ]
        )
        procedures.append(equipment_withdrawal)

        equipment_withdrawal_day = mining_end_day + withdrawal_days

        # 生成日计划（前30天示例）
        daily_plans = self._generate_daily_plans(
            procedures, mining_schedule, mining_start_day, 30
        )

        # 生成周计划
        weekly_plans = self._generate_weekly_plans(
            mining_schedule, mining_start_day
        )

        # 生成月计划
        monthly_plans = self._generate_monthly_plans(
            mining_schedule, mining_start_day
        )

        return {
            'workface_id': wf_id,
            'workface_name': wf.get('name', wf_id),
            'basic_info': {
                'length': length,
                'advance_length': advance_length,
                'thickness': thickness,
                'geological_score': score,
                'reserves': length * advance_length * thickness * 1.4 / 10000,  # 万吨
            },
            'procedures': [self._procedure_to_dict(p) for p in procedures],
            'key_dates': {
                'prep_start_day': prep_start_day,
                'prep_start_date': self._day_to_date(prep_start_day),
                'tunneling_end_day': tunneling_end_day,
                'tunneling_end_date': self._day_to_date(tunneling_end_day),
                'equipment_start_day': equipment_start_day,
                'equipment_start_date': self._day_to_date(equipment_start_day),
                'install_end_day': install_end,
                'install_end_date': self._day_to_date(install_end),
                'mining_start_day': mining_start_day,
                'mining_start_date': self._day_to_date(mining_start_day),
                'first_weighting_day': first_weighting_day,
                'first_weighting_date': self._day_to_date(first_weighting_day),
                'end_mining_start_day': end_mining_start,
                'end_mining_start_date': self._day_to_date(end_mining_start),
                'mining_end_day': mining_end_day,
                'mining_end_date': self._day_to_date(mining_end_day),
                'equipment_withdrawal_day': equipment_withdrawal_day,
                'equipment_withdrawal_date': self._day_to_date(equipment_withdrawal_day),
            },
            'duration': {
                'prep_days': tunneling_end_day - prep_start_day,
                'install_days': commissioning_end - equipment_start_day,
                'mining_days': mining_schedule['total_days'],
                'total_days': equipment_withdrawal_day - prep_start_day,
                'prep_months': round((tunneling_end_day - prep_start_day) / 30, 1),
                'mining_months': round(mining_schedule['total_days'] / 30, 1),
                'total_months': round((equipment_withdrawal_day - prep_start_day) / 30, 1),
            },
            'production': {
                'daily_advance': mining_schedule['daily_advance'],
                'monthly_advance': mining_schedule['monthly_advance'],
                'daily_output': mining_schedule['daily_output'],
                'monthly_output': mining_schedule['monthly_output'],
                'total_output': mining_schedule['total_output'],
            },
            'mining_schedule': mining_schedule,
            'daily_plans': daily_plans,
            'weekly_plans': weekly_plans,
            'monthly_plans': monthly_plans,
        }

    def _generate_tunneling_milestones(
        self,
        length: float,
        start_day: int
    ) -> List[Dict]:
        """生成掘进里程碑"""
        milestones = []
        checkpoints = [0.25, 0.5, 0.75, 1.0]
        daily_rate = self.config.roadheader_monthly_rate / 30

        for pct in checkpoints:
            distance = length * pct
            day = start_day + int(distance / daily_rate)
            milestones.append({
                'day': day,
                'date': self._day_to_date(day),
                'event': f'掘进{int(pct*100)}%（{int(distance)}m）',
                'distance': distance,
            })

        return milestones

    def _generate_support_install_milestones(
        self,
        length: float,
        start_day: int
    ) -> List[Dict]:
        """生成支架安装里程碑"""
        total_supports = int(length / 1.75)  # 支架间距约1.75m
        daily_install = 8  # 每天安装8架
        milestones = []

        checkpoints = [0.25, 0.5, 0.75, 1.0]
        for pct in checkpoints:
            supports = int(total_supports * pct)
            day = start_day + int(supports / daily_install)
            milestones.append({
                'day': day,
                'date': self._day_to_date(day),
                'event': f'安装支架{supports}架（{int(pct*100)}%）',
            })

        return milestones

    def _generate_mining_milestones(
        self,
        advance_length: float,
        start_day: int,
        daily_advance: float,
        periodic_weighting_days: List[int]
    ) -> List[Dict]:
        """生成回采里程碑"""
        milestones = []

        # 进度里程碑
        checkpoints = [100, 200, 300, 500, 750, 1000]
        for distance in checkpoints:
            if distance <= advance_length:
                day = start_day + int(distance / daily_advance)
                milestones.append({
                    'day': day,
                    'date': self._day_to_date(day),
                    'event': f'推进{distance}m',
                    'type': 'progress',
                })

        # 周期来压里程碑
        for i, weighting_day in enumerate(periodic_weighting_days[:5]):
            day = start_day + weighting_day
            milestones.append({
                'day': day,
                'date': self._day_to_date(day),
                'event': f'第{i+1}次周期来压',
                'type': 'weighting',
            })

        return sorted(milestones, key=lambda x: x['day'])

    def _generate_daily_plans(
        self,
        procedures: List[WorkProcedure],
        mining_schedule: Dict,
        mining_start_day: int,
        n_days: int = 30
    ) -> List[Dict]:
        """生成日计划"""
        daily_plans = []

        for day_offset in range(n_days):
            day = mining_start_day + day_offset
            date = self._day_to_date(day)

            # 找出当天进行的工序
            active_procedures = []
            for proc in procedures:
                if proc.start_day <= day < proc.end_day:
                    active_procedures.append(proc.name)

            # 三班计划
            shift_plans = [
                {
                    'shift': '早班',
                    'time': '8:00-16:00',
                    'tasks': ['正常推进', '支架追机', '煤壁片帮处理'],
                    'target_advance': mining_schedule['daily_advance'] / 3,
                },
                {
                    'shift': '中班',
                    'time': '16:00-24:00',
                    'tasks': ['正常推进', '设备检修', '材料运输'],
                    'target_advance': mining_schedule['daily_advance'] / 3,
                },
                {
                    'shift': '夜班',
                    'time': '0:00-8:00',
                    'tasks': ['正常推进', '顶板管理', '安全检查'],
                    'target_advance': mining_schedule['daily_advance'] / 3,
                },
            ]

            # 关键事件
            key_events = []
            for proc in procedures:
                for milestone in proc.milestones:
                    if milestone.get('day') == day:
                        key_events.append(milestone['event'])

            # 安全提示
            safety_reminders = ["班前安全确认", "瓦斯检测", "顶板观察"]

            # 检查是否是周期来压日
            if day_offset in mining_schedule.get('periodic_weighting_days', []):
                safety_reminders.extend([
                    "⚠️ 周期来压期间",
                    "加强顶板监测",
                    "控制推进速度"
                ])

            daily_plans.append({
                'day': day,
                'day_offset': day_offset,
                'date': date,
                'shift_plans': shift_plans,
                'target_advance': mining_schedule['daily_advance'],
                'target_output': mining_schedule['daily_output'],
                'cumulative_advance': day_offset * mining_schedule['daily_advance'],
                'active_procedures': active_procedures,
                'key_events': key_events,
                'safety_reminders': safety_reminders,
            })

        return daily_plans

    def _generate_weekly_plans(
        self,
        mining_schedule: Dict,
        mining_start_day: int
    ) -> List[Dict]:
        """生成周计划"""
        weekly_plans = []
        total_weeks = mining_schedule['total_days'] // 7 + 1

        for week in range(min(total_weeks, 52)):
            start_day = mining_start_day + week * 7
            end_day = start_day + 6

            weekly_plans.append({
                'week': week + 1,
                'start_date': self._day_to_date(start_day),
                'end_date': self._day_to_date(end_day),
                'target_advance': mining_schedule['daily_advance'] * 7,
                'target_output': mining_schedule['daily_output'] * 7,
                'key_milestones': [],
                'equipment_maintenance': [
                    '采煤机滚筒截齿检查',
                    '支架液压系统检测',
                    '刮板输送机链条张紧度调整'
                ],
                'safety_focus': [
                    '顶板管理',
                    '瓦斯防治',
                    '设备运行安全'
                ],
            })

        return weekly_plans

    def _generate_monthly_plans(
        self,
        mining_schedule: Dict,
        mining_start_day: int
    ) -> List[Dict]:
        """生成月计划"""
        return mining_schedule.get('monthly_plan', [])

    def _generate_timeline(
        self,
        workface_plans: Dict,
        succession_order: List[str]
    ) -> List[Dict]:
        """生成整体时间线"""
        timeline = []

        for wf_id in succession_order:
            if wf_id not in workface_plans:
                continue

            plan = workface_plans[wf_id]
            key_dates = plan['key_dates']

            # 添加关键事件
            events = [
                ('准备开始', key_dates['prep_start_day'], key_dates['prep_start_date']),
                ('掘进完成', key_dates['tunneling_end_day'], key_dates['tunneling_end_date']),
                ('设备安装开始', key_dates['equipment_start_day'], key_dates['equipment_start_date']),
                ('回采开始', key_dates['mining_start_day'], key_dates['mining_start_date']),
                ('初次来压', key_dates['first_weighting_day'], key_dates['first_weighting_date']),
                ('进入末采', key_dates['end_mining_start_day'], key_dates['end_mining_start_date']),
                ('回采结束', key_dates['mining_end_day'], key_dates['mining_end_date']),
            ]

            for event_name, day, date in events:
                timeline.append({
                    'workface': wf_id,
                    'event': event_name,
                    'day': day,
                    'date': date,
                    'month': round(day / 30, 1),
                })

        return sorted(timeline, key=lambda x: x['day'])

    def _analyze_critical_path(
        self,
        workface_plans: Dict,
        succession_order: List[str]
    ) -> Dict:
        """分析关键路径"""
        critical_events = []

        for i, wf_id in enumerate(succession_order):
            if wf_id not in workface_plans:
                continue

            plan = workface_plans[wf_id]

            # 关键节点：准备完成时间
            critical_events.append({
                'workface': wf_id,
                'event': '准备完成',
                'day': plan['key_dates']['tunneling_end_day'],
                'is_critical': True,
                'slack': 0,
            })

            # 关键节点：设备安装完成
            critical_events.append({
                'workface': wf_id,
                'event': '设备就绪',
                'day': plan['key_dates']['install_end_day'],
                'is_critical': True,
                'slack': 0,
            })

            # 检查接续衔接
            if i > 0:
                prev_wf_id = succession_order[i-1]
                if prev_wf_id in workface_plans:
                    prev_end = workface_plans[prev_wf_id]['key_dates']['mining_end_day']
                    curr_start = plan['key_dates']['mining_start_day']
                    gap = curr_start - prev_end

                    if gap < 0:
                        # 有重叠，正常接续
                        critical_events.append({
                            'workface': wf_id,
                            'event': '接续衔接',
                            'day': curr_start,
                            'is_critical': True,
                            'slack': 0,
                            'note': f'与{prev_wf_id}重叠{-gap}天，接续正常'
                        })
                    elif gap > 30:
                        # 接续断档风险
                        critical_events.append({
                            'workface': wf_id,
                            'event': '接续断档风险',
                            'day': curr_start,
                            'is_critical': True,
                            'slack': 0,
                            'note': f'与{prev_wf_id}间隔{gap}天，存在断档风险'
                        })

        return {
            'critical_events': sorted(critical_events, key=lambda x: x['day']),
            'total_duration': max([p['key_dates']['equipment_withdrawal_day']
                                  for p in workface_plans.values()]) if workface_plans else 0,
        }

    def _generate_resource_plan(self, workface_plans: Dict) -> Dict:
        """生成资源需求计划"""
        resource_timeline = {}

        for wf_id, plan in workface_plans.items():
            for proc in plan['procedures']:
                for day in range(proc['start_day'], proc['end_day']):
                    if day not in resource_timeline:
                        resource_timeline[day] = {
                            'equipment': set(),
                            'personnel': {},
                            'materials': {},
                        }

                    # 累加资源需求
                    for resource, count in proc.get('resources', {}).items():
                        if '队' in resource or '人员' in resource or '工' in resource:
                            resource_timeline[day]['personnel'][resource] = \
                                resource_timeline[day]['personnel'].get(resource, 0) + count
                        elif '机' in resource or '设备' in resource or '车' in resource:
                            resource_timeline[day]['equipment'].add(resource)
                        else:
                            resource_timeline[day]['materials'][resource] = \
                                resource_timeline[day]['materials'].get(resource, 0) + count

        # 找出资源峰值
        peak_personnel = 0
        peak_day = 0
        for day, resources in resource_timeline.items():
            total = sum(resources['personnel'].values())
            if total > peak_personnel:
                peak_personnel = total
                peak_day = day

        return {
            'peak_personnel': peak_personnel,
            'peak_day': peak_day,
            'peak_date': self._day_to_date(peak_day),
            'timeline_sample': {
                k: {
                    'equipment': list(v['equipment']),
                    'personnel': v['personnel'],
                    'materials': v['materials']
                }
                for k, v in list(resource_timeline.items())[:30]
            },
        }

    def _analyze_risks(
        self,
        workface_plans: Dict,
        workfaces: List[Dict]
    ) -> Dict:
        """风险分析"""
        risks = []

        wf_index = {wf['id']: wf for wf in workfaces}

        for wf_id, plan in workface_plans.items():
            wf = wf_index.get(wf_id, {})

            # 地质条件风险
            score = wf.get('avgScore', 75)
            if score < 60:
                risks.append({
                    'workface': wf_id,
                    'risk_type': '地质条件',
                    'level': 'high',
                    'description': f'地质评分{score}分，可能影响推进速度和产量',
                    'mitigation': ['加强超前探测', '备用支护材料', '制定应急预案']
                })

            # 煤厚变化风险
            thickness = wf.get('avgThickness', 2.0)
            if thickness > 5.0:
                risks.append({
                    'workface': wf_id,
                    'risk_type': '厚煤层开采',
                    'level': 'medium',
                    'description': f'煤厚{thickness}m，属于厚煤层，顶板管理难度大',
                    'mitigation': ['放顶煤工艺', '加强顶板监测', '合理控制采高']
                })

            # 接续风险
            duration = plan['duration']
            if duration['prep_months'] > 12:
                risks.append({
                    'workface': wf_id,
                    'risk_type': '准备周期',
                    'level': 'medium',
                    'description': f'准备周期{duration["prep_months"]}月，周期较长',
                    'mitigation': ['优化掘进组织', '增加掘进队组', '平行施工']
                })

        return {
            'risks': risks,
            'high_risk_count': len([r for r in risks if r['level'] == 'high']),
            'medium_risk_count': len([r for r in risks if r['level'] == 'medium']),
            'low_risk_count': len([r for r in risks if r['level'] == 'low']),
        }

    def _generate_monthly_summary(self, workface_plans: Dict) -> List[Dict]:
        """生成月度汇总"""
        monthly_data = {}

        for wf_id, plan in workface_plans.items():
            # 回采月产量
            mining_start = plan['key_dates']['mining_start_day']
            mining_end = plan['key_dates']['mining_end_day']
            monthly_output = plan['production']['monthly_output']

            start_month = mining_start // 30
            end_month = mining_end // 30

            for month in range(start_month, end_month + 1):
                if month not in monthly_data:
                    monthly_data[month] = {
                        'month': month + 1,
                        'date': self._day_to_date(month * 30)[:7],
                        'active_workfaces': [],
                        'output': 0,
                        'events': [],
                    }

                monthly_data[month]['active_workfaces'].append(wf_id)
                monthly_data[month]['output'] += monthly_output

        # 转换为列表并排序
        summary = sorted(monthly_data.values(), key=lambda x: x['month'])

        # 添加累计产量
        cumulative = 0
        for month_data in summary:
            cumulative += month_data['output']
            month_data['cumulative_output'] = cumulative

        return summary

    def _generate_enhanced_gantt(self, workface_plans: Dict) -> List[Dict]:
        """生成增强版甘特图数据"""
        gantt_data = []

        for wf_id, plan in workface_plans.items():
            key_dates = plan['key_dates']

            # 掘进阶段
            gantt_data.append({
                'workface': wf_id,
                'task': '掘进',
                'phase': 'tunneling',
                'start': key_dates['prep_start_day'],
                'end': key_dates['tunneling_end_day'],
                'start_date': key_dates['prep_start_date'],
                'end_date': key_dates['tunneling_end_date'],
                'duration_days': key_dates['tunneling_end_day'] - key_dates['prep_start_day'],
                'type': 'preparation',
                'color': '#FFA500',  # 橙色
            })

            # 安装阶段
            gantt_data.append({
                'workface': wf_id,
                'task': '安装',
                'phase': 'installation',
                'start': key_dates['equipment_start_day'],
                'end': key_dates['install_end_day'],
                'start_date': key_dates['equipment_start_date'],
                'end_date': key_dates['install_end_date'],
                'duration_days': key_dates['install_end_day'] - key_dates['equipment_start_day'],
                'type': 'installation',
                'color': '#9370DB',  # 紫色
            })

            # 初采阶段
            gantt_data.append({
                'workface': wf_id,
                'task': '初采',
                'phase': 'first_mining',
                'start': key_dates['mining_start_day'],
                'end': key_dates['first_weighting_day'],
                'start_date': key_dates['mining_start_date'],
                'end_date': key_dates['first_weighting_date'],
                'duration_days': key_dates['first_weighting_day'] - key_dates['mining_start_day'],
                'type': 'mining',
                'color': '#32CD32',  # 浅绿色
            })

            # 正常回采
            gantt_data.append({
                'workface': wf_id,
                'task': '正常回采',
                'phase': 'normal_mining',
                'start': key_dates['first_weighting_day'],
                'end': key_dates['end_mining_start_day'],
                'start_date': key_dates['first_weighting_date'],
                'end_date': key_dates['end_mining_start_date'],
                'duration_days': key_dates['end_mining_start_day'] - key_dates['first_weighting_day'],
                'type': 'mining',
                'color': '#228B22',  # 深绿色
            })

            # 末采阶段
            gantt_data.append({
                'workface': wf_id,
                'task': '末采',
                'phase': 'end_mining',
                'start': key_dates['end_mining_start_day'],
                'end': key_dates['mining_end_day'],
                'start_date': key_dates['end_mining_start_date'],
                'end_date': key_dates['mining_end_date'],
                'duration_days': key_dates['mining_end_day'] - key_dates['end_mining_start_day'],
                'type': 'mining',
                'color': '#006400',  # 最深绿色
            })

            # 设备回撤
            gantt_data.append({
                'workface': wf_id,
                'task': '回撤',
                'phase': 'withdrawal',
                'start': key_dates['mining_end_day'],
                'end': key_dates['equipment_withdrawal_day'],
                'start_date': key_dates['mining_end_date'],
                'end_date': key_dates['equipment_withdrawal_date'],
                'duration_days': key_dates['equipment_withdrawal_day'] - key_dates['mining_end_day'],
                'type': 'withdrawal',
                'color': '#808080',  # 灰色
            })

        return gantt_data

    def _generate_summary(
        self,
        workface_plans: Dict,
        succession_order: List[str]
    ) -> Dict:
        """生成汇总信息"""
        if not workface_plans:
            return {}

        total_output = sum(p['production']['total_output'] for p in workface_plans.values())
        total_days = max(p['key_dates']['equipment_withdrawal_day'] for p in workface_plans.values())

        return {
            'total_workfaces': len(workface_plans),
            'succession_order': succession_order,
            'total_days': total_days,
            'total_months': round(total_days / 30, 1),
            'total_output': total_output,
            'total_output_wan_ton': round(total_output / 10000, 2),
            'average_monthly_output': round(total_output / (total_days / 30), 0),
            'start_date': self.start_date.strftime("%Y-%m-%d"),
            'end_date': self._day_to_date(total_days),
        }

    def _procedure_to_dict(self, proc: WorkProcedure) -> Dict:
        """工序转换为字典"""
        return {
            'phase': proc.phase.value,
            'name': proc.name,
            'start_day': proc.start_day,
            'end_day': proc.end_day,
            'start_date': self._day_to_date(proc.start_day),
            'end_date': self._day_to_date(proc.end_day),
            'duration_days': proc.duration_days,
            'parallel_with': proc.parallel_with,
            'depends_on': proc.depends_on,
            'resources': proc.resources,
            'description': proc.description,
            'milestones': proc.milestones,
            'risks': proc.risks,
            'safety_measures': proc.safety_measures,
        }

    def _day_to_date(self, day: int) -> str:
        """天数转日期"""
        date = self.start_date + timedelta(days=day)
        return date.strftime("%Y-%m-%d")


def generate_detailed_succession_plan(
    workfaces: List[Dict],
    succession_result: Dict,
    start_date: str = None,
    monthly_target: float = 100000
) -> Dict:
    """
    生成详细接续计划的便捷函数

    Args:
        workfaces: 工作面列表
        succession_result: 接续优化结果（包含workface_schedule）
        start_date: 开始日期
        monthly_target: 月产量目标

    Returns:
        详细计划
    """
    generator = DetailedPlanGenerator(start_date=start_date)

    # 从接续结果中提取开采顺序
    schedule = succession_result.get('plan', {}).get('workface_schedule', {})

    # 按回采开始时间排序
    order = sorted(
        schedule.keys(),
        key=lambda x: schedule[x].get('mining_start', 999)
    )

    return generator.generate_detailed_plan(
        workfaces=workfaces,
        succession_order=order,
        monthly_target=monthly_target
    )
