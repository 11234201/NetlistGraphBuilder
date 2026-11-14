# 工作台架构收敛计划（2026-11）

更新日期：2026-11-14。状态：A1–A7 已完成本计划验收；第 12 节测量开销优化与第 13 节审查问题修复及回归已完成，用户已验收并归入 v1.4.1 修补版，发布验收见第 14 节。本文承接本轮源码审查，记录事实、优先级、实施顺序与验证证据；不是新产品路线或 Simple 解冻授权。

## 1. 审查基线

- 运行时为离线原生 ES modules；审查时静态模块图为 268 modules / 636 edges，未解析依赖、边界违规、import 环均为 0。
- 21 个 legacy controller 导出 188 个动作。控制器通过注入的同级动作形成双向依赖；静态 import 无环不能证明用例编排已解耦。
- `appState` 和 `ViewSession` 对 roots、选区、视口、overrides 进行双向同步，历史恢复仍直接写旧状态。
- 产品 `moduleWorkspace` 与 `netlistFeature.queryView` 共享底层算法，但分别组装查询参数；后者不是生产工作区的唯一入口。
- Single/Compare 的引用映射、override 快照，以及 Adjust 提交流水线存在重复。
- `nodeGeometry` 仍依据 cell/assign 等节点类型生成尺寸和端口；领域中性边界尚未完全落地。
- Cell Config 面板包含领域统计和推断；Netlist Scene facade 包含 DOM 挂载便利接口。
- 部分架构契约只用于测试，演进文档仍提及已退役的 `workspaceRequest.js`。

以上是代码观察。状态失步、规则演进遗漏和扩展成本是据此推断的风险，不等同于已复现的用户故障。优先级表示重构顺序。

## 2. 优先级与验收

| ID | 优先级 | 工作包 | 完成条件 | 状态 |
| --- | --- | --- | --- | --- |
| A1 | P1 | ViewSession 状态归属 | 按字段迁移到单一写入入口；旧状态成为只读投影；历史/模块恢复显式导入 | 已完成：导航、查询、viewport、策略与 overrides 单一写入；恢复显式导入 |
| A2 | P1 | 用例编排与副作用 | 命令 effects 有统一执行边界；历史、持久化、计算、DOM 提交职责分明；减少 peer controller 依赖 | 已完成：历史/保存分离；导航 effects 统一执行；异步就绪与首次有效历史变更有回归 |
| A3 | P2 | 领域查询与生产入口 | 一套规范化查询供 facade 和真实工作区使用；真实 query-to-Scene 集成回归 | 已完成；中性测量契约仍属 A5 |
| A4 | P2 | 共享引用和 overrides | canonical/occurrence 引用映射与覆盖快照有共同所有者，Single/Compare/history 行为保持 | 已完成 |
| A5 | P2 | 中性测量/布局契约 | 活跃 provider 消费完整测量结果；Simple 几何、状态、诊断、策略逐项不变 | 已完成：Anchor/ELK 消费完整测量；raw API 适配和 Simple 冻结路径保留 |
| A6 | P2 | UI/领域边界 | Cell Config 查询/推断移至领域；领域 Scene 不依赖 DOM 挂载 | 已完成 |
| A7 | P3 | 门禁与文档 | 覆盖本轮确立的依赖约束；标清兼容/研究入口；当前架构描述与产品接线一致 | 已完成：只读状态、effects 与测量边界门禁及验证证据齐备 |

## 3. 实施顺序

1. **基础收敛**：A4 的纯数据转换、A6 的 Cell Config 查询和 Scene 边界；补字段完整性、不可变性与真实控制器集成测试。
2. **生产入口**：A3 统一查询规则，保留缓存层与自动布局边界；补 facade/产品等价验证。
3. **应用用例**：A2 先分离历史提交与持久化职责，再选择 Focused 操作贯通命令、effects、任务、渲染与历史。
4. **状态迁移**：A1 按 roots/selection、模式/深度、overrides、viewport 分批迁移；每批覆盖 Single、Compare、历史、模块切换、Session/Golden 恢复。
5. **几何契约**：A5 独立实施与验证；A7 随各批收紧门禁并更新文档。

每批先确定行为基线，再修改、验证、记录。仅完成部分子项时保持工作包“实施中”，不得以提取文件替代行为验收。

## 4. 保持的约束

- 保留 parser → IR → inference/analysis → layout → Scene/render → UI 数据流与输入不可变性。
- Simple 的算法、helper、策略和输出冻结。不得以重命名、搬迁或提取绕过；不刷新期待值掩盖变化。
- Group collapse 仅保留既有兼容边界；验收使用 full-node、Search-first 或 Focused。
- 保留 JobCoordinator 的计算修订保护与 renderGeneration 的 DOM 挂载代际保护。
- ArtifactStore（提交产物）与 workspaceArtifactCache（阶段复用缓存）职责不同；Session 严格纯数据，Scene 产物允许受保护的惰性函数。
- 保留原生 ES modules、离线资源和现有技术栈；不引入框架或打包步骤。
- 不自动提交、推送或发布；保留既有 `.vscode/settings.json` 用户修改。

## 5. 验证方式

- 远端使用 `mfs-remote:/home/wzh/my_code/netlist_graph_builder_architecture_20261114/`，基线与修改后快照隔离，原始日志留在远端。
- 常规批次：边界聚焦单测、`npm test`、`npm run test:architecture`、`npm run test:docs`、`git diff --check`。
- 图查询、推断、布局/渲染路径变化：`MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases`，默认 provider 取 `DEFAULT_LAYOUT_PROVIDER_ID`，并记录 provider。
- 几何变更另跑 determinism、fixtures；复杂度敏感变更另跑 benchmark。既有失败单独记账。
- 发布输入或资源打包方式变化时运行 Windows release；新增源码模块须确认动态资源收集覆盖。

## 6. 执行记录

### 2026-11-14：开始

- 开始时已完成只读审查和方案落盘；后续验证结论见以下批次记录。
- 远端连接正常：Linux x86_64，Node v24.16.0。
- 当前开始基础收敛，先统一 overrides 与对象引用的重复纯函数，保持调用方策略。

### 2026-11-14：基础收敛

