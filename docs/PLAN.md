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
- 阶段 6：`docs/STAGE_6_PLAN.md`
- 阶段 7：向多领域图形工作台迁移（架构基线与全量审计已完成），见 [阶段 7 计划](STAGE_7_PLAN.md) 和 [目标架构](architecture_evolution.md)。
- 阶段 8：层次追踪、对象聚焦与大图交互收敛（计划中），见 [阶段 8 计划](STAGE_8_PLAN.md)。

## 需求拆解与完成状态

当前里程碑：阶段 7 已完成模块化单体的第一条产品路径：领域契约与注册、Document/ViewSession/commands、共享 pipeline/Scene renderer、UI controller、版本化存档边界，以及内存 AIG 扩展性门禁均已落地。阶段 8 已进入规划，聚焦跨层 Fanin/Fanout、Cell/Net Focused、大图交互性能、可切换的标准门符号、通用 View History、Search 解耦与 Compare 按需加载。阶段 5 的可选 Liberty 增强继续保留为后续计划。

下一条工程主线是阶段 8：先固化真实浏览器与大图基线，再沿阶段 7 边界实施最小失效、按需 Compare、统一 Cell/Net root 和 occurrence-aware 层次查询；Worker 只在消除重复工作后仍有明确主线程瓶颈时立项。生产级 AIG 输入/转换/分析继续另行规划。

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
| R6-1 | 阶段 6 | 新 module/instance 边界时序格式 | Global/Local、INPUT/OUTPUT、AT/RT/Slack、Apply 和旧格式兼容 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-2 | 阶段 6 | 全图时序显示策略 | Auto/Global/Local 与 Slack/AT/RT/All 全图设置 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-3 | 阶段 6 | Cell spacing 与拥塞可读性 | 可调 cell 间距、拥塞感知通道和布局质量回归 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-4 | 阶段 6 | 顶部控件收敛 | Import/More 分组、侧栏 Layout/Timing 和窄屏可用性 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-5 | 阶段 6 | 直接粘贴时序 | 显式 Paste timing、通用文本导入和新格式自动识别 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-6 | 阶段 6 | EDA 启动接口 | 统一 CLI、应用控制层、ready 输出和本地安全边界 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-7 | 阶段 6 | Search-first 双向局部视图 | 独立 fanin/fanout depth、Focused neighborhood 和大图按需布局 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-8 | 阶段 6 | Module 前进/后退 | module 导航历史、状态恢复、按钮和快捷键 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-9 | 阶段 6 | 过程日志控件 | 可折叠日志面板、阶段/级别过滤、容量控制、复制和导出 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-10 | 阶段 6 | 定位并放大所选 cell | View 定位控件、稳定阅读尺度、局部图自动揭示和 Compare 一致行为 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-11 | 阶段 6 | 可复用 Cell Config | 编辑 gate kind/pin direction、本地持久化、JSON 导入导出和 EDA 加载 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R7-1 | 阶段 7 | 多领域工作台核心 | DomainFeature/registry、DocumentStore、ViewSession commands、任务与 Compare 契约 | 已完成 | `docs/STAGE_7_PLAN.md` |
| R7-2 | 阶段 7 | 共享图形与交互边界 | query-to-Scene pipeline、安全/渐进 SVG、Single/Compare controller 与版本化存档 | 已完成 | `docs/STAGE_7_PLAN.md` |
| R7-3 | 阶段 7 | AIG 扩展性验证 | 内存 AIG 经公共搜索、Focused、布局、选择和导出链路，公共层无领域分支 | 已完成 | `docs/STAGE_7_PLAN.md` |
| R8-1 | 阶段 8 | 跨层 Fanin/Fanout | occurrence identity、层次连接模板、可穿 hinst 的双向 cone 与边界信息 | 进行中 | `docs/STAGE_8_PLAN.md` |
| R8-2 | 阶段 8 | Net Focused | Cell/Net 统一 root、driver/load seed、高扇出有界局部图 | 进行中 | `docs/STAGE_8_PLAN.md` |
| R8-3 | 阶段 8 | 交互性能与最小失效 | artifact cache、阶段失效矩阵、局部 reroute/Scene/DOM 更新与性能证据 | 进行中 | `docs/STAGE_8_PLAN.md` |
| R8-4 | 阶段 8 | 可切换的标准逻辑门符号 | 矩形/标准符号显示策略、AND/OR/XOR/BUF 族 Scene 图元、反相 bubble 与 fallback | 计划中 | `docs/STAGE_8_PLAN.md` |
| R8-5 | 阶段 8 | 通用 View History | selection/navigation/focus/viewport/override 的事务化 Back/Forward | 进行中 | `docs/STAGE_8_PLAN.md` |
| R8-6 | 阶段 8 | Search 与 Focused 解耦 | Locate-only 默认语义、显式 Add Focus、Search-first 自动 fallback | 进行中 | `docs/STAGE_8_PLAN.md` |
| R8-7 | 阶段 8 | Compare 大图按需加载 | 双侧独立 Search-first、无布局统计、单侧 job 与显式 Whole | 进行中 | `docs/STAGE_8_PLAN.md` |

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

