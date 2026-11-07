# 架构审查问题清单（2026-11-07）

审查对象：当前工作区，包含尚未提交的控制器拆分和后续修复。本文不等同于对已发布版本的审计。

共 30 项。P1 为高影响正确性问题，P2 为一般缺陷或应优先补齐的边界，P3 为维护与验证改进。验证等级：

## 修复状态（2026-11-07）

本清单现已关闭。关闭含义是：运行时缺陷已有实现和聚焦测试；架构风险已有可执行门禁或固定 schema；测试可信度问题已由真实装配／浏览器产物断言覆盖。原始发现文字保留，便于追溯审查依据。

| 项目 | 状态 | 落地摘要 |
|---|---|---|
| 01–06 | 已修复 | 启动、Single、Compare 和历史恢复统一成功／失败／取消出口；提交身份随 workspace 保存 |
| 07–11 | 已修复 | 历史事务拒绝异步误用；文件读取 latest-wins、顺序物化；Job 取消与 thenable 误用受控 |
| 12–15 | 已修复 | 依赖端口只读、Compare schema 固定、动作重名报错、装配依赖启动期校验 |
| 16–19 | 已修复 | Document/Artifact 深快照；稀疏数组保长；Map 仅允许 primitive key |
| 20–23 | 已修复 | 无碰撞类型编码、缓存权重预算、受保护 storage getter、一次性保存失败反馈 |
| 24–26 | 已修复 | Worker 别名／window 识别、资源 URL 与执行边分离、app 工具禁止反向依赖控制器 |
| 27–30 | 已修复 | 真实装配校验和生命周期测试；浏览器等待状态；双输出 cone；解析 Golden/SVG 内容 |

复核补强（2026-11-07）：

- legacy state port 对 `compare` 使用按控制器声明的 nested capability；未声明字段的读取和写入均失败。
- 完整装配在初始化完成后校验 service 的实际函数／对象类型，不再只检查属性名。
- app 内依赖按 composition → controller → orchestrator → leaf 排序，低层反向依赖由完整模块图门禁拒绝。
- 历史源码检查读取原始模块，不再删除 `services.` 或拼接可执行函数体；关键生命周期使用真实 controller 工厂测试。
- 浏览器 Golden 回归验证拖动产生有效 diff，并比较导出→回导→二次导出的节点坐标和尺寸。
- 故障注入覆盖启动失败／取消、Compare 单批恢复、Compare SVG mount 拒绝和连续存储失败去重提示。

最终复验：`npm test` 868/868；Chromium 完整 import/history/drag/Golden/Compare/Worker 工作流无页面错误；
Windows 离线发布校验通过，ZIP SHA-256 为
`3f78b198a779d25041e223a9ee464cc575b0ec8ebdad6d467bf2481c3c9dbe11`。

- **复现**：执行了独立最小程序，观察到所述结果。
- **代码确认**：检查实现及调用关系，触发条件可以从代码推出；尚未做对应完整浏览器复现。
- **风险**：当前边界或测试缺少约束，不能据此宣称用户已遇到故障。

每项都给出具体定位符；链接相对本文所在目录。既往已解决的直接 UI→app 白名单漏洞、Compare 输出函数漏导出等不计入本清单。

## 一、运行时与生命周期

### 01 · P1 · EDA 启动等待缺少失败／取消出口
**代码确认。** [input_controller.js](../src/app/input_controller.js)，`createStartupHandlers.loadNetlist/ensureDesign`。
Promise 只将 `onRendered` 连接到 resolve；异步布局最终失败或取消不会 reject。`loadDesign` 也只向渲染转发成功回调。启动序列可能永远停在加载网表，无法执行后续 focus/ready。
**修复及验收：** 将完整结束状态传至启动器；强制所有 provider 失败、取消启动任务，断言 Promise 在限定时间内结束。

### 02 · P2 · Compare 旧历史恢复回调仍执行界面副作用
**复现。** [history_controller.js](../src/app/history_controller.js)，`restoreCompareViewHistoryEntry.finishRestore`。
操作编号仅保护 `endRestore`；旧回调先执行选择和 transform，再到受保护的结束函数。连续发起两次恢复并调用第一次完成回调，观察到旧回调执行一次 transform，而新恢复仍进行中。
**修复及验收：** 在全部副作用之前验证恢复身份；乱序完成旧、新恢复，旧操作应零副作用。

### 03 · P1 · 图复用判断没有使用已提交图的身份
**代码确认。** [history_controller.js](../src/app/history_controller.js)，两个 `canReuseWorkspace`。
比较的是恢复前后可变参数，而非当前 graph 对应的计算参数。异步计算期间参数已经更新、旧图仍在，此时相同参数的历史恢复可以错误复用旧图并提前结束。
**修复及验收：** 给已提交 workspace 保存不可变请求身份；延迟计算后恢复目标状态，断言不复用不匹配的图。

