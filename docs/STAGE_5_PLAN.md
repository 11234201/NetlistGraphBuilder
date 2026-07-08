# 阶段 5 细化计划

## 阶段目标

阶段 5 增加可选 Liberty `.lib` 支持，用于提高 pin direction 和 cell function 判断准确性。无 `.lib` 仍然必须是默认可用路径。

## 前置条件

- 阶段 4 的布局和大图浏览稳定。
- 推断规则已有清晰的来源标记。
- unknown cell fallback 行为稳定。

## 任务拆分

### 1. Liberty 子集解析

只解析必要子集：`cell`、`pin`、`direction` 和可选 `function`。

### 2. Library Model

新增 `Library`、`LibraryCell`、`LibraryPin`、`PinDirection`、`PinFunction`，并保留来源文件名和解析诊断。

### 3. 推断覆盖策略

优先级为 Liberty pin direction、项目 cell rule、fallback rule、unknown。UI 中要能显示当前推断来源。

### 4. Cell Function 辅助

如果 `.lib` 有 function，用 function 辅助判断 gate kind，并给 AOI/OAI/MUX 等 complex gate 更准确标签。

### 5. UI 入口

支持可选加载 `.lib`。加载成功后重新推断当前 design；加载失败不影响原网表显示。

### 6. 诊断与回退

明确显示 `.lib` 未加载、cell 缺失、pin 缺失、function 不支持等状态。

## 验证计划

- 无 `.lib` 时所有既有 fixture 仍通过。
- 加载测试 `.lib` 后 pin direction 覆盖启发式规则。
- `.lib` 缺 cell 时 fallback 到 rule，不崩溃。
- UI 能显示 inference source。

## 本阶段不做

- 不做完整 Liberty timing parser。
- 不做时序分析。
- 不做功耗/面积分析。
- 不做完整布尔等价验证。