- A4：`graph_overrides.js` 统一 Single/Compare、状态命令、模块工作区与历史的领域覆盖快照；`graph_object_refs.js` 统一图节点/ObjectRef 转换和 occurrence 匹配；ObjectRef 列表复制归入共享契约。Session 的同步方向尚未改变。
- A6：Cell Config 统计/推断移入 `cell_definition_query.js`；面板保留渲染/表单读取；领域 Scene 移除只被测试使用的 DOM 挂载便利接口，渐进渲染测试直接装配 Scene 与 renderer。
- A7：禁止 UI 导入推断规则和领域导入渐进式 DOM 挂载模块。
- 远端基线 `baseline_unit.log`：1099/1099；首批聚焦 `batch1_focused.log`：76/76；首批全量 `batch1_unit.log`：1103/1103。
- 下一步 A3：共用领域查询入口；保持生产图变换顺序和 Simple 的 legacy projection，补 facade/真实工作区等价验证。

### 2026-11-14：生产查询与应用用例

- A3：`netlist_view_query.js` 统一视图选择与显示变换；`moduleWorkspace` 与 `netlistFeature.queryView` 均调用此边界，缓存和自动布局仍由工作区负责。Search-first 保持生产路径的空图和零布局行为；facade 补齐 net roots、预算和 occurrence 参数传递。
- A2：`adjusted_view.js` 统一 Single/Compare 的自动布局产物 → 手工覆盖 → Scene 过程，不调用 provider；`focused_view_command.js` 统一搜索 reveal/add 的命令拒绝、无变化和重建分支，DOM 提交与反馈仍通过回调注入。
- A2：`debounced_persistence.js` 独立负责延迟保存、最新快照读取及失败/恢复通知。`history_controller.persistSession` 为兼容现有调用仍先记录历史再请求保存；未宣称所有命令 effects 或历史/存储入口已完成分离。
- A4：删除 history 导出的复制工具和 input/preferences 的对应 peer service，改用契约直接导入；收窄 state commands 的状态能力声明。入口行数门禁由 470 降到 467。
- A7：更新当前架构与演进文档，明确双向状态桥仍存在，区分阶段缓存与已提交产物；移除将已退役 `workspaceRequest` 描述为当前产品路径的表述。

### 验证证据

原始日志目录：`mfs-remote:/home/wzh/my_code/netlist_graph_builder_architecture_20261114/logs/`。远端 `baseline/` 保留修改前源码，`work/` 为本轮源码快照。

| 验证 | 结果 | 日志/范围 |
| --- | --- | --- |
| 第二批查询聚焦测试 | 35/35 | `batch2_focused.log` |
| 最终全量单测 | 1111/1111 | `batch3_unit.log`，含架构、确定性与 fixture 测试 |
| 完整 mapped 严格回归 | 47/47；失败 0，硬违规 0 | `batch2_mapped.log`；`MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-hard`；`native-layered`；覆盖图查询变更，随后仅应用适配/存储调度变更 |
| 浏览器工作流与 Worker | 无浏览器错误；Worker 与同步结果相同，取消返回 AbortError | `batch3_browser.log`；导入、alias、Focused、历史、拖拽、Golden/SVG 导出、Compare；取消耗时约 14.1 ms |
| Simple 修改前后对照 | 12/12 相同 | `simple_parity_normalized.log`；2 个小设计 × 3 种视图 × aliases 开关；比较 full/source/auto/adjusted graph 与 Scene SVG |
| 默认 provider 基准 | 1K/4K/8K 均 routed，违规 0 | `batch3_benchmark.log`；每档 3 次中位数，pipeline 407.5/1890.7/5394.2 ms |
| 最终架构门禁 | 275 modules / 655 edges；未解析、边界违规、循环均为 0 | `npm run test:architecture` |
| 文档链接与差异检查 | 默认 58 + 本轮专项 3 个相对链接有效；diff 无空白错误 | `npm run test:docs`、专项链接检查、`git diff --check` |
| Windows 离线发布 | 打包与本机启动冒烟通过；7 个新模块和 ELK license 均在压缩包中 | `npm run release:windows -- -SkipTests`；完整测试已在远端执行 |

Simple 首次逐字段比较只发现耗时差异；最终比较仅排除 `elapsedMs`、`deltaMs`、`phaseElapsedMs` 三个运行耗时字段，保留几何、路由状态、策略及其他诊断。首次原始日志 `simple_parity.log` 保留；这不是全量 Simple mapped 验收，也未更新冻结期待值。基准没有同机修改前对照，不能据此声称性能提升。

Windows 打包依赖本机 .NET C# 编译器和 Windows 启动器，属于远端 Linux 无法替代的平台检查；产物仅位于忽略的 `dist/`，未提交或发布。归档 `NetlistGraphBuilder-v1.4.0-win-x64.zip` 的 SHA-256 为 `d0605ffddd5390a9aa1b4defdf0a46283b7caab821846ecc4c1c68c19b60c2eb`。

## 7. 第 6 节结束时的后续顺序（现已执行完成）

1. **A1：overrides、viewport、策略迁移**。沿已统一的快照与 Adjust 边界推进，保留手势预览/提交和工作区取消语义。
2. **A2：命令 effects 与用例编排收敛**。历史/持久化分离已完成（第 10 节）；继续迁移剩余 legacy setter 的重复协调，把计算、DOM、保存的 effects 消费收敛到应用用例。每批继续验证一次用户操作只提交一次历史，纯选区/视口操作不重建布局。
3. **A5：测量契约独立批次**。先明确生产 `measure_graph` 与中性 `MeasuredGraph` 的差距，只推进活跃 provider；Simple 继续冻结并保留独立不变性证据。

此处保留当时的批次顺序；第 8–11 节已完成上述剩余项。完成判断基于行为验收，不以文件拆分数或入口行数代替结果。

## 8. ViewSession 导航状态迁移（2026-11-14）

### 实施边界

