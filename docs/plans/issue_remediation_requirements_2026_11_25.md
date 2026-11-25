# 项目问题修复需求拆分（2026-11-25）

> 对应问题清单：[project_issue_list_2026_11_25.md](../project_issue_list_2026_11_25.md)（基线 `7dc7c6c`）
> 配套文档：[修复方案路线](./issue_remediation_roadmap_2026_11_25.md) · [验收标准文件](./issue_remediation_acceptance_2026_11_25.md)

## 1. 全量追溯矩阵（55 项问题 → 22 个需求包 + 1 项冻结边界）

| 需求 ID | 所属波次 | 优先级 | 关联 Issue IDs | 主题 | 验收编号 |
| --- | --- | --- | --- | --- | --- |
| `REQ-01` | Wave 0 | P0 | `B01` | 多文件设计 View History 与页面退出保存修复 | `AC-01` |
| `REQ-02` | Wave 0 | P0 | `W01`, `W02`, `W03` | `7dc7c6c` Compare 交互与远程事务闭环 | `AC-02` |
| `REQ-03` | Wave 1 | P0 | `B02`, `B03`, `B05` | Verilog 属性、转义标识符冲突与未支持语法诊断 | `AC-03` |
| `REQ-04` | Wave 1 | P0 | `B04`, `P06` | 位宽展开有界保护、转义标量保留与多文件模块索引 | `AC-04` |
| `REQ-05` | Wave 2 | P0 | `B06`, `B08`, `B09` | 时序多单位处理、带注释 JSON 与转义/CSV 解析修复 | `AC-05` |
| `REQ-06` | Wave 2 | P0 | `B07`, `B10`, `B11`, `P07` | 别名线网时序确定性、引脚归一化与正则/DFS 性能 | `AC-06` |
| `REQ-07` | Wave 2 | P0 | `B12`, `B13`, `B14` | 跨层投影 ID 修复、数值深度优先队列与多 bit 端口上溯 | `AC-07` |
| `REQ-08` | Wave 2 | P1 | `B15`, `B16`, `B17`, `P03`, `P08` | AIG 边界映射名、Golden 严格数值校验、DOT `/y` 分词与双解析消除 | `AC-08` |
| `REQ-09` | Wave 3 | P0 | `B18`, `B21` | `wireRoutes` 标签避障保留、`orientation` 补全与 ELK/树路由修补 | `AC-09` |
| `REQ-10` | Wave 3 | P0 | `B19`, `P04`, `P05` | AnchorLayered `inout`/`NORTH`/`SOUTH` 端口与增量局部路由性能 | `AC-10` |
| `REQ-11` | Wave 3 | P0 | `B20` | Native Layout Worker 错误保留（`cause`）与空消息防挂起 | `AC-11` |
| `REQ-12` | Wave 3 | P0 | `B22`, `B23`, `B24`, `B25` | SVG 导出时序徽标、Compare CSS 冲突/重复 ID 与空点防护 | `AC-12` |
| `REQ-13` | Wave 4 | P0 | `S01`, `S02`, `S03` | Node 启动器 `realpath` 守卫、静态服务软链兼容与 IPC 身份校验 | `AC-13` |
| `REQ-14` | Wave 4 | P0 | `S04`, `S05`, `S07`, `S08` | Native C++ `SO_PEERCRED`、随机 Token、Broker 竞态与 HTTP 解析加固 | `AC-14` |
| `REQ-15` | Wave 4 | P0 | `S06` | Tcl `::ngb::Start` `2>` 重定向注入防护与路径规范化 | `AC-15` |
| `REQ-16` | Wave 4 | P1 | `S09`, `S10`, `A03` | 四端 CLI 协议对齐、Windows 构建流防死锁与错误日志补齐 | `AC-16` |
| `REQ-17` | Wave 5 | P1 | `A01` | 应用控制器瘦身、`domain_workbench.js` 纳管与 `timingAnnotation.js` 拆分 | `AC-17` |
| `REQ-18` | Wave 5 | P1 | `A02` | `groupCollapse` 运行时残留清理与 `test-mapped-cases.mjs` 参数修复 | `AC-18` |
| `REQ-19` | Wave 5 | P2 | `A05`, `A08`, `A09` | 全仓 CRLF 换行符独立归一化、死代码/无引用脚本清理与杂物治理 | `AC-19` |
| `REQ-20` | Wave 5 | P2 | `A06`, `A07` | 规划文档状态同步、`docs/` 历史归档与 `index.html` UI/A11y 一致性 | `AC-20` |
| `REQ-21` | Wave 6 | P1 | `P01` | `dp_020_mapped.v` 峰值堆回归定位与布局迭代/内存收敛 | `AC-21` |
| `REQ-22` | Wave 6 | P1 | `P02` | 4K 全图手势结束恢复（≤ 100ms）与 `sop_015` 挂载超时治理 | `AC-22` |
| *冻结/范围外* | — | — | `A04` | Simple 25 模块永久冻结（只读）；五语言启动器长期架构合并暂不立项 | — |

---

## 2. 逐项需求规格

### Wave 0：近期遗漏与多文件阻断止血

#### `REQ-01`：多文件设计 View History 与页面退出保存修复
- **基本信息**：Wave 0 · 优先级 P0 · 对应问题 `B01` · 前置依赖：无
- **目标**：让多文件追加/合并网表（`design add`、`compare design`、多文件拖放、多文件恢复）与单文件一样正常写入 `ViewHistory` 并在 `beforeunload` 时持久化最终快照。
- **涉及文件**：[input_controller.js](../../src/app/input_controller.js)、[history_controller.js](../../src/app/history_controller.js)、[main.js](../../src/app/main.js)、[session_persistence_controller.js](../../src/app/session_persistence_controller.js)、[appState.js](../../src/app/appState.js)
- **改动方案**：
  1. 在 [appState.js](../../src/app/appState.js) 或共享窄辅助函数导出 `hasLoadedDesignSource(state)`（判定 `Boolean(state?.currentSource || state?.sourceFiles?.length)`），与 `session_persistence_controller.js` 保持一致。
  2. 在 `historyPorts.state` 中补声明 `"sourceFiles"`，将 `history_controller.js` `recordViewHistory()` 的前置检查改为 `!hasLoadedDesignSource(state) || !state.currentModule || state.restoringViewHistory`。
  3. 将 `main.js` 中 `getSessionSnapshot` 的门控条件改为 `hasLoadedDesignSource(state) ? createSessionSnapshot(state) : null`（不增加 `main.js` 行数或抽离辅助后保持 ≤ 420 行）。
- **错误日志与失败路径**：多文件恢复或历史回放失败时复用既有 `persistence` / `navigation` 边界记录 `details.error` 与 `sourceFiles.length`、`moduleName`；空设计仍静默返回 `null`，不产生假警告。
- **明确不做**：不改动单/多文件源文本在 `sessionStorage` 的存储容量策略与 `sourceIdentity` 生成格式。

