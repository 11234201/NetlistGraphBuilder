# 阶段 7：向多领域图形工作台迁移

更新日期：2026-09-09。状态：S7-1 首个兼容切片已实现并验证；目标架构迁移尚未完成。

架构依据：[面向 Netlist 与 AIG 的可扩展工作台架构](architecture_evolution.md)。本计划是该设计的执行拆分；现行代码边界见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 1. 本阶段目标与交付边界

把以单个 Netlist 应用全局状态为中心的代码，迁移到“独立领域模型 + ViewSession/commands + 共享图形流水线”。完成后，新增 AIG 等图类型主要新增领域适配器与注册项，Single/Compare、画布、任务管理和通用渲染不再复制。

保留离线原生 ES modules、现有 parser/IR 和成熟布局算法；每批给出独立可验证结果。新接口用 JSDoc、边界校验和行为测试约束，不以拆文件数量或 main 行数作为验收标准。

本阶段包含最小内存 AIG 样例作为架构验证，不交付生产级 AIGER parser、Netlist→AIG 转换、逻辑等价或时序展开。Worker、全图缓存、Canvas/Wasm 仍是按性能证据决定的后续工作。

## 2. 已有成果与基线

### 2.1 已提交成果

`8d53bfc`（承接 `5d65f38`）包含：

- workspaceRequest：保护旧布局成功/失败、渲染进度及完成回调。
- progressive renderer：大图切小图/空态时取消旧批次。
- roots 归一化与动作 helper、Add 上限处理、已绘制 root 的直接定位。
- searchControls、spacingControls：搜索控件和数字间距输入边界抽取。
- mapped runner：失败分类、退出码、耗时、模式和阶段信息。

这些是可复用的迁移基础，不等于完整 commands、ViewSession 或领域适配器已经实现。原计划中的批次 0～3 均仅部分落地，原批次 4/5 未实施。

### 2.2 历史验证与尚缺证据

- 本轮首批验证记录：`npm test` 285/285 通过；main 语法检查、diff whitespace 检查通过。
- mapped：45/47 通过，dp_020、sop_004 在 layout 阶段超过 45000ms；已完成案例 violations=59/120，最大 layout=30832ms、最大 heap=125MiB；整套回归退出码为 1。
- 此前 dp_020 的 no-collapse 诊断报告 1481 个 violation；它不能与默认 collapse 结果直接比较。历史文档对超时存在基线解释，但完整的同环境/同模式版本对照仍未固化。
- mfs-remote 在首批与最终门禁均连接超时，因此使用本地轻量测试和本地 mapped 回归。真实浏览器连续操作已覆盖 Single Focused 与 module hierarchy；no-collapse 全量对照仍作为后续路由性能工作，不混入本阶段纯架构迁移。

未来记录必须区分“历史结果、当前执行结果、尚未验证”；不得把 45/47 或单元通过描述成全验证通过。

## 3. 依赖顺序与工作包

```text
S7-0 行为基线/失败记录
  -> S7-1 契约 + Netlist legacy adapter
  -> S7-2 Document/ViewSession + commands + jobs
  -> S7-3 统一 view pipeline / Compare
  -> S7-4 测量与 Scene 边界
  -> S7-5 UI/领域能力/存档迁移
  -> S7-6 第二领域样例验证与收尾

S7-R 路由语义保持提取：在 S7-4 基础上，取得布局对照证据后进行
S7-P 性能扩展：仅在测量表明需要时立项，不阻塞本阶段架构验收
```

S7-0 的应用行为基线是后续前置条件；大案例性能对照可独立推进，不阻塞不改变布局算法的应用层迁移。涉及几何/复杂度变更的工作包必须先补足对应基线。每批提交均更新本文件执行记录，不把所有工作攒成一个无法审查的大提交。