- Single 的 `focusedRootRefs`、`focusedRootNodeIds`、`activeFocusedRootNodeId`、`coneRootNodeId`、`selectedNodeId`、`selectedNet`，以及 Compare 的两侧 roots/active root、`selectedKind`/`selectedName`/`selectedSide`，在生产控制器端口中改为只读。投影的 roots 数组与 Compare 两侧容器冻结，禁止绕过字段赋值进行嵌套写入。
- 普通命令和 `beginComputation` 不再从旧字段反向构造 roots/selection。canonical 引用由 ViewSession 保存；Compare 两侧选区独立，更新非活动侧的 viewport 不会抢占 Inspector 所选侧。
- 历史、模块工作区、Compare 工作区、Session 首次加载和 Golden 恢复显式调用桥接器 `importNavigation`。`appState`/Golden 的旧纯状态辅助函数保留独立快照兼容用法；产品调用必须注入导入回调，不能向只读控制器端口直接写入。
- `view_navigation_import.js` 统一旧 ID 到 ObjectRef 的解析与投影。目标图尚未生成时，由导入适配器保存不可变的旧 ID 意图；图提交后 `refreshNavigation` 解析 canonical/occurrence 引用，保持计算修订号，避免把同一次导入误判为新的计算请求。后来的显式导入替换先前意图，已完成导入不会再次回放。
- 图解析前检查模块和 occurrence，避免用前一个模块/实例的图解释旧 ID；提交后的 workspace identity 使用解析后的引用，保留后续选择操作的缓存复用条件。
- `legacy_port` 拒绝普通赋值及反射写入；架构测试禁止 controller 重新直接写入已迁移字段。生命周期/错误恢复测试改用真实 Single/Compare 桥接器，受控渲染器仍用于模拟失败与取消。

### 验证记录

本批基线保存在远端 `before_a1/`，验证日志继续放在第 6 节所列 `logs/`。本批未改动布局算法或 Simple 文件。

- 聚焦生命周期回归：`a1_focused.log`，108/108。
- 全量单测：`a1_unit.log`，1119/1119，含 7 项新增导航行为测试及 1 项写入门禁。
- 真实浏览器：`a1_browser.log`，导入、alias、Focused、历史前进/后退、拖拽、Golden/SVG、Compare 输出筛选及页面刷新后的 Session 恢复全部通过，无页面错误；Worker/同步产物相同，取消返回 AbortError（约 13.8 ms）。
- 架构门禁：276 modules / 655 edges，未解析依赖、边界违规、循环均为 0。文档链接：默认 58 + 专项 3 条有效；`git diff --check` 通过。
- Windows：`npm run release:windows -- -SkipTests` 打包与本机启动冒烟通过；新导航导入模块与 ELK license 均在归档中。该平台检查仍在 Windows 本机执行，完整测试在远端执行；产物留在忽略的 `dist/`，未提交/发布。当前归档 SHA-256：`c3dc63e1ace125b94c403ae297107f9930e209759272ec622ac3aed84da11a3e`。
- 完整 mapped 严格回归：`a1_mapped.log`，`MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-hard`，47/47、失败 0、违规 0/0；provider=`native-layered`，全节点、hard invariants 开启，最大单例布局 36618 ms、最大 heap 551 MiB。这是本批独立运行的正确性证据，不据不同轮次耗时宣称性能提升。

### 本批结束时尚未迁移（后续见第 9 节）

`viewMode`、查询深度、viewport、布局/展示策略和 overrides 仍有兼容回读；`persistSession` 仍保留隐式历史提交。旧 ID 导入暂存也属于兼容边界。A1 保持“实施中”，不能将本批 roots/selection 完成表述为全部 ViewSession 状态已单向化。


## 9. ViewSession 模式与查询深度迁移（2026-11-14）

### 实施边界

- `viewMode`、`faninDepth`、`fanoutDepth` 和 Compare 输出锥的 `coneDepth` 纳入会话写入边界；控制器旧字段只读。`view.mode.set`、`view.depths.set` 和新增 `view.coneDepth.set` 负责普通操作，`importQuery` / `importNavigation` 负责显式恢复。
- Single 桥只在构造时接收初始设置；无文档阶段的偏好与 EDA 启动参数进入私有初始查询，打开文档后由 ViewSession 持有。普通命令、viewport 同步、计算启动不再回读旧模式/深度。reset 保留 canonical 深度并将模式恢复为 Whole。
- 模块工作区、Session、历史和 Golden 通过显式导入恢复查询；待解析的旧 roots 只暂存导航意图，后续图就绪不会回放旧查询或覆盖用户的新模式/深度。
- Single 工作区输入显式接收 `readQuery()`；Compare 保持与 Single 共享深度设置的产品行为，同时显式导入两侧实际查询：Focused 使用双向深度，输出锥使用 coneDepth/0，大图使用 Search-first。历史缓存复用也复用同一 Compare 查询解析函数，不再另写模式判定。
- `contracts/view_query.js` 保留原 `createViewQuery` API，新增会话查询规范化；Focused 深度允许 0，输出锥最小 1，最大 99。没有修改布局算法、Simple 冻结代码或期望值。
- 扩展控制器写入门禁；新增旧字段污染、启动/重置、延迟 roots、零深度/边界、Compare 实际查询、模块/Golden 只读端口恢复用例；浏览器回归加入双向深度、输出锥范围、历史和 Session 刷新恢复。

### 验证记录

本批基线位于远端 `before_query/`，日志仍保留在第 6 节的 `logs/`。最终结果如下：

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 聚焦恢复与生命周期测试 | 98/98 | `query_focused.log`；其后新增模块默认模式测试纳入全量 |
| 最终完整单测 | 1127/1127，新增 8 项迁移行为测试 | `query_unit_final.log`；含架构、确定性、fixtures、真实桥接器与模块往返恢复 |
| 真实浏览器工作流 | 无页面错误；Focused 零深度、模式历史、Golden 查询往返、Compare 输出锥 1→2 层及刷新恢复通过 | `query_browser.log`；Worker/同步产物一致，取消为 AbortError（约 11.8 ms） |
| 完整 mapped 严格回归 | 47/47；失败 0，违规 0/0 | `query_mapped.log`；`MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-hard`；provider=`native-layered`，maxLayout=34643 ms，maxHeap=522 MiB |
| Simple 冻结对照 | 12/12 相同 | `query_simple_parity.log`；原始 `baseline/` 对比本批 `work/`，仅排除第 6 节记录的三项耗时字段 |
| 架构依赖门禁 | 276 modules / 661 edges；未解析、边界违规、循环均为 0 | `npm run test:architecture` |
| 文档与差异检查 | 默认 58 + 专项 3 条相对链接有效；无空白错误 | `npm run test:docs`、专项链接检查、`git diff --check` |
| Windows 离线发布 | 打包、本机启动冒烟、ELK license 和会话查询源码完整性通过 | `npm run release:windows -- -SkipTests`；单测在远端完整执行 |

