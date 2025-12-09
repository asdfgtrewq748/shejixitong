"""
可视化模块

提供实验结果可视化功能
"""

from typing import List, Dict, Optional, Tuple
import numpy as np
import json
import os


def plot_training_curves(
    training_results: Dict[str, List[float]],
    output_path: str = None,
    title: str = "Training Curves"
) -> Dict:
    """
    绘制训练曲线数据（返回可视化数据供前端渲染）

    Args:
        training_results: {算法名: 奖励序列}
        output_path: 输出路径
        title: 标题

    Returns:
        可视化数据
    """
    chart_data = {
        'type': 'line',
        'title': title,
        'xLabel': 'Episode',
        'yLabel': 'Reward',
        'series': []
    }

    for name, rewards in training_results.items():
        # 平滑处理
        window = min(50, len(rewards) // 10)
        if window > 1:
            smoothed = np.convolve(rewards, np.ones(window)/window, mode='valid')
        else:
            smoothed = rewards

        chart_data['series'].append({
            'name': name,
            'data': [{'x': i, 'y': float(r)} for i, r in enumerate(smoothed)],
            'raw_data': [float(r) for r in rewards],
        })

    if output_path:
        with open(output_path, 'w') as f:
            json.dump(chart_data, f, indent=2)

    return chart_data


def plot_comparison_bars(
    comparison_data: Dict[str, Dict],
    metrics: List[str] = None,
    output_path: str = None
) -> Dict:
    """
    绘制算法比较柱状图数据

    Args:
        comparison_data: 比较数据
        metrics: 要比较的指标列表
        output_path: 输出路径

    Returns:
        可视化数据
    """
    if metrics is None:
        metrics = ['total_reward', 'total_production', 'recovery_rate', 'equipment_utilization']

    chart_data = {
        'type': 'bar',
        'title': 'Algorithm Comparison',
        'categories': list(comparison_data.keys()),
        'series': []
    }

    for metric in metrics:
        series_data = []
        for algo_name, algo_data in comparison_data.items():
            if 'metrics' in algo_data and metric in algo_data['metrics']:
                value = algo_data['metrics'][metric]['mean']
                std = algo_data['metrics'][metric]['std']
                series_data.append({
                    'value': float(value),
                    'std': float(std),
                })
            else:
                series_data.append({'value': 0, 'std': 0})

        chart_data['series'].append({
            'name': metric,
            'data': series_data,
        })

    if output_path:
        with open(output_path, 'w') as f:
            json.dump(chart_data, f, indent=2)

    return chart_data


def plot_gantt_chart(
    schedule: Dict[str, Dict],
    output_path: str = None
) -> Dict:
    """
    生成甘特图数据

    Args:
        schedule: 工作面时间表 {工作面ID: {prep_start, mining_start, mining_end, status}}
        output_path: 输出路径

    Returns:
        甘特图数据
    """
    chart_data = {
        'type': 'gantt',
        'title': 'Workface Succession Schedule',
        'tasks': []
    }

    for wf_id, info in schedule.items():
        # 准备阶段
        if info.get('prep_start') is not None:
            prep_end = info.get('mining_start', info['prep_start'] + 6)
            chart_data['tasks'].append({
                'id': f'{wf_id}_prep',
                'workface': wf_id,
                'task': 'Preparation',
                'start': info['prep_start'],
                'end': prep_end,
                'type': 'preparation',
                'color': '#FCD34D',  # yellow
            })

        # 回采阶段
        if info.get('mining_start') is not None:
            mining_end = info.get('mining_end', info['mining_start'] + 12)
            chart_data['tasks'].append({
                'id': f'{wf_id}_mining',
                'workface': wf_id,
                'task': 'Mining',
                'start': info['mining_start'],
                'end': mining_end,
                'type': 'mining',
                'color': '#34D399',  # green
            })

    # 排序
    chart_data['tasks'].sort(key=lambda x: (x['workface'], x['start']))

    if output_path:
        with open(output_path, 'w') as f:
            json.dump(chart_data, f, indent=2)

    return chart_data


def plot_pareto_front(
    solutions: List[Dict],
    objectives: Tuple[str, str] = ('production', 'risk'),
    output_path: str = None
) -> Dict:
    """
    绘制帕累托前沿数据

    Args:
        solutions: 解列表，每个解包含多个目标值
        objectives: 要绘制的两个目标
        output_path: 输出路径

    Returns:
        散点图数据
    """
    obj1, obj2 = objectives

    chart_data = {
        'type': 'scatter',
        'title': f'Pareto Front: {obj1} vs {obj2}',
        'xLabel': obj1,
        'yLabel': obj2,
        'points': [],
        'pareto_front': [],
    }

    # 所有解
    for sol in solutions:
        if obj1 in sol and obj2 in sol:
            chart_data['points'].append({
                'x': float(sol[obj1]),
                'y': float(sol[obj2]),
                'is_pareto': sol.get('is_pareto', False),
            })

    # 标记帕累托前沿
    pareto_points = [p for p in chart_data['points'] if p.get('is_pareto', False)]
    if pareto_points:
        chart_data['pareto_front'] = sorted(pareto_points, key=lambda p: p['x'])

    if output_path:
        with open(output_path, 'w') as f:
            json.dump(chart_data, f, indent=2)

    return chart_data


def plot_production_timeline(
    production_history: List[float],
    target: float = None,
    output_path: str = None
) -> Dict:
    """
    绘制产量时间线数据

    Args:
        production_history: 月产量序列
        target: 目标产量
        output_path: 输出路径

    Returns:
        时间线数据
    """
    chart_data = {
        'type': 'area',
        'title': 'Monthly Production Timeline',
        'xLabel': 'Month',
        'yLabel': 'Production (tons)',
        'series': [{
            'name': 'Monthly Production',
            'data': [{'x': i, 'y': float(p)} for i, p in enumerate(production_history)],
        }],
    }

    if target:
        chart_data['series'].append({
            'name': 'Target',
            'data': [{'x': i, 'y': target} for i in range(len(production_history))],
            'type': 'line',
            'style': 'dashed',
        })

    # 计算累计产量
    cumulative = np.cumsum(production_history)
    chart_data['cumulative'] = {
        'name': 'Cumulative Production',
        'data': [{'x': i, 'y': float(c)} for i, c in enumerate(cumulative)],
    }

    if output_path:
        with open(output_path, 'w') as f:
            json.dump(chart_data, f, indent=2)

    return chart_data


def plot_risk_heatmap(
    workfaces: List[Dict],
    output_path: str = None
) -> Dict:
    """
    生成风险热力图数据

    Args:
        workfaces: 工作面列表，包含位置和风险信息
        output_path: 输出路径

    Returns:
        热力图数据
    """
    chart_data = {
        'type': 'heatmap',
        'title': 'Risk Distribution',
        'xLabel': 'X (m)',
        'yLabel': 'Y (m)',
        'points': [],
    }

    for wf in workfaces:
        chart_data['points'].append({
            'id': wf.get('id', ''),
            'x': float(wf.get('center_x', 0)),
            'y': float(wf.get('center_y', 0)),
            'risk': float(wf.get('risk_score', 0)),
            'status': wf.get('status', 0),
        })

    if output_path:
        with open(output_path, 'w') as f:
            json.dump(chart_data, f, indent=2)

    return chart_data


def export_results_table(
    results: Dict[str, Dict],
    output_path: str,
    format: str = 'csv'
) -> str:
    """
    导出结果表格

    Args:
        results: 算法结果
        output_path: 输出路径
        format: 输出格式 ('csv' 或 'latex')

    Returns:
        输出文件路径
    """
    metrics = [
        'total_production', 'monthly_production_mean', 'production_variance_coef',
        'total_duration', 'equipment_utilization', 'recovery_rate',
        'total_cost', 'cost_per_ton', 'npv',
        'total_reward'
    ]

    if format == 'csv':
        lines = ['Algorithm,' + ','.join(metrics)]

        for algo_name, algo_data in results.items():
            row = [algo_name]
            for metric in metrics:
                if 'metrics' in algo_data and metric in algo_data['metrics']:
                    mean = algo_data['metrics'][metric]['mean']
                    std = algo_data['metrics'][metric]['std']
                    row.append(f'{mean:.2f}±{std:.2f}')
                else:
                    row.append('N/A')
            lines.append(','.join(row))

        with open(output_path, 'w') as f:
            f.write('\n'.join(lines))

    elif format == 'latex':
        # LaTeX表格格式
        lines = [
            '\\begin{table}[htbp]',
            '\\centering',
            '\\caption{Algorithm Comparison Results}',
            '\\label{tab:results}',
            '\\begin{tabular}{l' + 'c' * len(metrics) + '}',
            '\\hline',
            'Algorithm & ' + ' & '.join([m.replace('_', '\\_') for m in metrics]) + ' \\\\',
            '\\hline',
        ]

        for algo_name, algo_data in results.items():
            row = [algo_name.replace('_', '\\_')]
            for metric in metrics:
                if 'metrics' in algo_data and metric in algo_data['metrics']:
                    mean = algo_data['metrics'][metric]['mean']
                    std = algo_data['metrics'][metric]['std']
                    row.append(f'${mean:.2f} \\pm {std:.2f}$')
                else:
                    row.append('N/A')
            lines.append(' & '.join(row) + ' \\\\')

        lines.extend([
            '\\hline',
            '\\end{tabular}',
            '\\end{table}',
        ])

        with open(output_path, 'w') as f:
            f.write('\n'.join(lines))

    return output_path


def generate_full_report(
    experiment_results: Dict,
    output_dir: str = 'results'
) -> Dict[str, str]:
    """
    生成完整实验报告

    Args:
        experiment_results: 实验结果
        output_dir: 输出目录

    Returns:
        生成的文件路径字典
    """
    os.makedirs(output_dir, exist_ok=True)

    files = {}

    # 1. 训练曲线
    if 'training_curves' in experiment_results:
        path = os.path.join(output_dir, 'training_curves.json')
        plot_training_curves(experiment_results['training_curves'], path)
        files['training_curves'] = path

    # 2. 算法比较
    if 'summaries' in experiment_results:
        path = os.path.join(output_dir, 'comparison_bars.json')
        plot_comparison_bars(experiment_results['summaries'], output_path=path)
        files['comparison_bars'] = path

        # CSV表格
        csv_path = os.path.join(output_dir, 'results_table.csv')
        export_results_table(experiment_results['summaries'], csv_path, 'csv')
        files['results_csv'] = csv_path

        # LaTeX表格
        latex_path = os.path.join(output_dir, 'results_table.tex')
        export_results_table(experiment_results['summaries'], latex_path, 'latex')
        files['results_latex'] = latex_path

    # 3. 甘特图
    if 'best_schedule' in experiment_results:
        path = os.path.join(output_dir, 'gantt_chart.json')
        plot_gantt_chart(experiment_results['best_schedule'], path)
        files['gantt_chart'] = path

    # 4. 产量时间线
    if 'best_production_history' in experiment_results:
        path = os.path.join(output_dir, 'production_timeline.json')
        plot_production_timeline(
            experiment_results['best_production_history'],
            experiment_results.get('target_production'),
            path
        )
        files['production_timeline'] = path

    return files