| 工作包 | 当前状态 | 成本/风险 | 可审查产物 |
| --- | --- | --- | --- |
| S7-0 | 完成（已知慢例保留失败） | 小至中 / 低 | 可复现基线与失败矩阵 |
| S7-1 | 完成 | 中 / 中 | 数据契约、领域接口、兼容 adapter、依赖检查 |
| S7-2 | 进行中（store/command 核心已建立） | 中至大 / 高 | 分域状态、commands、job coordinator |
| S7-3 | 进行中（共享 pipeline 已接入） | 中至大 / 高 | 同一 pipeline 支撑 Single/Compare |
| S7-4 | 进行中（measured graph 与惰性 Scene 已接入） | 大 / 高 | measured graph、Scene、符号适配、renderer |
| S7-5 | 进行中（控件、层次列表、codec、能力注册已迁移） | 中至大 / 中 | 受限 UI 接口、存档与启动兼容、能力注册 |
| S7-6 | 进行中（内存 AIG 公共链路已验证） | 中 / 中 | 内存 AIG 契约验收、兼容收尾与发布验证 |
| S7-R | 完成（纯提取与可见转角策略） | 中至大 / 高 | 路由纯提取；策略调优独立提交 |
| S7-P | 待测量决策 | 未估算 | 缓存/Worker 的独立设计与实测 |

## 4. 工作包验收

### S7-0：固化行为、模式和失败基线

实施：

1. 固定关键路径：搜索未绘制 cell 追加 roots、显式 Set 替换、跨 module reveal、上限拒绝、Compare 单侧/同步、历史和旧 session/Golden 恢复。
2. 使用可控 Promise 与分批 renderer 验证旧成功、旧失败、progress、selection reveal、关闭视图和导入替换时序；补真实浏览器快速操作记录。
3. 在可用执行环境比较 `45e4e12`、`5d65f38`、`8d53bfc`（必要时另加当前 HEAD）的两个慢案例；default 与 no-collapse 分开，记录环境、预算、耗时与质量。
4. 45 秒门禁不改变。延长超时只作为单例诊断，超时及 violation 保留为失败；原始日志放远端工作目录或 ignored `dc_runs/`。

验收：每项行为都有对应测试/操作步骤；已知失败可以重现且有分类，未查明原因明确记录。布局正确性回归如被证实，须单独修复后再扩大几何改动。

### S7-1：定义契约，包装现有 Netlist 能力

实施：

1. 引入 Document envelope、ObjectRef、ViewQuery、Diagnostic、DomainFeature、Executor、Diagram/MeasuredGraph/Scene 的最小契约与 JSDoc。
2. 明确 canonical/display、document/unit/object/terminal 身份；维护投影映射，不用 label 做身份。
3. Netlist feature 用 legacy adapter 包装现有 parser、inference、graphWorkspace、搜索、详情和 provider；先跑通现有导入到展示链，不同时搬动算法。
4. bootstrap 静态注册具体实现；application 只接收领域端口，公共代码不通过 service locator 取得任意实现。
5. 添加 import 边界检查；旧反向依赖列为精确且有工作包归属的例外，新公共目录无例外。

验收：未更改 Netlist IR；原样例通过 adapter 得到等价对象/连线/诊断；端口明确拒绝非法输入。Diagram 契约能表达无 cell/pin 的最小样例，尚不必提供完整第二领域。

### S7-2：建立 Document/ViewSession 与 command/job 边界

实施：

1. 从 appState 分出 DocumentStore、ViewSession、ArtifactStore；源数据、持久化设置和 pointer/DOM/任务句柄各有归属。
2. 先迁移 `focus.*` 与 `selection.reveal`，再迁移 unit 导航、layout policy 和 overrides；所有命令显式带 sessionId，状态决策返回需执行的 effect。
3. roots 动作与 selection 分开；已绘制对象只定位。达到上限不驱逐旧 root；跨 module 不复用旧作用域的 ID。
4. 将 workspaceRequest 升级为按 document/session/job revision 的协调器；纯 pan/zoom 不取消 layout，source reload 会失效所有相关任务。
5. 同时保护导入 generation、错误/进度、selectionRevision、render completion；关闭 session/document 清理任务、监听和 artifact 引用。

验收：两份独立 session 的选择、roots、override、任务互不污染；快速切换和旧任务失败不会抢占状态；UI 无直接 store mutation。命令行为测试调用真实 handler，不只测试集合 helper 或源码正则。

