# 长期计划

## 产品定位

Netlist Graph Builder 是一个离线可用的 gate-level netlist schematic browser。它的核心价值不是把网表转成一张静态图，而是帮助工程师在没有 `.lib`、不安装大型 EDA 工具、无法访问公网的情况下，快速理解门级结构。

目标用户是需要检查 synthesis、resyn、remap、ECO 或局部逻辑 cone 的工程师。第一优先级是“结构看得清、交互顺手、离线可靠”，不是完整替代商业 schematic viewer。

## 长期技术路线

```text
Structural Verilog
  -> parser
  -> Netlist IR
  -> cell/pin inference
  -> graph extraction
  -> ELK-style layered layout
  -> SVG interactive schematic
```

长期首选：

- 语言：TypeScript / JavaScript。
- 运行方式：纯前端静态网页优先，后续可封装为 Tauri/Electron。
- 布局：ELK.js 作为主路线，Dagre 或简单自研层次布局作为 fallback。
- 渲染：SVG 优先，超大图再考虑 Canvas/WebGL 混合。
- 依赖策略：能 vend 到 `vendor/`，保证内网离线可用。

## 不做什么

- 第一阶段不解析完整 Verilog/SystemVerilog。
- 第一阶段不依赖 Liberty `.lib`。
- 第一阶段不追求形式等价验证。
- 第一阶段不把 Mermaid/LLM 作为主绘图路径。
- 不为了画完整大 module 而牺牲 cone 浏览体验。

## 核心能力路线图

每个阶段都必须有独立的细化方案 Markdown。总计划只描述路线和阶段边界，阶段内的任务拆分、完成标准、验证计划写入对应文件：

- 阶段 0：`docs/STAGE_0_PLAN.md`
- 阶段 1：`docs/STAGE_1_PLAN.md`
- 阶段 2：`docs/STAGE_2_PLAN.md`
- 阶段 3：`docs/STAGE_3_PLAN.md`
- 阶段 4：`docs/STAGE_4_PLAN.md`
- 阶段 5：`docs/STAGE_5_PLAN.md`

## 需求拆解与完成状态

当前里程碑：阶段 4 已完成，并随 `v0.4.0` 发布大图布局与工程化能力。下一阶段进入可选 Liberty 增强。

状态口径：

- 已完成：仓库中已有可运行实现或文档交付物。
- 进行中：当前优先处理，允许拆出更细任务。
- 计划中：已进入路线图，但尚未实现。
- 暂缓：明确不在当前阶段处理。