Windows 检查依赖本机 C# 编译器和启动器，产物仅留在忽略的 `dist/`。归档 SHA-256：`3f368f63ff4260f7fa1db52aacfb7414f339bb86587997f482b0165dba6a35c1`。本批没有改变图算法复杂度，不据 mapped 耗时波动宣称性能提升；没有更新 Simple 冻结期待值，也没有提交或发布。

### 剩余边界

模式/深度的兼容回读已移除。viewport、布局/展示策略与 overrides 仍待迁移；Compare 的输出选择/Whole 请求、同步策略等编排字段仍由工作区控制器持有。历史/Session/Golden 的旧格式解码与 ID 解析继续作为显式导入边界，本节完成时 `persistSession` 的隐式历史提交仍待 A2 分离（现已在第 10 节完成）。A1 保持“实施中”。


## 10. 历史提交与会话持久化分离（2026-11-14）

### 实施边界

- `session_persistence_controller.js` 独立拥有 Session 快照、延迟保存和失败/恢复通知。`persistSession()` 只请求保存，不读取历史、不提交历史、不消费待提交的命令 metadata；`recordViewHistory()` 只记录，`commitViewHistory()` 显式组合记录与保存，用于手势收尾等操作边界。
- 控制器在 ports 的 `historyActions` 声明用户操作；组合层校验动作存在并统一包装事务。模式、深度、模块/occurrence、搜索、Focused roots、连接导航与显示符号等按操作提交；底层 setter 的嵌套提交被同一事务捕获，布局/DOM 完成和 Compare 高亮回放不新建条目。
- 事务只在同步执行段激活，支持返回 Promise，不跨等待全局占用。渲染成功回调显式绑定原事务，同一操作的后续完成更新原条目；新操作、直接提交和 Back/Forward 使旧代际失效，旧回调先走取消收尾，不再改变选区/viewport 或复活历史。
- pan/wheel 在手势结束后显式提交；拖拽开始的选择不单独入栈，释放提交一次 override，完成后的选择回放不追加。首次文档加载显式记录基线，历史恢复完成显式请求保存。
- 修复 Adjust 后撤销的复用判定：恢复前请求身份也必须匹配已提交 workspace identity，防止把拖拽后的图误复用为恢复前的自动图；Single/Compare 共用同一判定原则。
- 保持原历史快照的撤销范围：布局 provider/策略、alias/hub 与 timing 设置的持久化不因此自动变成新撤销字段。Simple、布局算法和 query 几何规则没有改变。
- 历史控制器拥有事务生命周期，`main.js` 只接线；入口行数门禁从 467 降至 465。架构测试禁止持久化控制器消费历史/待提交 metadata，禁止渲染控制器隐式提交历史。

### 验证记录

本批基线位于远端 `before_history/`，最终源码位于 `work/`，日志仍保留在第 6 节的 `logs/`。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 最终完整单测 | 1153/1153；失败、取消、跳过均为 0 | `history_unit_final.log`；含 15 项历史/保存迁移行为测试、13 项事务测试及架构、确定性、fixture 回归 |
| 真实浏览器工作流 | fanin/fanout 深度、拖拽和 Compare 输出锥各一步撤销/重做通过；无页面错误 | `history_browser.log`；含实际节点几何、Session 保存/刷新、Golden、导出；Worker/同步产物相同，取消为 AbortError（约 12.4 ms） |
| 完整 mapped 严格回归 | 47/47；失败 0，违规 0/0 | `history_mapped.log`；`MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-hard`；provider=`native-layered`，hard invariants 开启，maxLayout=34958 ms，maxHeap=523 MiB |
| Simple 冻结对照 | 12/12 相同 | `history_simple_parity.log`；原始 `baseline/` 对比本批 `work/`，仅排除第 6 节所列三项耗时字段 |
| 架构依赖门禁 | 277 modules / 663 edges；未解析、边界违规、循环均为 0 | `npm run test:architecture`；入口上限 465 行 |
| 文档与差异检查 | 默认 58 + 专项 3 条相对链接有效；无空白错误 | `npm run test:docs`、专项链接检查、`git diff --check` |
| Windows 离线发布 | 打包、本机启动冒烟、ELK license 与新持久化/历史源码完整性通过 | `npm run release:windows -- -SkipTests`；完整单测在远端执行 |

浏览器回归发现的 Adjust 撤销错误复用和 Compare 历史恢复未保存已修复，并由真实桥接器的单测覆盖。单测还验证纯保存不消费命令 metadata、纯选区/viewport 不重建布局、Compare 双侧复合操作只追加一次、历史往返不会复活过期回调，以及保存失败/恢复通知。

Windows 检查依赖本机 C# 编译器和启动器，产物仅留在忽略的 `dist/`，未提交或发布。归档 `NetlistGraphBuilder-v1.4.0-win-x64.zip` 的 SHA-256 为 `a0c1df325d07d26ebddff73ccca0ed70cb9aef658b2172eaf3fa90e368c26dc2`。本批不改变图算法复杂度，未新增 benchmark，也不据 mapped 耗时变化声称性能改善；没有改动 Simple 冻结实现或期待值。

### 第 10 节结束时的后续边界（现已在第 11 节完成）

本批消除 `persistSession` 的隐式历史提交。命令 effects 的统一执行和剩余 legacy setter 的进一步收敛继续按 A2 推进；A1 的 viewport、策略、overrides 单向迁移与 A5 测量契约仍分别实施。


## 11. 剩余工作包收尾（2026-11-14）

用户授权持续完成本计划。基线 `before_completion/` 保留第 10 节全部通过时的源码；仍在同一远端目录验证，不重置既有工作区，不提交、推送或发布。