### S7-3：统一流水线与 Compare 协调

实施：

1. 用一条 `query -> project/measure -> layout -> overrides -> scene` pipeline 逐步替代 moduleWorkspace 编排，保留 auto/adjusted 两份产物。
2. Compare 由两个普通 ViewSession 加 ComparisonSession 组成，删除左右两份专用图构建状态和重复流水线。
3. 独立管理 viewport、roots、selection 同步；匹配返回 matched/unmatched/ambiguous。
4. 同步意图携带 transactionId/originSessionId，避免回声；成对展示等待同一事务双方结果，单侧操作不取消另一侧计算。
5. pipeline 明确阶段依赖；selection/viewport 不重跑 provider，spacing 从必要的 measurement/layout 阶段开始。

验收：Single 与 Compare 执行同一 use case 行为矩阵；缺失匹配不清空另一侧；同步开关彼此独立；异步双侧失败及单侧关闭有验证。旧 API adapter 在调用方迁完后删除。

### S7-4：分离领域展示、测量、通用几何和 Scene

实施：

1. 把 nodeGeometry 中读取 cell pins、gate kind、推断规则的逻辑移到 Netlist presentation，输出完整 measured ports、法线、bubble 留白与 node bounds。
2. 将 Simple/ELK 从 legacy adapter 逐步迁至明确的几何输入，保存 topology key、route ownership、labels 和 overrides 契约。
3. 将 svgRenderer 的门符号和领域分支移到 presentation；Scene renderer 只消费图元、文字、装饰和 hit targets。
4. 保留惰性 scene plan、progressive/cancel、导出与 screen 几何一致性；通用 renderer 不 import infer 或读取 `node.ref`。
5. 在通用几何、领域语义和 profile 可读性三层分别校验；所有新层不反向依赖 application。

验收：迁移前后代表 fixture 的节点、端口、路径、极性装饰及映射等价；排列不变性、几何硬约束和 mapped 回归完成并如实记录；拖动不运行 provider，所有完成态恢复完整 labels/hit areas。此包需布局前后对照，不能仅靠 UI 测试放行。

### S7-5：迁移功能贡献、面板、存档与启动

实施：

1. bootstrap 按 feature capability 注册 commands、panels、profiles、formats；searchControls/spacingControls 接受限定 query/command API。
2. 将输入、Cell Config、timing、日志/导出、canvas 的剩余职责从 main 移入所属 use case/controller；不通过注入整个全局 state 换个文件继续耦合。
3. detail panel 以 ObjectRef 查询结构化数据；增加可开关的 module 层次结构列表，按模块实例关系展开并与当前 module 导航/选择同步；特殊 UI factory 只获得容器和限定端口。
4. 在 persistence 边界分离 session、Golden、Cell Config、startup codecs；清除 layoutGolden 对 app 的 import。
5. 旧单 root、session v1、Golden v1/v2 和 startup v1 用固定 fixture 迁移；新数据带 domain/unit/source identity，错误源上的 overrides 明确失效。
6. 文件输入契约允许 text/bytes；现有 Node/Python/Windows launcher 仍兼容，记录新格式如何扩展而不复制领域逻辑。

验收：main 主要组装与启动；控件通过 command 真正影响状态；空/非法数字、4 倍数吸附和旧非 4 倍数存档行为明确；三种启动路径与旧存档 round trip 通过。

### S7-6：第二领域样例与架构收尾

实施：

1. 在 `tests/support/` 提供独立的内存 AIG model/query/presentation feature，包含二输入 AND、正/反相分支、重复 fanin、常量、共享子图与 latch Q/D 边界。
2. 通过公共 Document/ViewSession/commands/pipeline 完成搜索、Focused、选择、布局、场景和 SVG 导出；检查 sourceMap、fanin slot、polarity 未丢失。
3. 验证无 Cell Config/timing 能力时相关命令和面板不可用；Netlist/AIG 同时打开不串状态。
4. 清除已完成迁移的 legacy adapter/例外；保留的例外必须列出具体理由和移除计划，核心扩展性门禁不允许靠例外通过。
5. 更新现行 ARCHITECTURE、README、领域 skill 和开发规则；文档中的已实现状态逐项与代码核对。
6. 执行离线启动与 Windows release 检查，确认新目录被打包、ELK 许可证仍在、没有隐式联网资源。

