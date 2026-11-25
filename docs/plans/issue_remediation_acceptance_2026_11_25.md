# 项目问题修复验收标准（2026-11-25）

> 对应问题清单：[project_issue_list_2026_11_25.md](../project_issue_list_2026_11_25.md)（基线 `7dc7c6c`）
> 配套文档：[修复方案路线](./issue_remediation_roadmap_2026_11_25.md) · [需求拆分文件](./issue_remediation_requirements_2026_11_25.md)

## 1. 全局强制门禁（Global Gates）

以下 **G1–G7** 为每个对应波次合入前的通用通过线；凡涉及对应代码边界的变更，不得豁免或放宽阈值：

| 门禁 | 适用范围 | 必须满足的客观标准 | 验证命令 / 入口 |
| --- | --- | --- | --- |
| **G1 单元与架构门禁** | 全部 JS 变更 | 全部单元测试通过（新增聚焦单测先红后绿）；AST 检查 `unresolved=0`、`boundaryViolations=0`、`cycles=0`；文档链接 `missing=0` | `npm test`、`npm run test:architecture`、`npm run test:docs` |
| **G2 映射网表硬约束** | Parser / IR / 图提取 / Layout / 渲染 | 47/47 mapped 用例全部 `PASS`、`violations=0`、`layoutStatus="routed"`、默认 `DEFAULT_LAYOUT_PROVIDER_ID`（`native-layered`） | `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-hard` |
| **G3 Simple 冻结零变更** | 触及 `src/layout/` 或共享路由/空间索引（对应只读冻结边界 `A04`） | Simple 6 个冻结模块及相关 25 个专属模块（`A04`）零改动；对比改动前基线，Simple 输出的节点坐标、边路径、`routeStatus`、`diagnostics` 与策略 **100% 一致**；五语言启动器长期合并亦不在本轮改动范围 | Simple 单测集 + 冻结对照快照比对 |
| **G4 置换不变性与不可变性** | Parser / 图构建 / 时序 / 跨层 / 布局 | 打乱输入模块/实例/端口/边/时序记录数组顺序后输出结果 100% 等价；源 IR 与 Session 不可变写入抛错 | [layout-determinism.test.js](../../tests/unit/layout-determinism.test.js)、各新增乱序测试 |
| **G5 错误日志与失败路径** | 异步流程、Worker、导入/导出、失败修复 | 落实 [SKILLS_AND_RULES.md](../SKILLS_AND_RULES.md) 第 7.3 节：边界注入测试验证 `code`/`operation`/归属与 `details.error` 原始异常（含跨 Worker `stack`/`cause`）；正常空结果与取消不记 `error`；不覆写旧可用画布；涉及 UI 工作流的变更须在浏览器实测打开 Log 详情并导出 JSONL 核对字段完整且脱敏 | [failure_logging.test.js](../../tests/unit/failure_logging.test.js)、[process-log-e2e.mjs](../../tests/e2e/process-log-e2e.mjs) |
| **G6 多启动器与离线包** | Node / Python / C++ / Tcl / 构建脚本 | 四端启动器契约与协议通过（Node/Python 本机可测，Linux ELF/`ngb.tcl` 在带 CMake+`tclsh` 环境验证）；Windows 离线包构建成功、无外网请求、ELK/Viz 许可证 SHA 一致 | `npm run test:remote-protocol`、`npm run release:windows`、[native_cmake_e2e.py](../../tests/e2e/native_cmake_e2e.py) |
| **G7 代码与仓库卫生** | 全部提交 | `git diff --check` 无空白错误；全仓文本文件 LF 无漂移；`main.js` ≤ 420 行且控制器 ≤ 520 行预算未上调 | `git diff --check`、`git ls-files --eol` |

---

## 2. 逐需求验收标准（`AC-01` ~ `AC-22`）

### Wave 0：`REQ-01`–`REQ-02`

- [x] **AC-01（对应 `REQ-01` / `B01`）**
  - **功能断言**：
    1. 加载首个 Verilog 后再通过 `design add`、`compare design` 或多文件导入加载第二个网表（此时 `state.currentSource === null`、`state.sourceFiles.length >= 2`）：执行切换视图模式、选中对象、修改 Compare Sync 选项（`synchronized`/`selectionSynchronized`/`focusedRootsSynchronized`）后，按 `Ctrl+Z` / `Ctrl+Shift+Z` 必须精确撤销并前进恢复。
    2. 触发 `beforeunload` 或会话持久化读取 `getSessionSnapshot()` 必须返回包含 `sourceFiles`（数量 ≥ 2）的非空快照；刷新或恢复会话后可重新还原多文件设计。
  - **失败路径与日志**：多文件快照若损坏或模块缺失，恢复边界向 Process Log 写入 `persistence` 错误并保留 `sourceFiles.length` 与 `details.error`；空白未导入任何设计时 `beforeunload` 不写入空快照也不报错。
  - **验证入口**：[multi-source-import.test.js](../../tests/unit/multi-source-import.test.js)、[view-history.test.js](../../tests/unit/view-history.test.js)、[ui-workbench-e2e.mjs](../../tests/e2e/ui-workbench-e2e.mjs)。

- [x] **AC-02（对应 `REQ-02` / `W01`, `W02`, `W03`）**
  - **功能断言**：
    1. `W01`：Compare 模式下点击或远程选中端口（Port）时，工具栏 `Focus selected` 按钮保持可用（但不可添加为 Focused root）；触发 `F` / `selection zoom` / `search open` 时，在 `selectionSynchronized=true` 下两侧匹配 Port 均居中缩放，在 `false` 下仅选中侧居中。
    2. `W02`：在 Compare 中设置 `Sync pan / zoom = ON` 且 `Center match on click = OFF` 时，点击一侧 Focused root chip 仅移动该侧视口，对侧视口 `(x, y, scale)` 字节级不变；`Sync Focus roots = OFF` 时切换/清空单侧 roots 不重置对侧视口。
    3. `W03`：远程执行 `compare split vertical` 后执行视图历史 `Back`（`Ctrl+Z`），Split 方向准确回退为 `horizontal`。
  - **失败路径与日志**：非 Compare 模式执行 `compare split` 返回 `DOMAIN_MISMATCH` 且历史栈无新条目；对不存在的端口执行 `selection zoom` 提示不可用但不报错。
  - **验证入口**：[remote_design_acceptance.mjs](../../tests/e2e/remote_design_acceptance.mjs)、[ui-workbench-e2e.mjs](../../tests/e2e/ui-workbench-e2e.mjs)、[focused-roots-controller.test.js](../../tests/unit/focused-roots-controller.test.js)。

### Wave 1：`REQ-03`–`REQ-04`