- A1：viewport、layoutPolicy、presentationPolicy 与 overrides 改为 ViewSession 所有；普通命令/计算不回读旧字段。模块、Compare pair、历史、Golden、启动偏好和文档重置通过显式导入；只读投影包含嵌套对象与 Map。共享产品策略从 canonical Single 会话同步到 Compare，会话间选区仍独立。测试覆盖污染隔离、快照隔离、热路径引用复用和完整恢复流程。
- A2：共享 effects 执行器负责合并命令结果，区分计算、轻量 DOM、viewport 和成功后保存；外层事务继续独占历史。Focused、搜索、连接导航、模式和深度迁入同一分支处理，拒绝、无变化、取消与失败有独立回归。
- A5：`contracts/measured_graph.js` 校验并保护尺寸、完整端口、连接偏移、resize 策略和顺序组；Netlist 测量适配器在布局前生成这些数据，Anchor/ELK 的 `layoutMeasured` 核心消费完整契约。raw `layout(graph)` 通过显式兼容适配保持原返回结构；研究探针同步到新主体及兼容入口，未调整期待值。Simple 的测量/布局路径及其实现保持冻结。
- A2 异步收尾：命令无变化不等于目标产物已就绪；重复在途 Focused、模式/深度和根激活请求检查已提交工作区，必要时重新调度并绑定当前操作。历史同步阶段未产生变化时，首次异步有效变化追加一条，保留原始撤销基线；后续完成替换本操作条目，过期回调仍失效。
- A7：新增 33 项测试（状态迁移 14、effects 10、测量 6、历史延续 3），并让控制器集成 fixture 使用真实受限 services 端口。旧字段只读门禁扩展到 viewport/策略/overrides，测量 provider 禁止重新推断语义几何。`main.js` 入口上限保持 465 行。

### 最终验证证据

验证环境仍为 `mfs-remote` 的 Linux x86_64 / Node v24.16.0。源码 `work/`；本批前对照 `before_completion/`；原始日志留在任务根目录下的 `logs/`。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 最终完整单测 | 1186/1186；失败、跳过、取消均为 0 | `completion_unit_verified.log`；含全部架构、确定性、fixtures 和真实恢复/事务集成 |
| 核心浏览器与 Worker | 无页面错误；单步历史、拖拽实际几何、Golden、Session/Compare 恢复通过；Worker/同步一致，取消为 AbortError（约 26.2 ms） | `completion_browser_verified.log` |
| 工作台 UI 浏览器 | 9 组全部通过 | `completion_ui_browser.log`；面板/缩放、根操作、Inspector、Compare 朝向与活动侧、响应式与刷新；截图/报告留远端 `work/dc_runs/ui-workbench-1794665671726/` |
| 完整 mapped 严格回归 | 47/47；失败 0，违规 0/0 | `completion_mapped.log`；`MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-hard`；默认 `native-layered`，maxLayout=34628 ms，结束采样 maxHeap=1393 MiB（解释见下） |
| Simple 冻结对照 | 12/12 全字段一致 | `completion_simple_parity.log`；原始 `baseline/` 对照，仍仅排除三项耗时字段 |
| 活跃 provider 产品等价对照 | 46/46 结果等价 | `completion_active_parity.log`；`active_measurement_parity.mjs`；Native/ELK 各 23 组，覆盖 Whole/Focused/Search-first、alias、Concat、节点位置/尺寸覆盖及上下端口 |
| 同机默认 provider 基准 | 1K/4K/8K 全部 routed，违规 0 | `completion_benchmark_before.log` / `completion_benchmark_after.log`；前后顺序 `npm run benchmark`，每档 3 次中位数，详见下表 |
| 架构依赖 | 285 modules / 690 edges；未解析、边界违规、循环均为 0 | `npm run test:architecture` |
| 文档/差异 | 默认 58 + 专项 3 条相对链接有效；无空白错误 | `npm run test:docs`、专项链接检查、`git diff --check` |
| Windows 离线发布 | 打包与本机启动冒烟通过；285 个源码文件逐字节匹配，ELK license 完整 | `npm run release:windows -- -SkipTests`；完整测试在远端执行 |

活跃 provider 对照比较 full/source/auto/adjusted graph 与 Scene SVG。除三项耗时外，仅在活跃 provider 的 auto/adjusted nodes 中定点排除本批新契约字段 `ports[].id`、`connectionOffsets`、`portLayout`，不排除尺寸、端口坐标、路线、状态、诊断或策略，也不把该规则用于 Simple。Native 两项上下端口既有拒绝保持一致，ELK Concat/部分覆盖的既有 unroutable 和诊断保持一致；这是迁移等价证据，不能冒充这些输入的路由成功证据。

### 性能与内存代价

本次收益是状态与依赖边界收敛，不宣称性能提升。默认 provider 的同机 3 次中位数如下：

| cells | layout 前→后（ms） | parse→SVG pipeline 前→后（ms） |
| --- | --- | --- |
| 1024 | 328.2 → 363.2 | 415.6 → 462.1 |
| 4096 | 1423.1 → 1554.2 | 1747.6 → 1910.7 |
| 8192 | 4422.1 → 4487.3 | 5253.6 → 5202.1 |

小规模 layout 观测开销约 9–11%，8K 约 1.5%；3 次中位数只支持本机本批比较，不作为普遍速度结论。

mapped 的结束 heap 采样升高后，额外顺序诊断最重 `dp_020`，保留完整原 runner 的结果，再执行 full-GC；脚本 `measure_mapped_memory.mjs`，命令 `node --expose-gc measure_mapped_memory.mjs before_completion` / `… work`，日志 `completion_memory_dp020_before.log` / `completion_memory_dp020_after.log`：自然 heap 为 305.2→1417.8 MiB，full-GC 后为 133.8→135.8 MiB，峰值 RSS 为 1544.9→1662.5 MiB（约 +7.6%）。不能把结束采样差异解释为 2.7 倍存活堆增长，也不能声称没有额外内存成本。

