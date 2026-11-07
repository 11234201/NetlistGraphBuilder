# 当前工作区代码审查（扩展轮，2026-11-07）

## 修复状态（2026-11-07）

本报告的 17 项确定问题已在当前工作区完成修复并增加边界回归：

- 01–02：补齐 Golden 的 committed-workspace 端口；新设计导入先退出 Compare，并重建干净的 Compare 状态。
- 03–05：重复 Apply 保留 Compare 查询/视口；显式 Whole 设置全图请求；Single/Compare 的 net 选择都可直接进入 Focused。
- 06–10：Timing/Golden 导入等待最终 mount；escaped displayName 选择 canonical module；批量输入保留此前成功设计；图外 port 不虚报定位；Single 历史同步深度控件。
- 11–13：渲染与历史使用一致 workspace identity；nested port 的 defineProperty 退化为普通赋值；不可变快照拒绝函数值。
- 14–17：Worker 分析预声明提升绑定、区分 var/lexical scope、保守合并条件分支并尊重全局对象遮蔽；缺失 storage 明确返回失败。

验证在 `mfs-remote:/home/wzh/my_code/netlist_graph_builder_review_fix` 执行：`npm test` 894/894 通过；
`npm run test:architecture` 报告 233 modules、560 edges、0 unresolved、0 boundary violation、0 cycle。
本批没有修改 parser、布局或 routing 算法，因此未运行 mapped cases、determinism、fixture benchmark 或发布构建；
也没有把 controller/Node 回归表述成真实浏览器 E2E。下方条目保留发现时的触发条件和证据，供审阅修复范围。

## 范围与证据口径

- 基线提交：`17629dd`；审查对象是包含现有未提交修改的工作区，不是只审查 HEAD。
- 覆盖输入导入、Single/Compare、搜索、历史恢复、控制器端口、不可变快照和模块依赖门禁。没有声称穷尽 parser、routing 或所有布局实现。
- 共 **17 项**：P1 2 项、P2 11 项、P3 4 项。前 11 项是用户流程或工作区行为；后 6 项是公共边界和开发门禁缺陷，不能等同于已经发生的产品事故。
- “最小复现”指本轮通过 Node 调用实际模块并断言结果；DOM、下载、调度等外部服务使用小型替身。不是浏览器 E2E。
- 发现阶段只做轻量本地检查；修复完成后按顶部“修复状态”记录在远端运行完整 `npm test` 和架构检查。未运行 mapped cases、benchmark 或发布构建。
- 下面保留发现时的独立记录和复现口径；既有 `code_review_2026_11_07_followup.md` 保留原样，重复问题明确标注。

## 用户流程和工作区

### 01 · P1 · 已完成的 Single 工作区仍无法导出 SVG/Golden

- 位置：`src/app/golden_controller.js:18,107,164,185`；`src/app/workbench_controllers.js:30`。
- 原因：控制器读取 `singleWorkspaceIdentity`，但 `goldenPorts.state` 没有声明它。生产装配使用 `createLegacyPort`，因此这个属性始终是 `undefined`。
- 触发：任何正常 Single 工作区布局完成后尝试导出。按钮保持 disabled，直接调用方法也只返回等待提示。
- 证据：**最小复现**。底层状态设置 `singleWorkspaceIdentity = 'committed'`，通过真实 `goldenPorts` 建端口，分别调用 SVG/Golden 导出；下载调用为 0，输出两条 `Wait for the current Single workspace...`。
- 修复与验收：补齐声明；使用生产端口装配而非直接传完整 state 的测试，验证提交前禁用、提交后两种导出可用。
- 与旧清单关系：本次聊天首轮发现；旧 followup 未列出。

### 02 · P1 · Compare 中导入新设计没有退出或重置旧 Compare

