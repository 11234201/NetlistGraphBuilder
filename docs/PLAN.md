# 长期演进计划与路线图

## 1. 产品定位

- **当前维护基线**：默认启用 `Native Layered H08` 布局引擎，失败时按 `H08 → ELK → Simple` 顺序自动降级；关于 Linux 单文件启动器、CMake 构建及 EDA/Tcl 辅助脚本的专项维护，请参阅 [维护计划](plans/linux_launcher_maintenance.md)（历史阶段文档保留当时的验收背景，不代表旧发布版本包含当前主干的全部后续修复）。
- **核心价值**：**Netlist Graph Builder** 是一个离线可用的门级结构化 Verilog 原理图浏览器（Gate-level Netlist Schematic Browser）。它的核心价值并非仅仅将网表转为一张静态图片，而是帮助芯片设计与验证工程师在**缺乏 Liberty（`.lib`）时序库、未安装大型商业 EDA 工具且无法访问公网**的环境中，快速读懂门级拓扑结构。
- **目标用户与第一优先级**：面向需要排查逻辑综合（Synthesis）、重综合（Resyn）、工艺重映射（Remap）、ECO 修改或局部逻辑锥（Logic Cone）的工程师。产品第一优先级是**“结构看得清、交互顺手、离线可靠”**，而非全面替代重量级商业原理图工具。

## 2. 长期技术路线

```text
Structural Verilog
  -> parser
  -> Netlist IR
  -> cell/pin inference
  -> graph extraction
  -> ELK-style layered layout (H08 / ELK / Simple)
  -> SVG interactive schematic
```

**长期技术选型**：

- **开发语言**：原生 JavaScript（ES Modules）与 JSDoc 契约约束；桌面/服务端启动器采用 C#（Windows）与 C++11（Linux）。
- **运行形态**：纯静态前端资源优先，无打包工具（bundler）或包安装依赖；支持本地 Node.js / Python 预览及 Windows / Linux 单文件离线启动器。
- **布局引擎**：默认采用项目自研的 `H08` 静态分层布局与正交布线引擎，内置本地化（vendored）`ELK` 与 `Simple` 作为自动降级与备选方案。
- **图形渲染**：以交互式 SVG 与渐进式分批挂载为核心。
- **离线依赖策略**：所有必需运行时依赖均内嵌或 vendored 至 `vendor/` 目录，确保在隔离内网环境下 100% 离线可用。

## 3. 明确不做的事项（Non-Goals）

- 不实现完整的行为级 Verilog / SystemVerilog 编译与综合前端。
- 不将 Liberty `.lib` 作为必需前置依赖（无 `.lib` 是默认工作模式）。
- 不提供形式化逻辑等价性证明（Formal Equivalence Checking）。
- 不将 Mermaid 或大语言模型（LLM）生成作为原理图绘图路径。
- 不为了强行一次性渲染超大模块的完整图而牺牲局部逻辑锥（Focused Cone）的响应体验。

## 4. 核心阶段路线图

每个演进阶段均维护在独立的细化方案文档中。本总计划负责定义全局路线与阶段边界，各阶段内部的任务拆解、验收标准与验证矩阵详见对应文档：

- **阶段 0（项目准备）**：`docs/STAGE_0_PLAN.md`
- **阶段 1（最小可用原型）**：`docs/STAGE_1_PLAN.md`
- **阶段 2（实用分析能力）**：`docs/STAGE_2_PLAN.md`
- **阶段 3（双模块对比视图）**：`docs/STAGE_3_PLAN.md`
- **阶段 4（大图与工程化）**：`docs/STAGE_4_PLAN.md`
- **阶段 5（可选 Liberty 增强）**：`docs/STAGE_5_PLAN.md`
- **阶段 6（时序、聚焦浏览与 EDA 集成）**：`docs/STAGE_6_PLAN.md`
- **阶段 7（多领域图形工作台架构演进）**：已完成架构基线落地与全量审计，详见 [阶段 7 计划](STAGE_7_PLAN.md) 与 [目标架构](architecture_evolution.md)。
- **阶段 8（层次追踪、对象聚焦与大图交互收敛）**：核心功能已落地并持续收敛中，详见 [阶段 8 计划](STAGE_8_PLAN.md)。

## 5. 需求拆解与完成状态

