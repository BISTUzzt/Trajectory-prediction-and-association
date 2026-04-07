## 关联实现逻辑

核心思想：按时间步逐帧处理，使用“轨迹预测点 vs 当前新点”的全局最优匹配完成关联。

1. 输入归一化
- 在 `TrajectoryAssociator._normalize_input_data()` 中将输入整理为 `{ts: [[x,y(,z)], ...]}`。
- 校验字段合法性、`information.ts` 与外层 `time_step` 一致性。

2. 按时间推进
- 将所有 `ts` 升序遍历。
- 每个时间步取出当前帧新点 `new_points`。

3. 轨迹预测
- 对“仍活跃”的每条轨迹调用 `TrajectoryPredictor.predict_next_point()` 生成预测点。
- 历史长度足够时使用卡尔曼滤波；不足时退化为末点近似。

4. 点级关联（匈牙利算法）
- 在 `PointAssociator.associate()` 构造代价矩阵并调用 `linear_sum_assignment`。
- `pos_dim=2` 时，距离使用经纬度球面距离（米）；`pos_dim=3` 时使用欧氏距离缩放。
- 仅保留距离 `<= threshold_m` 的匹配结果。

5. 轨迹更新
- 匹配成功：将新点接入对应轨迹。
- 未匹配新点：新建轨迹。
- 轨迹超时（`timeout_steps * cycle`）后不再参与后续匹配。

6. 输出整理与校验
- 模块输出为 `Dict[traj_id, List[information]]`。
- 其中 `information.id == traj_id`，表示“关联后轨迹号”。

> 说明：输入中的 `id` 在关联过程中不参与匹配计算，匹配依据是时序 + 空间距离 + 预测。

# 关联模块接口说明

## 输入接口

- 类型：`Dict[time_step, List[information]]`

### `time_step`
- 类型：`int | float`
- 约束：必须与对应 `information.ts` 一致

### `information`
- 类型：`Dict`
- 字段（仅允许以下字段）：
  - `ts`：`int | float`（必填）
  - `id`：`int`（必填）
  - `x`：`float`（必填）
  - `y`：`float`（必填）
  - `z`：`float`（可选，缺省默认 `0.0`）

### 输入示例
```python
{
  100: [
    {"ts": 100, "id": 1, "x": 120.1, "y": 30.2, "z": 0.0},
    {"ts": 100, "id": 2, "x": 120.2, "y": 30.3}
  ],
  106: [
    {"ts": 106, "id": 1, "x": 120.12, "y": 30.25, "z": 0.0}
  ]
}
```

---

## 输出接口

- 类型：`Dict[traj_id, List[information]]`
- 说明：`information.id` 为关联后的轨迹编号（等于外层 `traj_id`）

### `traj_id`
- 类型：`int`

### `information`
- 类型：`Dict`
- 字段（固定为以下 5 个）：
  - `ts`：`float`
  - `id`：`int`（且必须等于外层 `traj_id`）
  - `x`：`float`
  - `y`：`float`
  - `z`：`float`

### 输出示例
```python
{
  0: [
    {"ts": 100.0, "id": 0, "x": 120.1, "y": 30.2, "z": 0.0},
    {"ts": 106.0, "id": 0, "x": 120.12, "y": 30.25, "z": 0.0}
  ],
  1: [
    {"ts": 100.0, "id": 1, "x": 120.2, "y": 30.3, "z": 0.0}
  ]
}
```

---

## 对外调用入口

- 推荐直接调用：`traj_association_module.py` 中的 `associate_trajectories()`

```python
from traj_association_module import associate_trajectories

result = associate_trajectories(
  data=input_data,   # Dict[time_step, List[information]]
  ds_id=1,
  pos_dim=3,
)
```

---

## 备注

- `run_csv_association.py` 仅用于本地 CSV 输入/输出查看，不属于对外模块接口。
- 当前 `run_csv_association.py` 的 CSV 输出会将 `id` 回填为输入原始 `id`（用于展示/对照）；
  模块接口 `associate_trajectories()` 的返回中，`id` 仍表示关联后轨迹号。


项目启动步骤：
输出csv文件：run_csv_association.py
前端启动：start_viewer.py

关联接口调用：traj_association_module.py