#### `REQ-02`：`7dc7c6c` Compare 交互与远程事务闭环
- **基本信息**：Wave 0 · 优先级 P0 · 对应问题 `W01`, `W02`, `W03` · 前置依赖：建议与 `REQ-01` 同波交付
- **目标**：使 Compare 下的 Port 选区、`Focused root chip` 点击、以及远程 `compare split` 命令与 `index.html` 的“port, cell or net”语义及历史事务完全一致。
- **涉及文件**：[focus_navigation_controller.js](../../src/app/focus_navigation_controller.js)、[focused_roots_controller.js](../../src/app/focused_roots_controller.js)、[view_controls_controller.js](../../src/app/view_controls_controller.js)、[remote_design_commands.js](../../src/app/remote_design_commands.js)、[remote_navigation_commands.js](../../src/app/remote_navigation_commands.js)、[workbench_controllers.js](../../src/app/workbench_controllers.js)
- **改动方案**：
  1. `W01`：扩展 `zoomToCompareSelection()` 支持 `selectedKind === "port"`（复用与 `inspector_controller.js` `findCompareNode(graph, "port", selectedName)` 一致的节点定位逻辑，尊重 `selectionSynchronized` 开关）；在 `focused_roots_controller.js` 更新 `Focus selected` 按钮可用性使 Compare Port 选中时可聚焦定位（但不允许将 Port 加为 Focused root）。
  2. `W02`：在 `focused_roots_controller.js` `activateCompareFocusedRoot()` 调用 `setCompareTransform(context.side, transform, false)` 禁止把单侧裸视口坐标直接同步到对侧；检查 `focused_roots_controller.js` 与 `view_controls_controller.js` 复位变换时，当 `focusedRootsSynchronized === false` 时仅重置活动侧而非无条件重置对侧。
  3. `W03`：在 `remote_design_commands.js` 或 `workbench_controllers.js` 的 `compareSettings.layout` 路径包裹 `runViewHistoryTransaction({ label: "Compare orientation" }, ...)`，与前端 `compareLayoutSelect` 对齐。
- **错误日志与失败路径**：非 Compare 状态执行远程 `compare split` 维持既有 `DOMAIN_MISMATCH` 异常并按原边界记录；缺失目标节点时只返回定位失败状态文本，不报错。
- **明确不做**：不修改 Compare 双侧匹配/对齐高亮算法与跨模块拓扑差异统计逻辑。

---

### Wave 1：Parser 与 Netlist IR 安全加固

#### `REQ-03`：Verilog 属性、转义标识符冲突与未支持语法诊断
- **基本信息**：Wave 1 · 优先级 P0 · 对应问题 `B02`, `B03`, `B05` · 前置依赖：无
- **目标**：彻底消除 `verilogParser.js` 对结构化语句的静默吞并，确保转义标识符合法通过、不支持的语法给出精确定位诊断。
- **涉及文件**：[verilogParser.js](../../src/parser/verilogParser.js)
- **改动方案**：
  1. `B02`：在词法或语句边界显式识别 Verilog-2001 属性块 `(* ... *)`（跳过平衡配对的 `(*` 到 `*)`，保留其后紧跟的 `module` / `port` / `wire` / `assign` / `cell` 正常解析，或按 `unsupported-attribute` 产生位置诊断而不破坏下一条语句）。
  2. `B03`：修改 `peekValue`、`matchValue`、`consumeUntilValue`、`DECLARATION_QUALIFIERS` 判定及 `isRangeToken`，仅当 `!token.escaped` 且为普通词法 token 时才按关键字/修饰符/方括号范围匹配，确保 `\wire `、`\reg `、`\input `、`\signed `、`\endmodule ` 等转义名称按普通标识符解析。
  3. `B05`：对位置参数端口连接 `cell inst(y, a, b);`、参数化模块头 `#(parameter ...)`、`wire a = b;` 内联赋值、以及独立 `reg`/`logic`/`supply0`/`supply1` 声明发出带行列/模块上下文的结构化 `diagnostics`（明确 `unsupported-positional-ports`、`unsupported-parameter-list` 等诊断码），同时清理 `bindModuleAttributeComments` 死代码与多余扫描。
- **错误日志与失败路径**：`verilogParser` 保持纯结构性无副作用，按既有 `diagnostics[]` 返回 `code`、`moduleName`、源码 `span`；工作区导入边界负责把严重解析错误（`error`）或部分兼容告警（`warning`）汇总写入 Process Log（含 `fileName`、`diagnostics` 样本计数），保持同文件内其他正常模块可浏览。
- **明确不做**：不在 parser 层实现完整行为级 Verilog 或参数求值展开；不改变模块 IR 基础数据结构形态。

#### `REQ-04`：位宽展开有界保护、转义标量保留与多文件模块索引
- **基本信息**：Wave 1 · 优先级 P0 · 对应问题 `B04`, `P06` · 前置依赖：建议在 `REQ-03` 之后或同批
- **目标**：杜绝超大/非法位宽导致的无限循环与 OOM，修复转义标量网被误拆问题，消除多文件图构建时的 `O(C × M)` 模块查找瓶颈。
- **涉及文件**：[verilogParser.js](../../src/parser/verilogParser.js)、[model.js](../../src/netlist/model.js)、[graph.js](../../src/netlist/graph.js)
- **改动方案**：
  1. `B04`：参照 [liberty_model.js](../../src/infer/liberty_model.js) 引入命名最大位宽常量（如 `MAX_VECTOR_WIDTH`）及 `Number.isSafeInteger(msb) && Number.isSafeInteger(lsb)` 校验；超出安全整数或上限的位宽停止展开，保留整体引用并输出结构化诊断，防止死循环与 OOM。
  2. `B04`：在 `verilogParser.js` 为引脚连接引用保留 `escaped: Boolean(...)` 标记，`model.js` `expandReference` 与 `graph.js` `expandPortEndpoints` 当 `ref.escaped === true` 时禁止用正则 `/^(.*)\[(-?\d+):(-?\d+)\]$/` 拆分为向量。
  3. `P06`：在 `buildSchematicGraph` 进入 cell 遍历前建立按 `sourceFile` 分组的 `Map<sourceFile, Map<moduleName, Module>>`，将 `resolveReferencedModule` 的线性 `.find()` 优化为 `O(1)` 查表。
- **错误日志与失败路径**：位宽越界抛出或记录带 `moduleName`、线网名与位宽数值的结构化诊断，不崩溃整图；保留原有向量正常展开语义。
- **明确不做**：不改普通非转义向量 `[msb:lsb]` 的既有展开顺序与端口排序规则。

---