### 04 · P2 · Compare 历史恢复仍先计算中间状态
**代码确认。** [history_controller.js](../src/app/history_controller.js)，`restoreCompareViewHistoryEntry` 调用 `applyCompareSelection`。
进入 Compare／换 module 对会立即按默认输出和旧深度计算，随后才应用历史 roots、深度和 overrides，再计算目标图。同步 provider 可能显示中间图，异步 provider 产生多余任务。
**修复及验收：** 增加仅应用视图状态的入口；跨 module 对恢复断言只启动一批目标计算。

### 05 · P2 · 普通 Compare 渲染失败没有默认错误出口
**代码确认。** [compare_workspace_controller.js](../src/app/compare_workspace_controller.js)，`commitCompareWorkspace` 的 Promise catch。
catch 仅调用可选 `onFailed`；普通操作不提供该函数，SVG 渲染失败不会记录错误或更新失败状态，可能留下半张图和旧状态文字。
**修复及验收：** 默认记录并呈现渲染错误，再通知调用方；注入两侧任一渲染拒绝并断言可见失败。

### 06 · P2 · Single 拒绝过期提交时没有必达的取消通知
**代码确认。** [workspace_render_controller.js](../src/app/workspace_render_controller.js)，`onCommit/onSettled`。
Job 结果为 committed，但 render generation 已失效时，onCommit 静默跳过；onSettled 仅对非 committed 状态发取消通知。调用方可能既收不到完成也收不到取消。
**修复及验收：** 将“计算提交成功但展示拒绝”规范为 cancelled；测试 generation 已切换而结果状态仍为 committed 的情况。

### 07 · P2 · 历史事务只处理同步异常
**复现。** [viewHistoryTransaction.js](../src/app/viewHistoryTransaction.js)，`run`。
传入返回 Promise 的 operation 后立即提交事务；Promise 随后拒绝也不能撤销记录。最小复现中失败异步操作仍触发一次 commit。
**修复及验收：** 显式拒绝异步 operation，或等待其成功后提交；失败异步事务必须不入历史。

### 08 · P2 · 文件读取完成顺序可覆盖用户的新选择
**代码确认。** [quick_input_controller.js](../src/ui/quick_input_controller.js)，`loadInputFile`。
每次 change 独立等待 `file.text()`，没有请求代次。先选大文件 A、再选小文件 B，若 A 后完成，仍会覆盖已经加载的 B。
**修复及验收：** 在文件读取入口建立 latest-request 标识；用可控延迟文件证明最后一次用户选择获胜。

### 09 · P2 · 批量拖入会同时物化全部文件文本
**风险。** [quick_input_controller.js](../src/ui/quick_input_controller.js)，`loadFiles` 的 Promise.all。
并发读取全部文件，并在 entries 中保留所有完整字符串直到顺序导入完成。多个大网表／timing 文件会叠加峰值内存，单个失败也会使整批准备中止。
**修复及验收：** 根据元信息排序后有界读取，或使用小并发队列；测量批量大文件峰值内存和失败隔离。

### 10 · P2 · 取消的 Job 仍会进入 run
**代码确认。** [job_coordinator.js](../src/application/job_coordinator.js)，`start` 的第一个 Promise.then。
同步调用 start 后立即 cancel，微任务仍无条件执行 `run(context)`。当前 provider 可以自行检查 signal，但协调器不能保证其他昂贵 query/prepare 不被执行。
**修复及验收：** run 前检查请求有效性；立即取消的任务应不调用 run，并产生 stale/cancelled 结果。

### 11 · P2 · 同步任务误返回 Promise 时存在无人处理的拒绝
**代码确认。** [job_coordinator.js](../src/application/job_coordinator.js)，`runSync`。
检测到 thenable 后抛出同步错误，但没有观察该 Promise；若其随后 reject，将产生额外 unhandled rejection。
**修复及验收：** 拒绝接口误用的同时消费异步拒绝；用 Promise.reject 的同步任务验证只报告受控错误。

## 二、状态、快照与缓存

### 12 · P2 · 受限端口仍允许写入 services 和 elements
**风险。** [legacy_port.js](../src/app/legacy_port.js)，所有字段都定义 setter；[workbench_controllers.js](../src/app/workbench_controllers.js)，同一工厂用于三个端口。
服务和元素应是注入依赖，却拥有与 state 一样的赋值能力；写入 getter-only service registry 可能在运行时抛错，其他可写目标则可能被替换。
**修复及验收：** 区分只读依赖端口与明确可写状态端口；测试控制器不能替换注入服务。