- [x] **AC-03（对应 `REQ-03` / `B02`, `B03`, `B05`）**
  - **功能断言**：
    1. `B02`：包含 `(* keep = "true" *) BUF u1 (.A(a), .Y(y));`、`(* fsm_encoding = "one_hot" *) input [3:0] st` 等 Verilog-2001 属性的网表，后续所有 `port`/`wire`/`assign`/`cell` 必须全部被完整解析入 IR，无一丢失。
    2. `B03`：含 `\wire `、`\reg `、`\input `、`\signed `、`\endmodule ` 等合法转义标识符的模块、端口、线网和单元实例化均被完整保留，不提前截断模块也不被当作修饰符忽略。
    3. `B05`：输入含位置连接 `BUF u(y, a);`、参数化模块头 `module top #(parameter W=8)(input a, output y);`、`wire a = b;`、独立 `reg`/`logic`/`supply0`/`supply1` 声明时，IR 不可静默吞并：须产生含精确 `code`、源码行列 `span` 与 `moduleName` 的结构化 `diagnostics`（其中受支持部分或相邻正常模块仍可正常打开）。
  - **失败路径与日志**：工作区导入包含上述不支持构造的 Verilog 时，Process Log 写入有界结构化 `warning`/`error`（含 `fileName`、样本数），且同文件其他正常模块保持可浏览。
  - **验证入口**：[parser.test.js](../../tests/unit/parser.test.js)、[netlist-attributes.test.js](../../tests/unit/netlist-attributes.test.js)、`npm run test:mapped-hard`。

- [x] **AC-04（对应 `REQ-04` / `B04`, `P06`）**
  - **功能断言**：
    1. `B04`：解析/建图包含 `[99999999999999999:0]` 或 `[10000000:0]` 的越界向量连接时，必须在 `< 50 ms` 内安全返回（不死循环、不 OOM），不展开位宽并生成明确位宽越界诊断。
    2. `B04`：包含转义标量网 `\reg[3:0] ` 的实例化网表，IR 与图节点必须严格保留单一标量网 `\reg[3:0]`（`escaped: true`），禁止被拆成 `reg[3]..reg[0]` 四条虚构线网。
    3. `P06`：构造含 `M >= 500` 个模块且带 `sourceFile` 的多文件设计，`buildSchematicGraph` 调用线性耗时，不出现 `O(C × M)` 二次方退化（对比单文件同规模图耗时无数量级差异）。
  - **失败路径与日志**：越界位宽诊断随图摘要输出至 Diagnostics 与 Process Log；已有合法向量（如 `[31:0]`）展开行为与位序 100% 不变。
  - **验证入口**：[netlist-model.test.js](../../tests/unit/netlist-model.test.js)、[algorithm-review-regressions.test.js](../../tests/unit/algorithm-review-regressions.test.js)。

### Wave 2：`REQ-05`–`REQ-08`

- [x] **AC-05（对应 `REQ-05` / `B06`, `B08`, `B09`）**
  - **功能断言**：
    1. `B06`：合并 `unit: "ns"`（`slack: 1.0`）与 `unit: "ps"`（`slack: 500.0`）两份时序数据集后，所有数值必须按统一单位精确换算（如全部为 `ns` 下 `1.0` 与 `0.5`，或附带明确混用/换算诊断）；单数据集经过 `mergeTimingDatasets([one])` 也必须带有与多数据集一致的 `fileName` 归属。
    2. `B08`：含前导 `#` 或 `//` 注释的合法 JSON 时序文件能正确解析通过；`points` 为数组 `[]` 时产出明确的格式诊断而非静默忽略。
    3. `B09`：含 Verilog 转义名称（如 `\u_mux#0 /Y`、`\n,1 /A`）及双反斜杠结尾引号（`"foo\\"`）或单引号文本的时序行，完整保留标识符而不截断或误切 CSV 列。
  - **失败路径与日志**：不可换算单位混杂、损坏 JSON 必须触发 `timing` 阶段带 `fileName`、行列与 `details.error` 的 Process Log，且此前成功加载的图上时序标注不被覆盖清空。
  - **验证入口**：[timing-import.test.js](../../tests/unit/timing-import.test.js)、[timing-stage6.test.js](../../tests/unit/timing-stage6.test.js)、[workbench_timing_acceptance.mjs](../../tests/e2e/workbench_timing_acceptance.mjs)。

- [x] **AC-06（对应 `REQ-06` / `B07`, `B10`, `B11`, `P07`）**
  - **功能断言**：
    1. `B07`：同一 `assign` 别名组中多条别名拥有不同 slack 时，无论记录输入顺序如何，根线网始终保留最差 slack；slack 相等时按规范 `point` 字典序稳定决胜（打乱时序记录数组顺序结果逐字段全等）；线网或引脚名为 `toString`/`constructor`/`valueOf` 时不与原型属性碰撞。
    2. `B10`：带 `@root` 作用域的时序记录区分实例名大小写（`U_SUB/u1/Y` 不误匹配 `u_sub/u1/Y`）；偶数反斜杠 `\\/` 与奇数反斜杠 `\/` 处理结果与 `findLastUnescapedSlash` 一致。
    3. `B11`：转义引脚在 cell pin 记录、net 驱动传递与 `findTimingPin` 默认徽标选取三处使用同一归一化键，不重复存储也无漏匹配；`ambiguousNodeIds` 跳过 `directGroup` 时 `matchedRecordCount` 与 `unresolvedGroup` 账目严格守恒。
    4. `P07`：多作用域（≥ 20 个 `@scope`）与千级引脚测试下，不重复运行 4,000 步 DFS，计时较基线明显下降且无功能差异。
  - **失败路径与日志**：发生多驱动冲突或层次歧义时产生结构化 `timing_diagnostics`，可在 Inspector 与 Log 中准确追溯。
  - **验证入口**：[timing_match_diagnostics.test.js](../../tests/unit/timing_match_diagnostics.test.js)、[timing-stage6.test.js](../../tests/unit/timing-stage6.test.js)。

- [x] **AC-07（对应 `REQ-07` / `B12`, `B13`, `B14`）**
  - **功能断言**：
    1. `B12`：`projectHierarchicalRenderGraph` 产出的所有边，其 `edge.net` 必须等于真实线网/hub 名称，禁止退化为原始 `edge.id`（如 `top:$|...`）。
    2. `B13`：构建逻辑深度 ≥ 12 层的层次网表并设置 `maximumVisibleNodes` 截断，深度 `2`..`9` 节点必须先于深度 `10`..`12` 节点被保留；大队列（`frontier >= 500`）下耗时无二次方膨胀。
    3. `B14`：子模块实例化使用多 bit 总线或拼接连接同名端口（如 `.D({a, b})` 或 `[3:0]`）向上追踪时，父层所有关联驱动/负载线网全部被追踪到；名为 `top` 的顶层子模块实例不与根模块路径混淆；所有跨层输入打乱后输出保持置换不变。
  - **失败路径与日志**：触发深度、节点预算、循环递归或缺失定义边界时产出稳定的 boundary 诊断并展示在 Diagnostics 面板，不阻塞正常渲染。
  - **验证入口**：[hierarchy-connectivity.test.js](../../tests/unit/hierarchy-connectivity.test.js)、[port_identity.test.js](../../tests/unit/port_identity.test.js)。