- 位置：`src/app/appState.js:102`；`src/app/input_controller.js:145-168`；`src/app/workspace_render_controller.js:22`。
- 原因：`resetDesignWorkspace` 取消 Compare controller，但保留 `compare.active`、旧模块名、旧图等状态；`loadDesign` 接着发起 Single 渲染，没有退出 Compare。Single 提交条件又要求 `!state.compare.active`。
- 触发：打开 A/B Compare，导入包含不同模块的新 Verilog。
- 影响：设计数据已替换，界面仍处于旧 Compare；新 Single 工作区不提交，并通过取消回调结束导入。后续 Compare 模块查找可能返回空，用户看到旧图或取消提示，而不是新设计。
- 证据：**重置函数最小复现 + 调用链确认**。重置后 `active === true`，模块名仍为 `oldA/oldB`；未执行真实浏览器导入。
- 修复与验收：设计替换事务应同时重置 Compare 数据、可见性和任务身份；在实际装配的 Compare 状态导入新设计，断言新图提交、旧图清除、导入 Promise 成功。
- 与旧清单关系：新增。

### 03 · P2 · 相同模块对再次 Apply 会清空查询和视口

- 位置：`src/app/compare_workspace_controller.js:63-82`。
- 原因：`pairChanged === false` 时 `restoredWorkspace` 为 false，随后进入新工作区初始化分支。
- 触发：同一 Compare pair 选择 output 或 Whole、缩放平移，再点击 Apply。
- 影响：output 变 null、wholeRequested 变 false，两侧 transform 重置。
- 证据：**最小复现**。同 pair、output=y、左侧 scale=2，Apply 后 output=null、scale=1。
- 修复与验收：区分“不变”“恢复成功”“新建”三种状态；重复 Apply 保留当前查询和两侧视口。
- 与旧清单关系：复核确认 R3。

### 04 · P2 · 大图 Compare 的 Whole 按钮没有真正请求全图

- 位置：`src/app/view_controls_controller.js:71-81`；`src/app/compare_workspace_controller.js:174`；`src/app/compareWorkspace.js` 的 `resolveWorkspaceInputs`。
- 原因：Whole handler 清空 roots/output，却没有把 `compare.wholeRequested` 设为 true；prepare 路径仍按 `forceWhole=false` 选择 Search-first。
- 触发：首次进入超过 Search-first 阈值的 Compare，点击顶部 Whole 按钮。
- 影响：状态提示 `Whole compare modules`，实际仍是 Search-first；输出下拉框的 Whole handler 设置了该标志，两个入口行为不一致。
- 证据：**controller 最小复现 + 下游分支确认**。调用 Whole 后标志仍为 false。
- 修复与验收：统一 Whole 命令；验证大图两侧 workspaceInput 均进入 Whole，且端口能力声明同步更新。
- 与旧清单关系：新增。

### 05 · P2 · 选中 net 后 Focused 按钮可用，但操作拒绝该选择

- 位置：`src/app/view_controls_controller.js:20-30,54-64,143-152`。
- 原因：按钮启用条件包含 selectedNet/selectedCompareNet，但 Single handler 只从 selectedNodeId 建 root，Compare handler 只查 cell。
- 触发：没有既有 Focused roots，选中一条 net，然后点击 Focused。
- 影响：Single 提示 `Select a cell...`；Compare 同样拒绝 net，违反已有 net root 能力和按钮状态。
- 证据：**Single 最小复现；Compare 同构分支代码确认**。
- 修复与验收：复用已有 cell/net ObjectRef 或 focusedNetRootId 解析；覆盖两个画布从 net 选择直接切换 Focused。
- 与旧清单关系：新增。

### 06 · P2 · Timing/Golden 的导入完成契约仍不包含最终渲染

- 位置：`src/app/input_controller.js:53-55,85-93,114-123`；`src/app/golden_controller.js:96-103`。
- 原因：只有 netlist 分支返回最终完成 Promise。Timing/Golden 分支丢弃处理结果，底层处理也没有以渲染回调形成完成 Promise。
- 触发：异步布局期间导入 Timing/Golden，或批量导入 design + timing + golden。
- 影响：`await loadText()` 提前结束、弹窗关闭、下一个文件开始；布局失败不能通过该次导入的 rejection 反馈。startup 的 loadTiming 包装同样没有返回完成值。
- 证据：**代码路径确认**，未将源码模式检查当作异步端到端复现。
- 修复与验收：统一解析、提交、渲染完成、失败和取消语义；用延迟 provider 分别验证三种输入以及批次串行完成顺序。
- 与旧清单关系：复核确认 R1；优先级按导入反馈和排序错误定为 P2。

