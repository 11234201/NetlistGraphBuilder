---
name: netlist-schematic
description: Maintain and extend this repository's structural-Verilog parser, netlist graph, cell/pin inference, schematic layout and routing, SVG rendering, timing annotation, comparison, and large-canvas interactions. Use for code, tests, fixtures, performance work, or reviews that touch `src/parser`, `src/netlist`, `src/infer`, `src/analysis`, `src/layout`, `src/render`, `src/timing`, schematic UI/workspaces, or mapped-netlist regressions.
---

# Netlist Schematic 开发与维护规范

## 适用场景

当任务涉及门级网表解析、结构图提取、扇入/扇出逻辑锥（Fanin/Fanout cone）分析、双模块对比（Module compare）、无 `.lib` 单元/引脚推断、分层布局与正交布线或交互式 SVG 原理图渲染时，启用本 Skill。

## 必读上下文

开始修改代码前，请先阅读：

- `AGENTS.md`
- `docs/PLAN.md`
- 当前阶段对应的 `docs/STAGE_<N>_PLAN.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN_SPEC.md`
- `docs/SKILLS_AND_RULES.md`

## 核心工作原则

- **优先支持结构化 Verilog 子集**：专注于综合映射后的门级网表语法。
- **无 `.lib` 是默认工作模式**：缺乏 Liberty 库属于正常使用场景，不得将其视为运行异常。
- **未知单元优雅降级**：未识别单元绘制为矩形黑盒（blackbox），绝不中断绘图流程。
- **解析器严格保持纯结构性**：`parser` 层只解析语法结构，不进行逻辑门类型或引脚方向推断。
- **推断规则可测试、可替换**：内置规则与用户自定义 `Cell Config` 均须具备清晰的可追溯来源。
- **体验聚焦核心分析目标**：UI 的首要目标是帮助工程师看清门级结构、追踪逻辑锥与比对模块差异。
- **在拥有约束的最低层修改**：动工前先确认改动归属于 `parser`、`IR / inference`、`display transform`、`layout`、`render` 还是 `UI`；在拥有该约束的最低边界实现并补充单测，严禁跨层打补丁。
- **优先扩展共享基础设施**：使 Single / Compare 视图以及 AnchorLayered / ELK / Simple / Adjust 布局模式同时获得一致行为。
- **多领域解耦约束**：新领域能力通过 `bootstrap` 静态注册与 `DomainFeature` 贡献点接入；公共 `application`、`layout` 与 `render` 层严禁按 `domainId` 添加 Netlist / AIG 硬编码条件分支；领域目录严禁反向导入 `src/app/`。

## 分层实现约束

### 1. Parser 与图模型

- `parser` 必须完整保留规范化名称（canonical name）、显示名称（display name）、向量位宽（packed range）、源码行列范围（source span）与声明语义，不消除 `assign` 别名，也不推断逻辑门或引脚方向。
- 无 `.lib` 时使用可追踪的 `rule` / `fallback` / `unknown` / `user-config` 来源标记；未知单元必须继续生成 `blackbox`。新增标准单元匹配规则时，需同时在测试中验证 `gateKind` 与关键引脚的 `direction`。
- Netlist IR 是不可变源数据。别名折叠（alias）、时序标注（timing）、逻辑锥裁剪（cone）与高扇出中继（fanout hub）均为纯函数派生显示图变换，严禁原地修改解析器 IR 或调用方传入的图对象。结构分组折叠（Group collapse）已退出产品范围（旧字段仅作为存档兼容边界保留，任何新的图提取、布局、性能优化与回归测试均不得依赖折叠图）。
- 对公开数组建立缓存索引时，若底层数组被替换或长度发生变化，索引必须能够自动重建，且不得通过改变公开 IR 结构来换取性能。

### 2. Timing 时序解析与标注

- `timingParser` 仅负责将标准列式文本（Tabular/CSV）或 JSON 时序数据规范化为无环纯对象时序中间表示（`TimingDataset` IR，详细定义见 [`docs/design/timing_format_spec.md`](../../design/timing_format_spec.md)），不得读取图结构或 DOM；旧版 `LocResyn` 与 `Global/Local` 边界表格格式已正式废弃。
- 时序作用域（`@module`）到模块/实例/端口/线网的消歧归属于 `timingAnnotation` 层：必须在校验图实体存在性的前提下区分 Cell Pin（最长无歧义层次后缀匹配）与含 `/` 的转义 Port/Net；当 `point` 命中 `net` 时，其时序语义严格代表该 Net 的 **Source 驱动端**，并须沿 `assign` 别名链向上游穿透挂载至真实物理驱动端。
- 时序显示策略（Metric）属于工作区与会话的全图级状态，Single、Compare 与 SVG 导出必须消费同一套策略；节点几何测量（`measureNode`）与通用渲染器（`svgRenderer.js`）必须对时序保持零耦合，以确保切换时序指标或勾选徽标时不会触发自动布局重算。