**当前里程碑进展**：
- **阶段 7（已完成）**：模块化单体多领域工作台架构已全面落地，涵盖领域契约与静态注册、`DocumentStore` / `ViewSessionStore` / 命令总线、共享视图流水线与 `Scene` 渲染器、职责解耦的 UI 控制器、版本化存档编解码器（codec）以及内存 AIG 扩展性验证门禁。
- **阶段 8（进行中）**：跨层 Fanin/Fanout 追踪、Cell/Net 统一聚焦根、可切换的标准逻辑门符号、通用事务化视图历史（View History）、搜索与聚焦解耦以及 Compare 大图按需加载均已完成范围内交付；当前重点围绕交互性能基线、最小化缓存失效与代码审查问题闭环。阶段 5 的可选 Liberty `.lib` 增强继续作为后续储备计划，生产级 AIGER 导入与分析另行独立规划。

**状态定义**：
- `已完成`：仓库中已具备完整可运行实现、自动化测试及文档交付物。
- `进行中`：当前阶段重点推进或持续收敛的任务。
- `计划中`：已纳入长期路线图但尚未启动开发。
- `暂缓`：明确不在当前主线中推进。

| ID | 阶段 | 需求名称 | 主要交付物 | 状态 | 细化文档 |
| --- | --- | --- | --- | --- | --- |
| R0-1 | 阶段 0 | 项目基础准备 | 仓库骨架、目录结构、README、路线图、架构、设计规范、示例 fixture | 已完成 | `docs/STAGE_0_PLAN.md` |
| R1-1 | 阶段 1 | Structural Verilog parser 与 Netlist IR | `module` / `port` / `wire` / `assign` / `cell` / 转义标识符解析 | 已完成 | `docs/STAGE_1_PLAN.md` |
| R1-2 | 阶段 1 | 无 `.lib` 单元与引脚推断 | `gate kind`、`pin direction` 与推断来源（inference source）标记 | 已完成 | `docs/STAGE_1_PLAN.md` |
| R1-3 | 阶段 1 | 图提取与基础分层布局 | PI/PO/cell/assign 图提取、从左到右分层布局、正交连线 | 已完成 | `docs/STAGE_1_PLAN.md` |
| R1-4 | 阶段 1 | SVG 原理图渲染与基础交互 | SVG 渲染器、模块选择器、文件导入、缩放、平移与一键适配（Fit） | 已完成 | `docs/STAGE_1_PLAN.md` |
| R2-1 | 阶段 2 | 全局搜索与对象索引 | `net` / `port` / `instance` / `cell type` 搜索、居中定位与高亮 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R2-2 | 阶段 2 | 对象选择与属性详情面板 | 单元/线网连接详情、引脚映射、驱动（driver）与负载（load）追踪 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R2-3 | 阶段 2 | Fanin/Fanout 分析与逻辑锥视图 | 直接/传递/有限深度锥体遍历与视图模式切换 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R2-4 | 阶段 2 | Assign/Alias 规范化 | `assign` 别名链默认折叠、`Show aliases` 显隐切换、物理 BUF 保留 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R2-5 | 阶段 2 | 图中关键元信息展示 | 单元类型、实例名、输出线网名及扇出数量（fanout count）展示 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R2-6 | 阶段 2 | 离线 SVG 导出 | 当前完整模块或局部视图的自包含 SVG 文件导出 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R2-7 | 阶段 2 | 手工布局校准与 Golden 快照 | 节点拖拽调整、Layout Golden 保存/加载及几何差异比对 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R2-8 | 阶段 2 | 导线可读性与吸附优化 | 局部直连/短折线优先、引脚就近标签排布、网格与引脚水平对齐吸附 | 已完成 | `docs/STAGE_2_PLAN.md` |
| R3-1 | 阶段 3 | 双模块对比视图（Compare View） | 左右/上下双模块选择、分屏并排原理图、同步缩放与平移 | 已完成 | `docs/STAGE_3_PLAN.md` |
| R3-2 | 阶段 3 | 结构差异高亮与统计对比 | 同名端口/线网/同类逻辑门对齐高亮、未匹配差异标记及统计差值面板 | 已完成 | `docs/STAGE_3_PLAN.md` |
| R4-1 | 阶段 4 | 大图布局引擎与渐进渲染 | `LayoutProvider` 抽象、vendored ELK.js 集成、可取消的分批渐进式 SVG 渲染 | 已完成 | `docs/STAGE_4_PLAN.md` |
| R4-2 | 阶段 4 | 大图可读性简化与会话保存 | 高扇出中继（Fanout Hub）、低缩放隐藏细节（LOD）、`sessionStorage` 状态恢复 | 已完成 | `docs/STAGE_4_PLAN.md` |
| R4-3 | 阶段 4 | Balanced/Folded 折叠排布 | 超深串行 DAG 分带折叠与跨带独立通道（当前保持默认从左到右排布） | 暂缓 | `docs/STAGE_4_PLAN.md` |
| R5-1 | 阶段 5 | 可选 Liberty（`.lib`）增强 | `.lib` 必要子集解析、引脚方向精确覆盖、逻辑功能表达式辅助与回退诊断 | 计划中 | `docs/STAGE_5_PLAN.md` |
| R6-1 | 阶段 6 | 新版模块/实例边界时序格式 | Global/Local 快照、INPUT/OUTPUT、AT/RT/Slack、Apply 策略及旧格式兼容 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-2 | 阶段 6 | 全图统一时序显示策略 | `Auto` / `Global` / `Local` 快照与 `Slack` / `AT` / `RT` / `All` 全图徽标策略 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-3 | 阶段 6 | 单元间距调节与拥塞可读性 | 可调 `Cell spacing`、拥塞感知通道扩展与布局质量回归门禁 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-4 | 阶段 6 | 顶部工具栏精简收敛 | `Import` / `More` 下拉菜单分组、左侧栏整合 Layout/Timing 设置及窄屏适配 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-5 | 阶段 6 | 时序文本直接粘贴 | 显式 `Paste timing` 入口、超大文本预览保护与多格式自动识别 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-6 | 阶段 6 | 跨平台 EDA 启动接口 | Node/Python/Windows/Linux 统一 CLI、状态管理、单行 `ready` JSON 协议 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-7 | 阶段 6 | Search-first 与双向聚焦视图 | 大图默认搜索优先、独立 `Fanin` / `Fanout` 深度与多根节点 `Focused` 视图 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-8 | 阶段 6 | 模块浏览历史前进/后退 | 模块切换、局部视图、选中项与视口状态的历史栈恢复及快捷键 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-9 | 阶段 6 | 可折叠过程日志（Process Log） | 按阶段/级别过滤、高频进度合并、一键复制与日志文件导出 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-10 | 阶段 6 | 所选单元一键居中放大 | `Focus selected cell`（快捷键 `F`）、稳定阅读比例缩放与双视图一致行为 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R6-11 | 阶段 6 | 可复用单元语义配置（Cell Config） | 按 `cell type` 编辑门类型与引脚方向、`localStorage` 持久化及 JSON 导入导出 | 已完成 | `docs/STAGE_6_PLAN.md` |
| R7-1 | 阶段 7 | 多领域工作台核心架构 | `DomainFeature` 注册表、`DocumentStore`、`ViewSession` 命令、任务与对比协调 | 已完成 | `docs/STAGE_7_PLAN.md` |
| R7-2 | 阶段 7 | 共享图形流水线与存档边界 | `query-to-Scene` 流水线、渐进式 SVG 渲染器、独立 UI 控制器与版本化 codec | 已完成 | `docs/STAGE_7_PLAN.md` |
| R7-3 | 阶段 7 | AIG 多领域扩展性门禁 | 内存 AIG 完整跑通搜索、聚焦、布局、选中与导出链路，公共层零领域硬编码分支 | 已完成 | `docs/STAGE_7_PLAN.md` |
| R8-1 | 阶段 8 | 跨层次 Fanin/Fanout 追踪 | `occurrencePath` 实例身份、本层/父层连接分离展示与双击 `hinst` 钻取 | 已完成（范围内） | `docs/STAGE_8_PLAN.md` |
| R8-2 | 阶段 8 | Net Focused（线网聚焦根） | Cell 与 Net 统一作为聚焦根、驱动/负载种子展开与高扇出有界节点预算 | 已完成 | `docs/STAGE_8_PLAN.md` |
| R8-3 | 阶段 8 | 交互性能与最小化失效 | 有界产物缓存（LRU）、异步布局 Worker 隔离、增量重布线与性能基准验证 | 进行中 | `docs/STAGE_8_PLAN.md` |
| R8-4 | 阶段 8 | 可切换的标准逻辑门符号 | `Rectangles` 与 `Conventional`（AND/OR/XOR/BUF 族及反相气泡）无损切换 | 已完成 | `docs/STAGE_8_PLAN.md` |
| R8-5 | 阶段 8 | 通用事务化视图历史（View History） | 覆盖选择、层次导航、聚焦、视口与手工覆盖的统一 `Back` / `Forward` | 已完成（范围内） | `docs/STAGE_8_PLAN.md` |
| R8-6 | 阶段 8 | 搜索定位与聚焦修改解耦 | 已绘制对象默认仅定位（Locate-only）、显式 `+ Focus` 追加与 `Search-first` 自动聚焦 | 已完成 | `docs/STAGE_8_PLAN.md` |
| R8-7 | 阶段 8 | Compare 大图按需加载 | 双侧独立 `Search-first`、无布局拓扑统计、单侧独立任务取消与显式 `Whole` | 已完成（范围内） | `docs/STAGE_8_PLAN.md` |