验收：加入该 AIG 样例仅需其领域模块和一个注册项，通用 application/canvas/renderer 不添加 AIG 条件分支；现有 Netlist 工作流保持。AIG 样例验收成功不宣称产品已支持 `.aag/.aig` 文件。

### S7-R：路由策略收敛（独立于功能扩展）

在 S7-4 和对应基线就绪后，命名并提取 source escape、target approach、node padding、端点 inset 和可见转角规则。先保留原数值/输出；Simple/Adjust/ELK profile 的确有语义差异则保留显式策略。

16px 转角属于软偏好，不能突破几何硬约束。不得增加图规模相关候选、实例名/坐标特判或放宽 validator。直接按 net 生成 tree candidate 等算法优化继续放在 [多 root 与 routing 设计](multi_cell_focused_and_net_routing_design.md) 的独立任务中。

验收：纯提取保持 geometry signature；调优提交另列 quality/determinism/mapped/benchmark 前后证据。

### S7-P：性能决策（条件项）

先测 query、测量、layout、首批/完整 DOM 与复制成本；确认瓶颈后才增加版本化缓存或 Worker executor。缓存必须有依赖失效矩阵、容量/释放策略；Worker 需实测取消、复制、错误传播与离线包。

依据 [性能优化计划](PERFORMANCE_OPTIMIZATION_PLAN.md) 独立安排，不把缓存命中率或新接口当成性能改善。生产 AIG 导入、转换、跨周期展开也单独立项。

## 5. 验证和合并规则

| 变更 | 必须取得的证据 |
| --- | --- |
| 文档/契约设计 | 链接、身份/状态/依赖定义一致；现状与目标明确区分 |
| 应用状态、command、jobs、Compare | 真实 handler 行为矩阵、可控异步顺序、`npm test` |
| 图、投影、layout、Scene | 输入不变性、projection/ownership、determinism、fixture、mapped |
| 热路径/复杂度 | 相同环境和模式的 benchmark、候选预算；无新增全图平方扫描 |
| UI/画布生命周期 | 浏览器导入、连续搜索、切换、拖动/取消、缩放、关闭视图与导出 |
| 存档/启动/发布 | 旧格式 fixture、launcher e2e、Windows 离线资源及许可证 |

构建、测试、性能和大日志优先 mfs-remote；不可用时先记录原因，再选择有界本地替代。缺失某项证据时将对应工作包标为未验收，不把不相关批次也永久冻结。

每批提交前：检查 git status、仅暂存明确文件、运行适用检查、记录失败。纯提取、行为修复和性能调整分别提交；代码和调用方同时迁移，避免长期双写状态。每次迁移的 adapter 必须有负责工作包及退出条件。

## 6. 阶段完成定义与下一步

阶段完成需满足架构文档第 11 节的五项结构验收，并完成关键功能/兼容验证。mapped 或浏览器验证仍未通过时，记录为具体未完成项；不能因为 main 变短或出现 AIG 文件夹而宣布完成。

S7-1 已完成：新增 Document/ObjectRef/ViewQuery/Diagnostic/Executor 与 Diagram/MeasuredGraph/Scene 最小契约；bootstrap 静态注册 Netlist feature；现有解析入口经过该 feature；搜索和图节点通过 projection map 回到稳定对象身份。Netlist 图投影已下沉到领域目录，`app/graphWorkspace.js` 仅保留兼容导出；公共 view policy 进入 foundation，Netlist domain 与通用 layout 不再反向依赖 app。边界测试不再保留 legacy 例外，完整回归为 326/326。

