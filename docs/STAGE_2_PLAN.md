# 阶段 2 细化计划

> 状态：已完成。随 `v0.2.0` 于 2026-07-11 发布。

## 阶段目标

阶段 2 把原型从“能画图”推进到“能分析结构”。核心是搜索、选择、高亮、fanin/fanout cone 和基础导出。

## 前置条件

- 阶段 1 已经能解析 fixture。
- 至少一个 module 可以稳定生成 SVG schematic。
- unknown cell 可以渲染为 blackbox。

## 需求完成表

| ID | 需求 | 完成标准 | 状态 |
| --- | --- | --- | --- |
| R2-1 | 搜索索引 | 可搜索 module、port、net、instance、cell type，并定位到图中对象 | 已完成 |
| R2-2 | 对象选择与属性面板 | 点击对象后展示 gate/cell type、instance、pin/net、driver/load、推断来源 | 已完成 |
| R2-3 | Fanin/Fanout 图分析 | 支持 immediate、transitive 和 depth-limited fanin/fanout | 已完成 |
| R2-4 | Cone 视图模式 | whole module、fanin cone、fanout cone 可切换 | 已完成 |
| R2-5 | Assign/Alias 规范化 | alias 可折叠，并可切换显示 alias | 已完成 |
| R2-6 | 导出 SVG | 当前 module/cone 视图可导出为离线 SVG | 已完成 |
| R2-7 | 手动布局校准与临时 golden | 节点可拖动，保存 layout golden，并能对比自动布局与 golden 差异 | 已完成 |
| R2-8 | Wire 可读性修正 | 相近 pin 局部优先连线，net label 靠近接口，adjust 模式支持吸附对齐 | 已完成 |

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

### 7. 手动布局校准与临时 golden

增加一个只用于布局校准的调整模式，不把它设计成长期 schematic 编辑器。用户开启调整模式后，可以拖动每个 schematic 节点，连线根据新的节点位置重新路由。

保存 golden 时记录：

- module name。
- layout options。
- 每个 node 的 `id`、`kind`、`label`、`x`、`y`。
- 可选 SVG snapshot，方便人工快速复查。

对比 golden 时输出：

- 自动布局和 golden 中每个节点的位移。
- 同层节点顺序差异。
- PI/PO/gate 是否符合期望的列对齐。
- 可转化为布局规则的观察，例如同 cone 聚拢、输出对齐、跨层长线减少。

### 8. Wire 可读性修正计划

修正当前 fallback router 的三个问题：线过度走顶部 lane、net label 离接口太远、手动调整时缺少吸附。

#### 8.1 局部优先 routing

当前问题：跨层线倾向统一走顶部 trace，再从右侧回到目标，导致本来可以短连的线出现多个不必要弯角。

实现计划：

- 在 `routeEdge` 中增加 route kind：`direct`、`local-dogleg`、`channel`、`top-lane`。
- 当 source pin 与 target pin 的 `y` 差小于阈值时，优先生成水平直连或极短 dogleg。
- 当 source/target 位于相邻层且通道空间足够时，优先使用局部 channel lane，不进入顶部 lane。
- 只有跨越多层、局部通道不足或明显可能穿过节点区域时，才使用顶部 lane。
- 在 positioned edge 上保留 `routeKind`，方便测试和后续调试。

完成标准：

- y 对齐的两个 pin 之间能生成一条水平线或最少折线。
- 相邻层常见连接不再默认绕到顶部。
- 长 skip-level 线仍能使用顶部 lane，避免穿过中间节点。

#### 8.2 Net label 靠近接口

当前问题：net label 放在某条 wire segment 的中间，用户读图时无法快速对应到 cell pin。

实现计划：

- label 默认靠近 target pin，尤其是 cell input pin 左侧。
- 对 output port 或 fanout source，可选择靠近 source pin 右侧。
- label 位置基于 connection point 计算，而不是基于 path 中段计算。
- label 应避开 pin dot/bubble，保留固定小偏移。
- 后续如果出现重叠，再增加 label collision pass；本次先解决位置语义。

完成标准：

- 输入线的 net 名称靠近目标 cell 的输入 pin。
- 输出线或 port 线的 net 名称不漂到长线中段。
- SVG smoke test 覆盖至少一个 target-side label 位置。

#### 8.3 Adjust 模式吸附

当前问题：手动拖动 cell 是自由浮点坐标，很难把 pin 对齐成水平线。

实现计划：

- 增加 grid snap，默认步长 8px 或 12px。
- 增加 pin-y alignment snap：拖动节点时，如果当前节点某个 pin 的 y 接近相连节点 pin 的 y，则自动吸附。
- 吸附只改变节点 `y`，不改变拓扑和 pin 顺序。
- 状态栏提示当前吸附目标，例如 `Snapped to A -> B`。
- 保存 golden 时继续记录吸附后的最终 node position，不额外引入编辑器状态。

完成标准：

- 拖动 cell 时可以稳定吸附到相连 pin 的水平 y。
- 吸附后对应 wire 可以变成水平或短 dogleg。
- 未接近任何 pin 时仍按 grid snap 移动，不影响自由调整。

#### 8.4 验证计划

- 新增 layout unit tests：
  - y 对齐连接选择 `direct` 或 `local-dogleg`，不走 `top-lane`。
  - long skip-level edge 仍可走 `top-lane`。
  - label point 靠近 target/source pin，而非 path 中点。
- 新增 UI-adjacent unit/helper tests：
  - grid snap 把任意坐标吸附到固定步长。
  - pin-y snap 在阈值内吸附到相连 pin y。
- 手动验证：
  - 打开 fixture，调整一个 cell 到相邻 pin 水平线，wire 能明显减少弯角。
  - 导出 golden 后，节点位置为吸附后的坐标。

## 验证计划

- 从 output `sco_891` 能追到所有相关 primary input。
- 点击 cell 后属性面板显示 pin/net 关系。
- 搜索 `sco_916` 可以定位并高亮对象。
- depth limit 改变后 cone 节点数量变化合理。
- 导出的 SVG 可以离线打开。
- 拖动节点后 wire 重新连接到对应 pin，保存的 golden 可以重新加载或用于差异分析。
- 常见相近 pin 连接不强制走顶部 lane，net label 靠近接口，adjust 模式吸附能辅助对齐。

## 本阶段不做

- 不做两个 module 的 compare view。
- 不做 Liberty 解析。
- 不做 ELK.js 大图布局。
- 不做形式等价或逻辑等价判断。
- 不把手动校准模式扩展为可编辑网表或长期制图工具。

## 完成记录

- R2-1 至 R2-8 均已实现并纳入自动化测试。
- 搜索、对象选择、fanin/fanout traversal、cone view 和 depth limit 已形成完整分析流程。
- Assign alias 默认折叠，展开时显示为 `ALIAS`，不与真实 BUF cell 混淆。
- Adjust、wire routing、timing badge 和关键元信息经过多轮实际网表可读性修正。
- 当前 module 或 cone 可导出为包含内嵌样式的独立 SVG。
- `v0.2.0` 发布前自动化测试共 56 项通过。

已知遗留：整体布局在部分大 module 上仍偏横向细长，布局宽高平衡留到后续布局阶段处理。
