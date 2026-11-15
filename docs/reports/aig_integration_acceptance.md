# AIG 主界面接入验收记录

日期：2026-11-15。范围：[P0–P5 接入计划](../plans/aig_graphviz_integration.md)。状态：完成。

## 交付

ABC AIG DOT 与平坦 AND/NOT BLIF 已通过现有 File 菜单进入 Single / Whole 主画布。双格式共享不可变模型、稳定编号、来源映射、逻辑深度/关键边/引用扇出分析，以及本地 Graphviz 曲线和惰性 Scene。Navigator、Inspector、名称/来源搜索、逐边连接跳转、平移缩放、SVG 导出、刷新恢复及能力隔离已贯通。

Simple 未解冻；Compare 默认方向未改。AIG Compare、Netlist→AIG、AIGER 和逻辑优化继续属于独立后续范围。

## 环境与快照

- 基线：`b305189029f4ccf867fb7eed622c22ee6d9785b3`。
- 远端根目录：`/home/wzh/my_code/netlistGraphBuilder/aig_integration_20261115/`；Node v24.16.0，Chrome 146.0.7680.164。
- 子目录：`baseline`、`model_tests`、`graphviz_tests`、`candidate_browser`。原始大日志和浏览器报告均留远端 `dc_runs/`。
- 初始用户改动 `.vscode/settings.json` 未触碰；实施中并行更新的 `src/layout/measured_elk_layout.js`、`tests/unit/elk_port_adaptation.test.js` 不归本次 AIG 修改。组合工作区测试记录的是实际送测快照；这些并行文件随后仍有更新，不能把快照验证外推为其后续改动也已验收。

## 正确性与回归

| 检查 | 基线 | 实施结果 |
| --- | --- | --- |
| 完整单元 `npm test` | 1198/1198 | 最终送测快照 1240/1240 |
| 静态架构 | 287 模块 / 693 边，零问题 | 312 模块 / 736 边，零未解析、越层、循环 |
| AIG 语义专项 | 原型不作为生产依据 | 16/16；24 组排列/改名、重复 AND/槽位、OFF cover、别名、常量、异常输入、Unicode、长链与宽图 |
| 独立逻辑参考 | 原始 shared_cone AIGER | 全部 16 个输入组合 × 3 输出真值一致；AIGER 仅用作测试 oracle |
| 外部格式校验 | 既有 ABC / Graphviz 2.43.0 | 新鲜 ABC DOT/BLIF 导出与原生 dot_json 解析交叉验证 5 项通过 |
| 真实 AIG 工作台 | 无生产入口 | 6/6；真实 parser/WASM/Scene/DOM，无全链路 stub |
| 既有 workbench | 通过 | 通过，含历史/拖动/Golden/导出/Compare/恢复 |
| 既有 UI workbench | 9/9 | 9/9 |
| 全节点 mapped | 47/47，0 硬违规 | 47/47，0 硬违规，默认 native-layered；maxLayout 35872ms，maxHeap 546MiB |
| Simple / 几何保护 | 六个模块与 helper 哈希、六组代表快照 | 源码哈希与 Whole/Focused/manual override 几何逐字节相同 |
| 文档链接 | — | 最终默认检查 62 条、AIG 附加检查 17 条，缺失 0 |

工作台六场景覆盖：Netlist Compare→AIG、双格式同图、关键/扇出开关与筛选、精确曲线命中与槽位连接、搜索与选择同步、导出、宽窄屏、跨领域恢复、失败保留旧图、快速文件读取乱序/取消、跨文档 pan 和存储拒绝。没有页面异常、外部资源请求或失败资源请求。

Graphviz 独立单测 6/6，候选生命周期/存储单测 7/7；真实浏览器 10 项检查包括冷/热加载、json/dot_json、平行曲线、Unicode、非法输入、物理取消重建和超时。

## 性能与适用边界

网表 `npm run benchmark` 保持默认 native-layered/full graph。1024/4096/8192 节点 layout median 从基线 344.0/1515.1/4032.5ms 到 392.1/1600.4/4262.4ms，全部 routed、0 violations。两轮均有并行 mapped 任务，差值属于带负载观察，不能单凭单轮耗时归因于代码；默认布局与 Simple 代表几何没有改变。

