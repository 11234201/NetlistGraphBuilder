# 阶段 3 细化计划

> 状态：已完成。随 `v0.3.0` 于 2026-07-11 发布；当前完成度 7/7。

## 阶段目标

阶段 3 支持两个 module 的结构对比，主要服务 resyn/remap 前后对照分析。重点是并排展示、端口对齐、同步交互和基础结构差异提示。

## 前置条件

- 阶段 2 已支持对象索引和 cone 视图。
- 单 module 的选择、高亮和属性面板稳定。

## 需求完成表

| ID | 计划需求 | 完成标准 | 当前状态 |
| --- | --- | --- | --- |
| R3-1.1 | Compare View 状态模型 | 独立维护 left/right module、两侧图、选中对象、视图变换和同步开关，且不破坏 single view 状态 | 已完成 |
| R3-1.2 | Module 配对入口 | 可选择左右 module、进入/退出 compare view，并能按同名前缀及 `_Flex`、`_orig`、`_new` 后缀推荐配对 | 已完成 |
| R3-1.3 | Port 对齐 | 同名且同方向的 input/output 在两侧顺序一致；单侧 port 明确标为 unmatched | 已完成 |
| R3-1.4 | 并排 Schematic 与同步交互 | 两侧独立布局并排渲染，支持同步 zoom/pan、fit both，以及选中 port/net 后两侧聚焦 | 已完成 |
| R3-2.1 | 对比高亮与差异提示 | 可高亮同名 port/net、同类 cell，并标记 unmatched port/net 和启发式结构差异 | 已完成 |
| R3-2.2 | 结构统计对比 | 展示两侧 cell count、gate kind count、logic depth 粗估、max fanout 及差值 | 已完成 |
| R3-2.3 | Output Cone 对比 | 选择同名 output（验收样例为 `sco_891`）后同时显示两侧 fanin cone、对齐端口并展示 cone 统计 | 已完成 |

状态口径：只有实现、自动化测试和阶段验收均通过后才标记“已完成”；已编码但尚未完整验收的条目标记“进行中”。

## 任务拆分

### 1. Compare View 状态模型

新增 compare state，包括 left module、right module、selected output/net、synchronized pan/zoom 和 active highlight group。

### 2. Module 配对入口

UI 支持选择 left/right module、进入 compare view、返回 single module view。默认可按同名前缀、`_Flex`、`_orig`、`_new` 等后缀推荐配对。

### 3. Port 对齐

按 port 名称对齐。同名 input/output 对齐，只在一侧存在的 port 标记为 unmatched。

### 4. 双 Schematic

两侧各自布局和渲染，默认上下排列并可切换左右排列，支持同步 zoom、pan、fit both 和 selected port/net focus。

### 5. 差异提示

第一版只做结构统计和启发式差异，包括 cell count、gate kind count、logic depth 粗估、max fanout、unmatched net/port。

### 6. Output Cone 对比

选择同名 output 后，左右分别抽取 fanin cone，端口保持对齐，并显示两侧 cone 统计。

## 验证计划

- 能把示例中的 `root...` 和 `root..._Flex` 并排显示。
- 同名输入输出端口顺序一致。
- 选择 `sco_891` 后两侧都显示 fanin cone。
- 统计面板显示两侧 cell/gate/depth 差异。

## 完成验证

- 内置 `root...` / `root..._Flex` 示例通过上下、左右布局和 Single/Compare 往返页面验收。
- `sco_891` 两侧 fanin cone、同步交互、对象高亮和结构统计通过页面验收。
- Escaped hierarchical output（例如 `\u_dp_add_0/out0_33`）两侧 cone 回归用例通过。
- `v0.3.0` 发布前自动化测试共 60 项通过。

## 本阶段不做

- 不做 SAT/形式等价。
- 不做跨 module 自动匹配内部 net。
- 不做 Liberty function 比较。
- 不做大规模图性能优化。