### Wave 2：时序、跨层追踪与 AIG 正确性及局部热点

#### `REQ-05`：时序多单位处理、带注释 JSON 与转义/CSV 解析修复
- **基本信息**：Wave 2 · 优先级 P0 · 对应问题 `B06`, `B08`, `B09` · 前置依赖：无
- **目标**：消除多时序文件合并时的静默单位混算、注释 JSON 必败以及含转义标识符/反斜杠文本的错误切分。
- **涉及文件**：[timingParser.js](../../src/timing/timingParser.js)、[timing_match_log.js](../../src/app/timing_match_log.js)（或调用方边界）
- **改动方案**：
  1. `B06`：在 `mergeTimingDatasets` 检测到 `units.size > 1`（如 `ns` 与 `ps` 并存，仅支持已知换算率时间单位）时，统一换算至公共目标单位（如首个有效单位或 `ns`），对无法换算的混杂单位产出 `warning` 诊断且标明涉及的 `fileName` 与 `units`；当 `valid.length === 1` 时同样补齐单文件记录与诊断的 `fileName` 归属。
  2. `B08`：`startsWithJsonObject` 判别为 JSON 时，若前面存在 `#`/`//` 注释行，则先安全剥离整行前导注释后再交给 `JSON.parse`（或明确注释 JSON 不支持位置并精准报错，推荐安全剥离前导整行注释以与判别函数语义一致）；在 `parseTimingJson` 对 `Array.isArray(modValue.points)` 发出明确格式诊断而非静默跳过。
  3. `B09`：统一抽取转义感知词法扫描工具，让 `stripInlineComment`、`hasUnquotedComma`、`splitCsvLine` 识别 `\... ` 转义标识符（不截断内部 `#`、不把内部逗号/引号误判为分隔符），并以连续反斜杠奇偶性判定转义，支持 `'` 与 `"` 成对引号。
- **错误日志与失败路径**：`timingParser` 保持纯数据输出 `diagnostics`；混合单位换算告警、JSON 格式错误（带行列与 `fileName`）由导入/应用边界按 [SKILLS_AND_RULES.md](../SKILLS_AND_RULES.md) 第 7 节记入 `timing` 阶段 Process Log，失败时保留此前已有时序挂载不被清空。
- **明确不做**：不改变旧版已废弃格式拒收策略，不耦合图或 DOM 对象。

#### `REQ-06`：别名线网时序确定性、引脚归一化与正则/DFS 性能
- **基本信息**：Wave 2 · 优先级 P0 · 对应问题 `B07`, `B10`, `B11`, `P07` · 前置依赖：`REQ-03`/`REQ-05`
- **目标**：确保时序标注在任意记录顺序下保持确定性、正确处理转义引脚与大小写敏感实例名，并消除重复层次 DFS 与循环编译正则开销。
- **涉及文件**：[timingAnnotation.js](../../src/timing/timingAnnotation.js)、[timing_diagnostics.js](../../src/timing/timing_diagnostics.js)
- **改动方案**：
  1. `B07`：`netTiming`、`pins`、`pinPoints` 内部收集改用 `Object.create(null)` 或 `Map`（对外导出边界保持兼容纯对象/无原型键名）；为 `netEntry` 补充 `.point` 字段；写入 `rootCanonicalNet` / `rootNormNet` 前分别校验 `isPreferredTimingRecord(record, netTiming[rootCanonicalNet])`，避免较松弛别名覆盖关键别名。
  2. `B10`：去掉 `rooted` 正则全局 `"i"` 标志（若仅模块前缀需兼容大小写，改用局部修饰或仅在模块前缀匹配层处理），对实例路径 `pathPattern` 严格保持 Verilog 大小写敏感；统一用连续反斜杠奇偶判定替代 `(?<!\\)/`。
  3. `B11`：统一 `addDriverCellPinTiming`、`tryCollectCellPin` 与 `findTimingPin` 对引脚名的 `normalizePinName` 键控，确保去重与徽标命中一致；`ambiguousNodeIds` 过滤 `directGroup` 时显式归入 `diagnostics.unresolvedGroup` 并从有效匹配计数扣减。
  4. `P07`：在 `selectModuleRecords` 对 `findOccurrencePathsToModule` 按 `(scopeKey, root)` 记忆化缓存；预编译 `matchesModuleWrapper` 正则与 `matchOccurrencePrefixes` 索引前缀；用 `Set` 取代 `getOrderedTimingPins` 的 `.includes()` `O(P²)` 查找。
- **错误日志与失败路径**：多驱动/歧义匹配产生带 `moduleName`、数量与有界样本的 `timing` 诊断，不遗漏因歧义被跳过的数据统计。
- **明确不做**：不改动 `timingAnnotation.js` 文件物理结构拆分（归入 `REQ-17`）以保持本次语义修复 diff 清晰。

#### `REQ-07`：跨层投影 ID 修复、数值深度优先队列与多 bit 端口上溯
- **基本信息**：Wave 2 · 优先级 P0 · 对应问题 `B12`, `B13`, `B14` · 前置依赖：`REQ-04`
- **目标**：修正跨层视图边的网络名称缺失、深层次（depth ≥ 10）BFS 截断乱序及子模块多位端口上溯丢失线网问题。
- **涉及文件**：[hierarchy_connectivity.js](../../src/domains/netlist/hierarchy_connectivity.js)
- **改动方案**：
  1. `B12`：`projectHierarchicalRenderGraph` 先通过 `idMap.get(edge.source)` / `idMap.get(edge.target)` 得到重映射后 ID，再用重映射 ID 查询 `nodeById`，恢复真实的 `edge.net` 标签。
  2. `B13`：`analyzeHierarchicalCone` 改为数值型比较 `left.depth - right.depth`（紧跟其余字段字典序 tie-break），并改用按整数 `depth` 分桶或最小二叉堆替代每轮 `queues.sort(...) + queues.shift()`，将队列调度从 `O(Q² log Q)` 降至 `O(Q log Q)` 或均摊 `O(1)`。
  3. `B14`：`followPortEndpoint` 遍历 `parentInstance?.pins.filter((item) => item.name === endpoint.localId)` 全量上溯多 bit / 拼接线网；边 ID 纳入 `link.relation` 去重；用结构化 occurrence path（或显式 root 标记）避免顶层名为 `"top"` 的实例与根发生碰撞；预先构建 `childModule` 端口 `Map` 替代嵌套 `.ports.find()`。
- **错误日志与失败路径**：命中循环实例、缺失模块定义、frontier/node 上限时保持已有明确 boundary 诊断，并在排序测试中验证置换不变性。
- **明确不做**：不改变“跨 module port 为零深度、真实逻辑 cell 消耗深度”的既定产品语义。