### 13 · P2 · 嵌套状态可以绕过端口字段级约束
**风险。** [legacy_port.js](../src/app/legacy_port.js)，getter 返回原始对象。
取得 compare 等嵌套对象后，可任意写入其全部字段，新增属性也不受 Object.preventExtensions(port) 限制。声明一个 compare 字段实际暴露整个 Compare 状态域。
**修复及验收：** 按用例提供窄查询和命令，逐步取消大型嵌套对象端口；测试未授权嵌套写入。

### 14 · P2 · 控制器导出重名会被静默覆盖
**风险。** [workbench_controllers.js](../src/app/workbench_controllers.js)，Object.assign 合并工厂返回值。
两个控制器返回同名动作时，后者直接覆盖前者，装配阶段没有重复键诊断。
**修复及验收：** 使用显式注册和重名检查；制造重名导出时在初始化阶段给出两个来源。

### 15 · P2 · 注入依赖缺失到交互时才暴露
**风险。** [legacy_port.js](../src/app/legacy_port.js)，getter；[workbench_controllers.js](../src/app/workbench_controllers.js)，wire。
声明的服务没有在组合完成后检查存在性及可调用性；漏导出／漏接线可能只在用户点击时才成为 undefined 或 TypeError。
**修复及验收：** 保留延迟绑定以解决初始化顺序，同时在完整装配后执行契约校验。

### 16 · P2 · DocumentStore 接受后仍保留外部可变对象
**风险。** [document_store.js](../src/application/document_store.js)，`open`；[document.js](../src/contracts/document.js)，`isDocumentEnvelope`。
校验会构造规范对象，但 store 保存的是传入对象；即使使用标准 envelope，model 也仅按引用保存。外部修改可以绕过 sourceRevision，使缓存与任务有效性判断失真。
**修复及验收：** 明确不可变所有权并在入口落实；修改调用方原始对象不得改变已打开文档。

### 17 · P2 · ArtifactStore 只冻结外层记录
**风险。** [artifact_store.js](../src/application/artifact_store.js)，`put/get/list`。
value 仍是原始可变对象，调用方可修改已提交图而无需新 revision。与自动图被视作不可变缓存依赖的假设不一致。
**修复及验收：** 建立 artifact 的所有权／只读约定并在开发模式验证；测试取出后的写入不会污染另一消费者。

### 18 · P2 · 深快照丢失稀疏数组尾部长度
**复现。** [immutable_snapshot.js](../src/foundation/immutable_snapshot.js)，数组使用 [] 加 Object.keys 复制。
`immutableSnapshot(new Array(4)).length` 实际为 0。只有空洞、或尾部为空洞的数组长度无法保留。
**修复及验收：** 预设数组长度并保留空洞语义；加入全空洞与尾空洞用例。当前普通密集 roots 数组不受此问题影响。

### 19 · P3 · Map 对象键的身份语义被快照改变
**复现。** [immutable_snapshot.js](../src/foundation/immutable_snapshot.js)，Map key 递归复制。
原 Map 以对象 k 为键，快照后 get(k) 返回 undefined。当前字符串节点 ID 不受影响，但通用快照 API 的 Map 支持没有说明这项限制。
**修复及验收：** 限定 primitive keys 并校验，或明确提供稳定键规范；避免宣称保持任意 Map 的查找语义。

### 20 · P2 · 缓存序列化存在数组键碰撞
**复现。** [workspaceArtifactCache.js](../src/app/workspaceArtifactCache.js)，`stableSerialize`。
`createWorkspaceArtifactKey([])` 与 `createWorkspaceArtifactKey([undefined])` 均为 `[]`。不同参数可能命中相同缓存键；当前调用是否会产生该输入仍需专项验证。
**修复及验收：** 对 undefined、空洞等值编码类型标记或入口拒绝；覆盖不同数组的键唯一性。

### 21 · P2 · Workspace 缓存仅按条目数限制内存
**风险。** [workspaceArtifactCache.js](../src/app/workspaceArtifactCache.js)，capacity/put。
24 个条目可能分别包含大 full graph、positioned graph 和 scene，条目上限不能形成可靠内存预算。
**修复及验收：** 引入图规模或估算字节权重与单条上限；用不同规模图验证缓存总预算。

### 22 · P2 · 浏览器存储 getter 异常在 try 之外
**代码确认。** [sessionState.js](../src/app/sessionState.js)，storage 默认参数；[cell_config_storage.js](../src/persistence/cell_config_storage.js)，同类默认参数。
受限 origin／存储策略下，访问 globalThis.sessionStorage/localStorage 本身就可能抛异常；默认参数在函数体 try 前求值，既有 catch 无法捕获。
**修复及验收：** 将默认存储解析放入受保护函数体；测试抛错 getter，而不只是 getItem 抛错。