- [x] **AC-08（对应 `REQ-08` / `B15`, `B16`, `B17`, `P03`, `P08`）**
  - **功能断言**：
    1. `B15`：BLIF 带 `.names` / RTL 映射表执行 `projectCut` 时，Focused / Show-Path 截断边界节点必须优先显示 `primaryNameMapping.name` 而非裸 `signalId`。
    2. `B16`：Golden JSON 中传入 `faninDepth: null`、`fanoutDepth: ""`、`node.x: null`、`sourceIdentity.size: false` 时，均被严格拒绝/按缺失处理，禁止静默转为 `0` 或 `1`。
    3. `B17`：`aig_normalize` 孪生节点输入乱序后归属始终一致，多常数文字输入抛出明确 `AIG` 语义错误而非越界崩溃；`show_path` side input 保留转义线网显示名；`reconvergence_worker` 未初始化即查询时抛出 `"Analysis worker has no source model"` 明确异常。
    4. `P03` / `P08`：10 MiB 级大 DOT 文件词法解析呈线性耗时（较 `slice` 版本显著提速）；从 AIG 切回大 Verilog 网表时 `parseVerilog` 仅被调用 **1 次**。
  - **失败路径与日志**：`reconvergence_worker` 未初始化错误、DOT 语法错误与切回 Netlist 失败均保留原异常至 Process Log 且不破坏旧 AIG 视图。
  - **验证入口**：[aig-import.test.js](../../tests/unit/aig-import.test.js)、[aig_views_e2e.mjs](../../tests/e2e/aig_views_e2e.mjs)、[layout-golden-import.test.js](../../tests/unit/layout-golden-import.test.js)、[show_path.test.js](../../tests/unit/show_path.test.js)、[netlist_reconvergence.test.js](../../tests/unit/netlist_reconvergence.test.js)、`npm run benchmark:aig`。

### Wave 3：`REQ-09`–`REQ-12`

- [x] **AC-09（对应 `REQ-09` / `B18`, `B21`）**
  - **功能断言**：
    1. `B18`：复现“导线 `y=100` 中点被障碍节点遮挡”用例：`placeWireLabels` 将标签移至 `y=118` 后，`buildWireRoutes` 与 `refreshWireRouteLabels` 必须保留该避障坐标而不回退覆盖为节点重叠坐标；同时移除 `segment.orientation` 依赖后，水平合并分段上的接点分裂按 `x` 严格单调排序。
    2. `B21`：所有边均无有效路由段时 `netTreeRouter` 在活跃路径准确报告 `reachableTargetCount: 0`；`MeasuredElkLayoutProvider` 能正确拼接多段 `edge.sections[0..k]` 构成连续正交路径。
    3. **G3 门禁**：Simple 冻结路径的全部既有单测与对照快照 100% 逐字段一致。
  - **失败路径与日志**：空线网路由触发 `layoutValidator` 的 `wire-route-disconnected` 违规；Simple 不出现任何非预期违规变化。
  - **验证入口**：[wire-routes.test.js](../../tests/unit/wire-routes.test.js)、[wire-label-placement.test.js](../../tests/unit/wire-label-placement.test.js)、[measured_layout_boundary.test.js](../../tests/unit/measured_layout_boundary.test.js)、[layout-fixtures.test.js](../../tests/unit/layout-fixtures.test.js)、`npm run test:mapped-hard`。

- [x] **AC-10（对应 `REQ-10` / `B19`, `P04`, `P05`）**
  - **功能断言**：
    1. `B19`：对带 `inout` 端口且 `connectionOffsets.source !== connectionOffsets.target` 的测量图运行 `MeasuredAnchorLayoutProvider`，生成路径必须严格正交、沿端口声明侧接入、`layoutStatus === "routed"` 且 `layoutValidator` 违规数为 0；`NORTH`/`SOUTH` 端口不再因硬编码或 `unsupported-flat-port-side` 异常中断合法测量图。
    2. `P04` / `P05`：分裂路由不再每步重建全局依赖图（高分裂边界用例耗时显著降低）；`network_simplex` 与 `p3_ordering` 在 `100,000` 节点规模的 rank 数组上求最小值不发生 `RangeError: Maximum call stack size exceeded`；Adjust 连续 `replaceOwner` 1,000 次后 `RouteSegmentIndex` 内部桶条目保持有界增长且单次重布线不随节点数平方增长。
    3. **G3 门禁**：Simple 行为零变化。
  - **失败路径与日志**：非法端口侧向仍抛出完整 `PhaseError`（含 `phase`、`code` 与 `diagnostic`）。
  - **验证入口**：[anchor_layered_provider.test.js](../../tests/unit/anchor_layered_provider.test.js)、[local-route-candidates.test.js](../../tests/unit/local-route-candidates.test.js)、[spatial-index.test.js](../../tests/unit/spatial-index.test.js)、[positioned-routing.test.js](../../tests/unit/positioned-routing.test.js)、`npm run benchmark:interaction`。

- [x] **AC-11（对应 `REQ-11` / `B20`）**
  - **功能断言**：
    1. 注入 Worker 抛出含嵌套 `cause`（Error 链）、`code`、`diagnostic`（含不可克隆字段或循环引用防护）以及非 Error 值（字符串 / `null`）的异常，主线程接收到的拒绝 `Error` 必须完整保留 `name`、`message`、`stack`、`code` 与 `cause` 链，且 `self.postMessage` 不因 `DataCloneError` 静默失联。
    2. 模拟 Worker 发回 `null` / `undefined` 空 `data` 或触发 `worker.onerror`（含 `filename`/`lineno`/`colno`/`error`）：`executeNativeLayout` 返回的 Promise 必须在 1 帧内确定 `reject`（永不挂起），且包含源位置元数据。
    3. 浏览器取消仍直接 `terminate()` Worker 并抛出 `AbortError`，不触发自动降级，不记 `error` 日志。
  - **失败路径与日志**：布局失败触发工作区降级与 Process Log 记录时，导出 JSONL 中原始异常栈与 `cause` 可读。
  - **验证入口**：[native-layout-execution.test.js](../../tests/unit/native-layout-execution.test.js)、[layout_fallback.test.js](../../tests/unit/layout_fallback.test.js)、[failure_logging.test.js](../../tests/unit/failure_logging.test.js)。