#### `REQ-08`：AIG 边界映射名、Golden 严格数值校验、DOT `/y` 分词与双解析消除
- **基本信息**：Wave 2 · 优先级 P1 · 对应问题 `B15`, `B16`, `B17`, `P03`, `P08` · 前置依赖：无
- **目标**：补齐 AIG/Golden/Show Path 边界正确性，消除大 DOT 分词 `O(N × T)` 与 AIG→Netlist 二次解析浪费。
- **涉及文件**：[aig_view_query.js](../../src/domains/aig/aig_view_query.js)、[aig_normalize.js](../../src/domains/aig/aig_normalize.js)、[dot_parser.js](../../src/domains/aig/dot_parser.js)、[layout_golden.js](../../src/domains/netlist/layout_golden.js)、[show_path.js](../../src/domains/netlist/show_path.js)、[reconvergence_worker.js](../../src/domains/netlist/reconvergence_worker.js)、[domain_workbench.js](../../src/app/domain_workbench.js)
- **改动方案**：
  1. `B15`：`projectCut` 读取 `driver.primaryNameMapping` 时按 `ref?.name || ref?.signalId || ref?.label` 顺序取名，与 `aig_query.js` 一致。
  2. `B16`：`layout_golden.js` 中 `finiteNumber`、`positiveInteger`、`nonNegativeInteger` 显式拒绝 `null`、`""`（空白字符串）与 `boolean` 类型。
  3. `B17`：`aig_normalize.js` 在排序 `sourceRefs` 后再执行孪生节点 tie-break，并为常数归约补充 `requireAig(literals.length === 1, ...)`；`show_path.js` `addPathSideInputs` 优先保留 `edge.label || edge.net`；`reconvergence_worker.js` 补充 `if (!index) throw new Error("Analysis worker has no source model");` 明确异常。
  4. `P03`：`dot_parser.js` 使用复用型粘性正则（`/y` + `lastIndex = index`）替换 `text.slice(index).match(...)`。
  5. `P08`：`domain_workbench.js` 切换回 Netlist 时避免重复调用全量解析，或仅对头部/轻量验证或在 `loadDesign` 前保留一次性验证但传递已解析结果 / 错误时由 `loadDesign` 自己安全拒绝并保留 AIG 状态。
- **错误日志与失败路径**：`reconvergence_worker.js`、`dot_parser.js` 与 `domain_workbench.js` 切换失败均按现有诊断通道保留原错误与上下文（`domainId`、`fileName`）并保持当前视图不破坏。
- **明确不做**：不改动 BLIF/DOT 的语法支持子集或 `aig_level` 计算规则。

---

### Wave 3：活跃布局路由、Worker 边界与渲染导出

#### `REQ-09`：`wireRoutes` 标签避障保留、`orientation` 补全与 ELK/树路由修补
- **基本信息**：Wave 3 · 优先级 P0 · 对应问题 `B18`, `B21` · 前置依赖：Wave 1/2
- **目标**：让 `placeWireLabels` 产出的无碰撞标签坐标在 `wireRoutes.js` 中真正生效，修复遗留审计中的空线网树误报与 ELK 多段路由截断。
- **涉及文件**：[wireRoutes.js](../../src/layout/wireRoutes.js)、[wireLabelPlacement.js](../../src/layout/wireLabelPlacement.js)、[netTreeRouter.js](../../src/layout/netTreeRouter.js)、[measured_elk_layout.js](../../src/layout/measured_elk_layout.js)、[positionedRouting.js](../../src/layout/positionedRouting.js)
- **改动方案**：
  1. `B18`：**严格隔离 Simple**：为 `buildWireRoutes` / `refreshWireRouteLabels` 增加显式选项（如 `allowOffsetLabels: true`，默认 `false` 或由 `AnchorLayered`/`ELK`/`positionedRouting` 传入 `true`；Simple 不传该选项，保持冻结行为）。当开启时，`isPointNearSegments` 允许匹配沿某线段投影落在线段长度范围内且垂直偏移在合理标签避障范围内的坐标，或由 `placeWireLabels` 同步附带 `labelSegmentAnchor` 让 `wireRoutes` 校验锚点落在线段上同时保留 `labelPoint` 避障坐标。
  2. `B18`：`splitSegmentsAtJunctions` 直接根据 `Math.abs(segment.start.y - segment.end.y) <= GEOMETRY_EPSILON` 判断水平/垂直方向，不再依赖已被 `mergeSegments` 剥离的 `segment.orientation`。
  3. `B21`：`netTreeRouter.js` 当 `usable.length === 0` 时返回 `reachableTargetCount: 0`（若 Simple 存在依赖旧数字的冻结检查，通过 `options.reportEmptyAsUnreachable` 仅在活跃检验路径开启）；`measured_elk_layout.js` `getEdgePoints` 遍历拼接 `edge.sections` 所有连续段的 `startPoint`/`bendPoints`/`endPoint` 并规范化去重共线点。
- **错误日志与失败路径**：未连接物理线网由 `layoutValidator.js` 精确记录 `wire-route-disconnected`；禁用坐标越界时安全回退到 `chooseLabelPoint`。
- **明确不做**：严禁改动 `simple*.js` 与任何改变 Simple 几何/路由状态/诊断的行为。

#### `REQ-10`：AnchorLayered `inout`/`NORTH`/`SOUTH` 端口与增量局部路由性能
- **基本信息**：Wave 3 · 优先级 P0 · 对应问题 `B19`, `P04`, `P05` · 前置依赖：Wave 2
- **目标**：修复 `MeasuredAnchorLayoutProvider` 对双向 `inout` 引脚产生斜线/`unroutable` 及 `NORTH`/`SOUTH` 端口报错问题，优化分裂路由与 Adjust 增量重布线的复杂度热点。
- **涉及文件**：[measured_anchor_layout.js](../../src/layout/measured_anchor_layout.js)、[p3_ordering.js](../../src/layout/anchor_layered/p3_ordering.js)、[routing_split.js](../../src/layout/anchor_layered/routing_split.js)、[routing_dependencies.js](../../src/layout/anchor_layered/routing_dependencies.js)、[network_simplex.js](../../src/layout/anchor_layered/network_simplex.js)、[localRouteCandidates.js](../../src/layout/localRouteCandidates.js)、[spatialIndex.js](../../src/layout/spatialIndex.js)
- **改动方案**：
  1. `B19`：在 `measured_anchor_layout.js` 对 `port.direction === "inout"` 参照 `measured_elk_layout.js` 按 `source`/`target` 双角色映射为独立端口条目，消除 `connectionOffsets` 差异导致的斜线与 `unroutable`；同时补齐 `top`/`bottom`（`NORTH`/`SOUTH`）端口的 `borderOffset` 计算（或明确支持 `p3_ordering.js` 跨侧端口位置排序而非抛 `unsupported-flat-port-side`）。
  2. `P04`：`routing_split.js` 避免在每轮 split 中全量重跑 `buildDependencies` 与全表 `.filter()`，改为仅在初次构建后局部增量更新受影响线段与依赖或复用已校验排序结果；`network_simplex.js` 与 `p3_ordering.js` 用显式循环计算最小 rank，替换 `Math.min(...ranks.values())`。
  3. `P05`：在 `localRouteCandidates.js` 单次 `applyPositionedOverrides` 周期内复用或预计算 `getNodeVerticalBounds(nodes)`；在 `RouteSegmentIndex` 积累超过阈值的 `inactiveSegments` 墓碑时自动触发惰性 `compact()`，防止长期反复 `replaceOwner` 导致桶膨胀。
