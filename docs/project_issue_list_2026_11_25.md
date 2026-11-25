# 项目现存问题清单（2026-11-25）

> 审计基线：HEAD `7dc7c6c`（`feat(compare): separate click-to-center from pan and zoom sync`）。下文保留审计时的现象与数据。勾选项可按交叉索引在验收记录中复核。修复过程遵守 `AGENTS.md` 中的 Simple 永久冻结规则与单向分层约束。

**配套规划文档**：
- 修复方案路线：[issue_remediation_roadmap_2026_11_25.md](./plans/issue_remediation_roadmap_2026_11_25.md)
- 需求拆分规格：[issue_remediation_requirements_2026_11_25.md](./plans/issue_remediation_requirements_2026_11_25.md)
- 验收标准清单：[issue_remediation_acceptance_2026_11_25.md](./plans/issue_remediation_acceptance_2026_11_25.md)

## 修复交叉索引

下表对应[需求规格](plans/issue_remediation_requirements_2026_11_25.md)与[验收断言](plans/issue_remediation_acceptance_2026_11_25.md)。原始现象与基线测量保留在下文。

| Wave | 问题 | 需求 / 验收 |
| --- | --- | --- |
| 0 | `B01` | `REQ-01` / `AC-01` |
| 0 | `W01`, `W02`, `W03` | `REQ-02` / `AC-02` |
| 1 | `B02`, `B03`, `B05` | `REQ-03` / `AC-03` |
| 1 | `B04`, `P06` | `REQ-04` / `AC-04` |
| 2 | `B06`, `B08`, `B09` | `REQ-05` / `AC-05` |
| 2 | `B07`, `B10`, `B11`, `P07` | `REQ-06` / `AC-06` |
| 2 | `B12`, `B13`, `B14` | `REQ-07` / `AC-07` |
| 2 | `B15`, `B16`, `B17`, `P03`, `P08` | `REQ-08` / `AC-08` |
| 3 | `B18`, `B21` | `REQ-09` / `AC-09` |
| 3 | `B19`, `P04`, `P05` | `REQ-10` / `AC-10` |
| 3 | `B20` | `REQ-11` / `AC-11` |
| 3 | `B22`, `B23`, `B24`, `B25` | `REQ-12` / `AC-12` |
| 4 | `S01`, `S02`, `S03` | `REQ-13` / `AC-13` |
| 4 | `S04`, `S05`, `S07`, `S08` | `REQ-14` / `AC-14` |
| 4 | `S06` | `REQ-15` / `AC-15` |
| 4 | `S09`, `S10`, `A03` | `REQ-16` / `AC-16` |
| 5 | `A01` | `REQ-17` / `AC-17` |
| 5 | `A02` | `REQ-18` / `AC-18` |
| 5 | `A05`, `A08`, `A09` | `REQ-19` / `AC-19` |
| 5 | `A06`, `A07` | `REQ-20` / `AC-20` |
| 6 | `P01` | `REQ-21` / `AC-21` |
| 6 | `P02` | `REQ-22` / `AC-22` |
| 冻结 | `A04` | 永久只读，按 G3 核验 |

## 检查基线

| 检查项 | 命令 | 当前结果 | 备注 |
| --- | --- | --- | --- |
| 单元测试 | `npm test` | **1490 通过 / 0 失败 / 2 跳过** | 耗时约 25.9s |
| 静态架构门禁 | `npm run test:architecture` | **395 模块 / 972 边 / 0 违规 / 0 循环** | 含 `unresolved=0` |
| 文档链接检查 | `npm run test:docs` | **108 链接 / 0 失效** | 默认文档集 |
| 映射网表硬约束回归 | `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-hard` | **47/47 通过 / 0 违规** | `provider=native-layered`，最长 21.45s，峰值堆 1580 MiB |

## 问题汇总

| 分类 | High | Medium | Low | 合计 |
| --- | ---: | ---: | ---: | ---: |
| 一、近期改动（`7dc7c6c` / `compare sync-selection`）遗漏 | 0 | 3 | 0 | **3** |
| 二、功能与正确性缺陷（App / Parser / Timing / Domains / Layout / Render） | 12 | 11 | 2 | **25** |
| 三、安全边界与多启动器（Node / Python / C++ / Tcl / Windows）缺陷 | 6 | 4 | 0 | **10** |
| 四、性能瓶颈与未闭环验收项 | 3 | 4 | 1 | **8** |
| 五、架构债、错误日志缺口与仓库卫生 | 0 | 4 | 5 | **9** |
| **总计** | **21** | **26** | **8** | **55** |

**建议修复顺序**：
1. 先收口 `7dc7c6c`（`compare sync-selection`）遗留项（`W01`–`W03`）与直接影响新功能的 `B01`（多文件历史与退出保存失效）。
2. 修复高影响正确性缺陷：`B02`–`B04`（Verilog 解析与位宽死循环）、`B06`–`B07`（时序单位混用与别名覆盖）、`B12`–`B13`（跨层投影与 BFS 深度排序）、`B18`–`B20`（导线标签丢弃、`inout` 布局与 Worker 异常规范）、`B22`（导出 SVG 时序徽标样式）。
3. 修补多启动器安全与协议边界（`S01`–`S10`），随后推进性能优化（`P01`–`P08`）与架构/卫生收敛（`A01`–`A09`）。

---

## 一、近期改动（`7dc7c6c` / `compare sync-selection`）遗漏

