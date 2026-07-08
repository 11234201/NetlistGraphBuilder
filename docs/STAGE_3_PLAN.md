# 阶段 3 细化计划

## 阶段目标

阶段 3 支持两个 module 的结构对比，主要服务 resyn/remap 前后对照分析。重点是并排展示、端口对齐、同步交互和基础结构差异提示。

## 前置条件

- 阶段 2 已支持对象索引和 cone 视图。
- 单 module 的选择、高亮和属性面板稳定。

## 任务拆分

### 1. Compare View 状态模型

新增 compare state，包括 left module、right module、selected output/net、synchronized pan/zoom 和 active highlight group。

### 2. Module 配对入口

UI 支持选择 left/right module、进入 compare view、返回 single module view。默认可按同名前缀、`_Flex`、`_orig`、`_new` 等后缀推荐配对。

### 3. Port 对齐

按 port 名称对齐。同名 input/output 对齐，只在一侧存在的 port 标记为 unmatched。

### 4. 并排 Schematic

两侧各自布局和渲染，支持同步 zoom、pan、fit both 和 selected port/net focus。

### 5. 差异提示

第一版只做结构统计和启发式差异，包括 cell count、gate kind count、logic depth 粗估、max fanout、unmatched net/port。

### 6. Output Cone 对比

选择同名 output 后，左右分别抽取 fanin cone，端口保持对齐，并显示两侧 cone 统计。

## 验证计划

- 能把示例中的 `root...` 和 `root..._Flex` 并排显示。
- 同名输入输出端口顺序一致。
- 选择 `sco_891` 后两侧都显示 fanin cone。
- 统计面板显示两侧 cell/gate/depth 差异。

## 本阶段不做

- 不做 SAT/形式等价。
- 不做跨 module 自动匹配内部 net。
- 不做 Liberty function 比较。
- 不做大规模图性能优化。