S7-2 已建立 DocumentStore、独立 ViewSessionStore、ArtifactStore、显式 command bus，以及 `focus.*`/`selection.reveal` 的首组真实 handler。当前 handler 已覆盖 session 隔离、上限拒绝不替换、已绘制对象仅定位、隐藏对象追加 Focused、跨 unit 清除旧作用域 roots，并返回 query/layout/render/viewport/persist effect。Single 的导入、搜索索引、Set/Add/Remove 与搜索 reveal 已经通过显式 legacy adapter 接入该 command 边界；该 adapter 在 S7-3 统一 pipeline 后移除。JobCoordinator 已按 document/source/session/computation/job revision 隔离任务，同一 session/stage 的新任务淘汰旧成功、旧失败和旧进度，关闭 session/document 时取消任务并清理 artifact。viewport 只推进 UI session revision，不推进 computation revision，因此纯 pan/zoom 不会淘汰正在运行的 layout。

真实浏览器验收记录：在内置双模块样例的 Whole 视图搜索已绘制 cell，仅发生选择与居中，Focused roots 保持 0；显式 Set 建立一个 root 后，搜索当前 Focused 图中未绘制的 cell，roots 从 1 追加为 2，原 root 保留；浏览器控制台无 warning/error。对应全量单元回归为 302/302。

S7-5 的 module 层次结构列表已提前形成独立切片：Netlist 领域查询识别顶层模块和子模块实例，保留重复实例并有界标记递归 cycle；折叠面板由独立 renderer 转义名称，只通过 moduleName 导航端口切换视图。浏览器验证折叠/展开、点击切换和当前项 `aria-current` 同步通过，控制台无 warning/error。

S7-3 已建立通用的 `query -> project -> measure -> layout -> overrides -> scene` 顺序执行器，支持同步与异步 stage；Single 和 Compare 的两侧均通过 `buildModuleWorkspace` 执行该 pipeline，Compare 不再维护第二份选择/变换/布局编排。ComparisonSession/Coordinator 已表达左右普通 session、viewport/roots/selection 独立同步开关、transactionId 去回声，以及 matched/unmatched/ambiguous 结果边界。主界面 Compare 的 Focused roots 现由两个普通 ViewSession 持有，旧左右字段仅作为 DOM/存档兼容镜像；module/document identity 改变会重建对应 session。完整回归为 328/328。

S7-4 首个纯提取切片已将 Netlist pin direction/side/role 和反相输出语义固化为 `portDescriptors`、`outputBubble`，子模块跳转改为通用 `navigationTarget`。共享 `nodeGeometry`、`nodeSpacing`、`svgRenderer` 不再 import inference 或读取 parser `node.ref`，边界测试阻止回流。几何/渲染全量单测 307/307；mapped 45/47、violations 59/120，仍仅 dp_020 与 sop_004 在 layout 阶段超过 45000ms，与既有基线一致。benchmark 中位数（1024/4096/8192 cells）pipeline 为 71.7/530.1/1358.5ms，首个 progressive batch 均为 0.3ms；本切片未调整路由策略。

S7-4 measurement 切片已让 pipeline 在 layout 前物化节点 bounds 与 ports；Simple/ELK 优先消费 measured graph，旧 provider 直接调用仍在入口执行兼容测量。Diagram 输入保持不变，单元回归提升为 308/308；下一步把 SVG 输出拆为 Scene primitives 与通用 renderer。

S7-4 Scene 首个切片已将 identity stage 替换为独立的惰性 SVG Scene 契约；同步与 progressive 路径共同消费通用 renderer，scene reader 继续按边/节点范围分批且保留取消机制。通用 renderer 明确拒绝 graph-shaped 输入，模块工作区同时返回 graph 与 scene 供兼容迁移；单元回归为 310/310。当前 Scene item 仍由 Netlist schematic presentation 生成 SVG fragment，下一切片继续把节点符号拆成结构化图元，不能将此兼容形态视为 S7-4 完成。

Single、Compare、拖动后重绘、普通 SVG 导出与 Golden SVG snapshot 已改为消费各自流水线或 override commit 产生的 Scene；主界面 graph mount 不再回退到现场解释 graph。屏幕、渐进批次和导出由同一 Scene serializer 生成，compare 两侧 scene 生命周期独立。相关定向测试 23/23 通过；本机并行 Node test runner 偶发对所有测试 worker 返回 `spawn EPERM`，同一批文件直接单进程执行均通过，最近一次成功的完整并行回归仍为 311/311。