| ID | 阶段 | 需求 | 主要交付物 | 状态 | 细化文档 |
| --- | --- | --- | --- | --- | --- |
| R0-1 | 阶段 0 | 项目准备 | 仓库、目录、README、计划、架构、设计规范、示例 fixture | 已完成 | `docs/STAGE_0_PLAN.md` |
| R1-1 | 阶段 1 | Structural Verilog parser 与 Netlist IR | module/port/wire/assign/cell/escaped identifier 解析 | 已完成 | `docs/STAGE_1_PLAN.md` |
| R1-2 | 阶段 1 | 无 `.lib` cell/pin 推断 | gate kind、pin direction、inference source | 已完成 | `docs/STAGE_1_PLAN.md` |
| R1-3 | 阶段 1 | Graph extraction 与简单布局 | PI/PO/cell/assign graph、left-to-right layered layout、正交连线 | 已完成 | `docs/STAGE_1_PLAN.md` |
| R1-4 | 阶段 1 | SVG schematic 与基础交互 | SVG 渲染、module selector、文件导入、缩放、平移、fit | 已完成 | `docs/STAGE_1_PLAN.md` |
| R2-1 | 阶段 2 | 搜索与对象索引 | net/port/instance/cell type 搜索、定位、高亮 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R2-2 | 阶段 2 | 对象选择与属性面板增强 | gate/net 详情、pin/net 关系、driver/load 信息 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R2-3 | 阶段 2 | Fanin/Fanout 分析与 cone view | immediate/transitive/depth-limited traversal、视图切换 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R2-4 | 阶段 2 | Assign/Alias 规范化 | alias 折叠、显示切换、buf-like assign 处理 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R2-5 | 阶段 2 | 图中关键元信息 | cell type、instance、output net、fanout count | 已完成 | `docs/STAGE_2_PLAN.md` |
| R2-6 | 阶段 2 | 导出 SVG | 当前 module/cone 视图离线 SVG 导出 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R2-7 | 阶段 2 | 手动布局校准与临时 golden | 节点拖动、保存 layout golden、对比自动布局与 golden 差异 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R2-8 | 阶段 2 | Wire 可读性修正 | 局部优先 routing、pin 附近 net label、adjust snap 对齐 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R3-1 | 阶段 3 | Module compare view | 左右 module 选择、并排 schematic、同步缩放平移 | 已完成 | `docs/STAGE_3_PLAN.md` |
| R3-2 | 阶段 3 | 对比高亮与统计 | 同名 port/net/cell、结构差异区域、cell/depth/fanout 统计 | 已完成 | `docs/STAGE_3_PLAN.md` |
| R4-1 | 阶段 4 | 大图布局与性能 | LayoutProvider、ELK.js fallback/provider、progressive render | 已完成 | `docs/STAGE_4_PLAN.md` |
| R4-2 | 阶段 4 | 大图可读性与状态保存 | fanout hub、collapse/expand、offscreen 降细节、session state | 已完成 | `docs/STAGE_4_PLAN.md` |
| R4-3 | 阶段 4 | Balanced/Folded 布局 | 深层 DAG 按逻辑层分带折叠、跨带专用通道、保留默认左到右模式 | 暂缓 | `docs/STAGE_4_PLAN.md` |
| R5-1 | 阶段 5 | 可选 Liberty 增强 | `.lib` 子集解析、pin direction 覆盖、function 辅助、fallback 诊断 | 计划中 | `docs/STAGE_5_PLAN.md` |

### 阶段 0：项目准备

目标：建立仓库、计划、规范、目录骨架和示例输入。

交付物：

- Git 仓库。
- 项目目录结构。
- 长期计划和阶段计划。
- 架构说明。
- UI/交互设计规范。
- skill 和项目规则写入规范。
- 示例网表 fixture。

完成标准：

- 新成员可以只读 `README.md`、本文件和 `docs/ARCHITECTURE.md` 理解项目方向。
- 写代码前的阅读要求明确。
- 目录边界清楚。

### 阶段 1：最小可用原型

目标：输入一个 structural Verilog 文本，解析 module，并生成可缩放 SVG schematic。

短期计划：

- 实现 tokenizer/轻量 parser，支持：
  - `module ... endmodule`
  - `input/output/wire`
  - `assign lhs = rhs`
  - `CELL inst (.PIN(net), ...);`
  - escaped identifier，例如 `\a_q[25] `
- 设计 Netlist IR：
  - `Module`
  - `Port`
  - `Net`
  - `Cell`
  - `PinConnection`
  - `Assign`
- 实现 cell/pin 启发式推断：
  - `ND/NAND/CKND -> nand`
  - `NR/NOR -> nor`
  - `INV/CKINV -> inv`
  - `XOR -> xor`
  - `XNR/XNOR -> xnor`
  - 未识别 cell 作为 blackbox
- 实现简单 layered layout fallback。
- 实现 SVG renderer：
  - PI/PO 节点
  - gate 节点
  - net label
  - 基础连线
- 实现基本交互：
  - 缩放
  - 平移
  - fit to view
  - module selector

完成标准：

- 能加载 `tests/fixtures/two_equivalent_style_modules.v`。
- 能分别画出两个 module 的结构图。
- 图可放大缩小，文字不糊。
- unknown cell 不会导致崩溃。

### 阶段 2：实用分析能力

目标：让工具从“能画图”变成“能看结构”。

短期计划：

- 搜索 net、port、instance、cell type。
- 点击 gate/net 高亮：
  - immediate fanin
  - immediate fanout
  - transitive fanin cone
  - transitive fanout cone