- [x] **AC-12（对应 `REQ-12` / `B22`, `B23`, `B24`, `B25`）**
  - **功能断言**：
    1. `B22`：带时序注解、黑盒、常量、隐式线网、高扇出 Hub 与选中态的电路导出为独立 SVG，检查内联 `<style>` 能实际命中 `<text class="timing-badge">` 与各类 `.node.*` / `.pin-*` / `.is-selected` 元素，导出视觉外观与页面内一致。
    2. `B23`：Compare 模式下检查左侧 `#leftSchematicMount` 与右侧 `#rightSchematicMount` 内部的 DOM，整个文档内不存在重复 `id="schematicContent"`；检查 `#comparePanel` 内部 A/B/Split 标签计算样式满足横排对齐，且 `--danger` 在 `:root` 中有明确色值定义。
    3. `B24` / `B25`：传入无 `wireRoutes` 且缺少 `labelPoint` 的边到 `svgRenderer.js` 不抛 `TypeError`；`progressiveSvgRenderer` 在 `total < threshold` 分支若 `isCurrent()` 为 `false` 时不修改 `mount.innerHTML` 并正确结算为取消态。
  - **失败路径与日志**：SVG 导出异常走 `export` 阶段记录保留原始异常；取消的渲染静默退出无告警。
  - **验证入口**：[svg-scene-renderer.test.js](../../tests/unit/svg-scene-renderer.test.js)、[progressive-renderer.test.js](../../tests/unit/progressive-renderer.test.js)、[stage4-features.test.js](../../tests/unit/stage4-features.test.js)、[workbench-e2e.mjs](../../tests/e2e/workbench-e2e.mjs)。

### Wave 4：`REQ-13`–`REQ-16`

- [x] **AC-13（对应 `REQ-13` / `S01`, `S02`, `S03`）**
  - **安全断言**：
    1. `S01`：将 `--browse-root` 指向包含 `state.json`、`state.json.tmp.<pid>`、会话临时目录或日志目录（含通过 symlink 或 Windows 不同盘符大小写路径指向）的目录，执行 `server files`、`import`、`export` 读写操作全部被 `guard()` 拒绝并返回 `ACCESS_DENIED` / HTTP 403。
    2. `S02`：将整个仓库软链接到一个新路径并从软链路径运行 `node tools/serve.mjs`，访问 `GET /`、`GET /src/app/main.js` 均返回 `200 OK`；访问非资源路径（如 `/package.json` 或 `/nonexistent.txt`）统一返回 `403` 不暴露存在性差异。
    3. `S03`：向 `state.control` 发送伪造 PID 或非当前用户的管道/IPC 请求被拒绝；`belongsToLauncherState` 不仅靠对端 JSON 字段就强杀任意 PID。
  - **失败路径与日志**：越权访问在服务端写入安全日志（不含敏感路径泄露或 token 值）。
  - **验证入口**：[server_file_picker.test.js](../../tests/unit/server_file_picker.test.js)、[remote_workbench.test.js](../../tests/unit/remote_workbench.test.js)、[launcher-e2e.mjs](../../tests/e2e/launcher-e2e.mjs)、[remote_workbench_protocol.mjs](../../tests/e2e/remote_workbench_protocol.mjs)。

- [x] **AC-14（对应 `REQ-14` / `S04`, `S05`, `S07`, `S08`）**
  - **安全与并发断言**：
    1. `S04` / `S05`：`ngb cmd --state-file ...` 显式传 `expectedPid` 校验 `SO_PEERCRED`（篡改 `state.json` 中 `pid` 为其他进程时调用必须被拒）；`state.json` 中的 `owner` 为高熵随机 hex 字符串（来自 `WorkbenchToken()`），不包含进程栈地址特征。
    2. `S07`：`PrepareFiles` 批处理读盘期间触发页面断开，服务不抛出误导性 `ACCESS_DENIED`；`picker-files` 在断连或跨页 `--page` 下正确失败/拒绝。
    3. `S08`：发送带 `Transfer-Encoding: chunked`、`Content-Type: application/json-evil`、带尾随字母的 `Content-Length: 10abc` 的恶意 HTTP 请求全部被拒（400/501）；`WorkbenchFiles::Protected()` 拦截对 `.tmp.<pid>` 文件的读写。
  - **失败路径与日志**：上述拒绝对端错误均通过 `TerminalLog` 记录规范错误码。
  - **验证入口**：[native_launcher_e2e.py](../../tests/e2e/native_launcher_e2e.py)、[remote_workbench_protocol.mjs](../../tests/e2e/remote_workbench_protocol.mjs)（在 Linux 构建环境通过 `ctest --test-dir build/linux`）。

- [x] **AC-15（对应 `REQ-15` / `S06`）**
  - **安全断言**：
    1. 在 Tcl 中调用 `::ngb::Start $bin $state --module "2>/tmp/pwned"`、`--focus "2>>/tmp/pwned"` 或 `--browse-root "2>@1"` 时，必须立即抛出 `"Unsafe Tcl pipeline argument"` 异常，目标路径不得创建/截断文件且不得启动任何子进程。
    2. `--browse-root` 合法相对路径能正常经过 `file normalize` 后启动成功。
  - **验证入口**：[native_launcher_tcl.test.tcl](../../tests/e2e/native_launcher_tcl.test.tcl)、[remote_workbench_acceptance.tcl](../../tests/e2e/remote_workbench_acceptance.tcl)。

- [x] **AC-16（对应 `REQ-16` / `S09`, `S10`, `A03`）**
  - **协议与日志断言**：
    1. `S09`：Node / Python / C++ / Windows 四端启动器在缺失 state 文件执行 `status` 时全部输出 `status=stopped` 且退出码为 `0`；`stop` 均清理会话目录/状态文件（含 Windows Node 不残留 `%TEMP%\ngb-session-*`）并返回一致 JSON/status；服务停止期间请求统一返回约定停止错误码。
    2. `S10`：让 Windows 冒烟测试输出超过 16 KB 日志到 stdout/stderr，`npm run release:windows` 正常排空流并完成校验不死锁。
    3. `A03`：浏览器内模拟 `navigator.clipboard.writeText` 抛错点击 Inspector 复制按钮，UI 提示回退文字的同时 Process Log 出现 `inspector.copy` 级别 `warning` 且 `details.error` 完整保留原异常（同步核对 JSONL 导出）；Python/C++ 触发 `picker-files` 失败均在终端日志出现 `workbench.files_failed`。
  - **验证入口**：[terminal_logging.test.js](../../tests/unit/terminal_logging.test.js)、[terminal_logging_e2e.py](../../tests/e2e/terminal_logging_e2e.py)、[windows_remote_workbench.mjs](../../tests/e2e/windows_remote_workbench.mjs)、[process-log-e2e.mjs](../../tests/e2e/process-log-e2e.mjs)、`npm run release:windows`。

### Wave 5：`REQ-17`–`REQ-20`

- [x] **AC-17（对应 `REQ-17` / `A01`）**
  - **结构与门禁断言**：
    1. `domain_workbench.js` 纳入 [architecture-boundaries.test.js](../../tests/unit/architecture-boundaries.test.js) 行数检查且 ≤ 450 行；`main.js` ≤ 420 行且不升反降；`inspector_controller.js`、`compare_workspace_controller.js`、`focused_roots_controller.js`、`input_controller.js` 均 ≤ 450 行。
    2. `timingAnnotation.js` 拆分后主门面文件 ≤ 500 行，对外导出符号与行为 100% 兼容。
  - **验证入口**：`npm run test:architecture`、`npm test`（含 `architecture-boundaries.test.js`）。