通用 Scene renderer 已定义 element/text item，并集中处理属性和文本转义；wire path、hit target、bridge、junction、label，以及节点、端口、时序 badge、导航属性均已从拼接字符串迁为结构化 element tree。raw string/fragment 输入已被删除并由测试明确拒绝，完整单元回归为 314/314。节点类型分派目前仍在旧 schematic presentation 文件中；下一切片将其移入 Netlist 领域并倒置 scene builder 依赖。

Netlist 节点类型、端口、时序和导航 presentation 已提取到 `src/domains/netlist/netlist_scene_presentation.js`，并由 `netlist_scene.js` 作为领域 facade 组合通用 wire Scene builder。Single/Compare pipeline、override 重绘及测试均只经该 facade；共享 builder 强制调用方提供 node presenter，旧 renderer 内重复的 Netlist 分派及 graph mount wrapper 已删除。共享 renderer 不 import 领域模块，边界测试固定该方向；迁移前后 SVG 逐字节等价，完整回归为 319/319。

S7-6 已加入仅位于 `tests/support/` 的独立内存 AIG feature，覆盖二输入 AND、正/反相边、重复 fanin slot、常量、共享子图及 latch Q/D 边界。该 feature 通过公共 registry、DocumentStore、ViewSession command、view pipeline、measurement、Simple layout、结构化 Scene 和 SVG renderer 完成 Focused 搜索到导出；Netlist/AIG 同时打开与跨 document ref 拒绝均已验证，公共 application/layout/render 源码门禁未出现 AIG 条件分支。AIG 不注册 timing/Cell Config 能力；这仅证明架构扩展性，不代表产品支持 AIGER 文件。

为消除 Windows `node --test <glob>` 为每个文件创建 worker 时反复出现的 `spawn EPERM`，`npm test` 改为单进程、稳定排序地导入同一组 `tests/unit/*.test.js`，仍由 `node:test` 执行和报告。当前完整回归为 318/318。

S7-5 persistence 已建立独立 session codec v2：新记录带 domain/document/unit/source identity，读取时优先 v2 key 并兼容迁移旧 v1 key、moduleName 和单 root 字段。Layout Golden 升级为 v3 并带相同身份；v1/v2 fixture 仍可导入，新 v3 在 domain/document/source 不匹配时于应用 overrides 前拒绝。Cell Config 的 localStorage 读写与 startup v1 解码也已移入 persistence 边界，原公开 startup API 保持兼容，并覆盖损坏数据、读失败和写失败。完整回归结果见后续持续验证记录。

bootstrap 现在是产品入口取得领域 feature 的唯一静态注册点；DomainFeature 标准化 formats、capabilities、commands、panels 与 layoutProfiles，registry 提供能力与贡献查询。应用导入入口支持注入 registry，默认产品仍仅注册 Netlist；内存 AIG 经同一 registry 明确不提供 timing/Cell Config。完整回归为 326/326。

Windows 专属发布检查在本地执行：首次完整测试与包 smoke 均通过，但旧 PowerShell 缺少 `Get-FileHash`，因此校验步骤失败；脚本改用 .NET SHA256 流式实现后重跑成功。生成 `NetlistGraphBuilder-v0.7.3-win-x64.zip`，SHA-256 为 `f9ea456a7ca490d12d9569535e54d706335a0d293ff88979f352d07bd5a690de`；包内 app 新目录、localhost smoke 与 ELKJS 许可证复制均由脚本门禁验证，dist 产物保持忽略。

当前 HEAD 的最终布局门禁：mfs-remote 连接仍在 8 秒超时；本地沙箱内 runner 因 `spawn EPERM` 未执行案例，获准在沙箱外重跑后得到 45/47，失败仍仅 `dp_020`、`sop_004` 在 layout 阶段超过固定 45000ms；violations=59/120，最大已完成 layout=30560ms，最大 heap=103MiB。benchmark 曾暴露旧脚本绕过 Netlist Scene facade，修正并加边界门禁后，中位数 pipeline（1024/4096/8192 cells）为 104.7/571.0/1637.1ms，首批 progressive batch 为 1.0/0.9/1.0ms。与迁移前记录相比未出现复杂度阶跃，但当前机器绝对耗时有波动。