### 23 · P2 · Session 保存失败没有用户可见反馈
**代码确认。** [sessionState.js](../src/app/sessionState.js)，`saveSessionState` 返回 false；[history_controller.js](../src/app/history_controller.js)，`persistSession` 忽略返回值。
快照包含完整网表，超过存储配额后保存失败被静默忽略；用户刷新时可能恢复旧内容。
**修复及验收：** 报告一次明确的保存失败状态，避免反复刷屏；注入 QuotaExceededError 验证反馈与旧存档保留。

## 三、架构门禁与回归可信度

### 24 · P2 · Worker 依赖识别可被正常别名写法绕过
**复现。** [module_graph.mjs](../tools/module_graph.mjs)，Worker NewExpression 分支。
`new window.Worker('./missing.js')`、`const W=Worker; new W('./missing.js')` 均得到零边、零诊断。这里是同一类构造器识别遗漏，不拆成多个问题。
**修复及验收：** 识别允许的构造器形式并对不透明用法报错，或明确禁止别名并检测；加入上述变体。

### 25 · P3 · 普通 .js URL 被视作可执行模块依赖
**复现。** [module_graph.mjs](../tools/module_graph.mjs)，module URL 分支。
单独创建 `new URL('./missing.js', import.meta.url)` 即报告未解析模块，即使该 URL 仅用于下载链接／展示文本。门禁把资源引用与执行依赖混在一起，可能误报层级与循环。
**修复及验收：** 区分资源边和执行边，或明确声明当前保守策略；用资源 URL 与 Worker URL 对比测试。

### 26 · P2 · app 层内部没有职责依赖限制
**风险。** [module_graph.mjs](../tools/module_graph.mjs)，`owner !== 'app'` 例外。
除了禁止引用 main，所有 app 控制器、状态适配器、工具之间的 import 都允许。代码量从 main 移出后，仍可形成任意方向耦合，只要没有形成循环便通过。
**修复及验收：** 为 app 子职责定义依赖方向或逐步迁往正式分层；用工具依赖控制器等反向引用作为失败用例。

### 27 · P2 · 源码拼接测试绕开真实工厂与依赖注入
**风险。** [workbench_source.js](../tests/helpers/workbench_source.js)，截取函数体并删除 `services.`。
测试重建的代码没有真实工厂返回值、局部闭包和端口约束，因此能验证函数文本却漏掉导出／注入错误。既往 Compare 输出漏导出是此盲区的实际例子。
**修复及验收：** 将交互行为迁为实例化真实控制器的测试，仅保留少量真正需要文本检查的架构规则。

### 28 · P2 · 浏览器历史回归依赖固定等待时间
**风险。** [workbench-e2e.mjs](../tests/e2e/workbench-e2e.mjs)，Focused 与 Back/Forward 后的 waitForTimeout(150)。
机器变慢时尚未完成就继续操作；机器快时也没有验证实际恢复内容。可能产生偶发失败或未覆盖的假通过。
**修复及验收：** 等待具体目标节点、深度、视口或请求完成身份；加入受控慢 provider 测试。

### 29 · P2 · Compare 输出测试不能证明 cone 真正切换
**风险。** [workbench-e2e.mjs](../tests/e2e/workbench-e2e.mjs)，selectOption('y') 后仅等 Compare ready。
fixture 只有一路输出，Whole 与 output cone 的可见拓扑可能相同；状态文字也不能验证左右图的查询语义。
**修复及验收：** 使用两路互不相交输出，验证选一路后两侧节点集合和深度范围发生预期变化。

### 30 · P2 · 导出回归只检查文件扩展名
**风险。** [workbench-e2e.mjs](../tests/e2e/workbench-e2e.mjs)，Golden/SVG 下载循环。
仅验证 suggestedFilename 后缀；无法发现 SVG 来自旧 module、内容缺失、Golden 坐标与当前 overrides 不一致。
**修复及验收：** 解析下载内容，核对 module/节点集合/关键坐标和 XML 可解析性，再回导验证一致性。

## 建议处理批次

1. **生命周期与正确性：** 01–08；先统一请求身份和完成／失败／取消契约，再修调用方。
2. **任务与数据边界：** 10–20；对当前字符串键／密集数组之外的 API 输入先明确支持范围。
3. **内存与持久化：** 09、21–23；用故障注入和峰值内存证据验收。
4. **门禁和测试：** 24–30；将行为断言建立在真实装配与产物上。

这些条目不是“30 个已在产品中复现的 bug”。复现项确认工具或边界行为；风险项说明修复前缺少的保证。关闭结果以本文顶部状态表及当前测试记录为准，原始建议段落不回写成事后描述。