- [x] **AC-18（对应 `REQ-18` / `A02`）**
  - **功能与脚本断言**：
    1. 全局搜索 `collapseLargeGroups` / `expandedGroupIds` 仅存在于旧存档/Golden 兼容解码与初始化兼容边界；7 个业务控制器端口不再暴露/透传折叠状态。
    2. 导入含 `collapseLargeGroups: true` 的旧版 Session JSON 仍可安全恢复视图（走全图或 Search-first，不抛错并有界提醒）。
    3. 直接运行 `node tools/test-mapped-cases.mjs --no-collapse --hard` 与不带环境变量运行 `npm run test:mapped-cases` 均执行全节点非折叠模式（47/47 通过）。
  - **验证入口**：[session-codec.test.js](../../tests/unit/session-codec.test.js)、[layout-golden-import.test.js](../../tests/unit/layout-golden-import.test.js)、`npm run test:mapped-hard`。

- [x] **AC-19（对应 `REQ-19` / `A05`, `A08`, `A09`）**
  - **卫生断言**：
    1. `A05`（独立提交）：`git ls-files --eol` 检查除明确二进制或 `-text`（`vendor/graphviz/*`）外，全仓工作树 **0 个 `w/crlf`、0 个 `w/mixed`**；`terminal_log.sh` 与 `run_oracle.sh` 在 Linux/bash 可直接执行无 `\r` 报错。
    2. `A08`：`src/layout/nodePlacement.js` 移除后 `npm test` 与 `npm run test:architecture` 全通过；`tools/` 未归档孤立脚本清理清单完成对照。
    3. `A09`：确认根目录下 `%SystemDrive%/`、`node-preview-smoke.*.log`、`mytest/` 及冗余 `dist/` 旧解压包已清理方案可执行（不误删正经版本或用户源码）。
  - **验证入口**：`git ls-files --eol`、`git diff --check`、`npm test`、`npm run test:architecture`。

- [x] **AC-20（对应 `REQ-20` / `A06`, `A07`）**
  - **文档与界面断言**：
    1. `A06`：`docs/PLAN.md` 中 Stage 5 / `R5-1` 状态已更新为已完成并链接到 Liberty 实现与验证文档；`docs/STAGE_8_PLAN.md` 与历史归档文档链接经 `npm run test:docs` 检查 `missing=0`（且全量扫描 `docs/` 所有 `.md` 文件 0 断链）。
    2. `A07`：`index.html` 中提示文案语种统一、快捷键说明一致、Compare 两侧 timing `<input accept="...">` 包含 `.sta`、Navigator tabs 具备完整 `aria-controls` 与 `role="tabpanel"` 关联。
  - **验证入口**：`npm run test:docs`、[ui-workbench-e2e.mjs](../../tests/e2e/ui-workbench-e2e.mjs)。

### Wave 6：`REQ-21`–`REQ-22`

- [x] **AC-21（对应 `REQ-21` / `P01`）**
  - **性能与硬约束断言**：
    1. 运行 `node tools/test-one-mapped-case.mjs tests/fixtures/mapped/datapath/dp_020_mapped.v --no-collapse --hard`：`violations=0`、`layoutStatus="routed"`、峰值堆 `heapUsedMiB` 相比当前基线（1,592 MiB）显著回落（目标逼近或低于历史 600–700 MiB 量级）且 `layoutMs` 不高于基线（目标相比 20.4s 显著下降）。
    2. `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-hard` 全量 47/47 通过、`violations=0/0`，`npm run benchmark:mapped` 无任何小/中用例回归 > 10%。
  - **验证入口**：`npm run test:mapped-hard`、`npm run benchmark:mapped`。

- [x] **AC-22（对应 `REQ-22` / `P02`）**
  - **浏览器交互与挂载断言**：
    1. 执行 [frontend_interaction_performance.mjs](../../tests/e2e/frontend_interaction_performance.mjs) 五轮定量双对比（遵循 [frontend_interaction_performance_2026_11.md](./frontend_interaction_performance_2026_11.md) `measurementVersion: 2` 口径）：Netlist 4K 缩放恢复代理 P95 ≤ 100 ms、平移恢复代理 P95 ≤ 100 ms、持续缩放/平移帧间隔不低于候选基线（≤ 48.2 / 82.0 ms 且阻塞大幅下降）、1K 小图无回退。
    2. `sop_015_mapped.v` 在浏览器 90 秒预算内可稳定完成挂载（或进入明确可用的分段完成态且无超时、无页面错误）。
    3. 手势结束后文字、跨线桥、点击热区与静态 SVG 导出几何 100% 完整，期间布局 Worker 调用 0、整图替换 0、保存 0。
  - **验证入口**：`npm run benchmark:frontend`、[netlist_gesture_details_e2e.mjs](../../tests/e2e/netlist_gesture_details_e2e.mjs)、[aig_gesture_details_e2e.mjs](../../tests/e2e/aig_gesture_details_e2e.mjs)。

---

## 3. 波次签收与证据留档表

| 波次 | 最低签收门禁组合 | 需留存的对比/日志证据 |
| --- | --- | --- |
| **Wave 0** | `G1` + `G5` + `ui-workbench-e2e` + `remote_design_acceptance` | 多文件 Undo/Redo + Compare Port 居中/芯片不串视口/远程 `compare split` 回退证据 |
| **Wave 1** | `G1` + `G2` + `G4` + `G5` | 解析属性/转义/位宽越界注入单测结果；47/47 mapped `violations=0` |
| **Wave 2** | `G1` + `G4` + `G5` + `test:aig` + `test:aig-views` + `benchmark:aig` | 时序乱序一致性、跨层深度 ≥ 10 验证、DOT 解析加速数据 |
| **Wave 3** | `G1` + `G2` + `G3` + `G4` + `G5` + `workbench-e2e` | **Simple 冻结零差异比对表**；`dp_001..sop_015` 0 违规；Worker `cause` 与 Log JSONL 导出样本 |
| **Wave 4** | `G1` + `G5` + `G6` + `G7` | Linux `ctest` & `test:remote-protocol`（或明确标注环境）；Windows `release:windows` 包 SHA-256 与冒烟报告；Inspector Log JSONL |
| **Wave 5** | `G1` + `G2` + `G3` + `G7` | **独立 CRLF 归一纯格式提交 SHA**；`git ls-files --eol` 0 漂移报告；模块行数统计对比 |
| **Wave 6** | `G1` + `G2` + `G3` + `benchmark:mapped` + `benchmark:frontend` | `dp_020` 修复前后堆/耗时对比；五轮 `windows_full_formal_summary.json` 达标报告；`sop_015` 浏览器加载通过记录 |

## 工具归属与本地保留窗口（AC-19）

以下脚本均可独立运行。保留入口与原路径，复验历史报告时可直接调用。