---

## 6. 各阶段核心目标与验收标准摘要

### 阶段 0：项目准备
- **目标**：建立代码仓库、工程规范、目录骨架与示例测试网表。
- **完成标准**：新成员仅阅读 `README.md`、本文件与 `docs/ARCHITECTURE.md` 即可理清项目方向与分层边界。

### 阶段 1：最小可用原型
- **目标**：解析结构化 Verilog 模块，并在无 `.lib` 环境下生成可缩放平移的交互式 SVG 原理图。
- **完成标准**：成功加载并绘制 `tests/fixtures/two_equivalent_style_modules.v` 中的模块；支持转义标识符；遇到未知单元安全渲染为黑盒而不崩溃。

### 阶段 2：实用分析能力
- **目标**：让工具从“能画图”升级为“能高效读结构、追路径”。
- **完成标准**：支持全局搜索定位、点击查看驱动/负载详情、有限深度扇入/扇出逻辑锥、`assign` 别名折叠、离线 SVG 导出以及 `Adjust` 手工节点拖拽与 Golden 保存。

### 阶段 3：双模块对比视图
- **目标**：支持重综合（Resyn / Remap）前后两个模块的结构与统计对比。
- **完成标准**：支持并排展示两个模块（如原模块与 `_Flex` 模块）、同步缩放平移、共有输出端口扇入锥联动对比，以及同名端口/线网/同类逻辑门与未匹配差异高亮。