- **错误日志与失败路径**：遇到真正无法布线或非法端口配置时抛出带结构化 `diagnostic` 的 `PhaseError`；不吞掉 `PhaseError` 详情。
- **明确不做**：不改动 `simple*.js` 及其专属放置/路由参数。

#### `REQ-11`：Native Layout Worker 错误保留（`cause`）与空消息防挂起
- **基本信息**：Wave 3 · 优先级 P0 · 对应问题 `B20` · 前置依赖：无
- **目标**：确保浏览器 Worker 异步布局异常完整透传 `name`、`message`、`stack`、`cause` 与结构化 `diagnostic`，且在异常响应下绝不挂起。
- **涉及文件**：[native_layout_worker.js](../../src/layout/native_layout_worker.js)、[native_layout_execution.js](../../src/layout/native_layout_execution.js)
- **改动方案**：
  1. `native_layout_worker.js`：引入递归有界序列化函数（如限深 4 层）提取 `error.name`、`error.message`、`error.stack`、`error.code`、`error.cause` 及克隆安全版 `error.diagnostic`；兼容非 `Error` 抛出值（字符串/数字/null）；对 `self.postMessage` 加 `try/catch` 兜底防止 `DataCloneError` 导致静默无回传。
  2. `native_layout_execution.js`：`onmessage` 对 `!data || typeof data !== "object"` 判空并返回明确错误 `finish(new Error(...))`，严禁未决异常逃出回调挂起 Promise；重建 `Error` 时恢复 `code` 与递归还原 `cause`；`worker.onerror` 保留 `event.filename`、`event.lineno`、`event.colno` 与 `event.error` 到新异常及 `cause`。
- **错误日志与失败路径**：直接满足 [SKILLS_AND_RULES.md](../SKILLS_AND_RULES.md) 第 7.3 节跨 Worker 验证要求（不改变主工作区自动降级策略 `AnchorLayered -> ELK -> Simple` 与用户取消不降级语义）。
- **明确不做**：不修改 Worker 生命周期（每请求独占一个 Worker、取消即 `terminate()`）及算法结果。

#### `REQ-12`：SVG 导出时序徽标、Compare CSS 冲突/重复 ID 与空点防护
- **基本信息**：Wave 3 · 优先级 P0 · 对应问题 `B22`, `B23`, `B24`, `B25` · 前置依赖：无
- **目标**：修复导出 SVG 时序样式丢失、Compare 控制栏布局错位、重复 DOM ID 与渲染边界空值异常。
- **涉及文件**：[svgExport.js](../../src/render/svgExport.js)、[styles.css](../../styles.css)、[svg_scene_renderer.js](../../src/render/svg_scene_renderer.js)、[svgRenderer.js](../../src/render/svgRenderer.js)、[progressiveSvgRenderer.js](../../src/render/progressiveSvgRenderer.js)（以及检索所有引用 `#schematicContent` 的调用点）
- **改动方案**：
  1. `B22`：对齐 `svgExport.js` `EXPORT_CSS` 中的 `.timing-badge` 样式（作用于 `.timing-badge` 本身及其阈值修饰符），并补全 `.pin-dot` / `.pin-critical` 及 `.node.constant` / `.implicit` / `.blackbox` / `.assign` / `.hub` / `.group` / `.timing-annotated` / `.is-selected` 等与 `styles.css` 一致的导出规则。
  2. `B23`：梳理 `styles.css` 中 `.compare-panel label:not(.alias-toggle)` 与 `.compare-config > label` / `.compare-orientation` 的选择器权重冲突；在 `:root` 补定义 `--danger`；将 `svg_scene_renderer.js` 中容器组从写死的全局唯一 `id="schematicContent"` 迁移为 `class="schematic-content"`（或带挂载作用域标识并同步改造 `mount.querySelector(".schematic-content")` / `[data-scene-content]`）。
  3. `B24`：`svgRenderer.js` `createEdgePrimitive` 遇到 `edge.showLabel !== false` 但缺失 `edge.labelPoint` 时回退到线路径中点或安全跳过标签而不抛 `TypeError`。
  4. `B25`：`progressiveSvgRenderer.js` 同步小图分支执行 `mount.innerHTML` 前增加 `if (options.isCurrent?.() === false)` 早退检查，返回取消态与渐进分支一致。
- **错误日志与失败路径**：导出构建异常由既有 `export` 边界记录；过期渲染不写入旧 DOM 也不报错误。
- **明确不做**：不引入外部 CSS 构建器或修改核心几何布局结果。

---

### Wave 4：多启动器安全加固与四端协议一致性

#### `REQ-13`：Node 启动器 `realpath` 守卫、静态服务软链兼容与 IPC 身份校验
- **基本信息**：Wave 4 · 优先级 P0 · 对应问题 `S01`, `S02`, `S03` · 前置依赖：无
- **目标**：消除 Node 启动器在符号链接、Windows 大小写、临时状态文件与本地管道权限上的安全绕过与全站 403 问题。
- **涉及文件**：[serve.mjs](../../tools/serve.mjs)、[workbench_terminal.mjs](../../tools/workbench_terminal.mjs)、[workbench_files.mjs](../../tools/workbench_files.mjs)、[workbench_ipc.mjs](../../tools/workbench_ipc.mjs)、[launcher-state.mjs](../../tools/launcher-state.mjs)、[terminal_log.mjs](../../tools/terminal_log.mjs)
- **改动方案**：
  1. `S01`：对 `state`（及 `${state}.lock`、`${state}.tmp.${process.pid}`）、`dir` 和 `terminal_log.mjs` 目录做 `realpath`（存在段向上解析其已存在父目录后拼接）及 Windows 路径大小写折叠比较，修复 `guard()` 漏保护。
  2. `S02`：`serve.mjs` 启动时用 `realpathSync(root)` 作为规范根；静态请求先检验 `runtimeAsset.test(pathname)` 白名单再调用 `realpath(filePath)`，既解决软链工作区下全站 403 又消除 404/403 存在性探测。
  3. `S03`：在 Windows 上对 Node IPC（参考 Python 做法通过受控子逻辑或双向挑战/owner token + 受限权限校验，或采用带随机口令/同用户 SID 验证的本地回环监听/命名管道校验）确保仅同用户进程可连入控制端，并在 `workbench_ipc.mjs` / `launcher-state.mjs` `belongsToLauncherState` 补齐对端身份与进程真实性校验（禁止仅凭未认证返回 JSON 判定归属并执行杀进程）。