| 用途 | 工具 |
| --- | --- |
| BLIF 聚焦预算、mapped 堆、测量分配 | [BLIF 聚焦](../../tools/benchmark_blif_focused.mjs)、[mapped 堆](../../tools/benchmark_mapped_memory.mjs)、[测量分配](../../tools/benchmark_measurement.mjs) |
| 生成大图输入与汇总浏览器轮次 | [生成器](../../tools/generate-large-example.mjs)、[交互汇总](../../tools/summarize_frontend_interactions.mjs) |
| 冻结前 Simple 管线只读诊断 | [分阶段 profile](../../tools/profile-mapped-pipeline.mjs) |
| 可选 Liberty 解析与历史基线对照 | [基线比较](../../tools/compare_liberty_baseline.mjs)、[解析 oracle](../../tools/liberty_oracle.py)、[读取器核对](../../tools/test_liberty_cases.mjs) |
| Liberty 外部综合、重试与独立真值校验 | [生成综合样例](../../tools/synthesize_liberty_cases.py)、[合并重跑清单](../../tools/merge_liberty_synthesis_runs.py)、[综合 oracle](../../tools/liberty_synthesis_oracle.py)、[控制组](../../tools/test_liberty_synthesis_controls.mjs)、[真值校验](../../tools/test_liberty_truth.mjs) |

本地维护时，用 `git ls-files --others --ignored --exclude-standard --directory` 盘点忽略项。保留已交付版本的 ZIP、校验和、当前验证包与最近两个验证版本。其余 `dist/` 解压副本先按版本、修改时间与归档内容核对，再在资源管理器中逐项移入回收站。对根目录 `%SystemDrive%/`、`mytest/` 先检查内容和归属，保留个人输入和源码。已结束任务的 `node-preview-smoke.*.log` 和 Python `__pycache__/` 可按同一方式回收。本次未删除本机历史包或个人文件。

## 4. 本次实测记录

所有 mapped 产品测试均以完整图和 `native-layered` 为默认入口。Linux 计算、浏览器 E2E 与 CMake 验证在 `mfs-remote` 的独立工作目录运行。Windows EXE、离线包及 Windows 前端性能验证在本机运行。下列数字对应同一项测试的实际输出。

| 波次 | 实测证据 |
| --- | --- |
| Wave 0 | Linux Chrome 的 UI 和远程命令用例分别验证端口居中、单侧 root chip 保持对侧变换、双源 Compare split Undo/Redo。实际刷新后重新列出的所有模块及三项 Compare 同步状态与刷新前一致。损坏多文件快照的 JSONL 有 `session.invalid-files`、文件数量、模块与原始异常。 |
| Wave 1 | 越界向量解析与建图 0.25–1.22 ms。同机 1,501 个模块、4,000 个单元的图构建中位数从 76.71 ms 降至 29.70 ms。 |
| Wave 2 | 24 组 scope、1,200 个实例路径、1,000 个引脚的时序查询中位数从 183.15 ms 降至 8.32 ms。5.40 MB 与 10.84 MB DOT 的解析中位数分别从 162.10 / 313.92 ms 降至 129.27 / 257.04 ms。浏览器实测从 AIG 切回 Verilog 仅解析一次。11 个 AIG 视图场景通过。 |
| Wave 3 | 确定性、布局 fixture 及冻结对照均通过。14 万节点的 P2 平衡结点与 P3 宽层用例在原基线均栈溢出，修复后两个用例均通过。重复上游 critical-cycle 探针产生 400 / 800 次分裂，同核三轮中位数为 938→215 ms / 3,402→567 ms，依赖、线段和分裂结果摘要均相等。Workbench Chrome E2E 验证布局取消、旧回调隔离及 Compare、SVG 导出、会话刷新。Chrome 独立打开产品导出的 SVG，逐项比对 timing 徽标、引脚、黑盒、常量、隐式线网、hub、两侧选中轮廓和导线的计算样式。冻结摘要见下表。 |
| Wave 4 | Linux 原生 CTest 7/7，远程协议检查 50/50。Linux 与 Windows 均实测 Node、Python 启动流程，Windows 冒烟排空 stdout/stderr 各超过 32 KiB。 |
| Wave 5 | 独立换行提交 `4ea7ace` 固化 LF。基线索引中的文本已经是 LF，提交仅需修改 `.gitattributes`。旧折叠请求恢复为完整图并记录有界提示。两份 Bash 入口的可执行位独立记录在 `c37d7c2`，Linux 已验证直接启动及 oracle 脚本语法。 |
| Wave 6 | `dp_020` 三轮布局为 18.442 / 18.594 / 18.489 秒，11,398 条边全部布通。Windows 4K 五轮缩放 / 平移恢复 P95 为 12.0 / 65.2 ms。真实 `sop_015` 三轮完整挂载为 29.886 / 30.417 / 32.134 秒，全部 44,248 个对象、39,107 个线段命中区及 28,263 个标签均可用。 |

分波回滚可按下列本地提交定位。日志、兼容性与真实浏览器验收记录在同一功能批次交付。

| 波次 | 提交 | 独立验证 |
| --- | --- | --- |
| Wave 0 | `c8a750b`、`96c4737`、`9c05363` | 单测 1,501 项及真实刷新、远程操作。 |
| Wave 1 | `1559639` | 解析、IR 和 Process Log 浏览器专项通过。此中间树全图硬门禁也通过 47/47。 |
| Wave 2 | `a882425` | 单测 1,517 项及 AIG、时序失败浏览器场景通过。时序门面在此波随匹配逻辑提取。 |
| Wave 3 | `48f4aba` | 默认布局器 47/47。该波自身的 Simple 全图 47/47 与 3 份原图、6 份手动位移图均逐字段等于冻结基线。Worker 日志、Single/Compare 独立 SVG 样式和大层防栈回归通过。 |
| Wave 4 | `34e16f6`、`ae19295`、`72b2ce7` | 启动器、Inspector 日志及并发远程命令实测通过。 |
| Wave 5 | `4ea7ace`、`c37d7c2`、`aad5762` | 换行、可执行位、业务清理分别提交。架构与退役清理中间树单测 1,530 项。 |
| Wave 6 | `2d89a15`、`9ce8341` | 同机布局、真实浏览器及 Simple 对照详见下文。 |

### 最终集成门禁

| 门禁 | 实测结果 |
| --- | --- |
| G1 | Linux 单测 1,544/1,544，无跳过。文档链接检查 793 项，0 个失效本地文件链接。运行时 AST 检查 416 个模块、1,034 条依赖边，未解析引用、跨层违规、依赖环均为 0。回放 LF 和权限提交之后的 12 个功能与测试提交，每个版本都通过 AST 门禁。 |
| G2 | 显式全图硬门禁与默认产品入口均通过 47/47。硬门禁 `violations=0/0`，最长布局 18,547 ms，校验后堆读数最高 611 MiB。 |
| G3 | 47 份 Simple 布局摘要逐项一致，见下方逐例记录。 |
| G4 | 布局确定性与 fixture 专项 5/5。解析、图提取、时序输入置换与不可变集合测试均列入 G1。Chrome 另验证只读集合的写入方法不能改动源模型。 |
| G5 | Chrome 全量远程指令覆盖通过，182 个命令均已覆盖，目录 `missing=[]`，64 个挂起请求达到队列上限后返回 `QUEUE_FULL`。Chrome 打开 Process Log 详情并导出 JSONL，校验导入、Inspector 剪贴板拒绝、损坏多文件会话、Worker 的原异常、堆栈与 cause。取消、替换及重试归属由单测与 Workbench E2E 覆盖。 |
| G6 | Linux CTest 7/7，远程协议 50/50，验证了并发请求期间的监听端点归属。Windows 解压 EXE 的工作台与 AIG/Netlist 冒烟均通过，外网请求数 0。核对包内全部 424 个 src 文件及四份许可证。 |
| G7 | 独立 LF 与 Bash 文件权限提交见 Wave 5。全仓文本的索引与工作树均为 0 个 CRLF、0 个混合换行。`git diff --check` 通过，控制器预算见下表。 |