### 阶段 4：大图与工程化
- **目标**：支撑千级单元规模的真实工程网表浏览与状态持久化。
- **完成标准**：引入 `LayoutProvider` 架构与离线 `ELK.js`、400+ 对象渐进式渲染、高扇出 `Fanout Hub`、低缩放细节隐藏（LOD）及 `sessionStorage` 标签页会话恢复（注：早期尝试的分组折叠 `group collapse` 已于后续版本正式退役，由 `H08` 引擎、`Search-first` 与 `Focused` 取代）。

### 阶段 5：可选 `.lib` 增强（计划中）
- **目标**：在用户提供 Liberty 文件时进一步提升引脚方向与门功能识别准确度，同时丝毫不影响默认无 `.lib` 工作流。

### 阶段 6：时序、聚焦浏览与 EDA 集成
- **目标**：全面适配 Global/Local 边界时序分析与大型层次化网表调试工作流，并提供跨平台 EDA 命令行启动接口。
- **完成标准**：支持新旧时序格式导入与全图徽标策略、可持久化 `Cell Config`、大图 `Search-first` 与双向 `Focused` 视图、`Focus selected cell` 一键居中、过程日志面板以及统一的 CLI `ready` JSON 协议。详见 `docs/STAGE_6_PLAN.md`。

### 阶段 7：多领域图形工作台架构演进
- **目标**：将单领域 Netlist 应用重构为“模块化单体 + 独立领域模型 + 共享图形工作台”架构。
- **完成标准**：落地 `contracts/`、`application/`、`domains/netlist/`、`diagram/`、`bootstrap/` 分层边界，通过静态 AST 架构门禁与内存 AIG 全链路扩展性测试。详见 `docs/STAGE_7_PLAN.md`。

### 阶段 8：层次追踪、对象聚焦与大图交互收敛
- **目标**：将局部结构浏览扩展至精确的层次实例上下文（occurrence context），并确保搜索、聚焦、双模块对比、视图历史与画布手势在大型网表上均以最小必要计算开销运行。
- **完成标准**：跨层连接与 Net Focused 准确有界且不污染源 IR；大图默认路径不触发冗余全图布局；轻量手势不重跑布局引擎；标准逻辑门符号切换不改变引脚与布线几何；统一视图历史事务与异步取消隔离全部通过回归验证。详见 `docs/STAGE_8_PLAN.md`。

---

## 7. 开发前必读约定

在正式编写或修改代码前，请务必先通读：

1. 本文件（`docs/PLAN.md`）
2. 当前任务所属阶段的细化计划（如 `docs/STAGE_8_PLAN.md`）
3. 架构设计说明（`docs/ARCHITECTURE.md`）
4. 若涉及界面、交互或视觉表现，通读 `docs/DESIGN_SPEC.md`
5. 若涉及工程规范、自动化测试或 Agent 技能，通读 `AGENTS.md` 与 `docs/SKILLS_AND_RULES.md`