纯测量阶段再以 `measure_dto_memory.mjs` 同命令形式诊断：同一 5695 节点/18424 端口，构图后 full-GC 为起点，旧 raw 测量与新完整 DTO+materialize 分别为 6.8→207.1 ms、GC 前分配增量 10.9→41.3 MiB、保留测量对象的 full-GC 后增量 3.2→10.5 MiB；日志 `completion_measurement_memory_before.log` / `completion_measurement_memory_after.log`。这是单次受控诊断，明确记录约 200 ms / 7.3 MiB 的新契约成本，不是中位数性能门禁。没有通过放宽超时/违规预算、修改 Simple 或缩减 mapped 案例来通过验收。

Windows 检查需要本机 C# 编译器与 Windows 启动器，产物仅留忽略的 `dist/`；归档 SHA-256：`4547d7972528a7cf48367314975c35160fb899b9d82a129cb054d5064de6f219`。

### 完成边界

A1–A7 的本计划验收均已完成。保留的边界有：旧存档/图 ID 的显式解码、直接 raw provider API 的适配、Simple 冻结路径，以及拥有专门职责的 DOM/手势/Adjust/timing 控制器。它们不再承担普通命令的旧状态回读或隐式历史提交。生产级 AIGER、移除旧存档格式、Simple 解冻与进一步测量分配优化不是第 11 节的未完成项，需要另立产品或性能任务；其中测量开销已按用户的新授权在第 12 节实施。

未提交、推送或发布；既有 `.vscode/settings.json` 用户修改保持原样。


## 12. 重构开销优化（2026-11-14）

用户另行授权优化本次重构引入的小规模延迟与峰值 RSS。本节基线为第 11 节最终代码 `before_performance/`，保留原始 `before_completion/` 和冻结 `baseline/`，不把不同批次、不同采样数的时间直接拼成性能收益。

### 实施范围与优先级

- P1：完整测量契约直接冻结一次自有几何副本，避免再递归复制已校验的尺寸、端口和连接偏移；可选端口元数据、策略及顺序组仍严格隔离，函数、非纯数据与非法 Map 键等检查不放宽。
- P1：物化节点复用只读局部端口；尺寸调整先复制再重排。原输入不冻结、不改写，raw API 保持原输出字段。
- P1：Netlist 适配器直接为新生成的端口添加 ID，复用同次测量的策略输入；Anchor 创建局部端点时直接消费几何，移除逐端口/逐边的完整节点副本与重复端口查找。算术顺序和解析优先级不变，未改动布局/路由算法、搜索预算或 Simple 实现。
- P2：Map/Set 的既有只读代理封装提取为共享 `readonly_collection`，不暴露 backing；通用快照的普通属性走赋值路径，继承名称仍显式定义为自有数据属性，保留 `__proto__`、继承 setter、循环和稀疏数组语义。
- P2：新增可复跑诊断 `tools/benchmark_measurement.mjs` 与 `tools/benchmark_mapped_memory.mjs`，均支持指定基线源码目录和 fixture；后者保留原严格 mapped runner，只在结束后 full-GC，布局期间不强制 GC。

### 验证与测量口径

服务器仍为 `mfs-remote` / Node v24.16.0。所有性能进程顺序运行；源码在 `/home/wzh/my_code/netlist_graph_builder_architecture_20261114/work/`，原始日志在同级 `logs/`。Windows 发布仅因本机编译器/启动器依赖而本地执行。

- 完整单测 1190/1190；新增 4 项涵盖嵌套元数据和 Map 隔离、物化复用/resize 写时复制、原型名称/循环和继承 setter/稀疏数组。`performance_unit.log`。
- 架构门禁：286 modules / 692 edges，未解析/边界违规/循环均为 0；`performance_architecture.log`。
- 本轮 Anchor/ELK 产品 46/46 全字段等价，包含所有新增测量字段；只排除 `elapsedMs`、`deltaMs`、`phaseElapsedMs`。已知两项 Native 拒绝与 ELK 既有 unroutable 保持一致，不冒充路由成功。`performance_exact_parity.log`。
- Simple 原始冻结基线 12/12 全字段等价；未改冻结代码和期待值。`performance_simple_parity.log`。另与第 11 节前的活跃 provider 对照 46/46 等价，`performance_original_active_parity.log`。

| 收尾验证 | 结果 | 证据 |
| --- | --- | --- |
| 完整 mapped 严格回归 | 47/47，失败 0，违规 0/0；maxLayout 34697 ms，结束采样 maxHeap 660 MiB | `performance_mapped.log`；`MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-hard`；默认 `native-layered`，full-node |
| 核心浏览器与 Worker | 单步历史、拖拽、Golden、导出、Compare/Session 恢复通过；页面错误 0；Worker/同步相同，取消 AbortError 约 15.3 ms | `performance_browser.log` |
| Windows 离线发布 | 编译与本机启动冒烟通过；286 个源码及 ELK license 逐字节一致 | `npm run release:windows -- -SkipTests`；完整单测在服务器执行 |

Windows 归档 SHA-256：`d33d2c308cc53e555958622b4231835f745e0ac235c98e951586f459e1975e1e`，产物只在忽略的 `dist/`。本机与服务器的 503 个运行时/单测文件按统一换行逐项比对无差异。UI 工作台 9/9 通过，`performance_ui_browser.log`，报告/截图留在远端 `work/dc_runs/ui-workbench-1794667196569/`。最终默认 58 条及专项 3 条相对文档链接有效，`performance_docs_final.log` / `performance_docs_special.log`；`git diff --check` 无空白错误。

### 性能与内存证据

同机 5 次中位数 `npm run benchmark`：

| cells | layout 前→后（ms） | pipeline 前→后（ms） |
| --- | --- | --- |
| 1024 | 288.6 → 295.3 | 382.7 → 398.7 |
| 4096 | 1504.6 → 1352.8 | 1840.5 → 1708.1 |
| 8192 | 4385.8 → 3755.1 | 5133.0 → 4467.1 |

日志 `performance_benchmark_before.log` / `performance_benchmark_after.log`。全部默认 `native-layered`、full-node、routed、零违规。1K 首轮没有改善，不能据此报告全规模加速。因此补充按“后/前/后/前”交替、每档 9 次中位数的小规模复测：1K 为 268.5/281.7/257.2/281.8 ms，4K 为 1318.2/1466.8/1351.4/1431.8 ms；两对同序比较分别改善 4.7%/8.7% 与 10.1%/5.6%。`performance_small_interleaved.log`；报告这组受控结果及首轮波动，不推广为任意图的保证。