### Wave 6 性能与离线交付

同机 `dp_020` 布局从 38.449 秒降至中位 18.489 秒，也低于审计记录的 20.4 秒。标准命令在校验后读取 `heapUsedMiB`，同机从 1,531 降至三轮 275 / 170 / 307 MiB。独立 V8 采样中，GC 前堆占用最高观测值从 1,350.05 降至 1,018.50 MiB，仍高于 600–700 MiB 的参考目标。进程 RSS 高水位在同机基线为 1,778 MiB，修复后三轮约 1,234 / 1,318 / 1,168 MiB。独立的强制回收诊断测得 P4、P5、导线构建后和最终校验后的存活对象分别约 105、141、122、90 MiB。P2 遇到 1,867 次零位移 pivot，保持原 2,100 次迭代上限并保留告警。原始相位、堆与路由记录保存在忽略目录 `dc_runs/issue_remediation_2026_11_25/dp_020_profile_summary.json`。

正式性能批次为每例的建图、首次及重复拖动、首次及重复 Focus 共设 60 秒预算。正式基线完成 43/47，最终版完成 44/47，完成项均为 `routed`。`sop_014` 新进入预算；`dp_020`、`sop_004`、`sop_015` 在该性能批次仍超时，其完整图硬约束均通过。正式批次各自完成集合的建图、拖动、重复拖动、重复 Focus 中位数分别从 2,379.6 / 4,918.5 / 4,741.7 / 0.4 ms 变为 1,891.0 / 3,022.3 / 2,901.1 / 0.2 ms。对基线能在该预算内完成的全部 43 例，每例又做基线及最终版本各四次同核交错测量。对正式单轮超过阈值的 `eq_005`，用第二枚 CPU 反序复测至各八次，总计 352 个独立 Node 进程。建图、拖动、重复拖动及重复 Focus 的 172 组中位数均在 10% 回归线以内，最高回退为 `dp_001` 重复拖动的 7.53%。独立延长运行的三个大图中，`sop_004`、`sop_014`、`sop_015` 分别在 98.4 / 57.8 / 99.0 秒完成全部操作并得到 `routed`。这些时间包含手动重布线与聚焦操作。原始逐例基准与配对测量保存在忽略目录 `dc_runs/issue_remediation_2026_11_25/mapped_benchmark_summary.json`。

Windows Chrome 保持相同视口、面板与输入，两个版本在每个规模各预热一轮后实测五轮。4K 缩放 / 平移恢复 P95 从 682.6 / 349.0 ms 降至 12.0 / 65.2 ms，活动帧间隔 P95 的逐轮中位数从 100.0 / 117.8 ms 降至 35.3 / 6.0 ms，阻塞时间中位数从 105 / 233 ms 降至 40 / 0 ms。1K 恢复 P95 从 161.6 / 134.5 ms 降至 13.2 / 15.6 ms。所有候选轮次的手势期布局 Worker、整图替换与会话保存均为 0，连续输入间亦无保存。4K 单击选择反馈的逐轮 P95 中位数从 137.3 降至 122.7 ms，1K 从 42.5 降至 36.7 ms。大图完成态的挂载与下载 SVG 几何摘要均为 `d807a17fcbd2a4f4cb840569acc84e278063c43203491f1c8710e2daec11301d`。Windows 五轮原始指标汇总保存在忽略目录 `dc_runs/issue_remediation_2026_11_25/windows_full_formal_summary.json`。

7 单元的 `sop_001` 揭示了手动重布线的固定成本。12 个全新进程的 V8 采样中，移动逻辑累计 172.1 ms，其中选路 101.2 ms、评分 45.0 ms、对已评分候选的重复比较 23.4 ms。只对默认 provider 复用同轮候选分数后，双核四批各 6 对独立进程的移动耗时中位数从 14.05 降至 12.50 ms，移动后的图和完整 SVG 均逐字节一致。

Windows 离线产物为 `dist/NetlistGraphBuilder-v1.7.0-win-x64-remediation-20261125.zip`，大小 10,722,468 字节，SHA-256 为 `9537642b8449060701138a743e78335bbf458ecf463b8f81f4c59962048b03d4`。实测源文件和包内文件得到相同的许可证摘要。

| 许可证 | SHA-256 |
| --- | --- |
| ELK | `89591d4578fb1ebd91501312a3d25f021bd865a2e436641c1cf7b1bc7e3c1617` |
| Viz | `f1fb91bf7cbcb42b2af56949e4fa909e1979d5b57c2826cabacdb4b631457720` |
| Graphviz | `0becf16567beb77fa252b7664631dd177c8f9a1889e48995b45379c7130e5303` |
| Expat | `31b15de82aa19a845156169a17a5488bf597e561b2c318d159ed583139b25e87` |

### Wave 5 模块预算

按源码物理行计数。单测使用换行符拆分计数，同时计入文件尾的空项。

| 模块 | 审计基线 | 修复后 |
| --- | ---: | ---: |
| `main.js` | 418 | 406 |
| `domain_workbench.js` | 700 | 442 |
| `inspector_controller.js` | 516 | 439 |
| `compare_workspace_controller.js` | 502 | 442 |
| `focused_roots_controller.js` | 500 | 447 |
| `input_controller.js` | 492 | 446 |
| `timingAnnotation.js` | 1724 | 212 |

### G3 冻结输出对照

对审计基线与修复树使用相同的输入、显式 `simple-layered` 和完整图选项，按布局对象的字段及序列计算 SHA-256，忽略耗时字段。两端 47/47 同名用例的摘要逐项相等。首轮 45 秒快照预算内完成 40 对，其余 7 对在独立快照作业中等待计算完成。在 `9ce8341` 的手动布线与工作区缓存修改后，再对全部 47 例复验，逐份核对 1,020 个源码、fixture、工具与离线依赖的文件摘要。最终 47 例全部与同一份基线匹配，其中 `dp_020` 301.28 秒、`sop_004` 257.57 秒，均等待至自然结束。最终复核日志 SHA-256 为 `9ecca7b0a0c3ecaf79e198a6044649259b368ba27f4fd54b2773fb0ce04db970`。