- **错误日志与失败路径**：越权访问返回 `ACCESS_DENIED` / HTTP 403 并写入 `terminal_log.mjs` 安全审计事件；`workbench_terminal.mjs` 统一对 `list`/`picker-files` 失败记录 `workbench.files_failed`。
- **明确不做**：不引入 npm 第三方原生 C++ Addon（继续遵守零外部 npm 运行依赖约束）。

#### `REQ-14`：Native C++ `SO_PEERCRED`、随机 Token、Broker 竞态与 HTTP 解析加固
- **基本信息**：Wave 4 · 优先级 P0 · 对应问题 `S04`, `S05`, `S07`, `S08` · 前置依赖：无
- **目标**：修补 Linux 单文件二进制 `ngb` 的对端凭据校验缺失、弱 Token、Broker 多文件断连竞态及 HTTP 请求解析脆弱点。
- **涉及文件**：[WorkbenchTransport.h](../../native/launcher/WorkbenchTransport.h)、[main.cpp](../../native/launcher/main.cpp)、[WorkbenchBroker.h](../../native/launcher/WorkbenchBroker.h)、[WorkbenchFiles.h](../../native/launcher/WorkbenchFiles.h)
- **改动方案**：
  1. `S04`：`WorkbenchCli` 读取 `cfg` 时强制校验 `pid`（`> 0`）与 `control` 字段，向 `WorkbenchCall(path, b, expectedPid)` 显式传入 `expectedPid` 启用 `SO_PEERCRED` PID/UID 双校验。
  2. `S05`：删除 `main.cpp` 中暴露栈地址的 `makeOwnerToken()`，改为调用 `WorkbenchFiles.h` 已有的加密随机数接口 `ngb::WorkbenchToken()`。
  3. `S07`：`PrepareFiles` 重新加锁或遍历文件前先检查 `job.m_finished` 且在统一 `try` 内安全读取 `m_pathsByHandle`；`picker-files` 重入后核对 `p.m_online && p.m_connection == connection`；`import` 与 `picker-files` 校验并拒绝非法跨页 `--page`（返回 `ACCESS_DENIED`）。
  4. `S08`：`ReadWorkbenchRequest` 显式拒绝 `Transfer-Encoding`（返回 400/501）、严格解析 `Content-Type` 媒体类型（剔除参数后精准匹配 `application/json`）、严格校验纯数字 `Content-Length`、按精确字节切片传入 `Json::parse` 并在 `recv`/`send` 上重试 `EINTR`；`WorkbenchFiles::Protected()` 补上 `state_ + ".tmp." + std::to_string(pid)`。
- **错误日志与失败路径**：非法请求、跨页拒绝与对端校验失败通过 `TerminalLog` 记录 `code`/`operation` 及连接错误码，不泄露 `owner` token 或栈地址。
- **明确不做**：不改变 C++17 标准库 + POSIX 零外部新依赖的构建基线。

#### `REQ-15`：Tcl `::ngb::Start` `2>` 重定向注入防护与路径规范化
- **基本信息**：Wave 4 · 优先级 P0 · 对应问题 `S06` · 前置依赖：无
- **目标**：对齐 `::ngb::Start` 与 `::ngb::Connect` 的管道安全参数校验，封堵 `2>` 重定向注入漏洞。
- **涉及文件**：[ngb.tcl](../../tools/eda/ngb.tcl)
- **改动方案**：
  1. 将 `::ngb::Start` 第 39 行的参数拦截正则由 `^[<>|&]` 更新为 `^(2?>|[<|&])`（与 `::ngb::Connect` 对齐，且考虑规范化前后的 `--browse-root` 等所有路径与字符串值）。
  2. 将 `--browse-root` 加入 `file normalize` 列表（并在规范化前及规范化后均校验重定向字符，防止先规整或跳过拦截）。
- **错误日志与失败路径**：命中危险字符立即向 EDA Tcl 解释器 `error "Unsafe Tcl pipeline argument"`，不拉起子进程、不残留状态文件。
- **明确不做**：不更改 Tcl 8.5+ 兼容与零 `Tcllib` 依赖策略。

#### `REQ-16`：四端 CLI 协议对齐、Windows 构建流防死锁与错误日志补齐
- **基本信息**：Wave 4 · 优先级 P1 · 对应问题 `S09`, `S10`, `A03` · 前置依赖：`REQ-13`, `REQ-14`
- **目标**：消除 Node/Python/C++/Windows 四个启动器在 `status`/`stop`/stopping 错误码上的行为不一致，防住 Windows 发布脚本死锁，补齐剩余日志缺口。
- **涉及文件**：[main.cpp](../../native/launcher/main.cpp)、[launcher-state.mjs](../../tools/launcher-state.mjs)、[workbench_broker.mjs](../../tools/workbench_broker.mjs)、[serve.py](../../tools/serve.py)、[workbench_transport.py](../../tools/workbench_transport.py)、[workbench_service.py](../../tools/workbench_service.py)、[build-windows-release.ps1](../../tools/build-windows-release.ps1)、[inspector_tabs_controller.js](../../src/ui/inspector_tabs_controller.js)
- **改动方案**：
  1. `S09`：统一 `status` 在状态文件不存在时输出 `status=stopped` 且退出码为 `0`（修改 `main.cpp` 与既有契约对齐，同步复核 `native_launcher_e2e.py`）；统一 `stop` 的 JSON/status 输出；Node `stopLauncherState` 在 Windows 上优先通过控制通道发送优雅 `stop` 指令（如 Python 所做），避免强杀泄漏 `%TEMP%\ngb-session-*`；统一服务关闭中错误码为约定的统一码（如 `SERVER_STOPPING`），并在 `workbench_broker.mjs` 补齐关闭守卫。
  2. `S10`：`build-windows-release.ps1` 改用异步 `OutputDataReceived`/`ErrorDataReceived`（或先读取再等待进程）排空子进程标准输出/错误流，防止超 4 KB 死锁。
  3. `A03`：`inspector_tabs_controller.js` 剪贴板失败分支通过回调向 Process Log 写入 `warning`（携带 `details.error` 与 `operation: "inspector.copy"`）；`workbench_transport.py` 对 `picker-files` 失败记录 `workbench.files_failed`；`main.cpp` HTTP 边界捕获 `list`/`picker-files` 失败时同步写入 `TerminalLog`。