### 07 · P2 · 启动模块 displayName 校验成功后仍可能打开首个模块

- 位置：`src/app/input_controller.js:138-140,165-166`。
- 原因：验证接受 name 或 displayName，选择只匹配 name。
- 触发：源文件先定义 first，再定义 escaped module `\foo.bar`；启动参数传其显示名 `\foo.bar`。parser 的 canonical name 为 `foo.bar`。
- 影响：参数被接受，但实际选择 first，静默打开错误模块。
- 证据：**实际 parser/import/controller 最小复现**。必须传带反斜杠的 displayName；传 canonical `foo.bar` 是成功场景，不能作为反例。
- 修复与验收：预验证返回唯一解析结果，后续直接使用该对象；覆盖 escaped 模块不是首个模块的情况。
- 与旧清单关系：复核确认 R2。

### 08 · P2 · 批次中后一个网表失败会抹掉前一个成功状态

- 位置：`src/ui/quick_input_controller.js:49-64`。
- 原因：成功将 designLoaded 置 true，后一个 netlist 失败又无条件置 false；这不是“本批至少一个成功”的语义。
- 触发：按顺序导入 good.v、解析失败的 bad.v、timing.log。bad.v 在提交新设计前失败，good.v 仍是当前设计。
- 影响：Timing/Golden 被跳过，提示本批没有任何成功网表，与真实状态不符；已有测试只覆盖 bad→good 顺序。
- 证据：**最小复现**。loaded 只有 good；状态包含 `Skipped timing.log: no netlist in this batch loaded successfully`。
- 修复与验收：明确记录最后一个可用设计及失败是否已污染状态；至少覆盖 good→bad 和 bad→good 两种顺序，不能简单把所有失败都解释为“没有成功设计”。
- 与旧清单关系：新增。

### 09 · P2 · 搜索图外 port 会清除选择并虚报定位成功

- 位置：`src/app/search_navigation_controller.js:79-88`；`src/app/searchLocatePolicy.js` 的 unavailable 契约。
- 原因：最终 port 分支不判断找不到节点的结果，直接 `setSelectedNode(null)`，然后发成功样式 Search 状态。
- 触发：Search-first 或 Focused 图中没有该 port，点击仍存在于搜索索引中的 port 结果。
- 影响：未定位任何对象，还丢失原选择；修复“传 graph”只覆盖图内命中。
- 证据：**最小复现**。fullGraph 有 input:a，positioned graph 为空；选择被清空，状态为 `Search: port a`。
- 修复与验收：遵循 unavailable 分支并保留原选择，或提供明确的展示策略；分别测试图内和图外 port。
- 与旧清单关系：旧第 19 项的剩余缺口，不重复计算已修复的缺 graph 参数问题。

### 10 · P2 · Single 历史恢复后深度输入框仍显示恢复前的值

- 位置：`src/app/history_controller.js:80-82`；对比 Compare 分支 `161-166`。
- 原因：Single 只写 state 的 cone/fanin/fanout depth，未同步输入框；`updateViewControls` 也只更新 disabled，不更新这些 value。
- 触发：修改深度后 Back/Undo 恢复旧视图。
- 影响：图使用恢复后的深度，控件却显示旧值；下一次修改另一侧深度时，handler 会读回两侧输入值，重新覆盖已恢复的深度。
- 证据：**最小复现**。恢复后 state 为 `[2,3,4]`，输入仍为 `[7,9,8]`。
- 修复与验收：共享深度控件同步函数；Single 与 Compare 历史恢复后 state/DOM 一致，再修改单个输入不覆盖另一侧。
- 与旧清单关系：新增。

### 11 · P2 · 渲染与历史控制器为同一 Focused 状态生成不同身份