同一 dp_020 的 5695 节点/18424 端口，使用新增诊断工具各跑 3 个独立进程冷测 DTO+materialize：耗时中位数 **202.3 → 52.3 ms（-74.1%）**，GC 前堆增量中位数 41.2 → 14.3 MiB，保留两种表示后的 full-GC 增量 **10.5 → 5.4 MiB（-48.6%）**；`performance_measurement_verified.log`。先前诊断 `performance_dto_before.log` / `performance_dto_probe2.log` 也得到相同方向。GC 前增量会受自然 GC 干扰，不能替代分配总量或峰值 RSS。

完整 dp_020 严格 runner 各 3 次独立进程，顺序为“前/后、后/前、前/后”，布局期间不强制 GC、不调整堆上限：

| 指标 | 优化前 | 优化后 |
| --- | --- | --- |
| 峰值 RSS 单次读数（MiB） | 1679.0 / 1668.1 / 1642.5 | 1661.7 / 1583.3 / 1561.9 |
| 峰值 RSS 中位数（MiB） | 1668.1 | 1583.3（-84.8 MiB，约 -5.1%） |
| full-GC 后存活堆（MiB） | 135.8 / 135.8 / 135.8 | 133.8 / 133.8 / 133.7 |
| 自然结束 heapUsed（MiB） | 1483.2 / 1415.8 / 1403.3 | 1394.1 / 239.5 / 259.8 |

日志为 `performance_dp020_before.log` / `performance_dp020_after.log`、同名前缀的 `_repeat.log` 与 `_third.log`。第三对由已入库的 `benchmark_mapped_memory.mjs` 执行，前两对由第 11 节的等价诊断脚本执行；二者都导入同一个原始 runner 并在结束后 full-GC。六次 runner 的 canonical input digest 与全部 layoutMetrics 相同，均为 routed/零违规。峰值范围仍有重叠，不能保证每次运行都下降 5.1%；自然结束堆差异主要体现 GC 时机，不能称为约 5 倍泄漏修复。本批降低了观测峰值与测量存活开销，但不宣称任意图或浏览器进程 RSS 均回到重构前水平。

复现方式（在远端任务根目录，两个版本应顺序执行）：

```bash
node --expose-gc work/tools/benchmark_measurement.mjs before_performance
node --expose-gc work/tools/benchmark_measurement.mjs work
node --expose-gc work/tools/benchmark_mapped_memory.mjs before_performance
node --expose-gc work/tools/benchmark_mapped_memory.mjs work
```

完整图基准命令在相应源码目录运行 `BENCHMARK_RUNS=5 npm run benchmark`；小规模复测使用 `BENCHMARK_SIZES=1024,4096 BENCHMARK_RUNS=9 npm run benchmark`。保留 provider 环境变量显式覆盖，默认仍由 `DEFAULT_LAYOUT_PROVIDER_ID` 决定。


### 本轮完成边界

本轮降耗与回归已完成。运行时只变更六个测量/快照相关文件，Simple 冻结代码、provider 几何算法、路由预算与期望值均未调整。测量分配与小规模延迟得到受控改善，峰值 RSS 中位数下降但仍受 GC 时机影响，保留上述波动范围，不将结束堆采样或单次最快结果作为无条件性能承诺。

既有状态/历史重构与用户的 `.vscode/settings.json`、AIG 研究文档保持原样；未暂存、提交、推送或发布。


## 13. 代码检视问题修复（2026-11-14）

用户授权修复检视发现的两项问题。远端基线为 `before_review_fixes/`（第 12 节完成版本）；两项缺陷均在该基线中存在。本节不修改 Simple 冻结代码、不扩大到其他产品能力。

### 修复内容

- P1 只读集合：`readonly_collection.js` 改用读取方法白名单。只有显式审查的 Map/Set 读取方法绑定内部集合；未知函数调用返回只读错误，未知 getter 只能读到代理 receiver。保留 `size`、迭代、`forEach` 的代理参数、`valueOf`、字符串转换和 Set 非变异代数操作；不存在的 `then` 保持不存在。浏览器的 `getOrInsert` / `getOrInsertComputed` 无法改变 Session/测量 Map，也不会执行传入的 callback。
- P2 端口 ID：`native_port_ids.js` 在 Anchor 适配边界先检查后缀是否可能含有歧义：标准端口 ID 不以冒号开头且不含 `::`，可由最后一个 `::` 唯一分解，因此直接复用原编码而不分配 Set 或临时组合字符串；其他输入再线性扫描真实与虚拟端口组合 ID。没有冲突时保留原 ID/digest/排序；发现任意冲突后，对所有端点统一采用无歧义的 JSON 元组编码，避免“只编码冲突项”与未编码字符串再次碰撞。原始节点 ID、端口 ID、边端点不变；无重试或全图两两扫描。
- 新增 8 项单测：未知集合方法/访问器与 Set 代数 2 项、编码稳定性/冲突与排列/安全后缀 3 项、Native 实际布局的内部分隔符/边界冒号/虚拟端口冲突 3 项。覆盖引号、反斜杠、Unicode、孤立 surrogate 和类似编码结果的原始名字。
- 真实工作台浏览器测试加入原生 Map 新 API 检查：Session overrides 与测量 Map、已有 key 与新 key 均必须拒绝写入；回调调用次数为 0，集合内容、大小和 Session revision 保持不变。Node 24 不具备这些新原生方法，不能只用 Node 通过作为浏览器修复证据。