- **错误日志与失败路径**：每条新增日志均带 `operation`、`code` 和原始异常 `details.error`，日志自身失败不阻塞 UI 复制提示或 HTTP 响应。
- **明确不做**：不合并五种语言的启动器实现（留待远期规划）。

---

### Wave 5：架构模块拆分、退役清理与仓库卫生

#### `REQ-17`：应用控制器瘦身、`domain_workbench.js` 纳管与 `timingAnnotation.js` 拆分
- **基本信息**：Wave 5 · 优先级 P1 · 对应问题 `A01` · 前置依赖：Wave 0–3 稳定
- **目标**：消除 `main.js` 和核心控制器紧贴行数上限的维护瓶颈，将 700 行的 `domain_workbench.js` 拆解并纳入架构门禁，将 1,724 行的 `timingAnnotation.js` 模块化分层。
- **涉及文件**：[domain_workbench.js](../../src/app/domain_workbench.js)、[inspector_controller.js](../../src/app/inspector_controller.js)、[compare_workspace_controller.js](../../src/app/compare_workspace_controller.js)、[focused_roots_controller.js](../../src/app/focused_roots_controller.js)、[input_controller.js](../../src/app/input_controller.js)、[main.js](../../src/app/main.js)、[timingAnnotation.js](../../src/timing/timingAnnotation.js)、[architecture-boundaries.test.js](../../tests/unit/architecture-boundaries.test.js)
- **改动方案**：
  1. 从 `domain_workbench.js` 抽出纯 AIG 壳隐藏/恢复控制与 SVG 节点高亮/状态拼装辅助，使核心编排文件降至 ≤ 450 行，并在 `architecture-boundaries.test.js` 将工作台编排文件（或明确纳入 `domain_workbench.js`）加入行数门禁。
  2. 从 `inspector_controller.js`（516 行）、`compare_workspace_controller.js`（502 行）、`focused_roots_controller.js`（500 行）、`input_controller.js`（492 行）各抽离 1 项纯函数职责（如选中目标导航判定、Compare 状态摘要构造），使其回落到 ≤ 450 行，同时保证 `main.js` 不升反降。
  3. 按阶段拆分 `timingAnnotation.js` 为独立子模块（例如：`timing_scope.js` 负责 `@module`/occurrence 作用域消歧、`timing_index.js` 负责 cell/port/net 索引与归一化、`timing_badges.js` 负责策略聚合与徽标生成、`timingAnnotation.js` 保持对外稳定门面导出）。
- **错误日志与失败路径**：保持所有错误边界与对外签名 100% 兼容，不改变 `processLog` 归属。
- **明确不做**：不放宽任何现有行数预算；不重写现有工作台业务逻辑。