S7-0 同机慢例对照已补齐：使用同一 Windows 主机、default collapse、45000ms 门禁和仅含 `dp_020`/`sop_004` 的 fixture 集，`45e4e12`、`5d65f38`、`8d53bfc` 与当前 HEAD 均为 0/2，两个案例都超时；`8d53bfc` 与当前 HEAD 均确认停在 layout。历史提交的旧 runner 对超时不提供 metrics，故不伪造质量数值。临时 worktree 已移除，fixture 副本保留在 ignored `dc_runs/stage7_baseline/`。

S7-R 已由共享 `ROUTE_GEOMETRY_POLICY`、`orthogonalRouting` 和 candidate validator 落实：target approach clearance、最小 16px 可见转角、正反向 endpoint inset、node padding 与 endpoint access 均有命名边界和定向测试，Simple/Adjust 共享固定搜索预算。该切片包含用户要求的垂直 pin 最后弯可见性调整；未引入实例名/坐标特判或图规模相关重试。

S7-5 timing 输入解析与“至少一个有效 scope/instance”校验已移入 `application/timing_import.js`，返回不可变 source/summary 结果；main 只负责提交 timing、日志和选择重绘路径。文本类型、空识别结果和 legacy 格式均有边界测试，完整回归为 330/330。

Cell Config 的 set/remove/import/reset 已收敛到 `application/cell_config_use_cases.js`：prepare import 只解析并报告冲突，用户确认后才发生一次显式 persistence commit；main 不再组合领域更新与 storage 写入。无效输入不会落盘，定向事务测试与完整回归 332/332 通过。

Process Log 的过滤、drawer、自动滚动、复制、导出和清空事件已移入 `ui/process_log_controller.js`；controller 只接收受限 DOM 元素与 status/copy/download 端口，不读取全局 state。main 仅保留统一 `logProcess` 调用入口，交互测试和完整回归 333/333 通过。

Module hierarchy 的领域查询、HTML 渲染、点击解析及导航协调已组合进 `ui/module_hierarchy_controller.js`；controller 仅获得 tree 容器、design/current-module 查询和 navigate 端口，空文档与当前 module 点击不会产生导航。main 只在生命周期变化时调用 `render()`，完整回归为 335/335。

浏览器 Blob/URL/link 下载副作用已移入 `platform/browser_download.js`，SVG、Golden、Cell Config 与 Process Log 共享 text/json 端口及文件名规范化；URL 在成功或失败路径均于 adapter 内释放。main 不再直接创建下载 DOM，完整回归为 337/337。

Wire/Cell spacing 的 range 与 number 事件、空值保留、最近 4 倍数吸附及三控件同步已组合进 `ui/layout_spacing_controller.js`；controller 只通过 spacing query 和 `onCommit(key,value)` command 影响应用，main 不再读取原始输入。完整回归为 338/338。

Timing snapshot/metric 的事件、未知值回退、`all` 展开和 DOM 同步已进入 `ui/timing_display_controller.js`；main 只接收规范化且不可变的完整 display policy 并执行 persist/rerender effect。完整回归为 340/340。

Single/Compare wheel 的目标切换、滚轮步数累计、每帧合并、交互 class 与 140ms 最终持久化已统一到 `ui/wheel_gesture_controller.js`；controller 不读取 graph/session，只把规范化 sample 交给 viewport commit 端口。切换画布前会 flush 原目标，完整回归为 341/341。

Single/Compare 空白画布平移的 pointer capture、按帧合并、坐标校验、最终 flush 与取消语义已统一到 `ui/canvas_pan_controller.js`；main 只提供当前 viewport、轻量 transform commit，以及 Single 侧的持久化/点击清选 effect。完整回归为 343/343。

剩余收尾聚焦 S7-2/S7-5：继续缩减 main 对兼容状态镜像的直接写入，并把输入、timing、Cell Config 与 canvas 事件编排移入受限 controller；已完成的 Scene、Compare、基线和路由项目不再重复迁移。