### 3. Layout 与正交布线（Routing）

- **区分硬约束与软目标**：正交走线、沿引脚声明侧接入、端点本体保护、节点避障以及不同物理线网严禁共线重叠属于**硬约束**（集中在共享正交契约与 `layoutValidator` 中）；直线率、折点数、线长、交叉数及外围通道使用率属于**软目标**（由候选生成器、打分策略与布局策略控制）。
- `Simple` 与 `Adjust` 共享路径校验、通道收集、线段空间索引、有界搜索上限与打分权重；`AnchorLayered` 与 `ELK` 的输出也必须规范化为相同的 `PositionedGraph` 契约。
- 所有拓扑排序、通道预留、标签避障优先级与重布线顺序必须对输入节点/边数组的排列顺序完全不敏感（Permutation invariant）。
- 候选搜索必须设置固定预算上限；通过空间索引（spatial index）缩小候选集，最终由精确几何谓词裁决。严禁恢复全图两两扫描（all-pairs scan）或随图规模线性增长的重试循环。
- 自动布局产物（automatic provider graph）与手工微调图（adjusted graph）必须分开保存：人工位置/尺寸仅作为覆盖层（override）叠加，拖拽过程中不得重新运行自动布局引擎，点击 `Reset` 必须能精确恢复自动布局坐标。

### 4. Render 与画布交互

- 领域展示层负责将 `PositionedGraph` 转换为结构化场景（`Scene`）；通用渲染器（`render`）仅消费 `Scene`，不解析 Verilog、不读取领域私有推断字段、不重新布局、也不计算逻辑锥。
- 大图渲染采用惰性渲染计划（lazy render plan）与可取消的分批 DOM 挂载，严禁预先生成全部 DOM 批次字符串再伪装成渐进式渲染。
- 平移（pan）、缩放（zoom）与节点拖拽（drag）统一使用共享的 `viewport`、`pointerSession` 与 `frameScheduler` 工具。高频指针事件每动画帧最多提交一次轻量级 DOM 变换；手势进行期间严禁执行整图 `innerHTML` 重建、重跑布局引擎或写入会话持久化存储。
- 节点拖拽期间仅移动预览节点并弱化关联导线；释放鼠标后统一执行一次覆盖提交、局部重布线与完整渲染。
- 所有来自网表、时序日志、Golden 文件或用户编辑的文本在拼入 HTML / SVG 前，必须经过共享的安全字符转义函数（`src/ui/html.js`）。

### 5. 工作台状态、计算产物与快照隔离（核心教训）

- **严格区分 Session 状态与 Artifact 计算产物**：
  - `ViewSession`（如选区、视口、局部覆盖 `overrides`、`layoutPolicy`）属于可序列化纯状态数据，必须通过严格的 `immutableSnapshot` 进行不可变保护，严禁包含任何函数/闭包或非原始 Map 键。
  - `ArtifactStore`（如 `single-workspace`、`compare-*-workspace`）保存的是领域计算产物，产物中包含的 `Scene` 场景图依据大图渐进式渲染规范天然携带惰性读取闭包（`readEdges`、`readNodes`）。对产物执行快照保护时必须启用 `{ allowFunctions: true }` 安全冻结函数引用，严禁将针对纯数据的 Session 检查直接施加于计算产物上。
- **严禁未经全链路验证的“泛化式理论防御”**：
  - 静态审查或缺陷修复时，若发现基础工具（如快照、深度克隆、输入校验器）拦截了某类值（如 Function / Symbol / Map Key），必须在完整数据流（从解析、布局到渲染展示）中排查是否存在合法的下游消费者，绝不能仅凭局部理论推导下达“整个网表路径绝不允许出现”的断言。
- **防止过度打桩（Mock）遮蔽真实集成故障**：
  - 核心工作区编排链路（`buildModuleWorkspace` ➔ `JobCoordinator` ➔ `ArtifactStore` ➔ `workspaceExecution`）必须保留至少一条真实数据流的端到端集成测试，严禁在所有层级全部使用纯字符串或无操作 Stub 代替真实产物，避免出现各层单测全绿但浏览器端首帧启动直接崩溃的盲区。

