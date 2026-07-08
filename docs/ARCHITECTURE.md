# 架构设计

## 分层原则

项目采用清晰的数据流分层，避免 UI、parser 和布局逻辑互相耦合。

```text
parser -> netlist IR -> inference -> graph extraction -> layout -> render -> UI
```

每层只依赖左侧稳定数据结构，不直接读取 Verilog 原文，除非它就是 parser 层。

## 模块边界

### `src/parser/`

负责把 structural Verilog 文本解析成原始语法信息。

职责：

- 处理注释。
- 处理 escaped identifier。
- 解析 module、port、net declaration、assign、cell instance。
- 保留必要 source span，方便错误定位。

不负责：

- 推断 gate 类型。
- 推断 pin 方向。
- 决定图怎么画。

### `src/netlist/`

负责稳定 IR 和图分析基础结构。

建议核心类型：

```text
Design
  modules: Module[]

Module
  name
  ports
  nets
  cells
  assigns

Port
  name
  direction: input | output | inout | unknown

Net
  name
  declaredKind: port | wire | implicit

Cell
  type
  instance
  pins: PinConnection[]

PinConnection
  pin
  net
```

### `src/infer/`

负责无 `.lib` 推断。

职责：

- cell type -> gate kind。
- pin name -> input/output/inout。
- assign alias 处理建议。
- 标记推断置信度。

规则必须可配置，长期放入类似：

```text
src/infer/defaultCellRules.ts
```

后续可以加载：

```text
config/cell_rules.json
```

### `src/layout/`

负责把图模型转成布局引擎输入，再把布局结果规范化。

布局 provider 设计：

```text
LayoutProvider
  layout(graph, options) -> PositionedGraph
```

长期 provider：

- `SimpleLayeredLayoutProvider`：内置 fallback，方便测试和离线最小原型。
- `ElkLayoutProvider`：长期主力。

### `src/render/`

负责把 positioned graph 变成 SVG。

职责：

- gate symbol。
- port 节点。
- wire/edge。
- label。
- highlight class。
- marker 和 arrow。

渲染层不解析网表，不计算 cone。

### `src/ui/`

负责用户交互。

职责：

- 文件拖入/打开。
- module 选择。
- 视图模式切换。
- 搜索。
- 高亮。
- 缩放平移。
- 导出。

UI 通过明确 API 调用 parser/netlist/layout/render，不直接操作内部临时结构。

## 数据模型原则

- net 名称使用 canonical form 存储，同时保留 display name。
- escaped identifier 要在 parser 层规范处理。
- assign alias 不在 parser 层消除，在 netlist/infer 或 graph extraction 阶段处理。
- 每个 cell/pin 的推断来源要可追踪：
  - `library`
  - `rule`
  - `fallback`
  - `unknown`

## 错误处理原则

- parser 错误给出 module 名、行列范围和附近 token。
- unknown cell 不算错误。
- unknown pin direction 不算错误，但在 UI 中可提示。
- 单个 module 解析失败不应阻止其他 module 展示，除非文件整体语法不可恢复。