### 验证进度

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 专项 / 完整单测 | 22/22 / 1198/1198，失败/跳过/取消均为 0；包含确定性与 fixture 回归 | `review_fix_unit_final.log` |
| 架构门禁 | 287 modules / 693 edges；未解析、边界违规、循环为 0 | `review_fix_architecture_final.log` |
| 原生浏览器 Map API | Chrome 146.0.7680.164，两个新增原生方法的 8 项写入检查全部拒绝；callback=0，Session revision=1，集合大小与内容不变 | `review_fix_browser_final.log` |
| 浏览器工作流 / Worker | 历史、拖拽、Golden、导出、Compare/Session 恢复通过，无页面错误；Worker/同步结果一致，取消 AbortError 约 15.2 ms | 同上 |
| 活跃 provider 等价 / Simple 冻结 | 46/46 / 12/12；完整字段比较，仅排除原三项耗时；既有错误状态也保持相同 | `review_fix_parity_final.log` / `review_fix_simple_parity_final.log` |
| 完整 mapped 严格回归 | 47/47，失败 0，违规 0/0；maxLayout 35022 ms，结束采样 maxHeap 521 MiB | `review_fix_mapped_final.log`；默认 `native-layered`，full-node，原超时/硬约束不变 |
| Windows 离线包 | 编译和本机启动冒烟通过；287 个运行时源码与 ELK license 逐字节匹配 | `npm run release:windows -- -SkipTests`；单测已在远端完整执行 |

Windows 打包使用本机编译器/启动器，产物只留在忽略的 `dist/`。归档 SHA-256：`c88215fce0b54e7a7b60dc45ba14188db84f8aed0d0a54a468b0715c4e999313`。

同机 `npm run benchmark` 全部默认 `native-layered`、full-node、routed、零违规：

| cells | 初版修复前→后（3 次中位数，ms） | 反序复测前→后（5 次中位数，ms） | 最终快速判定（5 次中位数，ms） |
| --- | --- | --- | --- |
| 1024 | 298.8 → 321.9 | 281.1 → 292.2 | 299.9 |
| 4096 | 1396.0 → 1454.8 | 1346.7 → 1319.0 | 1372.0 |
| 8192 | 3840.9 → 4488.3 | 3700.6 → 3739.6 | 3752.6 |

日志：`review_fix_benchmark_before.log` / `review_fix_benchmark_after.log`、`review_fix_benchmark_reverse.log`（后/前）、`review_fix_benchmark_final.log`。初轮 8K 的明显升高未在反序测试中重现；1K 的最终跨进程采样仍略高，不能据此宣称修复无开销。快速判定减少的是标准输入上确定存在的临时字符串/Set 分配，不根据跨轮波动宣称速度提升。为区分预热与修复成本，追加一次同进程 1K layout-only 对照：两版本各预热 5 次，ABBA 顺序 6 轮、各 12 个样本，不强制 GC，使用同一源图且所有 inputDigest 相同。修复前中位数 239.8 ms（范围 216.1–280.1），最终修复后 247.75 ms（222.3–275.4），观测中位数约 +3.3%，分布重叠；`review_fix_small_layout.log` / 远端 `review_fix_small_layout.mjs`。该数据不含 parse/SVG，也不作为性能提升证据。本批交付为正确性修复，保留小规模观测开销，不声称零成本或恢复所有原始速度。


### 完成边界

两项审查问题及回归已完成。最终运行时只改只读集合封装、Anchor 适配接线及新增端口编码 helper；Simple 算法、默认策略和期待值保持冻结。本机与服务器的 505 个运行时/单测文件按统一换行逐项一致；离线包包含最终 287 个运行时模块与原 ELK 许可证。

最终默认 58 条和专项 3 条相对文档链接有效，`review_fix_docs_final.log` / `review_fix_docs_special.log`；`git diff --check` 无空白错误。没有暂存、提交、推送或发布，保留用户的 `.vscode/settings.json` 与并行 AIG 研究修改。

## 14. v1.4.1 发布验收（2026-11-14）

用户验收本轮重构、性能优化与两项审查修复，并授权发布修补版本。版本由 1.4.0 升至 1.4.1，更新 README 和 CHANGELOG；本批交付覆盖第 1–13 节已完成范围，继续保留 Simple 冻结及第 13 节记录的小规模观测开销。

- 发布源码快照树：`7195e92d7ee8cba38141b28f899883e9d271c533`。快照验证后只追加发布计划记录；运行时、测试、启动器和打包输入保持一致。仅清理新增测量 provider 文件末尾空行，没有功能改动。
- 远端构建目录：`/home/wzh/my_code/netlist_graph_builder_architecture_20261114/release_v1_4_1/`；完整日志留在同级 `logs/`。沿用 Linux SSH 工作区，Windows 编译和启动冒烟因平台要求在本机运行，产物留在忽略的 `dist/`。
- 发布快照重新通过 `npm test` 1198/1198（失败、跳过、取消均 0）；架构 287 modules / 693 edges，未解析、越层、循环均 0；文档默认 58 条和专项 3 条相对链接无缺失。
- 506 个运行时、单测及工作台浏览器测试文件与第 13 节验证源码逐项一致（仅忽略换行及文件尾空白），复用其 full-node mapped 47/47、Chrome 新 Map API 与工作台回归、活跃 provider 46/46 和 Simple 12/12 等价证据。
- Linux x86-64 / glibc 2.35：Release 构建与 CTest 6/6，通过内嵌资源逐项比对、许可证、HTTP、生命周期、CMake 与 Tcl 集成。证据：`release_v1_4_1_unit.log`、`release_v1_4_1_cmake.log`、`release_v1_4_1_ctest.log`。
- Windows：`npm run release:windows -- -SkipTests` 编译与 HTTP 启动冒烟通过（完整单测已在发布快照上远端运行）；EXE 版本 `1.4.1.0`，ZIP 内 287 个运行时模块及 7 项资源/文档与工作区逐字节一致，包含原 ELK 许可证。
- 提交清单只包含已验收源码、测试、相关工具、计划/架构文档和版本说明；不纳入 `.vscode/settings.json`、并行 AIG 研究、构建产物或临时日志。

发布入口：[v1.4.1](https://github.com/11234201/NetlistGraphBuilder/releases/tag/v1.4.1)。提供以下三个附件及各自 `.sha256` 文件：

| 附件 | SHA-256 |
| --- | --- |
| `NetlistGraphBuilder-v1.4.1-win-x64.zip` | `eb9fec2a3cdc5d9980f804ed87cbcd1e45847ada9d1ce33901137d23c61482a7` |
| `NetlistGraphBuilder-v1.4.1-linux-x64` | `3a2e4608bbfd91029542659ca0326ca6cef617e558c1d783c78945a51d95fd17` |
| `ngb.tcl` | `5d702bbe5147e167541257c3887ac6ad2ed1d3382ad51e2245beb883e9414d1e` |
