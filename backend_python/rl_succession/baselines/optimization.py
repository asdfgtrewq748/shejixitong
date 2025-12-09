"""
元启发式优化算法

实现遗传算法、模拟退火、粒子群优化等
用于工作面接续顺序优化
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Tuple, Optional, Callable
import numpy as np
from copy import deepcopy


class BaseOptimizer(ABC):
    """优化器基类"""

    def __init__(self, name: str):
        self.name = name
        self.best_solution = None
        self.best_fitness = float('-inf')
        self.history = []

    @abstractmethod
    def optimize(self, env_factory: Callable, n_iterations: int) -> Dict:
        """
        运行优化

        Args:
            env_factory: 环境工厂函数
            n_iterations: 迭代次数

        Returns:
            优化结果
        """
        pass

    def evaluate_sequence(self, env, sequence: List[int]) -> float:
        """
        评估接续顺序

        Args:
            env: 环境实例
            sequence: 工作面接续顺序

        Returns:
            适应度值
        """
        state = env.reset()
        total_reward = 0
        sequence_idx = 0
        n_wf = len(env.workfaces)

        while True:
            action_mask = env.get_valid_action_mask()

            # 根据序列选择动作
            action = self._sequence_to_action(env, sequence, sequence_idx, action_mask, n_wf)

            if action > 0 and action_mask[action] > 0:
                # 更新序列索引
                action_type = self._get_action_type(action, n_wf)
                if action_type == 'prep':
                    sequence_idx = min(sequence_idx + 1, len(sequence) - 1)

            state, reward, done, info = env.step(action)
            total_reward += reward

            if done:
                break

        return total_reward

    def _sequence_to_action(self, env, sequence, seq_idx, action_mask, n_wf) -> int:
        """将序列转换为动作"""
        # 优先开始回采
        for i, wf in enumerate(env.state.workfaces):
            if wf.status == 2 and wf.equipment_installed:
                action_idx = 1 + n_wf + i
                if action_mask[action_idx] > 0:
                    return action_idx

        # 其次搬家
        for i, wf in enumerate(env.state.workfaces):
            if wf.status == 2 and not wf.equipment_installed:
                action_idx = 1 + 2 * n_wf + i
                if action_mask[action_idx] > 0:
                    return action_idx

        # 按序列开始准备
        if seq_idx < len(sequence):
            target_idx = sequence[seq_idx]
            if target_idx < len(env.state.workfaces):
                wf = env.state.workfaces[target_idx]
                if wf.status == 0:
                    action_idx = 1 + target_idx
                    if action_mask[action_idx] > 0:
                        return action_idx

        return 0

    def _get_action_type(self, action, n_wf) -> str:
        """获取动作类型"""
        if action == 0:
            return 'wait'
        elif action <= n_wf:
            return 'prep'
        elif action <= 2 * n_wf:
            return 'mining'
        else:
            return 'move'


class GeneticAlgorithm(BaseOptimizer):
    """
    遗传算法

    用于优化工作面接续顺序
    """

    def __init__(
        self,
        population_size: int = 50,
        mutation_rate: float = 0.1,
        crossover_rate: float = 0.8,
        elite_size: int = 5,
        tournament_size: int = 3,
    ):
        super().__init__("GeneticAlgorithm")
        self.population_size = population_size
        self.mutation_rate = mutation_rate
        self.crossover_rate = crossover_rate
        self.elite_size = elite_size
        self.tournament_size = tournament_size

    def optimize(self, env_factory: Callable, n_iterations: int) -> Dict:
        """运行遗传算法"""
        env = env_factory()
        n_workfaces = len(env.workfaces)

        # 初始化种群
        population = self._initialize_population(n_workfaces)

        # 评估初始种群
        fitness_scores = [self.evaluate_sequence(env_factory(), ind) for ind in population]

        for generation in range(n_iterations):
            # 选择
            selected = self._selection(population, fitness_scores)

            # 交叉
            offspring = self._crossover(selected, n_workfaces)

            # 变异
            offspring = self._mutation(offspring)

            # 评估新个体
            offspring_fitness = [self.evaluate_sequence(env_factory(), ind) for ind in offspring]

            # 精英保留
            combined = list(zip(population + offspring, fitness_scores + offspring_fitness))
            combined.sort(key=lambda x: x[1], reverse=True)

            population = [x[0] for x in combined[:self.population_size]]
            fitness_scores = [x[1] for x in combined[:self.population_size]]

            # 记录最优
            if fitness_scores[0] > self.best_fitness:
                self.best_fitness = fitness_scores[0]
                self.best_solution = population[0].copy()

            self.history.append({
                'generation': generation,
                'best_fitness': self.best_fitness,
                'avg_fitness': np.mean(fitness_scores),
            })

        return {
            'best_solution': self.best_solution,
            'best_fitness': self.best_fitness,
            'history': self.history,
        }

    def _initialize_population(self, n_workfaces: int) -> List[List[int]]:
        """初始化种群"""
        population = []
        for _ in range(self.population_size):
            individual = list(range(n_workfaces))
            np.random.shuffle(individual)
            population.append(individual)
        return population

    def _selection(self, population: List, fitness_scores: List[float]) -> List:
        """锦标赛选择"""
        selected = []
        for _ in range(self.population_size):
            tournament_indices = np.random.choice(len(population), self.tournament_size, replace=False)
            tournament_fitness = [fitness_scores[i] for i in tournament_indices]
            winner_idx = tournament_indices[np.argmax(tournament_fitness)]
            selected.append(population[winner_idx].copy())
        return selected

    def _crossover(self, population: List, n_workfaces: int) -> List:
        """顺序交叉 (OX)"""
        offspring = []

        for i in range(0, len(population) - 1, 2):
            if np.random.random() < self.crossover_rate:
                parent1, parent2 = population[i], population[i + 1]
                child1, child2 = self._ox_crossover(parent1, parent2)
                offspring.extend([child1, child2])
            else:
                offspring.extend([population[i].copy(), population[i + 1].copy()])

        return offspring

    def _ox_crossover(self, parent1: List[int], parent2: List[int]) -> Tuple[List[int], List[int]]:
        """顺序交叉实现"""
        n = len(parent1)
        start, end = sorted(np.random.choice(n, 2, replace=False))

        # 创建子代
        child1 = [-1] * n
        child2 = [-1] * n

        # 复制中间段
        child1[start:end] = parent1[start:end]
        child2[start:end] = parent2[start:end]

        # 填充剩余位置
        self._fill_ox_child(child1, parent2, start, end)
        self._fill_ox_child(child2, parent1, start, end)

        return child1, child2

    def _fill_ox_child(self, child: List[int], parent: List[int], start: int, end: int):
        """填充OX交叉子代"""
        n = len(child)
        parent_idx = end
        child_idx = end

        while -1 in child:
            if parent[parent_idx % n] not in child:
                child[child_idx % n] = parent[parent_idx % n]
                child_idx += 1
            parent_idx += 1

    def _mutation(self, population: List) -> List:
        """交换变异"""
        for individual in population:
            if np.random.random() < self.mutation_rate:
                i, j = np.random.choice(len(individual), 2, replace=False)
                individual[i], individual[j] = individual[j], individual[i]
        return population


class SimulatedAnnealing(BaseOptimizer):
    """
    模拟退火算法
    """

    def __init__(
        self,
        initial_temp: float = 1000.0,
        cooling_rate: float = 0.995,
        min_temp: float = 1.0,
    ):
        super().__init__("SimulatedAnnealing")
        self.initial_temp = initial_temp
        self.cooling_rate = cooling_rate
        self.min_temp = min_temp

    def optimize(self, env_factory: Callable, n_iterations: int) -> Dict:
        """运行模拟退火"""
        env = env_factory()
        n_workfaces = len(env.workfaces)

        # 初始解
        current_solution = list(range(n_workfaces))
        np.random.shuffle(current_solution)
        current_fitness = self.evaluate_sequence(env_factory(), current_solution)

        self.best_solution = current_solution.copy()
        self.best_fitness = current_fitness

        temperature = self.initial_temp

        for iteration in range(n_iterations):
            # 生成邻域解
            neighbor = self._get_neighbor(current_solution)
            neighbor_fitness = self.evaluate_sequence(env_factory(), neighbor)

            # 接受准则
            delta = neighbor_fitness - current_fitness

            if delta > 0 or np.random.random() < np.exp(delta / temperature):
                current_solution = neighbor
                current_fitness = neighbor_fitness

                if current_fitness > self.best_fitness:
                    self.best_solution = current_solution.copy()
                    self.best_fitness = current_fitness

            # 降温
            temperature = max(self.min_temp, temperature * self.cooling_rate)

            self.history.append({
                'iteration': iteration,
                'temperature': temperature,
                'current_fitness': current_fitness,
                'best_fitness': self.best_fitness,
            })

        return {
            'best_solution': self.best_solution,
            'best_fitness': self.best_fitness,
            'history': self.history,
        }

    def _get_neighbor(self, solution: List[int]) -> List[int]:
        """生成邻域解（2-opt）"""
        neighbor = solution.copy()
        i, j = sorted(np.random.choice(len(solution), 2, replace=False))
        neighbor[i:j+1] = reversed(neighbor[i:j+1])
        return neighbor


class ParticleSwarmOptimization(BaseOptimizer):
    """
    粒子群优化算法

    用于连续优化，通过位置-序列映射应用于排列问题
    """

    def __init__(
        self,
        n_particles: int = 30,
        w: float = 0.7,      # 惯性权重
        c1: float = 1.5,     # 个体学习因子
        c2: float = 1.5,     # 社会学习因子
    ):
        super().__init__("PSO")
        self.n_particles = n_particles
        self.w = w
        self.c1 = c1
        self.c2 = c2

    def optimize(self, env_factory: Callable, n_iterations: int) -> Dict:
        """运行PSO"""
        env = env_factory()
        n_workfaces = len(env.workfaces)

        # 初始化粒子
        positions = np.random.rand(self.n_particles, n_workfaces)
        velocities = np.random.rand(self.n_particles, n_workfaces) * 0.1

        # 个体最优
        p_best_positions = positions.copy()
        p_best_fitness = np.array([
            self.evaluate_sequence(env_factory(), self._position_to_sequence(pos))
            for pos in positions
        ])

        # 全局最优
        g_best_idx = np.argmax(p_best_fitness)
        g_best_position = p_best_positions[g_best_idx].copy()
        self.best_fitness = p_best_fitness[g_best_idx]
        self.best_solution = self._position_to_sequence(g_best_position)

        for iteration in range(n_iterations):
            for i in range(self.n_particles):
                # 更新速度
                r1, r2 = np.random.rand(2)
                velocities[i] = (
                    self.w * velocities[i] +
                    self.c1 * r1 * (p_best_positions[i] - positions[i]) +
                    self.c2 * r2 * (g_best_position - positions[i])
                )

                # 更新位置
                positions[i] += velocities[i]
                positions[i] = np.clip(positions[i], 0, 1)

                # 评估
                sequence = self._position_to_sequence(positions[i])
                fitness = self.evaluate_sequence(env_factory(), sequence)

                # 更新个体最优
                if fitness > p_best_fitness[i]:
                    p_best_fitness[i] = fitness
                    p_best_positions[i] = positions[i].copy()

                    # 更新全局最优
                    if fitness > self.best_fitness:
                        self.best_fitness = fitness
                        g_best_position = positions[i].copy()
                        self.best_solution = sequence

            self.history.append({
                'iteration': iteration,
                'best_fitness': self.best_fitness,
                'avg_fitness': np.mean(p_best_fitness),
            })

        return {
            'best_solution': self.best_solution,
            'best_fitness': self.best_fitness,
            'history': self.history,
        }

    def _position_to_sequence(self, position: np.ndarray) -> List[int]:
        """将连续位置转换为排列序列"""
        return list(np.argsort(position))