## 验证矩阵

| 修改范围 | 最低验证要求 |
| --- | --- |
| `parser` / `model` / `inference` | 对应模块单元测试（覆盖真实命名、转义标识符、向量切片/拼接及层次边界） |
| `timingParser` / `timingAnnotation` | 新旧时序格式兼容、作用域匹配、`Apply` / `Auto` 及 Single / Compare 策略同步测试 |
| 图变换 / `workspace` | 不可变性测试（验证输入对象未被原地修改，且 Single 与 Compare 行为一致） |
| `artifactStore` / `jobCoordinator` / `viewSession` | 状态与产物隔离单测（验证 Session 拒绝函数、Artifact 允许并冻结 Scene 函数，且不可变写入抛错）；真实模块从布局到产物提交的端到端单测 |
| `layout` / `routing` / `labels` | 专项单测 + `layout-determinism` + `layout-fixtures` + `npm test` |
| `viewport` / `pointer` / `panel` | 纯辅助函数单测；涉及大图交互改动时补充真实浏览器拖拽、缩放与平移验证 |
| 复杂度敏感路径 | 运行 `npm run benchmark`，确认不存在与图规模挂钩的候选膨胀或全图扫描 |
| 综合映射网表路径 | 运行 `npm run test:mapped-cases`（全节点回归设置 `MAPPED_CASE_NO_COLLAPSE=1`） |
| Windows 发布包构建输入 | 运行 `npm run release:windows`，验证离线启动、内嵌静态资源与许可证完整性 |

综合映射回归基准固定为 `tests/fixtures/mapped/` 下的 47 个 `*_mapped.v` 文件。仅映射后的 Verilog 网表与稳定测试脚本纳入 Git 版本控制；综合日志、JSON 中间文件、基准报告与临时产物一律留在已忽略的 `dc_runs/` 目录内。

## 输入与输出约定

- **常见输入**：`.v` / `.sv` 结构化网表文本（单模块或多模块）、时序报告日志、可选的 `Cell Config` JSON、Layout Golden JSON（以及未来可选的 Liberty `.lib`）。
- **常见输出**：Netlist IR、派生分析图模型、带几何坐标的 `PositionedGraph`、结构化 `Scene`、交互式 SVG 原理图及工作区视图会话状态。

## 严格禁止事项

- 严禁将 Mermaid 或 LLM 生成作为原理图主渲染路径。
- 严禁在 `parser` 层掺杂 UI 状态或门级推断逻辑。
- 严禁在 `render` 层直接解析 Verilog 或读取 Netlist 私有字段。
- 严禁因個別单元未知而中断整个模块的绘图流程。
- 严禁引入需要联网安装的运行时依赖。
- 严禁通过硬编码特定实例名、测试文件名或绝对像素坐标来“修补”某个布局用例。
- 严禁在高频指针/滚轮事件处理器中重复编写视口数学逻辑或同步触发昂贵的布局/全量渲染管线。
- 严禁将针对纯数据会话的严格快照检查无差别套用于包含惰性 Scene 读者函数的计算产物（Artifact）。
- 严禁在跨模块核心调度链路测试中对所有层级同时使用纯字符串/伪对象打桩而省略真实产物集成。
- 严禁通过放宽 `layoutValidator` 规则、调大超时预算或删减 47 个映射网表用例来掩盖回归缺陷。

## 提交前自检清单

- [ ] 转义标识符（escaped identifier）是否完整保留并正确转义显示？
- [ ] `assign` 别名链是否按策略正确折叠或显式展示，且物理 `BUF` 未被误删？
- [ ] 从任意输出端口是否能准确回溯至驱动源（driver）？
- [ ] 高扇出线网与多负载连接是否能正确汇聚、显示并高亮？
- [ ] 未知单元是否稳定渲染为 `blackbox`？
- [ ] 大倍率缩放下文字与逻辑门符号是否清晰锐利，平移距离是否与鼠标严格等比？
- [ ] 打乱输入节点或边数组顺序后，布局与布线输出是否 100% 保持不变？
- [ ] 大图下的候选数量、布局耗时、首帧渲染与手势帧率是否依然有界？
- [ ] 47 个综合映射网表用例是否全部完成布线且硬违规数为 0？
