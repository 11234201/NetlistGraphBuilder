# 阶段 2 细化计划

## 阶段目标

阶段 2 把原型从“能画图”推进到“能分析结构”。核心是搜索、选择、高亮、fanin/fanout cone 和基础导出。

## 前置条件

- 阶段 1 已经能解析 fixture。
- 至少一个 module 可以稳定生成 SVG schematic。
- unknown cell 可以渲染为 blackbox。

## 任务拆分

### 1. 搜索索引

建立统一对象索引：

- module
- port
- net
- instance
- cell type

搜索结果需要包含 object kind、display name、graph id 和所属 module。

### 2. 对象选择与属性面板

点击对象后显示 gate/cell type、instance、pin connection、connected nets、driver/load 关系和推断来源。

### 3. Fanin/Fanout 图分析

基于 graph 建立邻接关系，支持 immediate fanin、immediate fanout、transitive cone 和 depth-limited cone。

### 4. Cone 视图模式

视图模式包括 whole module、fanin cone、fanout cone。cone 视图只展示相关节点和边，并保留回到 whole module 的入口。

### 5. Assign/Alias 规范化

处理 `assign a = b` 和 buffer-like alias。规范化不放在 parser 层，UI 要能区分显示 alias 和折叠 alias。

### 6. 导出 SVG

导出当前 module/cone 视图，保留基础样式，文件名包含 module 名和视图模式。

## 验证计划

- 从 output `sco_891` 能追到所有相关 primary input。
- 点击 cell 后属性面板显示 pin/net 关系。
- 搜索 `sco_916` 可以定位并高亮对象。
- depth limit 改变后 cone 节点数量变化合理。
- 导出的 SVG 可以离线打开。

## 本阶段不做

- 不做两个 module 的 compare view。
- 不做 Liberty 解析。
- 不做 ELK.js 大图布局。
- 不做形式等价或逻辑等价判断。