- 增加 depth-limited cone view。
- assign/buf 规范化：
  - 单纯 wire alias 可折叠。
  - 用户可切换是否显示 alias。
- 图中显示关键元信息：
  - cell type
  - instance name
  - output net
  - fanout count
- 增加导出 SVG。
- 增加手动布局校准：
  - 用户可进入临时调整模式，自由拖动每个 schematic 节点。
  - 保存当前节点位置作为临时 layout golden。
  - 对比自动布局与 layout golden 的差异，沉淀为后续布局修改方案。
- 修正 wire 可读性：
  - 相近 pin 优先局部直连或短 dogleg，顶部 lane 只作为长跨层 fallback。
  - net label 默认贴近 cell/port pin，而不是放在长线中段。
  - 调整模式增加 grid snap 和 pin-y alignment snap，降低手动对齐成本。

完成标准：

- 用户可以从一个 output 快速追到所有 primary input。
- 用户可以限制只看前后 N 层。
- 搜索定位后视图自动居中。
- 用户可以手动调整一张图并保存 golden，用于说明期望布局。
- 常见局部连线不被强制绕到顶部，net 名称靠近接口且调整时容易吸附成直线。

### 阶段 3：对比视图

目标：支持 resyn/remap 前后两个 module 的结构对比。

短期计划：

- 选择两个 module 进入 compare view。
- 同名 input/output port 对齐。
- 并排显示两个 schematic。
- 支持同步缩放和平移。
- 高亮：
  - 同名 port
  - 同名 net
  - 同类 cell
  - 结构差异区域
- 输出基础统计对比：
  - cell count
  - inferred gate type count
  - logic depth 粗估
  - max fanout

完成标准：

- 能把 `root...` 和 `root..._Flex` 并排展示。
- 可以从同一个 output 比较两边 fanin cone。
- 对比视图不会强依赖 `.lib`。

### 阶段 4：大图和工程化

目标：让工具能处理更接近真实工程的网表片段。

短期计划：

- 引入 ELK.js，并封装 layout provider。
- 对大图增加：
  - progressive render
  - collapse/expand group
  - fanout hub 简化
  - offscreen 节点降细节
- 增加可选 Balanced/Folded layout：
  - 默认 left-to-right 模式保持不变。
  - 深层 DAG 可按 4-6 个逻辑层分带折叠，改善细长宽高比。
  - 跨带 edge 使用独立通道，避免简单压缩列距导致局部 net 乱绕。
- 增加 session state：
  - 最近打开的 module
  - 当前搜索
  - cone depth
  - 布局选项
- 增加项目内测试：
  - parser fixture tests
  - inference tests
  - graph extraction tests
  - SVG smoke tests

完成标准：

- 千级 cell 的局部 cone 浏览仍然可用。
- 布局层可以在 fallback 与 ELK.js 间切换。
- 解析失败能定位到大致文本位置。

### 阶段 5：可选 `.lib` 增强

目标：在用户提供 Liberty 时提高准确性，但不破坏无 `.lib` 工作流。

短期计划：

- 解析 Liberty cell/pin direction 的必要子集。
- 用 `.lib` pin direction 覆盖启发式规则。
- 可选读取 cell function，用于更准确 gate symbol。
- 标记 `.lib` 缺失、cell 缺失、pin 缺失的 fallback 状态。

完成标准：

- 无 `.lib` 时功能照常可用。
- 有 `.lib` 时 pin 方向和 cell 类型更准确。
- UI 明确显示当前推断来源。

## 每次写代码前必须通读

正式写代码前，至少通读：

1. 本文件。
2. 当前阶段对应的细化方案，例如 `docs/STAGE_1_PLAN.md`。
3. `docs/ARCHITECTURE.md`。
4. 若涉及界面、交互或视觉，通读 `docs/DESIGN_SPEC.md`。
5. 若涉及流程、工具、提示词或 agent 行为，通读 `docs/SKILLS_AND_RULES.md`。

读完后再进入实现；实现时只做当前阶段范围内的事情。