- [x] **W01 · [Medium] Compare 下 `zoomToCompareSelection` 忽略已选中的 Port**
  - 位置：[focus_navigation_controller.js](../src/app/focus_navigation_controller.js#L134-L161)、[focused_roots_controller.js](../src/app/focused_roots_controller.js)、[remote_navigation_commands.js](../src/app/remote_navigation_commands.js)、[index.html](../index.html#L18)、[inspector_controller.js](../src/app/inspector_controller.js#L248-L278)
  - 现象：点击 Compare 中的 Port 时 `focusCompareSelection` 可居中两侧匹配端口（UI 提示文案也包含 port/cell/net），但 `zoomToCompareSelection()` 仅放行 `["cell", "net"]`，导致选中 Port 时 `selection zoom`、`search open` 静默无动作，工具栏 Focus Selected 按钮保持禁用。

- [x] **W02 · [Medium] Compare 激活 Focused root chip 时仍拷贝裸视口坐标**
  - 位置：[focused_roots_controller.js](../src/app/focused_roots_controller.js#L370-L393)、[view_controls_controller.js](../src/app/view_controls_controller.js)
  - 现象：`activateCompareFocusedRoot` 调用 `services.setCompareTransform(context.side, transform)` 未传第 3 参数 `false`。当 `Sync pan / zoom` 开启而 `Center match on click` 关闭时，点击 root chip 仍会把本侧裸坐标直接覆盖到对侧；此外当 `synchronized` 开启而 `focusedRootsSynchronized` 关闭时，切换聚焦根仍会重置对侧视口。

- [x] **W03 · [Medium] 远程命令 `compare split` 未纳入视图历史事务**
  - 位置：[remote_design_commands.js](../src/app/remote_design_commands.js#L50-L65)、[workbench_event_bindings.js](../src/app/workbench_event_bindings.js)
  - 现象：同一分支内的 `compare sync-viewport` / `compare sync-roots` / `compare sync-selection`（通过 `workbench_controllers.js` 的 `setCompareSync`）与前端下拉框事件均包裹了 `runViewHistoryTransaction`，而远程 `compare split` 直接写入 `layout` 未包历史事务。
  - 关联影响：`B01` 会导致多文件设计（如执行 `compare design` 后）下新增的 `setCompareSync` 事务也无法写入 `ViewHistory`。

---

## 二、功能与正确性缺陷（App / Parser / Timing / Domains / Layout / Render）

### App 层
- [x] **B01 · [High] 多文件 / 合并网表下 View History（Undo/Redo）与页面退出自动保存静默失效**
  - 位置：[input_controller.js](../src/app/input_controller.js)、[history_controller.js](../src/app/history_controller.js#L282)、[main.js](../src/app/main.js#L415)
  - 现象：追加第二个网表（`design add`、`compare design`、多文件拖放或恢复多文件会话）后，`input_controller.js` 会清空 `state.currentSource = null` 并把源码存入 `state.sourceFiles`。但 `history_controller.js` 的 `recordViewHistory` 仅检查 `!state.currentSource`（且 `historyPorts.state` 未声明 `sourceFiles`），`main.js` 的 `getSessionSnapshot` 也仅检查 `state.currentSource`，导致多文件场景下所有视图历史记录静默跳过、`beforeunload` 跳过会话保存。

### Parser 与 Netlist IR
- [x] **B02 · [High] Verilog-2001 属性 `(* ... *)` 静默吞掉整条后续语句**
  - 位置：[verilogParser.js](../src/parser/verilogParser.js)
  - 现象：词法将 `(*` 切为 `(` 与 `*`。`parseModule` 遇到 `(` 后走入 `skipStatement()`（跳过直到 `;`），将 `(* attr = ... *)` 连同紧随其后的 `cell`/`port`/`wire`/`assign` 语句整条丢弃且无诊断。

- [x] **B03 · [High] 转义标识符与关键字、修饰符、位宽、结束符冲突**
  - 位置：[verilogParser.js](../src/parser/verilogParser.js)
  - 现象：`peekValue()`、`matchValue()`、`consumeUntilValue()`、`DECLARATION_QUALIFIERS.has(token.value)` 与 `isRangeToken(token.value)` 均未检查 `!token.escaped`。`\wire `、`\reg `、`\input `、`\signed ` 等合法转义标识符会被误判并静默丢弃；出现转义单元类型 `\endmodule ` 时会提前终止 `parseModule`。

- [x] **B04 · [High] 位宽展开无边界导致死循环/OOM，且转义标量网 `\reg[3:0] ` 被误拆**
  - 位置：[model.js](../src/netlist/model.js)、[graph.js](../src/netlist/graph.js)、[verilogParser.js](../src/parser/verilogParser.js)
  - 现象：`expandReference` 与 `expandPortEndpoints` 未校验 `Number.isSafeInteger` 与最大位宽上限，畸形位宽如 `[99999999999999999:0]` 会无限循环、超大范围会 OOM；同时 `verilogParser.js` 构造引脚连接时丢弃了 `connection.escaped`，导致 DC/Genus 常见的拍平转义标量网（如 `\reg[3:0] `）被 `model.js` 误拆成 4 条独立 bit 线网。

- [x] **B05 · [Medium] 多类结构化 Verilog 边缘语法静默丢失且无诊断**
  - 位置：[verilogParser.js](../src/parser/verilogParser.js)
  - 现象：位置参数端口连接 `cell inst(y, a, b);` 生成 0 引脚孤立单元；参数化模块头 `module top #(parameter W=8)(...)` 在 `#` 处触发 `skipStatement()` 丢失全部 ANSI 端口；`wire a = b;` 丢弃赋值关系；独立 `reg`/`logic`/`supply0`/`supply1` 语句被整体跳过；`bindModuleAttributeComments` 存在未使用变量与无效的 `O(N)` 兜底扫描。

### Timing 解析与标注
- [x] **B06 · [High] `mergeTimingDatasets` 静默混用 `ns` 与 `ps` 数值且单文件返回不一致**
  - 位置：[timingParser.js](../src/timing/timingParser.js#L414-L454)
  - 现象：合并不同单位数据集时直接拼接原始 `at`/`rt`/`slack`/`delay`/`slew` 数值并沿用首个数据集的 `unit`，既不做 1000× 换算也不产出诊断；当 `valid.length === 1` 时直接返回原对象，未像多文件分支那样把 `dataset.fileName` 补充到记录与诊断上。

- [x] **B07 · [High] `tryAnnotateNet` 别名覆盖根线网依赖顺序、决胜失效且存在原型键冲突**
  - 位置：[timingAnnotation.js](../src/timing/timingAnnotation.js#L51)
  - 现象：
    1. 仅比对 `netTiming[canonicalNet]` 就覆盖 `netTiming[rootCanonicalNet]`，导致后出现的较松弛别名可覆盖更关键别名已写入的根线网时序（依赖记录顺序）。
    2. `netEntry` 未保存 `.point`，同 slack 决胜时 `isPreferredTimingRecord` 退化为跟空串比对，变为“先到先得”。
    3. `netTiming`、`pins`、`pinPoints` 使用 `{}` 而非 `Object.create(null)` / `Map`，遇到名为 `constructor`/`toString`/`valueOf` 的线网或引脚会产生原型污染/碰撞。

- [x] **B08 · [Medium] 带注释前导的 JSON 时序文件触发 `JSON.parse` 必败，数组型 `points` 静默跳过**
  - 位置：[timingParser.js](../src/timing/timingParser.js)
  - 现象：`startsWithJsonObject` 跳过前导 `#`/`//` 行判断为 JSON 后，仍把未剥离注释的原文本交给 `JSON.parse`，必然报 `invalid-json`；`parseTimingJson` 遇到 `points` 为数组时因 `typeof [] === "object"` 而静默跳过，无诊断。

- [x] **B09 · [Medium] 行内注释与 CSV 解析破坏 Verilog 转义名与 `\\` 末尾引号**
  - 位置：[timingParser.js](../src/timing/timingParser.js)
  - 现象：`stripInlineComment` 不识别 Verilog 转义标识符 `\... `，转义名中的 `#` 会被误截断，内部 `'`/`"` 会翻转引号状态；`hasUnquotedComma`、`splitCsvLine`、`stripInlineComment` 只检查前一个字符是否为 `\` 而未统计连续反斜杠数量，无法处理 `"foo\\"`，且 CSV 路径不识别单引号 `'`。

- [x] **B10 · [Medium] 层次时序 `rooted` 正则使用 `"i"` 标志破坏 Verilog 大小写敏感语义**
  - 位置：[timingAnnotation.js](../src/timing/timingAnnotation.js)
  - 现象：`rooted` 正则附加的 `"i"` 标志同时作用于 `${pathPattern}`（实例层次路径），使有根路径按大小写不敏感匹配实例名，与无根/裸路径语义冲突；`(?<!\\)/` 仅检查单个前导反斜杠，处理偶数个反斜杠（`\\/`）时与 `findLastUnescapedSlash` 不一致。

- [x] **B11 · [Medium] Net 驱动引脚与 Pin 记录键归一化不一致且丢弃记录虚增匹配计数**
  - 位置：[timingAnnotation.js](../src/timing/timingAnnotation.js)
  - 现象：`tryCollectCellPin` 使用 `normalizePinName` 而 `addDriverCellPinTiming` 使用原始 `driver.pin`，`findTimingPin` 查询也未归一化，导致转义引脚绕过去重或无法命中默认徽标；`ambiguousNodeIds` 跳过 `directGroup` 时未计入未解决计数，使 `matchedRecordCount` 虚高。

### Domains（Netlist 跨层 / AIG / Golden）
- [x] **B12 · [High] `projectHierarchicalRenderGraph` 用未重映射节点 ID 查询已重映射的 `nodeById`**
  - 位置：[hierarchy_connectivity.js](../src/domains/netlist/hierarchy_connectivity.js#L318-L327)
  - 现象：`nodeById` 以 `renderId`（如 `hub:top/n1`）为键，而查询边所属网络名时却传入原始未重映射的 `edge.source`/`edge.target`，两者恒为 `undefined`，导致跨层投影边的 `edge.net` 始终退化为原始 `edge.id`。

- [x] **B13 · [High] `analyzeHierarchicalCone` 深度按字典序比较（`"10" < "2"`）且每次出队全量排序**
  - 位置：[hierarchy_connectivity.js](../src/domains/netlist/hierarchy_connectivity.js#L195-L197)、[L779-L781](../src/domains/netlist/hierarchy_connectivity.js#L779-L781)
  - 现象：`compareStates` 拼接 `${left.depth}:...` 作字符串比较，深度 ≥ 10 时会优先扩展深层节点，偏离最短深度 BFS 并提前耗尽节点预算；且每弹出 1 项都对队列执行 `queues.sort(...) + queues.shift()`（`O(Q² log Q)`）。

- [x] **B14 · [Medium] `followPortEndpoint` 向上穿越子模块端口丢弃多位/拼接总线**
  - 位置：[hierarchy_connectivity.js](../src/domains/netlist/hierarchy_connectivity.js)
  - 现象：模板构建时将多位/拼接端口展开为多条同名 `pin` 记录，但 `followPortEndpoint` 用 `parentInstance?.pins.find(...)` 只取了第一条线网，其余 bit 被静默丢弃；同文件还存在边 ID 未区分 `relation`、顶层名为 `"top"` 的子模块实例与根路径碰撞、嵌套线性 `.ports.find()` 等问题。

- [x] **B15 · [Medium] `aig_view_query.js` 的 `projectCut` 忽略 `primaryNameMapping.name`**
  - 位置：[aig_view_query.js](../src/domains/aig/aig_view_query.js)
  - 现象：读取 `driver.primaryNameMapping` 时只取 `ref?.signalId || ref?.label`，未优先取 `ref?.name`，导致 Focused / Show-Path 截断边界显示原始 BLIF ID 而非映射后的 RTL 名称。

- [x] **B16 · [Medium] `layout_golden.js` 数值解析把 `null` / `""` / 布尔值强转为 `0` 或 `1`**
  - 位置：[layout_golden.js](../src/domains/netlist/layout_golden.js)
  - 现象：`finiteNumber`、`positiveInteger`、`nonNegativeInteger` 直接调用 `Number(value)` 而未排除 `null`/`""`/布尔类型，导致缺失的 `faninDepth: null` 变成 `0`、缺失的 `node.x: null` 或 `sourceIdentity.size: null` 变成 `0`。

- [x] **B17 · [Low] AIG 归一化、Show Path 与 Reconvergence Worker 的小缺陷**
  - 位置：[aig_normalize.js](../src/domains/aig/aig_normalize.js)、[show_path.js](../src/domains/netlist/show_path.js)、[reconvergence_worker.js](../src/domains/netlist/reconvergence_worker.js)
  - 现象：`aig_normalize.js` 孪生节点 tie-break 在 `sourceRefs` 排序前读取 `sourceRefs[0]?.id`（轻微依赖输入顺序），且常量归一化未校验 `literals.length === 1`；`show_path.js` `addPathSideInputs` 使用 `edge.net` 而未保留 `edge.label` 转义显示名；`reconvergence_worker.js` 缺少 `index` 未初始化守卫（会抛不透明 `TypeError`）。

### Layout 与 Worker 执行
- [x] **B18 · [High] `buildWireRoutes` / `refreshWireRouteLabels` 静默丢弃 `placeWireLabels` 的避障结果**
  - 位置：[wireRoutes.js](../src/layout/wireRoutes.js#L114-L116)、[L161-L191](../src/layout/wireRoutes.js#L161-L191)、[L237-L244](../src/layout/wireRoutes.js#L237-L244)、[wireLabelPlacement.js](../src/layout/wireLabelPlacement.js)
  - 现象：`placeWireLabels` 会把所有标签沿垂直方向偏移 ≥ 5px 避开导线和障碍节点，但 `wireRoutes.js` 的 `isPointOnSegments` 要求点到线段距离 `<= 0.01`，几乎 100% 判定失败并丢弃避障坐标，退回到不做任何碰撞检查的 `chooseLabelPoint`；此外 `splitSegmentsAtJunctions` 读取 `segment.orientation`，但上游 `mergeSegments` 已将该字段剥离，使水平线分段排序失效。

- [x] **B19 · [High] `MeasuredAnchorLayoutProvider` 对带独立偏移的 `inout` 端口产出斜线并失败，且不支持 `NORTH`/`SOUTH` 端口**
  - 位置：[measured_anchor_layout.js](../src/layout/measured_anchor_layout.js#L44-L48)、[L71-L72](../src/layout/measured_anchor_layout.js#L71-L72)、[p3_ordering.js](../src/layout/anchor_layered/p3_ordering.js)
  - 现象：未像 `measured_elk_layout.js` 那样将 `inout` 端口拆分为 `source` 与 `target` 角色，`ports` 仅按 `target` 偏移发射，随后 `L71` 又用 `source` 偏移强行改写起点，导致首段斜线并校验失败（`unroutable`）；此外 `top`/`bottom` 端口的 `borderOffset` 被硬编码为 `0` 且 `p3_ordering.js` 遇到 `NORTH`/`SOUTH` 会直接抛出 `unsupported-flat-port-side`。

- [x] **B20 · [High] Native Layout Worker 违反错误日志规范并存在 Promise 挂起风险**
  - 位置：[native_layout_worker.js](../src/layout/native_layout_worker.js#L3-L10)、[native_layout_execution.js](../src/layout/native_layout_execution.js#L33-L46)
  - 现象：Worker `catch` 未序列化 `error.cause`（不符合 `AGENTS.md` 跨 Worker 保留栈与 cause 要求），未防御非 `Error` 抛出或 `error.diagnostic` 触发 `DataCloneError`；主线程 `onmessage` 未对 `data` 判空（若 `data` 为空则异常逃逸导致 Promise 永不 settle），`worker.onerror` 丢弃 `filename`/`lineno`/`colno`/`event.error`。

- [x] **B21 · [Medium] `netTreeRouter` 空路由误报与 `MeasuredElkLayoutProvider` 单段截断（既有审计未修）**
  - 位置：[netTreeRouter.js](../src/layout/netTreeRouter.js)、[measured_elk_layout.js](../src/layout/measured_elk_layout.js)、[routing_pause_snapshot_and_code_audit.md](./routing_pause_snapshot_and_code_audit.md)
  - 现象：`usable.length === 0` 时 `buildNetTreeSegments` 错误返回 `reachableTargetCount: edges.length`，在 `layoutValidator` 中掩盖断连问题；`MeasuredElkLayoutProvider.getEdgePoints` 仅读取 `edge.sections[0]`，忽略 ELK 多段路由结果。

### Render、HTML 与 CSS
- [x] **B22 · [High] `svgExport.js` 时序徽标选择器失效且缺失大量节点/状态样式**
  - 位置：[svgExport.js](../src/render/svgExport.js#L4-L36)、[netlist_scene_presentation.js](../src/domains/netlist/netlist_scene_presentation.js)、[styles.css](../styles.css)
  - 现象：`netlist_scene_presentation.js` 输出的是 `<text class="timing-badge">`，而 `EXPORT_CSS` 编写的是 `.timing-badge rect` / `.timing-badge text`，匹配 0 个元素导致导出 SVG 的时序文字失去字号、颜色与白边描边；同时 `.pin-dot`/`.pin-critical` 与页面样式冲突，且缺少 `.node.constant`/`.implicit`/`.blackbox`/`.assign`/`.hub`/`.is-selected` 等规则。

- [x] **B23 · [Medium] `#comparePanel` CSS 优先级碰撞、`--danger` 未定义与 Compare 重复 DOM ID**
  - 位置：[styles.css](../styles.css)、[svg_scene_renderer.js](../src/render/svg_scene_renderer.js)
  - 现象：旧规则 `.compare-panel label:not(.alias-toggle)`（权重 `0,2,1`）覆盖了新规则 `.compare-config > label`（`0,1,1`）与 `.compare-config > .compare-orientation`（`0,2,0`），导致 Compare 工具栏中 A/B/Split 标签排版错位；`.module-hierarchy-cycle` 引用了未定义的 `var(--danger)`；所有 SVG 均硬编码 `id="schematicContent"`，Compare 双画布同时挂载时产生重复 DOM ID。

- [x] **B24 · [Medium] `svgRenderer.js` 缺少 `wireRoutes` 且无 `labelPoint` 时抛出 `TypeError`**
  - 位置：[svgRenderer.js](../src/render/svgRenderer.js#L53-L96)
  - 现象：当 `graph.wireRoutes` 为空直接回退 `graph.edges` 时，若某条未布线边满足 `showLabel !== false` 但缺少 `labelPoint`，`round(edge.labelPoint.x)` 会直接崩溃。

- [x] **B25 · [Low] `progressiveSvgRenderer.js` 小图快路径跳过 `options.isCurrent?.()` 检查**
  - 位置：[progressiveSvgRenderer.js](../src/render/progressiveSvgRenderer.js)
  - 现象：`total < threshold` 时同步写入 `mount.innerHTML` 前未校验 `options.isCurrent?.() === false`，与分批渐进路径行为不一致。

---

## 三、安全边界与多启动器（Node / Python / C++ / Tcl / Windows）缺陷

- [x] **S01 · [High] Node 启动器 `guard()` 在符号链接、Windows 大小写与 `.tmp.` 文件下保护失效**
  - 位置：[workbench_terminal.mjs](../tools/workbench_terminal.mjs#L14-L18)、[workbench_files.mjs](../tools/workbench_files.mjs)、[terminal_log.mjs](../tools/terminal_log.mjs)
  - 现象：`guard()` 未对 `state`、会话临时目录和日志目录做 `realpath`，在 Windows 下大小写敏感且漏掉了 `${state}.tmp.${pid}`。当 `--browse-root` 覆盖状态文件或系统临时目录时，文件读取/导出可能越界访问 `state.json`（暴露控制通道路径与 owner token）。

- [x] **S02 · [High] Node 静态资源服务在仓库路径经过 symlink 时全站返回 403**
  - 位置：[serve.mjs](../tools/serve.mjs#L27)、[L119-L121](../tools/serve.mjs#L119-L121)
  - 现象：`root` 仅用 `resolve` 未用 `realpath`，而第 120 行对 `filePath` 调用 `realpath`，导致在 Linux NFS/软链目录或 macOS 下 `relative(root, canonical)` 以 `..` 开头，所有静态资源全部返回 `403 Forbidden`（对比 [serve.py](../tools/serve.py#L73) 正确使用了 `canonical(ROOT)`）；同时第 120 行先于 `runtimeAsset` 白名单执行 `realpath`，造成仓库内非资源文件的 404/403 存在性探测。

- [x] **S03 · [High] Node Windows 命名管道与 IPC 客户端缺少对端身份（SID / PID / UID）校验**
  - 位置：[workbench_terminal.mjs](../tools/workbench_terminal.mjs#L15)、[workbench_ipc.mjs](../tools/workbench_ipc.mjs)、[launcher-state.mjs](../tools/launcher-state.mjs)
  - 现象：Node 在 Windows 使用默认 DACL 创建命名管道且未校验客户端 SID（对比 Python 已使用 `ImpersonateNamedPipeClient` + `EqualSid`）；`workbench_ipc.mjs` 连接控制端时未校验服务器进程 PID/UID；`launcher-state.mjs` 在 Windows/macOS 直接轻信管道对端返回的 JSON `identity`。

- [x] **S04 · [High] Native C++ `WorkbenchCli`（`cmd`）跳过 `SO_PEERCRED` 校验**
  - 位置：[WorkbenchTransport.h](../native/launcher/WorkbenchTransport.h#L307-L315)
  - 现象：`WorkbenchCall(path, body, expectedPid = 0)` 仅在 `expectedPid != 0` 时校验 `SO_PEERCRED`，而 `WorkbenchCli` 明明读取了含 `pid` 的状态文件，调用时却传入默认 `expectedPid = 0`（且未校验状态字段合法性），将命令与 `--stdin` 负载发往未验证身份的 Unix Socket。

- [x] **S05 · [High] Native C++ `makeOwnerToken()` 泄漏栈 ASLR 地址且非加密随机**
  - 位置：[main.cpp](../native/launcher/main.cpp#L312-L318)、[WorkbenchFiles.h](../native/launcher/WorkbenchFiles.h)
  - 现象：`makeOwnerToken()` 直接拼接 `getpid()`、`std::time(0)` 与局部变量地址 `&output` 写入 `state.json`，暴露进程栈 ASLR 基址且可预测，而同目录的 `WorkbenchFiles.h` 已实现基于 `getrandom` 的 `ngb::WorkbenchToken()`。

- [x] **S06 · [High] Tcl `::ngb::Start` 漏拦截 `2>` 管道重定向注入**
  - 位置：[ngb.tcl](../tools/eda/ngb.tcl#L32-L41)、[L77](../tools/eda/ngb.tcl#L77)
  - 现象：`::ngb::Start` 用 `regexp {^[<>|&]} $value` 检查参数，漏掉了会被 Tcl `open` 解释为 stderr 重定向的 `2>` / `2>>` / `2>@`（而 `::ngb::Connect` 第 77 行已拦截 `^(2?>|[<|&])`）；同时第 36 行遗漏了对 `--browse-root` 的 `file normalize`。

- [x] **S07 · [Medium] Native C++ `WorkbenchBroker.h` 批处理断连竞态与跨页校验缺失**
  - 位置：[WorkbenchBroker.h](../native/launcher/WorkbenchBroker.h)
  - 现象：`PrepareFiles` 释放锁读盘期间若页面断开并清空句柄表，后续文件会在 `try` 块外查找 `m_pathsByHandle` 误抛 `ACCESS_DENIED` 而非正常取消；`picker-files` 在重获锁后未复核 `!p.m_online || p.m_connection != connection`；`import` 与 `picker-files` 均未拦截指向其他页面的 `--page`。

- [x] **S08 · [Medium] Native C++ `WorkbenchTransport.h` HTTP 解析缺陷与 `.tmp.` 状态文件保护缺失**
  - 位置：[WorkbenchTransport.h](../native/launcher/WorkbenchTransport.h)、[WorkbenchFiles.h](../native/launcher/WorkbenchFiles.h)
  - 现象：`ReadWorkbenchRequest` 未拒绝 `Transfer-Encoding`、`content-type` 仅前缀匹配、`std::stoull` 未拒尾随字符、JSON 解析传入整个缓冲而非精确长度、缺少 `EINTR` 重试；`WorkbenchFiles::Protected()` 遗漏了 `main.cpp` 创建的 `${stateFile}.tmp.${pid}`。

- [x] **S09 · [Medium] 四端（Node / Python / C++ / Windows）CLI 契约与错误码漂移**
  - 位置：[main.cpp](../native/launcher/main.cpp)、[launcher-state.mjs](../tools/launcher-state.mjs)、[serve.py](../tools/serve.py)、[workbench_service.py](../tools/workbench_service.py)
  - 现象：缺失 state 文件执行 `status` 时 Node/Python 输出 `status=stopped` 并退出 `0`，C++ 报错退出 `2`；C++ `stop` 成功无输出而 Node/Python 输出 JSON + `status`；Node 在 Windows 上 `stop` 直接强杀进程导致 `%TEMP%\ngb-session-*` 泄漏；stopping 状态错误码三端各异（`SERVER_STOPPING` / `SERVICE_STOPPING` / 无守卫）。

- [x] **S10 · [Medium] `build-windows-release.ps1` 冒烟测试存在管道缓冲死锁风险**
  - 位置：[build-windows-release.ps1](../tools/build-windows-release.ps1)
  - 现象：重定向了 `NetlistGraphBuilder.exe` 的 stdout 和 stderr，但未在等待退出前异步读取流，一旦子进程启动日志超过操作系统管道缓冲区（约 4 KB）就会永久阻塞直到超时。

---

## 四、性能瓶颈与未闭环验收项

- [x] **P01 · [High] 真实综合网表 `dp_020_mapped.v` 布局耗时 20.4s 且峰值堆达 1,592 MiB**
  - 位置：[dp_020_mapped.v](../tests/fixtures/mapped/datapath/dp_020_mapped.v)、[code_review_2026_11_08_algorithms.md](./code_review_2026_11_08_algorithms.md#L10)
  - 现象：实测 `dp_020_mapped.v`（3,762 cells / 5,695 nodes / 11,398 edges）在默认 `AnchorLayered` 下耗时 **20,393 ms**、峰值堆 **1,592 MiB**（较历史记录的 578 MiB 显著上涨），且 network simplex 达到 2,100 次迭代上限提前中止，交叉数高达 460 万。

  - 修复实测见 [验收记录](plans/issue_remediation_acceptance_2026_11_25.md)。原始报告在忽略目录 `dc_runs/issue_remediation_2026_11_25/dp_020_profile_summary.json`，分别记录校验后的堆读数、GC 前最高观测值和进程 RSS。

- [x] **P02 · [High] 4K 全图前端交互恢复验收未通过，且 `sop_015` 浏览器首帧挂载超时**
  - 位置：[frontend_interaction_performance_2026_11.md](./plans/frontend_interaction_performance_2026_11.md#L277)、[L330-L352](./plans/frontend_interaction_performance_2026_11.md#L330-L352)
  - 现象：Windows Chrome 下 4K 全图缩放恢复代理为 **299.5 ms**（较基线退化 23.1ms）、平移恢复 **170.0 ms**，均未达到 100 ms 目标；`sop_015` 在 90s 预算内停在 `Rendering 43,800/44,248` 超时；P5 按视口裁剪方案尚停留在试验结论，未启用。

  - 五轮恢复记录、手势内保存次数、完成态几何及真实挂载时间见[验收记录](plans/issue_remediation_acceptance_2026_11_25.md#4-本次实测记录)。

- [x] **P03 · [High] `parseDotSource` 词法扫描每 token 切片全剩余文本（`O(N × T)`）**
  - 位置：[dot_parser.js](../src/domains/aig/dot_parser.js)
  - 现象：每个未加引号标识符/数字都执行 `text.slice(index).match(...)` 复制剩余全文，大 ABC DOT 文件（上限 16 MiB）出现明显二次方退化（未复用带 `lastIndex` 的 `/y` 粘性正则）。

- [x] **P04 · [Medium] `routing_split.js` 分裂循环全量重建依赖图与区间树（最坏 `O(S² log S)`）与爆栈风险**
  - 位置：[routing_split.js](../src/layout/anchor_layered/routing_split.js)、[routing_dependencies.js](../src/layout/anchor_layered/routing_dependencies.js)、[network_simplex.js](../src/layout/anchor_layered/network_simplex.js)、[p3_ordering.js](../src/layout/anchor_layered/p3_ordering.js)
  - 现象：循环内每次分裂都重新校验、排序、`JSON.stringify` 并重建整张边界的依赖与区间树，且反复 `.filter()` 全表扫描；`network_simplex.js` 与 `p3_ordering.js` 使用 `Math.min(...ranks.values())` 展开全部节点层级，超大连通分量存在调用栈溢出风险。

- [x] **P05 · [Medium] `localRouteCandidates.js` 每次增量重布线全量扫描节点（`O(R × N)`）且空间索引墓碑累积**
  - 位置：[localRouteCandidates.js](../src/layout/localRouteCandidates.js)、[spatialIndex.js](../src/layout/spatialIndex.js)
  - 现象：`iterateLocalDetours` 与 `iterateOuterLanes` 在每条重布线边上均调用 `getNodeVerticalBounds(nodes)` 做 `O(N)` 扫描；`RouteSegmentIndex.removeOwner()` 仅记录 `inactiveSegments` 墓碑而不清理分桶数组，反复 `replaceOwner` 会导致分桶持续膨胀。

- [x] **P06 · [Medium] `buildSchematicGraph` 多文件设计下逐单元线性扫描模块列表（`O(C × M)`）**
  - 位置：[graph.js](../src/netlist/graph.js)
  - 现象：`resolveReferencedModule` 在设置 `ownerModule.sourceFile` 后对每个 cell 调用 `moduleList.find(...)` 线性扫描，未建立类似 `module_hierarchy.js` 的 `O(1)` 同文件索引映射。

- [x] **P07 · [Medium] `timingAnnotation.js` 跨 scope 重复执行 DFS 与循环内新建 `RegExp`**
  - 位置：[timingAnnotation.js](../src/timing/timingAnnotation.js)
  - 现象：`selectModuleRecords` 为每个 scope key 重复运行最多 4,000 步的层次路径 DFS；`matchOccurrencePrefixes` 产生 `O(R × P)` 惰性正则扫描；`matchesModuleWrapper` 在 `.filter()` 循环内反复编译 `new RegExp`；`getOrderedTimingPins` 使用 `includes` 形成 `O(P²)`。

- [x] **P08 · [Low] 从 AIG 切回 Netlist 时完整 Verilog 源码被解析两次**
  - 位置：[domain_workbench.js](../src/app/domain_workbench.js#L648-L651)
  - 现象：路由 `loadDesign` / `loadQuickInputText` 时，先调用 `registry.require("netlist").importSource(...)` 预校验解析一遍，随后再放行给 `loadDesign` 重新解析一遍，大网表切换存在冗余耗时。

---

## 五、架构债、错误日志缺口与仓库卫生

- [x] **A01 · [Medium] 应用入口与控制器逼近行数天花板，`domain_workbench.js` 与 `timingAnnotation.js` 膨胀**
  - 位置：[main.js](../src/app/main.js)、[inspector_controller.js](../src/app/inspector_controller.js)、[compare_workspace_controller.js](../src/app/compare_workspace_controller.js)、[focused_roots_controller.js](../src/app/focused_roots_controller.js)、[input_controller.js](../src/app/input_controller.js)、[domain_workbench.js](../src/app/domain_workbench.js)、[timingAnnotation.js](../src/timing/timingAnnotation.js)、[architecture-boundaries.test.js](../tests/unit/architecture-boundaries.test.js#L10-L17)
  - 现象：`main.js` 达 418/420 行，`inspector_controller.js`（516）、`compare_workspace_controller.js`（502）、`focused_roots_controller.js`（500）、`input_controller.js`（492）均紧贴 520 行预算；`domain_workbench.js` 达 700 行且因命名非 `_controller.js` 绕过了架构行数检查，内部硬编码了大量 AIG DOM ID 与流程；`timingAnnotation.js` 单文件长达 1,724 行，维护耦合度高。

- [x] **A02 · [Medium] 已退役 `groupCollapse` 运行时残留与 mapped 脚本默认值漂移**
  - 位置：`src/analysis/groupCollapse.js`、[netlist_graph_projection.js](../src/domains/netlist/netlist_graph_projection.js)、[netlist_feature.js](../src/domains/netlist/netlist_feature.js)、[selection_navigation_controller.js](../src/app/selection_navigation_controller.js)、[test-mapped-cases.mjs](../tools/test-mapped-cases.mjs#L14-L16)
  - 现象：虽然产品已退役分组折叠，但 `collapseLargeGroups` / `expandedGroupIds` 仍渗透在 7 个控制器端口、工作区构建与 `netlist_graph_projection.js` 中，且 `selection_navigation_controller.js` 保留死提示分支；`tools/test-mapped-cases.mjs` 未设置环境变量时默认仍以折叠模式运行，且忽略 `--no-collapse` CLI 参数（与 `test-one-mapped-case.mjs` 不一致）。

- [x] **A03 · [Low] 错误日志规范（`SKILLS_AND_RULES.md` §7）局部缺口**
  - 位置：[inspector_tabs_controller.js](../src/ui/inspector_tabs_controller.js#L174-L176)、[workbench_transport.py](../tools/workbench_transport.py)、[main.cpp](../native/launcher/main.cpp)、[SKILLS_AND_RULES.md](./SKILLS_AND_RULES.md#L76-L113)
  - 现象：Inspector 复制名称失败走空 `catch {}` 未向 Process Log 记录 `details.error`；Python `workbench_transport.py` 仅记录 `op == "list"` 失败，遗漏 `picker-files` 的 `workbench.files_failed`；C++ `main.cpp` 在 HTTP 边界捕获 `list`/`picker-files` 失败仅回 HTTP 400，未写入 `TerminalLog`。

- [x] **A04 · [Low] 冻结代码体量占比过半与五语言远程协议维护负担**
  - 位置：[channelCapacity.js](../src/layout/channelCapacity.js)、[simpleOrthogonalRouter.js](../src/layout/simpleOrthogonalRouter.js)、[workbench_commands.json](../src/contracts/workbench_commands.json)
  - 现象（仅作只读评估，遵守 Simple 永久冻结规则）：Simple 专属的 25 个模块（含 `src/layout/layered/` 11 文件与 `channelCapacity.js` 等）合计 8,715 行，占整个 `src/layout/` 的 **52%**；此外远程工作台 182 条命令的边界与协议需在 Node、Python、C++17、C#、Tcl 五套实现间手工保持一致，极易再次产生协议漂移。

- [x] **A05 · [Medium] 工作树换行符大面积漂移（138 个 CRLF + 4 个混合换行文件）**
  - 位置：[`.gitattributes`](../.gitattributes)、[`.editorconfig`](../.editorconfig)、[terminal_log.sh](../tools/terminal_log.sh)、[run_oracle.sh](../tools/research/elk_phase_oracle/run_oracle.sh)
  - 现象：仓内配置明确要求全仓 `eol=lf`，但工作树当前有 138 个受跟踪文件为 CRLF、4 个为 mixed（包括 2 个 Linux Shell 脚本 `terminal_log.sh` 与 `run_oracle.sh`），直接拷贝到 Linux 环境运行 `.sh` 会因 `\r` 报错；`.gitattributes` 仍保留不存在的 `*.ts`/`*.tsx`/`*.jsx` 规则而漏掉 `*.mjs`/`*.py`/`*.sh`。

- [x] **A06 · [Medium] 文档路线图失真与过时排障文档堆积**
  - 位置：[PLAN.md](./PLAN.md#L90)、[STAGE_8_PLAN.md](./STAGE_8_PLAN.md#L3)、[routing_pause_snapshot_and_code_audit.md](./routing_pause_snapshot_and_code_audit.md)
  - 现象：`docs/PLAN.md` 仍将已完整上线并配有 UI/测试/基准的 Stage 5（`R5-1` 可选 Liberty `.lib`）标为“计划中”；`docs/STAGE_8_PLAN.md` 头部仍标注 `2026-09-14` 且未合入最新现状；`docs/` 顶层仍堆放 7 份 2026-09 Simple 冻结前的暂停/重启/调查文档（合计超 150 KB）。

- [x] **A07 · [Low] `index.html` 语言混杂、快捷键文案不一致与无障碍属性缺口**
  - 位置：[index.html](../index.html#L114)、[L130-L168](../index.html#L130-L168)、[L216-L252](../index.html#L216-L252)
  - 现象：`<html lang="en">` 下多个对话框混用英文标题按钮与中文提示/占位符；前进历史按钮 tooltip 写 `Ctrl+Shift+Z / Alt+Right`，而 `#helpDialog` 写 `Ctrl+Y / Alt+Right`；Single 时序输入接受 `.sta`，Compare 两侧输入遗漏 `.sta`；Navigator 的 `role="tab"` 按钮缺少 `aria-controls` 且面板容器缺少 `role="tabpanel"`。

- [x] **A08 · [Low] 孤立死模块与未引用工具脚本**
  - 位置：`src/layout/nodePlacement.js`
  - 现象：`src/layout/nodePlacement.js` 在 `src/`、`tests/`、`tools/` 中均无引用；`tools/` 下有 14 个早期独立基准/Liberty 验证脚本未接入 `package.json` 或测试链路。

- [x] **A09 · [Low] 本地被忽略目录杂物累积**
  - 位置：[`.gitignore`](../.gitignore)
  - 现象：虽未纳入 Git 跟踪，但本地工作目录累积了 `dist/`（76 个解压包目录 + 177 个归档文件）、误生成的 `%SystemDrive%/`、2026-07 遗留的 `node-preview-smoke.*.log`、临时目录 `mytest/` 与 Python `__pycache__/`。