### 阶段 6：时序、聚焦浏览与 EDA 集成

目标：让工具适应 Global/Local 边界时序和真实层次调试工作流，大图优先通过搜索和双向局部逻辑浏览，并可由已有 EDA 工具直接启动到指定分析位置。

实施状态：已完成。

- 兼容旧 LocResyn timing 和新的 module/instance 边界表格格式。
- 增加可复用 Cell Config，为未知 cell type 配置 gate kind 和各 pin direction。
- 将 cell/port 时序 badge 改为全图 snapshot/metric 设置。
- 增加显式 Paste timing、Cell spacing 和拥塞感知布局。
- 精简 topbar，将低频操作归入菜单和侧栏。
- 增加 Search-first、独立 fanin/fanout depth 和 Focused neighborhood。
- 增加 Focus selected cell，将选择对象居中并缩放到稳定可读级别。
- 增加 module 浏览历史、后退、前进和视图状态恢复。
- 增加可折叠 Process Log，记录导入、解析、时序、布局、渲染和启动过程。
- 提供统一、离线、本地安全的 EDA 启动接口。

完成标准：

- 新旧时序格式可通过文件和粘贴载入，Global/Local/Apply 语义明确。
- 未知 cell 的 gate kind 和 pin direction 可编辑、保存、导入导出，并在后续 design 中自动复用。
- 全图时序显示、双向局部逻辑、module 前进/后退和 Cell spacing 可稳定使用。
- 所选 cell 可以一键居中放大；目标在局部图外时可自动进入对应 Focused neighborhood。
- 过程日志可以过滤、复制和导出，且不会因高频进度信息拖慢大图。
- 千级 cell 场景无需先渲染 Whole 即可搜索并查看局部逻辑。
- 外部 EDA 工具能打开指定 netlist、module 和 focus cell。

详细任务、接口约定和验证矩阵见 `docs/STAGE_6_PLAN.md`。

### 阶段 8：层次追踪、对象聚焦与大图交互收敛

目标：把局部结构浏览扩展到真实 instance occurrence 上下文，并让 Search、Focused、Compare、
View History 和画布交互在大型网表上按最小必要范围工作。

计划交付：

- Cell/Net 统一 Focused root，以及可穿越 hinst/port 的层次 Fanin/Fanout。
- Search 默认只定位；仅 Search-first 大图无法使用 Whole 位置时自动加入 Focused roots。
- 分阶段 artifact 复用、最小失效和 Compare 双侧按需 layout/render。
- 可在兼容矩形与 AND/NAND、OR/NOR、XOR/XNOR、BUF/INV 标准逻辑门符号间切换的显示策略。
- 覆盖 selection、层次导航、Focused、Compare、viewport 和 layout override 的通用 Back/Forward。

完成标准：跨层与 Net cone 正确、有界且不修改源 IR；大图默认路径不触发无必要 Whole layout；
轻量交互不运行 provider；符号模式切换不改变既有端口和 routing geometry；历史事务、分支、兼容和异步恢复
均通过验证。详细分批、性能基线、风险和验证矩阵见 `docs/STAGE_8_PLAN.md`。

## 每次写代码前必须通读

正式写代码前，至少通读：

1. 本文件。
2. 当前阶段对应的细化方案，例如 `docs/STAGE_1_PLAN.md`。
3. `docs/ARCHITECTURE.md`。
4. 若涉及界面、交互或视觉，通读 `docs/DESIGN_SPEC.md`。
5. 若涉及流程、工具、提示词或 agent 行为，通读 `docs/SKILLS_AND_RULES.md`。

读完后再进入实现；实现时只做当前阶段范围内的事情。