对 `sop_001`、`eq_001` 和 `dp_001` 的自动布局及各两次实际位置覆盖进行逐字段比较。修复未标记图的 provider 识别后，全部九行摘要与基线逐字相同；`dp_001` 单点移动重布了 24 条边。在工作区入口强制触发超重图逐出后，对三份 Simple 输入各取五类图与场景对象，自动及两次拖动产生的 45 个摘要与引入弱引用缓存前相同。另对 2,575 节点的 `dp_018` 验证 Simple 未启用合成视口，33,400 个线段与完整节点 SVG 标记的摘要与基线一致。下表记录两端共有的布局摘要。

<details>
<summary>展开 47 个 Simple 全图结果的 SHA-256</summary>

```text
be67740819491dc08100b2ff0d4e54d591ccde7be2b3525712c951137aced526  dp_001_mapped.v
e5fdfd0913f232a1edadb9d037ae927ebc1c20430137a19981b27f535b1eba95  dp_002_mapped.v
5fa0e14bbcc5c19c7389c64ab5b4653993a00165849fbb85ab59d65d3dce9cff  dp_003_mapped.v
03e1cb8757c0bc6a711332241ebe6b76a1156564a139b1df7c85a64231beb4ed  dp_004_mapped.v
58fe871bec8a31c517e2c55ba463f9d13336b764df35c51fab9b49150a56f4b1  dp_005_mapped.v
30d34a82092c8c841a6c227a5b39ff3c072bb8722410dcac07593935725b92c5  dp_006_mapped.v
3b363469047af709301561bff0d328f1d56e7a98845c7a7127c518afe48f9f4e  dp_007_mapped.v
5c39859b088bd0bd4c9f87584ab90c0e81ec4e2c841ec9847a07b1b82a6fd64f  dp_008_mapped.v
24f2fc39220e57b70eb1751cc1244c6f60e937dc12785391539b23c6e7fd530e  dp_009_mapped.v
18d32a585950ac97750d912523c837cb62df13894be6ccf9f749952388fd434d  dp_010_mapped.v
28c90e80ff2b782f4011b912b4d516810dbe054f9c6aca7faf9b365de4023e45  dp_011_mapped.v
5d4f7f41c3d6e905a41b603b373cb9e2cdc8c0a4b8bff186b8ead8c47feef9d8  dp_012_mapped.v
cd00ceda09550d5b7db62e7f2af1cd25d96fb327fa89aa599218f7afa0966779  dp_013_mapped.v
6d2fc4fe0cc7a13d852eff93d3ee8dc9e1d0d919ee775eb0abc6fe29f7637d28  dp_014_mapped.v
eda4cc5fb0fa2e1cf9f45436a58d4dc9d4a434683dd6f7fb51f0369ac8abffd9  dp_015_mapped.v
b00ec1be36290b28bef05d18d5576082396e11dfe11d38eddad25dbaeab24210  dp_016_mapped.v
7ca75cb6c35ae7976162855ee4862e4e7b390cbdf192b632b10363c1875c68de  dp_017_mapped.v
e36981e569c09de36b348ef6cd58b76f32a0bd3be06ca2da17592eaa645dd0e6  dp_018_mapped.v
7c051575a7d34f1eefc02d0f17c61fb5c8ff4f4e58d4971b64e9bd7aef87f3f8  dp_019_mapped.v
fd05d45f4767a4b388238996204ff15a50d4a57526d3558d85e92cc0630236e5  dp_020_mapped.v
eb3348f955508997118771eea3d3730c74b6d30a5f4f8aa07b4e494b357c1626  eq_001_mapped.v
688566d60b472920114f8d59e550ec72b6efb7e2f287a68249f220f4f236ef2a  eq_002_mapped.v
2b92a4b2b38ca0a57bbd49b33c791c1cf27e1275de5c5ae3b39516cda1f8981a  eq_003_mapped.v
01e4bd95a460b74979d9a7d4d426f4143da1e51e38f5b92e21f82523ec58048e  eq_004_mapped.v
6b0f25283f1f89fa537511ac229c2473cee4d3483f2f7a6c49da527d1f631f44  eq_005_mapped.v
688566d60b472920114f8d59e550ec72b6efb7e2f287a68249f220f4f236ef2a  eq_006_mapped.v
069bb53dc24d0bad2f963b8727f7de0425b616ff68904593edb3ae7492a15d35  eq_007_mapped.v
1dd6c408146299cd6b8c76d39c13c956832e535a9094415540e057a52c7eb432  eq_008_mapped.v
2d32e4f02f099dd157d0dccdb44a1c96ac8fd6af40b0540bfa61c26b042079d4  eq_009_mapped.v
96330b8f3a636c1ba1a510501d7e5d3f20c198d2de523e5724858cc5eeaa8c80  eq_010_mapped.v
76cb772b8cabf42e4c84c6650efd0dbf7652c27c0a5a40fa9795e5e41009095d  eq_011_mapped.v
1f9796426607dcdcf1b01c8168dd4a7afdf3b1cc5bae84d4ddb56a2d989fc5cf  eq_012_mapped.v
9d6dd842901f9b1513077e2ca15ef0153be1d3835958588e19fd4a077b6d6e48  sop_001_mapped.v
84df4e2a97a0975040aaecd1fd09ba0c8c55a8f57bff09b23316ad660ff33429  sop_002_mapped.v
884320d98c59d11b4b2f560802e870e7517afd902fa2234df8abf02dced0f6dc  sop_003_mapped.v
6296159c0fe1200bb88b0969888d15b2ddd8e83172170fb7be076558b7c503f8  sop_004_mapped.v
9280cba2d0a3c70f0acfe848407d1ec29ca258299d26787ee655ecb3ba46b98f  sop_005_mapped.v
492cb49803080b4234a3f4b3890a6270b948f839a4ead7a04f159f95e4acf8a8  sop_006_mapped.v
c28ba6242194b1ecb304894b1d4baa131c89283e04abaa2b87f8bb9b135dc0db  sop_007_mapped.v
e1d693635d253856fc58322d0c2c20a8b372db3c5d7c284df0e64a7995ab96d4  sop_008_mapped.v
0bb78d579e970a97a89a8d8c74af0f89b939f1f0b0fd7646785a8a82cd59d233  sop_009_mapped.v
9280cba2d0a3c70f0acfe848407d1ec29ca258299d26787ee655ecb3ba46b98f  sop_010_mapped.v
3ca0915ebde3993a8e7db583730370dd6fd9f7724fa04bc3c38b0ad37a9f6cab  sop_011_mapped.v
b3b8d0c7194c71c8624a8054a0403645ba85faf84c01bdbbb6cf01ede22abf94  sop_012_mapped.v
b589de43d3a8873960cdce437f474f6151f8883daa1f0a3a34d7755c70f20b56  sop_013_mapped.v
62b8ca8c6d03c0df0ec431872adaa06ae41627e3d2ade113a0ed22d0085362d0  sop_014_mapped.v
6fa9065caa5288a6e84a7e4b36024a59e50b9a68bb46e9acfbdd4135d2100a09  sop_015_mapped.v
```

</details>