- 位置：`src/app/workspace_render_controller.js:162-170`；`src/app/workspace_identity.js:9`；`src/app/history_controller.js:96-100`。
- 原因：workspaceRenderPorts 未声明 focusedRootRefs，调用共享 identity helper 时得到默认空数组；historyPorts 声明了该字段，生成身份时包含真实 refs。
- 触发：focusedRootRefs 非空，历史导航只改变选择或视口等本可复用图的状态。
- 影响：canReuseWorkspace 始终失败，多余布局/渲染，破坏大图历史导航的复用路径；不是已证实的图内容错误。
- 证据：**真实两组端口最小复现**。同一个 backing state 分别创建 render/history port，所得 identity 不相等。
- 修复与验收：审查 helper 的间接状态依赖；用实际端口调用共享 helper，验证身份一致及无关选择/视口变化不重新计算。
- 与旧清单关系：新增。

## 公共边界与开发门禁

### 12 · P3 · writable nested port 允许把底层字段改为不可写

- 位置：`src/app/legacy_port.js:39-41`。
- 原因：defineProperty 仅要求 descriptor 包含 value，随后原样转发 writable/enumerable 等标志。
- 触发：`Object.defineProperty(port.compare, 'active', {value:false, writable:false})`。
- 影响：后续正常 `port.compare.active = true` 抛 TypeError。当前未发现产品业务使用这一反射入口，因此定为边界缺陷，不描述为普遍用户故障。
- 证据：**最小复现**，第二次正常赋值抛错。
- 修复与验收：拒绝描述符重定义，或只将 value 转换为普通赋值；覆盖 descriptor flags。
- 与旧清单关系：复核 R4，但修正旧描述：纯 accessor descriptor 已因缺 value 被拒绝，不应继续声称 getter/setter 可直接写入。

### 13 · P3 · 不可变快照仍保留普通字段中的函数引用

- 位置：`src/foundation/immutable_snapshot.js:6`。
- 原因：所有非 object 值原样返回，包括 function。新增函数 Map key 拒绝逻辑没有覆盖普通字段、数组项和 Set 元素。
- 触发：`const f=()=>{}; f.mutable=1; const s=immutableSnapshot({f}); f.mutable=2`。
- 影响：`s.f.mutable === 2`，快照与输入共享可变函数对象。没有确认正常网表路径传入函数，因此定为 API 契约缺陷。
- 证据：**最小复现**。
- 修复与验收：在入口明确拒绝 function；覆盖普通字段、数组、Set 等容器，保留合法数据的循环引用支持。
- 与旧清单关系：新增；不同于已修复的 Map key 校验。

### 14 · P2 · Worker binding 未遵循提升和 var 函数作用域

- 位置：`tools/module_graph.mjs:155-176`。
- 原因：按 AST 遍历顺序声明 binding，所有声明写入当前 block，未区分 var 和 let/const。
- 可复现输入与结果：
  - `function f(){ new Worker('/src/missing.js'); function Worker(){} }`：本来使用已提升的局部函数，却误报 unresolved Worker。
  - `{ var W = Worker; } new W('/src/missing.js');`：真实 Worker 别名是外层可见的 var，却得到空 diagnostics，漏检不存在入口。
- 影响：架构门禁既误拒绝合法模块，也允许真实 Worker 入口逃过解析和分层检查。
- 证据：**buildModuleGraph 最小复现**。
- 修复与验收：先建立作用域绑定，再分析引用；区分函数/模块 var 与块级 lexical 声明。
- 与旧清单关系：扩展确认 R5；增加了实际漏检反例，不仅是误报。

### 15 · P2 · Worker 别名分析把不可达分支赋值当成必然执行

- 位置：`tools/module_graph.mjs:179-184` 及通用子节点遍历。
- 触发：`let W=Worker; if(false) W=class {}; new W('/src/missing.js');`。
- 原因：顺序访问 if 的所有子树，把 dead branch 对 W 的 false 覆盖带到后续语句，未做控制流合并。
- 影响：实际构造 Worker，但 dependency graph 没有这条边；unresolved、跨层和循环检查均可能漏掉此入口。
- 证据：**最小复现**，diagnostics 为 `[]`。
- 修复与验收：使用保守的“可能是 Worker”集合和分支合并，或对无法证明的构造显式报 opaque 请求；加入条件、循环和函数内赋值场景。
- 与旧清单关系：新增，修复绑定作用域本身不足以解决该问题。

