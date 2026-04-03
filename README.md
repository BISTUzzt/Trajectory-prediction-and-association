# 项目流程说明
- 前端启动：`start_viewer.py`（输出 CSV 文件）
- 数据处理：`run_csv_association.py`（调用关联接口）
- 核心模块：`traj_association_module.py`（轨迹关联算法）
- 
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
- 说明：`information.id` 与 `information.tra_id` 均为关联后的轨迹编号（等于外层 `traj_id`）

### `traj_id`
- 类型：`int`

### `information`
- 类型：`Dict`
- 字段（固定为以下 6 个）：
  - `ts`：`float`
  - `id`：`int`（且必须等于外层 `traj_id`）
  - `tra_id`：`int`（且必须等于外层 `traj_id`）
  - `x`：`float`
  - `y`：`float`
  - `z`：`float`

### 输出示例
```python
{
  0: [
    {"ts": 100.0, "id": 0, "tra_id": 0, "x": 120.1, "y": 30.2, "z": 0.0},
    {"ts": 106.0, "id": 0, "tra_id": 0, "x": 120.12, "y": 30.25, "z": 0.0}
  ],
  1: [
    {"ts": 100.0, "id": 1, "tra_id": 1, "x": 120.2, "y": 30.3, "z": 0.0}
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
