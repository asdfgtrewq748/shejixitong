"""
GNN煤层建模使用示例
演示完整的训练和预测流程
"""

import numpy as np
import json
import os

# 导入模块
from graph_builder import MultiScaleGraphBuilder, Borehole, create_sample_boreholes
from model import GeoGNN
from trainer import GNNTrainer, TrainingConfig, train_test_split_graph
from visualizer import CoalSeamVisualizer, plot_training_history, plot_prediction_comparison


def main():
    """主函数: 演示完整流程"""
    print("=" * 60)
    print("GNN煤层三维建模示例")
    print("=" * 60)

    # 1. 创建示例钻孔数据
    print("\n[1] 创建示例钻孔数据...")
    boreholes = create_sample_boreholes(n=100, seed=42)
    print(f"    创建了 {len(boreholes)} 个钻孔")
    print(f"    示例钻孔: {boreholes[0]}")

    # 2. 构建图数据
    print("\n[2] 构建图数据...")
    graph_builder = MultiScaleGraphBuilder(
        k_neighbors=6,
        radius=500.0,
        use_delaunay=True,
        normalize=True
    )

    graph = graph_builder.build(boreholes, graph_type="combined")
    print(f"    节点数: {len(graph.borehole_ids)}")
    print(f"    边数: {graph.edge_index.shape[1]}")
    print(f"    节点特征维度: {graph.node_features.shape[1]}")
    print(f"    边特征维度: {graph.edge_attr.shape[1]}")

    # 3. 创建模型
    print("\n[3] 创建GNN模型...")
    model = GeoGNN(
        in_channels=graph.node_features.shape[1],
        hidden_channels=64,
        out_channels=3,  # 煤厚、底板、顶板
        edge_channels=graph.edge_attr.shape[1],
        num_layers=3,
        heads=4,
        dropout=0.2
    )

    # 统计参数量
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"    总参数量: {total_params:,}")
    print(f"    可训练参数: {trainable_params:,}")

    # 4. 配置训练
    print("\n[4] 配置训练...")
    config = TrainingConfig(
        learning_rate=0.001,
        weight_decay=1e-4,
        epochs=100,
        patience=20,
        lambda_smooth=0.1,
        lambda_geo=0.1,
        lambda_gradient=0.05
    )
    print(f"    学习率: {config.learning_rate}")
    print(f"    训练轮数: {config.epochs}")
    print(f"    设备: {config.device}")

    # 5. 训练模型
    print("\n[5] 开始训练...")
    trainer = GNNTrainer(model, config)
    history = trainer.train(graph, verbose=True)

    print(f"\n    训练完成!")
    print(f"    最终训练损失: {history['train_loss'][-1]:.4f}")
    print(f"    最佳验证损失: {trainer.best_loss:.4f}")

    # 6. 预测
    print("\n[6] 进行预测...")
    predictions = trainer.predict(graph)
    print(f"    预测结果形状: {predictions.shape}")

    # 计算误差
    targets = graph.targets
    mae = np.mean(np.abs(predictions - targets), axis=0)
    rmse = np.sqrt(np.mean((predictions - targets) ** 2, axis=0))

    print(f"    煤厚 - MAE: {mae[0]:.3f}m, RMSE: {rmse[0]:.3f}m")
    print(f"    底板 - MAE: {mae[1]:.3f}m, RMSE: {rmse[1]:.3f}m")
    print(f"    顶板 - MAE: {mae[2]:.3f}m, RMSE: {rmse[2]:.3f}m")

    # 7. 可视化
    print("\n[7] 生成可视化数据...")
    visualizer = CoalSeamVisualizer()

    # 导出图数据为JSON
    graph_json = visualizer.graph_to_json(graph)
    print(f"    图数据节点数: {len(graph_json['nodes'])}")
    print(f"    图数据边数: {len(graph_json['edges'])}")

    # 导出预测结果
    pred_json = visualizer.predictions_to_json(graph, predictions)
    print(f"    预测结果数: {len(pred_json['predictions'])}")

    # 保存结果
    output_dir = os.path.dirname(os.path.abspath(__file__))

    with open(os.path.join(output_dir, 'graph_data.json'), 'w', encoding='utf-8') as f:
        json.dump(graph_json, f, indent=2, ensure_ascii=False)

    with open(os.path.join(output_dir, 'predictions.json'), 'w', encoding='utf-8') as f:
        json.dump(pred_json, f, indent=2, ensure_ascii=False)

    # 保存训练历史
    history_json = visualizer.training_history_to_json(history)
    with open(os.path.join(output_dir, 'training_history.json'), 'w', encoding='utf-8') as f:
        json.dump(history_json, f, indent=2)

    print(f"\n    结果已保存到: {output_dir}")

    # 8. 保存模型
    print("\n[8] 保存模型...")
    model_path = os.path.join(output_dir, 'gnn_model.pt')
    trainer.save_model(model_path)
    print(f"    模型已保存到: {model_path}")

    # 9. 尝试绘图(如果matplotlib可用)
    print("\n[9] 尝试生成图表...")
    try:
        plot_training_history(history, os.path.join(output_dir, 'training_history.png'))
        plot_prediction_comparison(graph, predictions, os.path.join(output_dir, 'prediction_comparison.png'))
        print("    图表已保存")
    except Exception as e:
        print(f"    图表生成跳过: {e}")

    print("\n" + "=" * 60)
    print("示例运行完成!")
    print("=" * 60)

    return model, graph, predictions


def demo_inference():
    """演示推理流程(加载已训练模型)"""
    print("\n演示: 加载模型并进行推理")

    # 创建新的钻孔数据
    new_boreholes = create_sample_boreholes(n=20, seed=123)

    # 构建图
    graph_builder = MultiScaleGraphBuilder()
    graph = graph_builder.build(new_boreholes)

    # 创建模型(需要与训练时相同的架构)
    model = GeoGNN(
        in_channels=graph.node_features.shape[1],
        hidden_channels=64,
        out_channels=3,
        edge_channels=graph.edge_attr.shape[1]
    )

    # 加载权重
    config = TrainingConfig()
    trainer = GNNTrainer(model, config)

    model_path = os.path.join(os.path.dirname(__file__), 'gnn_model.pt')
    if os.path.exists(model_path):
        trainer.load_model(model_path)
        print("模型加载成功")

        # 预测
        predictions = trainer.predict(graph)
        print(f"预测结果: {predictions.shape}")

        # 显示部分结果
        for i in range(min(5, len(new_boreholes))):
            print(f"  钻孔 {new_boreholes[i].id}: "
                  f"预测煤厚={predictions[i, 0]:.2f}m, "
                  f"实际煤厚={new_boreholes[i].thickness:.2f}m")
    else:
        print(f"模型文件不存在: {model_path}")
        print("请先运行 main() 训练模型")


if __name__ == "__main__":
    # 运行主示例
    model, graph, predictions = main()

    # 演示推理
    # demo_inference()