### 16 · P3 · window/globalThis 被遮蔽时仍被当成全局 Worker 容器

- 位置：`tools/module_graph.mjs:200-204`。
- 触发：`function f(window){ new window.Worker('/src/missing.js'); }`，调用方传普通自定义对象。
- 原因：MemberExpression 分支仅比较对象名称，不查询该名称的词法 binding。
- 影响：合法局部对象构造被误判为 Worker 入口，门禁误报 unresolved/non-local。
- 证据：**最小复现**，产生 `/src/missing.js` unresolved；该程序并不能静态证明调用浏览器 Worker。
- 修复与验收：全局对象成员识别也必须尊重参数、import、局部变量遮蔽；保留未遮蔽全局写法支持。
- 与旧清单关系：新增，和第 14 项的声明提升/var 归属分别需要覆盖。

### 17 · P3 · 不存在 storage 时保存函数仍报告成功

- 位置：`src/app/sessionState.js:30-34`。
- 原因：`target?.setItem(...)` 在 target 为 null/undefined 时静默跳过，随后返回 true。
- 触发：`saveSessionState(snapshot, null)`，或宿主没有 sessionStorage。
- 影响：调用方认为已保存并清除失败状态，但没有任何写入；正常浏览器 sessionStorage 抛 SecurityError 的情况已有 catch，不属于这个缺陷。
- 证据：**最小复现**，`saveSessionState({}, null) === true`。
- 修复与验收：只有实际找到可调用的存储接口并写入成功才返回 true；覆盖 null、undefined、抛错和正常 storage。
- 与旧清单关系：新增，影响主要是宿主兼容和接口调用，不夸大为所有浏览器丢失会话。

## 未计入上述 17 项的补充风险

1. **关闭粘贴窗口是否承诺取消导入**：`quick_input_controller.closeDialog` 只改变 dialogSession，已进入 loadText 的任务继续运行。旧 R6 的产品语义仍需明确；不能仅凭 Cancel 文案就断言后提交的新设计会被旧任务覆盖，底层另有任务代次保护。
2. **已收敛 · Compare workspaceIdentity 发布时机**：identity 现在只在两侧 mount 都成功后发布；拒绝、取消和过期渲染保持 null，并增加双 mount 完成回归。
3. **已收敛 · presentation 重绘错误出口**：Single 和 Compare 的纯 presentation Promise rejection 现在进入明确状态反馈，不再形成未处理 rejection。

## 修复与验收顺序

1. 先修 01、02，恢复基础导出和设计替换流程；测试必须经过真实端口装配。
2. 修 03–10，逐项覆盖具体交互状态和异步完成顺序；不要只测试 helper 返回值而省略 UI/controller 调用链。
3. 修 11，验证 Focused 历史复用，避免用全量重新布局掩盖身份错误。
4. 修 12–17，增加边界契约及门禁反例；与产品可复现故障分开安排优先级。
5. 实现后按项目规则在 mfs-remote 运行所需单测/架构检查；改变图、布局或 renderer 时再运行对应 mapped、determinism 和 benchmark。不能把本报告的轻量复现描述成这些验收已通过。

## 本轮执行记录

- 读取当前状态、路由 skill、项目约束和相关实现；未暂存任何路径。
- 扫描各 controller 对 state/elements/services 的直接字段引用与其 Ports 声明，发现 Golden 缺字段；进一步追踪共享 identity helper，发现 renderPorts 的间接缺字段。
- 用 Node v24.12.0 执行内存最小复现：01、03、05 的 Single 分支、07–17；02/04 分别验证了重置状态和 handler 标志，并追踪下游条件。06 为静态控制流确认。
- 07 首次试验传了 canonical name，断言失败，说明该输入正常；改用 parser 实际生成的 escaped displayName 后才复现。报告保留这个边界，避免把 canonical name 的正常路径误报。
- 发现阶段没有运行完整测试或浏览器 E2E；后续完整单测和架构检查结果见顶部修复状态。性能回归、浏览器 E2E 与发布构建仍未执行。