#### `REQ-18`：`groupCollapse` 运行时残留清理与 `test-mapped-cases.mjs` 参数修复
- **基本信息**：Wave 5 · 优先级 P1 · 对应问题 `A02` · 前置依赖：Wave 1–3
- **目标**：按 2026-09-14 产品决策将已退役的 `groupCollapse` 从运行期活跃管线和控制器端口中清理到纯粹的旧存档兼容解码边界（严禁触碰 Simple 冻结代码），并修复 mapped 测试脚本默认行为。
- **涉及文件**：`src/analysis/groupCollapse.js`、[netlist_graph_projection.js](../../src/domains/netlist/netlist_graph_projection.js)、[netlist_feature.js](../../src/domains/netlist/netlist_feature.js)、[selection_navigation_controller.js](../../src/app/selection_navigation_controller.js)、[workbench_controllers.js](../../src/app/workbench_controllers.js)、[test-mapped-cases.mjs](../../tools/test-mapped-cases.mjs)
- **改动方案**：
  1. 在 `sessionState.js`、`layoutGoldenImport.js` 与 `preferences_controller.js` 保留旧版存档字段（`collapseLargeGroups`、`expandedGroupIds`）的兼容读取与安全忽略警告，移除 7 个业务控制器端口及 `moduleWorkspace`/`compareWorkspace`/`netlist_graph_projection.js` 中的运行期折叠执行分支与 `selection_navigation_controller.js` 死提示（保留 `groupCollapse.js` 仅当测试/Simple 确实需要，否则同步清理；注意：不修改 `layout/` 中 Simple 消费的 `"group"` 分支以严格遵守 Simple 冻结）。
  2. 修复 [test-mapped-cases.mjs](../../tools/test-mapped-cases.mjs#L14-L16)：支持 CLI `--no-collapse` 参数解析，并按 `AGENTS.md` 产品测试默认跑全图非折叠（若需保留历史折叠对照，改用显式 `--legacy-collapse` / `MAPPED_CASE_COLLAPSE=1`）。
- **错误日志与失败路径**：导入含旧版 `collapseLargeGroups: true` 的 Session / Golden 时给出一次性非阻断提醒或安全降级为全图/Search-first，不报错。
- **明确不做**：绝不触碰 `src/layout/channelCapacity.js` 等 Simple 冻结代码内的 `"group"` 逻辑。

#### `REQ-19`：全仓 CRLF 换行符独立归一化、死代码/无引用脚本清理与杂物治理
- **基本信息**：Wave 5 · 优先级 P2 · 对应问题 `A05`, `A08`, `A09` · 前置依赖：Wave 0–4 合并后执行最佳
- **目标**：恢复工作树与 `.gitattributes`/`.editorconfig` LF 规范一致性，清理死模块与无引用脚本，建立本地构建产物目录保留窗口。
- **涉及文件**：[`.gitattributes`](../../.gitattributes)、`src/layout/nodePlacement.js`、[terminal_log.sh](../../tools/terminal_log.sh)、[run_oracle.sh](../../tools/research/elk_phase_oracle/run_oracle.sh)、`tools/` 下的 14 个独立脚本
- **改动方案**：
  1. `A05`（**独立纯格式提交**）：补全 `.gitattributes` 对 `*.mjs`、`*.py`、`*.sh` 的 `eol=lf` 声明并清理无用 `*.ts`/`*.tsx`/`*.jsx` 条目（注意保留 `vendor/graphviz/*` 的 `-text` 规则）；执行全仓换行符归一化，彻底消除 138 个 CRLF 与 4 个混合换行（含 2 个 Linux `.sh` 脚本）。
  2. `A08`：删除全仓 0 引用的兼容空壳 `src/layout/nodePlacement.js`；对 `tools/` 下 14 个独立脚本逐一确认归属——已过期的一次性脚本移入 `tools/archive/` 或移除，确有基准价值者补入说明文档。
  3. `A09`：提供本地清理脚本或指引清理 `dist/` 历史过期解压目录、根下 `%SystemDrive%/`、`node-preview-smoke.*.log`、`mytest/` 与 `__pycache__/`（仅限未跟踪本地杂物，不入库）。
- **错误日志与失败路径**：无新增运行时失败路径。
- **明确不做**：不在 CRLF 归一化提交中混入任何代码逻辑变动；不修改 `vendor/graphviz/viz.js` 字节。

#### `REQ-20`：规划文档状态同步、`docs/` 历史归档与 `index.html` UI/A11y 一致性
- **基本信息**：Wave 5 · 优先级 P2 · 对应问题 `A06`, `A07` · 前置依赖：Wave 3–5 同步
- **目标**：使工程文档反映真实能力现状，清理 `docs/` 顶层过时文档，统一前端 HTML 语种、快捷键文档、文件过滤与无障碍属性。
- **涉及文件**：[PLAN.md](../PLAN.md)、[STAGE_8_PLAN.md](../STAGE_8_PLAN.md)、[index.html](../../index.html)、`docs/` 历史冻结前排障文档（7 份）
- **改动方案**：
  1. `A06`：更新 [PLAN.md](../PLAN.md) 将 Stage 5 / `R5-1`（可选 Liberty `.lib`）由 `计划中` 更新为 `已完成` 并链接其实现与验证文档；更新 [STAGE_8_PLAN.md](../STAGE_8_PLAN.md) 状态说明；将 `docs/` 顶层 7 份 2026-09 Simple 冻结前的暂停/重启/调查文档归档至 `docs/archive/` 或标注顶部横幅“历史冻结前存档”并同步全仓文档内链。
  2. `A07`：统一 [index.html](../../index.html) 中英文文案（或严格按产品界面主语言统一按钮与提示）；对齐前进历史 tooltip 与 `#helpDialog` 快捷键说明（同时写清 `Ctrl+Shift+Z / Ctrl+Y / Alt+Right`）；为 Compare A/B 时序文件输入补全 `.sta`；为 Navigator `role="tab"` 补全 `aria-controls`、`id` 与容器 `role="tabpanel"` 关联。
- **错误日志与失败路径**：文档链接变动须全量通过 `npm run test:docs`。
- **明确不做**：不改动 `docs/ARCHITECTURE.md` 核心分层约束或删除有审计追溯价值的记录文件。

---

### Wave 6：大图内存回归定位与前端交互恢复达标

#### `REQ-21`：`dp_020_mapped.v` 峰值堆回归定位与布局迭代/内存收敛
- **基本信息**：Wave 6 · 优先级 P1 · 对应问题 `P01` · 前置依赖：Wave 3 (`REQ-10`)
- **目标**：定位并扭转 `dp_020_mapped.v` 在 `AnchorLayered` 下峰值堆从 578 MiB 上涨至 1,592 MiB 的分配回归，缓解 `network_simplex` 触及 2,100 次迭代上限与耗时（20.4s）问题。
- **涉及文件**：[dp_020_mapped.v](../../tests/fixtures/mapped/datapath/dp_020_mapped.v)、[anchor_layout_provider.js](../../src/layout/anchor_layout_provider.js)、`src/layout/anchor_layered/` 各相位模块、[benchmark-mapped-cases.mjs](../../tools/benchmark-mapped-cases.mjs)
- **改动方案**：
  1. **先测量再优化**：使用 `node --expose-gc` 对比 `code_review_2026_11_08_algorithms.md` 基线与当前 `dp_020` 各相位（p1–p5 与 `phaseData.placements`/诊断保留）堆分配，定位高分配对象（例如临时数组、密集邻接矩阵或未释放中间件引用）。
  2. **内存与耗时收敛**：清理阶段完成后不再需要的临时中间结构，优化 `p2`/`p3` 中大规模分量下的排序/交叉计数内存布局；在保证 47/47 零硬违规的前提下评估 `network_simplex` 初始可行解或迭代退化原因。
- **错误日志与失败路径**：保持 `ranking-iteration-limit` 警告诊断与超限保护不退化；不降低任何 `layoutValidator` 规则。
- **明确不做**：严禁通过放宽硬约束、增加 `collapseLargeGroups` 或触碰 Simple 来换取指标。

#### `REQ-22`：4K 全图手势结束恢复（≤ 100ms）与 `sop_015` 挂载超时治理
- **基本信息**：Wave 6 · 优先级 P1 · 对应问题 `P02` · 前置依赖：Wave 3 (`REQ-12`) & Wave 5
- **目标**：承接 [frontend_interaction_performance_2026_11.md](./frontend_interaction_performance_2026_11.md) 遗留性能目标，解决 4K 全图缩放/平移结束恢复卡顿（当前 299.5 / 170.0 ms → 目标 ≤ 100 ms）与 `sop_015`（44k 元素）90s 挂载超时。
- **涉及文件**：[progressiveSvgRenderer.js](../../src/render/progressiveSvgRenderer.js)、[svg_scene_renderer.js](../../src/render/svg_scene_renderer.js)、[canvas_controller.js](../../src/app/canvas_controller.js)、[compare_canvas_controller.js](../../src/app/compare_canvas_controller.js)、[frontend_interaction_performance.mjs](../../tests/e2e/frontend_interaction_performance.mjs)
- **改动方案**：
  1. 基于 `frontend_interaction_performance_2026_11.md` 第 8.4/8.6 节数据，重点定位手势结束后文本标签/命中层样式切换触发的整图样式重算与重绘阻塞（避免 `display:none <-> block` 切换导致全树重新计算盒模型，或采用分层 DOM 组/异步分批还原文本与跨线桥）。
  2. 结合第 8.4 节给出的 P5 空间分块可见区渲染方案设计（保持 Scene/搜索/导出仍为完整权威来源、跨区不丢失选区与键盘焦点），完成跨区平移、缩放补齐、全图 Fit 后评估产品启用；对 `sop_015` 级超大规模 SVG 首次挂载优化批次调度与 DOM 片段构建，确保 90s 预算内可完整加载或清晰渐进可用。
- **错误日志与失败路径**：手势取消、文档切换或挂载打断时遵循既有 `renderGeneration` 与 `canvas_gesture_lifecycle` 清理语义，无迟到写入或泄露。
- **明确不做**：不破坏完成态几何一致性、LOD 文字规则与静态 SVG 导出完整性。

---

## 3. 明确冻结与范围外事项（Out of Scope）

- **`A04`（Simple 冻结与五语言启动器长期演进）**：
  1. Simple 布局管线（`src/layout/simple*.js`、`channelCapacity.js`、`src/layout/layered/` 专属模块等 25 个文件 / 8,715 行）按照 [AGENTS.md](../../AGENTS.md) 保持**永久冻结**，本轮不进行任何重构、删减或算法修复。
  2. Node / Python / C++ / C# / Tcl 五端启动器的跨语言架构合并（如统一成单一内核）不属于本轮缺陷修复范围；本轮通过 `REQ-13`–`REQ-16` 确保四端安全与协议一致性即可。