Graphviz 默认无限 simplex 在 323 节点 / 481 边的固定重汇聚例超过 20 秒。采用 `nslimit=2,nslimit1=2` 后同图约 2.0–2.2 秒，四例节点、边、曲线、箭头、BT 深度分层与重复几何均通过；原失败保留于 [有界策略记录](../research/aig_graphviz_bounded_policy.md)，没有提高超时。

真实浏览器代表性测试 8/8：

| 样例 | 节点 / 边 | 首次 / 再次完整导入 ms | 首次 / 再次 Worker 布局 ms |
| --- | --- | --- | --- |
| 128 层链 | 131 / 257 | 992 / 810 | 848 / 694 |
| 96 宽层 | 194 / 288 | 254 / 248 | 96 / 93 |
| 12×12 重汇聚 | 168 / 300 | 222 / 236 | 74 / 76 |
| 256 扇出 | 516 / 770 | 760 / 717 | 444 / 412 |

每例 6 次高亮切换保持曲线路径不变且没有额外布局调用。50ms 采样的浏览器全部进程 RSS 总和峰值为 730–840MiB，包含浏览器与之前网表工作区的开销，不等于 AIG 精确分配峰值。Node 四例生产基准最大 RSS 约 161MiB。

保留的压力边界：512 层链仍触发 20 秒 Worker 超时，旧图保留；`NGB_AIG_CHAIN_SIZE=512 npm run benchmark:aig-browser` 可复现。首版支持有界失败与取消，不承诺任意拓扑均在预算内完成。源码/对象/规范化工作上限与浏览说明见 [用户指南](../USER_GUIDE.md#aig-图浏览)。

## 离线发布验证

- Vendored Viz.js 3.31.0 / Graphviz 16.1.0，单个约 1.19MB ESM 内含 WASM，无独立 WASM/字体或 CDN 请求。固定文件清单、SHA-256 与 Viz/Graphviz/Expat 许可证见 `vendor/graphviz/`。
- Linux 原生构建成功，ctest 6/6；真实浏览器对单文件启动器 10/10 通过，资源与许可证均内嵌。
- Windows 平台需要 Windows .NET 编译器与 exe 启动器，因此构建和平台烟测在本机执行；其余完整测试/依赖/大日志均在远端。
- 命令：`npm run release:windows -- -SkipTests -PackageSuffix aig-validation`。`-SkipTests` 复用已完成的远端全量单测；独立后缀保留已有发布包，未创建外部发布。
- Windows 验证包：`dist/NetlistGraphBuilder-v1.4.1-win-x64-aig-validation.zip`。最终 SHA-256：`496951cb61887ba97079f6649dfd731a53832b76acb175cc353efe64cbd4babc`。
- `node tests/e2e/windows-aig-release-smoke.mjs` 用本机无界面 Chrome 实测 Windows exe 启动、网表首屏、BLIF / DOT 真实 WASM 同图、切回网表，以及无页面异常/外部请求。截图/报告在本地 ignored `dc_runs/aig_windows_release/`。
- 包内所有 AIG/共享接线源码、样式与 Graphviz 资源均与最终本任务源码一致。上述并行的 `measured_elk_layout.js` 在首次构建后继续更新；最终包保留重建时实际快照，对其外部后续变更不作验收结论。

## 复验入口

```sh
npm test
npm run test:architecture
MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases
npm run benchmark
npm run test:aig-browser
npm run test:graphviz-browser
npm run benchmark:aig
npm run benchmark:aig-browser
```

浏览器测试使用已安装的 Chrome 和 Playwright：工作台与性能脚本设置 `NGB_CHROME=/opt/google/chrome/chrome`，Graphviz 独立脚本设置 `NGB_CHROMIUM_PATH=/opt/google/chrome/chrome`；两类均设置 `NGB_PLAYWRIGHT_MODULE=/home/wzh/my_code/papers-highlights-20261017/node_modules/playwright/index.mjs`。上述依赖属于测试环境，产品运行时不需要它们。

## 2026-11-15 代码审查修复复验

本轮修复四项问题：旧 Netlist 文件读取覆盖新 AIG、Graphviz 标签反斜杠损坏、切换文档后搜索控制器残留结果，以及 AIG 的 F 快捷键拦截 Ctrl/Meta/Alt+F。统一导入请求覆盖选择文件、拖放和粘贴；切换领域调用已有搜索清空边界；Netlist/AIG 共用 F 快捷键保护。标签修复同时覆盖 Graphviz JSON 对连续反斜杠的尾部截断，使用投影原始纯文本与引擎文字位置组合，未修改 vendored 引擎或 Simple。

修复前，新增浏览器用例分别复现导入、搜索和快捷键失败；真实 WASM 标签测试复现连续反斜杠截断。最终候选验证如下：

| 检查 | 结果 |
| --- | --- |
| `npm test`，包含布局确定性及 fixture 不变量 | 1252/1252，0 失败、0 跳过 |
| `npm run test:architecture` | 315 模块、741 依赖边，0 未解析/越界/循环 |
| `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases -- --hard` | 47/47，0 违规，provider=`native-layered` |
| AIG 真实浏览器工作台 | 9/9，双向延迟读取、三种文档切换搜索清空、修饰键与输入法保护均通过 |
| Graphviz 真实浏览器 | 11 项通过，24 个特殊标签经 Worker、领域流水线与 SVG 保持一致，0 外部请求 |
| 通用 UI 工作台 / 既有工作台 | 9/9 / 完整工作流通过，无页面异常 |
| Windows 离线包 | 构建与真实 Chrome 烟测通过，0 页面异常/外部请求，保留 ELK/Viz/Graphviz/Expat 许可证 |

远端快照及日志：`/home/wzh/my_code/netlistGraphBuilder/aig_integration_20261115/candidate_browser/`，全量验证日志位于 `dc_runs/review_fixes/`，Graphviz 标签报告为 `dc_runs/graphviz_escaped_labels_browser.json`。本机只执行 Windows 平台打包和启动器烟测，完整单元及浏览器回归均在远端执行。

新验证包为 `dist/NetlistGraphBuilder-v1.4.1-win-x64-aig-review-fixes.zip`，SHA-256 为 `e133c4209cfd003cacb83b167a912f0b74947b7716849e6e7044e672a38741af`。构建命令为 `npm run release:windows -- -SkipTests -PackageSuffix aig-review-fixes`，复用本轮远端全量测试；此前验证包保留，未发布外部附件或提交代码。

## 2026-11-15 第二轮检视与修复

本轮进一步发现并修复五项问题：

1. DOT 的引用标识符（如 `";"`、`"}"`、`"->"`）误入语法分支，混合大小写关键字及拼接赋值键也被拒绝。语法匹配现在区分 token 种类与引用状态，仅对关键字忽略大小写；新增 72 种标识符位置组合检查。
2. 缺省 DOT 标签把源 ID 当作转义模板，含 `\N` 的名称会自替换并重复。缺省标签现在使用源 ID 字面值，显式 `\N` 仍只替换一次。
3. 超过 100 个对象时，`Show selection` 清除筛选后停在第一页，无法显示选中项。现在复用筛选索引定位实际页码，保留仍匹配的筛选/排序，并允许手动翻页；当前页外的选中项有明确定位入口。
4. Source 面板将规范化边极性误标为别名极性。现在分别显示原始边极性、规范化边极性、原始目标和槽位，节点的别名极性展示保持不变。
5. 延迟返回或失败的启动清单仍可覆盖用户新打开的 Netlist/AIG。启动读取与后续阶段现在共享导入请求生命周期，过期结果不能加载设计、继续写入 timing/focus/ready 或执行错误回退。

主入口提取完整启动装配，行数上限进一步由 462 降至 460。浏览器导入竞态断言同时排除了状态栏重排带来的合法视口调整，继续严格核对源文档、选区、策略和完整几何；独立视口测试保持原有断言。

最终验证：

| 检查 | 结果 |
| --- | --- |
| `npm test` | 1262/1262，0 失败、0 跳过 |
| 架构依赖检查 | 316 模块、742 依赖边，0 未解析/越界/循环 |
| full graph mapped 硬不变量 | 47/47，0 违规，provider=`native-layered` |
| AIG 工作台浏览器 | 10/10，含 150 个对象的定位/筛选/分页回归 |
| 启动清单生命周期浏览器 | 4/4，Netlist/AIG × 旧清单成功/HTTP 500 |
| 通用 UI / 既有工作台 | 9/9 / 完整流程通过 |
| Node/Python launcher e2e | 通过 |
| Windows 离线包 | 构建及真实 Chrome 烟测通过，0 页面异常/外部请求；323 个打包源码文件与当前源码一致 |

日志保留于远端候选目录的 `dc_runs/review2_fixes/`；新增启动回归入口为 `node tests/e2e/startup-lifecycle-e2e.mjs`，沿用工作台浏览器环境变量。最终 Windows 验证包为 `dist/NetlistGraphBuilder-v1.4.1-win-x64-aig-review2-fixes.zip`，SHA-256 为 `9334e4f2836c2426eae28f50c070dfcdd74cd313ea24aac57efd13ec1aaa27ce`。完整测试在远端执行，本机仅进行 Windows 构建与烟测；Simple、既有发布包和外部发布状态保持不变，未提交代码。

## 2026-11-15 第三轮检视与收敛

本轮复现并修复七项问题：

1. 缩放或平移后导出的 SVG 带有交互视口变换，完整图形会被裁剪。导出现在从当前 Scene 生成完整 SVG，保留选区、高亮和文字样式，不携带画布视口变换。
2. 排队中的 wheel/pan 帧可能覆盖 Fit、Focus 或外部视口，wheel/pan 交接也可能丢失缩放。领域画布统一刷新或废弃旧手势帧，显式视口命令拥有最终状态。
3. AIG 中同时拖入 Netlist 与 Liberty 时，先处理库文件会被当前领域拒绝。批次通过注入的优先级先成功切换 Netlist，再应用附件；原 Netlist 的库文件优先顺序保持不变。失败或被新 AIG 替代的批次不会改变原工作区。
4. SVG 默认折叠标签中的连续空格、首尾空格与制表符。AIG 文字图元使用内联 `white-space:pre`，屏幕与独立 SVG 均保留源名称空白。
5. AIG 搜索结果激活后浮层仍遮挡画布。搜索控制器统一在激活时收起浮层，保留查询并支持方向键重开；Add to Focused 行为保持不变。
6. 输入法组合期间的 Enter 被当作搜索激活。组合输入期间的搜索按键现在交由输入框处理。
7. 帮助弹窗中的 F 键会移动背后画布。Netlist/AIG 共用的焦点快捷键现在尊重打开的对话框。

每项都有修复前的失败断言或真实 Chrome 复现；修复后交叉复查解析/模型/Scene、导入/任务/存档生命周期、视口/搜索/快捷键及最新装配边界，在本轮审查范围内未再发现新的已确认问题。

| 检查 | 结果 |
| --- | --- |
| `npm test`，含确定性及 fixture 不变量 | 1271/1271，0 失败、0 跳过 |
| 架构依赖检查 | 316 模块、744 依赖边，0 未解析/越界/循环；main 行数门限仍为 460 |
| full graph mapped 硬不变量 | 47/47，0 违规，provider=`native-layered`，maxLayout 34202ms、maxHeap 551MiB |
| AIG 工作台浏览器 | 11/11，含完整图导出、排队手势、搜索组合输入和弹窗快捷键回归 |
| AIG 混合导入浏览器 | 3/3：成功切换并应用库、失败保留原图、新输入取消旧批次 |
| Graphviz 真实浏览器 | 12 项通过，24 个转义标签及 4 个空白标签检查通过，0 外部请求 |
| 通用 UI / 既有工作台 | 9/9 / 完整流程通过，0 页面异常 |
| 网表基准 `npm run benchmark` | 默认 native-layered/full graph；1024/4096/8192 节点全部 routed、0 violations |
| AIG 基准 `npm run benchmark:aig` | 4 类拓扑通过，生产有界策略，重复几何一致 |
| Windows 离线包 | 构建及真实 Chrome 烟测通过，0 页面异常/外部请求；323 个包内源码文件与工作区一致，四类许可证完整 |

网表基准三次中位 layout 为 349.0/1548.6/3932.8ms，仅作为本轮带负载运行记录，不据此归因性能变化。完整回归与基准运行于远端 `candidate_browser/dc_runs/review3_fixes/`；Graphviz 标签复验日志为 `dc_runs/aig_whitespace_after.log`。新增批次回归入口为 `node tests/e2e/aig-import-batch-e2e.mjs`，沿用工作台浏览器环境变量。

Windows 平台构建与烟测在本机完成，构建命令为 `npm run release:windows -- -SkipTests -PackageSuffix aig-review3-fixes`，复用本轮远端全量测试。验证包：`dist/NetlistGraphBuilder-v1.4.1-win-x64-aig-review3-fixes.zip`；SHA-256：`d2cb9da95512efbded98ac106c48aeaa1f6b6d516334ae00665af0dc5c556438`。Simple 冻结代码及用户已有设置未修改，未提交或推送代码。

## 2026-11-15 第四轮主界面审查

本轮通过真实浏览器复现、边界单测及交叉审查，修复十项问题：

1. 剪贴板 API 缺失或同步失败时，AIG Copy 操作抛出未捕获异常。平台复制边界统一异步失败，界面提供手动复制提示；工作区切换后旧复制回调不再覆盖状态。
2. 新 AIG 源文本超出浏览器存储配额时，旧存档残留并在刷新后恢复旧图。保存失败现在移除旧快照；当前图仍可操作，后续小文件可正常存档。
3. AIG 显示上份 Netlist 的诊断。网表诊断入口随领域能力隔离，返回网表时恢复原有展开状态；AIG 期间的 Log 开关不再改变该状态。
4. 面板按钮激活后重绘导致键盘焦点丢失。面板交互控制器按语义标识恢复页签、分页、对象及筛选框焦点，分页边界转移到仍可用的按钮。
5. 筛选框在输入法组合期间重绘并删除原输入节点。组合输入保持原节点，完成后只应用一次最终文本；已用真实 Chrome CDP IME 验证。
6. wheel/pan 与侧栏或窗口 resize 双向交接时覆盖未提交视口。领域暴露当前可见预览，共享 resize 通过可选预览通知交接；手势帧不新增持久化或同步测量。
7. 延迟 Cell Config 导入在 AIG 激活后仍刷新旧网表并覆盖状态。全局配置保存与当前领域的界面效果分离；失败保留日志，非当前领域不弹冲突确认框。
8. `prepareImport(state.cellConfig, await file.text())` 在读取前捕获旧配置，并发导入会覆盖较新定义。现在先完成读取，再获取最新配置；不同单元合并，同名冲突使用最新快照。
9. SVG 被放大显示时，指针换算将单位比例限制为至少 1，造成拖动过量及缩放锚点漂移。坐标转换采用实际 `xMidYMid meet` 比例，缩放步长、上限和聚焦策略保持不变。
10. wheel 已显示但尚未 settle 时刷新，保存的是旧视口。现有保存边界读取当前可见预览；真实刷新发生于 11.4ms，重载前后物理倍率均为 1.3077333389，画布尺寸相同。

修复后分别复查面板、手势交接、公共 shell、异步配置、复制及存档生命周期，本轮范围内未再发现新的已确认问题。`main.js` 仅替换视口接口接线，行数门限仍为 460；新职责位于 UI 控制器和原有领域/平台边界。

| 检查 | 结果 |
| --- | --- |
| `npm test`，含确定性及 fixture 不变量 | 1294/1294，0 失败、0 跳过 |
| `npm run test:architecture` | 318 模块、746 依赖边，0 未解析/越界/循环 |
| AIG 主工作台浏览器 | 12/12 |
| AIG 面板/手势浏览器 | 6/6，含真实 IME、双向 resize 交接、60×30px 拖动及非中心滚轮锚点 |
| AIG shell / Cell Config 浏览器 | 6/6，含诊断恢复及延迟配置成功/失败/冲突 |
| AIG 存档浏览器 | 4/4，含真实配额不足、后续恢复及未 settle 时刷新 |
| 通用 UI / 既有工作台 | 9/9 / 完整流程通过，0 页面异常 |
| Windows 离线包 | 构建及真实 Chrome 烟测通过，0 页面异常/外部请求；325 个包内源码文件与工作区一致，ELK/Viz/Graphviz/Expat 许可证完整 |

本轮改变交互坐标及状态边界，未修改 parser、推断算法、布局/路由或 Scene 渲染；映射网表和性能基准沿用上一轮记录，不将旧结果记为本轮重跑。完整单测与浏览器回归在远端 `candidate_browser` 执行，主日志在 `dc_runs/review4_fixes/`；shell 报告为 `dc_runs/aig-shell-1794718898209/report.json`，存档最终报告为 `dc_runs/review4_fixes/storage-final/report.json`。新增专项复验入口：`tests/e2e/aig-interactions-e2e.mjs`、`tests/e2e/aig-shell-e2e.mjs`、`tests/e2e/aig-storage-e2e.mjs`，沿用工作台浏览器环境变量。

本机仅执行 Windows 平台构建与烟测。构建命令：`npm run release:windows -- -SkipTests -PackageSuffix aig-review4-fixes`。验证包：`dist/NetlistGraphBuilder-v1.4.1-win-x64-aig-review4-fixes.zip`；SHA-256：`748dd2339a81d2c3e9120ffd4029465e952f047e232f97b6e561ac6a7d55580b`。Simple 和用户既有设置未修改，未提交或推送代码。

## v1.5.0 发布验证（2026-11-15）

用户授权提交及发布后，版本提升为 v1.5.0。发布候选的完整源码在远端独立目录 `/home/wzh/my_code/netlistGraphBuilder/aig_integration_20261115/release_v1_5_0/` 验证，日志位于其 `dc_runs/`；个人 VS Code 路径设置不纳入提交。

- 全量单测 1294/1294；架构检查 318 模块、746 依赖边，零违规/循环；文档链接 62 项无缺失。
- 重新执行 full graph mapped 硬不变量：47/47、零违规，provider=`native-layered`，maxLayout 35982ms、maxHeap 649MiB。本次带并行构建负载，不据此归因性能变化。
- Linux x86-64 / glibc 2.35 下构建单文件启动器，CTest 6/6，Node/Python 启动器检查通过。
- `NGB_NATIVE_EXECUTABLE=<binary> node tests/e2e/aig-workbench-e2e.mjs` 对真实 Linux 单文件执行完整 AIG 浏览器回归，12/12，通过内嵌 Graphviz/WASM 运行，无外部请求或页面异常。
- Windows 使用 `npm run release:windows -- -SkipTests` 重建，复用本轮远端单测；当前版本自动寻址的 Windows 浏览器烟测通过，包内 325 个源码文件与工作区一致，VERSION 为 1.5.0，启动器文件版本为 1.5.0.0。

| 发布附件 | SHA-256 |
| --- | --- |
| `NetlistGraphBuilder-v1.5.0-win-x64.zip` | `089bcd31bfb8b6ab9fa0889a485d0eae6051cc067cb9fcb7efd01e4bbb9e672f` |
| `NetlistGraphBuilder-v1.5.0-linux-x64` | `50db2efc4309449a675e626681f680167870ef6cc15dd0d692e3de79e9c982d1` |
| `ngb.tcl` | `9f2c816f7e93c426230e5e2b006e6398f586adf13a41537383e66e163c857417` |

三个附件均配独立 `.sha256` 校验文件。Windows 包包含 ELK/Viz/Graphviz/Expat 四类许可证；Linux 单文件内嵌同类资源与声明。构建产物作为发布附件分发，不进入源码提交。
