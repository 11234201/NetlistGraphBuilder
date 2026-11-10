# Liberty reader 首版验证记录

日期：2026-11-10；分支 `codex/liberty-reader`，起点 `a8a1a0e`。验证已结束；通过、既有失败与未支持范围分别记录。

## 环境与范围

计算环境为 mfs-remote，Linux 6.2.0-32-generic、Intel Xeon Gold 6248R 3.00GHz（96 逻辑 CPU）、Node v24.16.0。工作目录 `/home/wzh/my_code/netlistGraphBuilder/liberty_reader_20261110`；完整库位于 `/home/wzh/open_source/ngb_liberty_corpus_20261110`；日志位于工作目录 `dc_runs/liberty/`。浏览器为服务器既有 Chrome 146 / Playwright。

运行时为原生 JS ESM，没有新增运行时依赖。Python 差分工具单独安装到远端 `dc_runs/liberty/oracle_env`：liberty-parser 0.0.29、lark 1.3.1、mpmath 1.3.0、numpy 2.2.6、sympy 1.14.0。不把 GPL 工具或库语料复制到产品包。

## 真实语料字段对照

来源提交与许可入口见 [调研记录](liberty_open_source_and_fixtures.md)。逐 cell 名、pin 名、direction、原始 function 对照独立 Python parser；不能外推为完整 Liberty 或 STA 语义验证。

| 语料 | 字节 | cells / pins | 未解释差异 | JS 解析+模型 ms | 模型字节 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Nangate45 typical | 6692032 | 135 / 541 | 0 | 265.18 | 212424 |
| IHP sg13g2 typ 1.20V 25C | 1720231 | 84 / 285 | 0 | 106.86 | 96834 |
| IHP sg13g2 fast 1.32V -40C | 1721355 | 84 / 285 | 0 | 110.26 | 97091 |

SHA-256：

- Nangate45：`8d540a4d4cf6d09d27c87ad067857a9c0c2eeb023ab7a56e058cd3113db4e9b1`
- IHP typical：`7677a8918689f452e80405ad16a83e744709342574f2aedcc507c2758986b396`
- IHP fast：`f191a3132d0f2f59ca2721884cdb1d8360c8fbf3e0012056af62583dd69ae701`

真实语料首次发现 Nangate 时钟门控单元的 `direction : internal` 被归一化成 unknown。已在 Library IR 保留 internal，并在共享语义层排除外部数据连线；补充回归后上述三库零差异、零模型告警。首次 Nangate 下载超时残片未使用；系统原有 Python 包缺依赖，未修改全局环境，改用隔离 venv。

复现示例（在远端工作目录）：

```sh
dc_runs/liberty/oracle_env/bin/python tools/liberty_oracle.py /home/wzh/open_source/ngb_liberty_corpus_20261110/nangate45.lib dc_runs/liberty/nangate45_oracle.json
node tools/test_liberty_cases.mjs /home/wzh/open_source/ngb_liberty_corpus_20261110/nangate45.lib dc_runs/liberty/nangate45_oracle.json
```

## 性能

`npm run benchmark:liberty` 使用固定行长的被跳过 timing 表，分别精确填充 4/16/64 MiB 输入。单次冷进程内递增输入的记录如下，非多次统计或通用硬件性能承诺。

| 输入 MiB | 解析+模型 ms | 保留 IR 字节 | 进程峰值 RSS MiB（累计） |
| ---: | ---: | ---: | ---: |
| 4 | 89.55 | 949 | 66 |
| 16 | 298.51 | 950 | 88.67 |
| 64 | 1174.96 | 952 | 155.14 |

64 MiB 低于预设 15 秒预算；输入四倍时耗时未超过八倍；跳过数组不随输入进入 IR。原文与词法临时对象仍占内存，不能宣称总内存常量。

常规 `npm run benchmark` 的 1024/4096/8192 cell 均 routed、硬违规 0；布局中位数分别 196 / 1484 / 6507.6ms，保留全部原始日志，不作为 parser 加速对比。

## 产品门禁

- 原始 HEAD 单测 913/913；首轮实现回归 917/920，修复旧签名断言、测试桩窄查询声明和入口行数后 920/920。新增更完整的接口/缓存/取消反例后，最终候选 **926/926 通过**，24.27s。日志 `final/dc_runs/liberty/unit_final.log`。
- 架构最终 247 模块、585 依赖、零未解析/越层/环；main 入口门限 611 → 530（当前 517 行）。
- 浏览器初轮文件导入、来源详情、错误保留、Compare 替换/卸载、混合拖放、扫描取消通过；扫描取消 31.5ms，无 pageerror。最终截图复验实际 Cancel 按钮 20.3ms、扫描取消 39.2ms，无 pageerror。截图 `final/dc_runs/liberty/browser.png`。
- **默认 Simple 的 mapped 门禁未通过，但完整 HEAD 对照确认失败已存在。** 相同 `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases`（47 例、45s 原超时）两组均 24 例失败、违规 1688/120，逐例 PASS/FAIL/TIMEOUT 状态差异为 0。日志 `mapped.log`、`mapped_head.log`、`mapped_comparison.json`。没有删除用例、抬高预算或修改布局算法。
- 两组单次最大 layout 时间分别 43395/44180ms，记录到的最大 heap 分别 986/689MiB；此为不同运行的采样值，不据此宣称内存或耗时改善。测试源码、原始日志均保留。
- 既有失败用例：dp_003、005、007、011、015、016、018、019、020；eq_004、011；sop_003–015。其余 23 例通过。本轮没有修复 Simple 的既有路由/超时问题，因此不能宣称仓库全部门禁全绿。
- Windows 发布检查使用本机专属 .NET Framework 编译器，在 `dc_runs/liberty_release_check` 隔离副本运行 `npm run release:windows -- -SkipTests`；单测放在远端完成。最终包约 1.01 MB，SHA-256 `1de365ed83d8cc2359427c8a64a9a3d179400fe035915c6624ef1822a503b792`；逐文件检查全部运行时源码与当前工作区一致。C# 编译、启动/HTTP 资源冒烟、ZIP、新 Liberty 模块与 ELK 许可证校验通过；没有覆盖既有 dist 包。
- 最终候选与 HEAD 的 47 个 mapped 文件、47 个 module 逐对象比较完整无库图，差异 **0**；命令 `node tools/compare_liberty_baseline.mjs ../dc_runs/liberty/head`，日志 `final/dc_runs/liberty/graph_baseline.json`。

## 已知支持边界

不包含 STA、库写回、.db/.lib.gz、include_file、启动器 --liberty、任意布尔等价、bundle 位映射或 bus 成员区间简写。顺序/三态/多输出等保守展示，未知 function 不抹掉已验证方向。同名 cell 跨库冲突拒绝；库仅本页面内存有效。测试覆盖两套公开标准单元库的标量接口，不代表所有商用工艺库已验证。

文档链接检查：9 份相关文档共 45 个相对链接全部存在；外链和锚点不在此检查范围。`git diff --check` 通过。未 stage、commit 或 push；既有用户文件保持原状。

后续已按用户要求重新下载两库、综合 47 份原 RTL，完成 94 组库/新网表闭环校验。独立连接、接口/真值、负对照和实际浏览器输入结果，以及首轮超时与重跑记录见[重新综合配对验证报告](liberty_synthesis_validation.md)；不改写本页原有布局基线结论。

## 2026-11-10 提交后审查与修复

审查基线为 `d8caaf9`（`codex/liberty-reader`）。修复与测试在独立远端目录 `/home/wzh/my_code/netlistGraphBuilder/liberty_review_fixes_20261110` 完成，原始证据位于该目录的 `dc_runs/review/`。本轮不改动布局算法、mapped fixtures 或原有超时/违规预算。

| 缺陷 | 修复边界与回归证据 |
| --- | --- |
| 前导块注释导致 Liberty 自动识别正则指数回溯 | `quickInput.js` 改为单向扫描空白/注释；独立子进程的 10000 个块注释反例在基线达到 5 秒上限，修复后正常识别 Verilog；同时覆盖关键字与左括号间的注释 |
| Unload 后，尚未完成的文件读取重新装载库 | QuickInput 接收 Cancel/Unload 动作，使自己的请求代次和 AbortSignal 失效；真实 library service 与两层 controller 覆盖文件选择、拖放、未知扩展名前缀读取，以及操作后再次导入 |
| 简单属性的括号未检查平衡 | parser 对保留和跳过的 `:` / `=` 属性统一检查括号及深度；缺右括号、多右括号、超深嵌套均拒绝，导入失败保留原库；合法带括号 function 正常解释 |
| 空 Cell Config 的原型属性遮蔽同名库单元 | `cellConfig.js` 查询仅接受自有键，写入将名称作为普通数据属性；覆盖 `constructor` / `toString` / `__proto__` 单元及 pin 的导入导出、删除、普通图与层次语义 |

验证过程与结果：

- 第一批新增测试在提交基线上 **9 项失败**，修复后专项 **37/37**、完整单测 **935/935**。继续审查发现配置原型键问题，两个新反例均先失败；最终完整单测 **937/937**，41.90 秒。日志 `baseline_regressions.log`、`prototype_before.log`、`prototype_after.log`、`unit_final.log`。
- 架构检查：247 模块、585 依赖，未解析/跨层/环均为 0；最终 247 个 JS 文件与本地 SHA-256 一致。库与网表配对复验 **94/94**，106324 cell、422000 pin；独立接口 **56/56**、264 行真值一致。此次复用此前已固定哈希的综合产物，没有重复综合。
- 浏览器新增实际 `File.text()` 延迟后 Unload 的用例，复验再次导入、失败保留、Compare、混合拖放和取消。正常 Chrome 与禁用 GPU 的诊断运行均执行完所有断言，pageerror 为 0；截图确认最终 `fresh.lib` 和 NAND 图正确。**两次均未正常退出清理阶段**：首次 Chrome 留在内核 D 状态，已终止本次测试 runner/预览进程并向该 Chrome 发送终止信号；诊断副本设置 90 秒外层上限，仍未正常结束。保留 `browser.log`、`browser_software.log`，不能将完整浏览器命令记为全绿。
- `npm run benchmark` 完成，1024/4096/8192 cell 均 routed、违规 0；layout 中位数 6627.8/39593.3/96444.5ms，明显慢于前次记录，不作为性能改善证据或归因于此次修复。Liberty 4/16/64 MiB 分别 111.68/402.59/1996.07ms，保留模型 949/950/952 字节，64 MiB 仍低于原 15 秒预算。
- Windows 构建使用本机专属 .NET Framework 编译器，在 ignored `dc_runs/liberty_review_fixes/release` 运行 `npm run release:windows -- -SkipTests`；单测在远端完成。编译、启动/HTTP 冒烟通过，包内全部 248 个 src 文件与当前源码一致，ELK 许可证存在。最终 ZIP SHA-256 为 `8c04b33976bf2f40d928471e4742d47cf575ef2e66500744c42d69f414598744`。
- `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases` 完成 47 例，23 通过、24 失败，失败集合与原始基线一致；`eq_004`、`sop_006` 从违规失败变为超时，不能声称逐项状态完全相同。当前违规 1315/120；由于超时项不计入违规统计，不能将汇总下降解读为质量改善。随后逐对象比较 47 文件/47 模块的完整无库图，差异为 0；日志 `mapped.log`、`mapped_comparison.json`、`graph_baseline.json`。默认 mapped 门禁仍未通过。
- 本轮修复尚未提交或推送；此前功能提交 `d8caaf9` 保留。原有用户改动保持原样，生成物均未加入版本控制；`git diff --check` 通过。

## 2026-11-10 后续审查：接口名称与批量导入

在前述修复基础上继续审查，远端隔离目录为 `/home/wzh/my_code/netlistGraphBuilder/liberty_review_round2_20261110`，证据位于其 `dc_runs/review/`。新增四项修复：

| 问题 | 修复及覆盖 |
| --- | --- |
| bus 名称中的 `$&`、`$$`、`$'`、反引号替换序列或 `%d`/`%s` 被字符串替换机制改写 | 一次扫描格式中的占位符，回调返回字面名称；六种名称均通过 Library IR 与转义 Verilog pin 的实际图绑定检查 |
| 空 `pin()`、`pg_pin()` 和 bus 成员 `pin()` 被静默忽略 | 在 Library IR 边界拒绝缺失名称，保留 source span 错误位置；失败导入不替换原库 |
| 同批多份 Liberty 文件依赖文件顺序，后者静默覆盖前者 | 在任何文件加载前拒绝含多份库的整个批次；覆盖两种工艺角的顺序交换、与网表混合、未知扩展名检测和拒绝后单独加载；使用指南明确该约定 |
| 旧导入取消或旧视图刷新完成后，覆盖新批次的错误提示 | Liberty controller 的异步状态更新同时核对自身代次与外部 AbortSignal；真实 service/controller 的确定性测试覆盖旧解析晚取消和旧刷新晚完成 |

- 四个初始反例在修复前失败，修复后专项 38/38；进一步发现两个状态竞态，先复现失败再修复，生命周期测试 11/11。共新增 **7 项单测**，最终 **944/944**，36.55 秒。日志 `before.log`、`focused.log`、`stale_before.log`、`stale_after.log`、`unit_final.log`。
- 最终架构检查 247 模块、585 依赖，未解析/跨层/环为 0；247 个 JS 文件 SHA-256 与本地完全一致。未新增运行时依赖、修改 main 入口或调整原有资源预算。
- 复用固定哈希的综合产物：配对 **94/94**，106324 cell、422000 pin；独立接口 **56/56**，264 行真值一致。日志 `paired.log`、`truth.log`，报告 `paired.json`、`truth.json`。
- Liberty 4/16/64 MiB 基准分别 104.18/337.14/1313.70ms，保留模型 949/950/952 字节；64 MiB 仍满足原 15 秒预算。这些是单次运行证据，不据此宣称通用加速。
- 完整节点 mapped **47 例全部执行，23 通过、24 失败**，失败集合与原始基线和上轮一致。相对原始基线，`dp_019`、`eq_004`、`sop_012` 从违规失败变为超时；相对上轮，`dp_019`、`sop_012` 转为超时，`sop_006` 从超时变为违规失败。当前违规 944/120；超时项不计入违规汇总，不能将下降解读成质量改善。47 文件/47 模块的完整无库图与原始基线逐对象比较，差异为 0。报告 `mapped_comparison.json`、`graph_baseline.json`；默认 mapped 门禁仍未通过。
- 本机专属 .NET Framework 构建在 ignored `dc_runs/liberty_review_round2/release` 完成，使用 `npm run release:windows -- -SkipTests`，单测已在远端执行。编译、启动/HTTP 冒烟、包内 248 个 src 文件与用户指南一致性、ELK 许可证哈希检查通过。ZIP SHA-256：`e47455f8e91af58f4e4f572561f0395aa6409608ff45337c10c36cc510563349`。
- 上轮 Chrome 进程仍处于内核 D 状态，未发现可用的替代浏览器运行时；本轮没有重新启动浏览器，新增批量导入与竞态由真实导入服务和控制器集成测试验证。保留上一轮浏览器退出清理限制，不增加浏览器全绿记录。
- 修复仍保留在工作区，未提交/推送；未改动原有用户文件。`git diff --check` 通过。

## 提交后复查：混合文件的 JSON 分类（2026-11-10）

前两轮修复已提交为 `3be3615ee6705b2486de051ab5d3345ba7beaf46`（`fix(liberty): harden parsing and import lifecycle boundaries`），未推送。本轮继续修复与库一起导入配套文件时遇到的既有问题；以下改动尚未提交。

- 批量入口原先仅凭 `.json` 扩展名就认定 Golden，导致 Timing JSON 无法自动导入。现在先根据完整 JSON 内容分类，再按 Liberty、网表、时序、Golden 的依赖顺序加载。
- 自动识别原先全文搜索 `points` / `modules` 和格式名称，可能被嵌套字段、合法时序点名称误导，也无法识别 JSON 转义键。现在解析 JSON，只根据顶层对象字段与明确的格式标记判断；具体数据合法性仍由各格式的导入边界校验。
- JSON 字段可以出现在 64 KiB 嗅探前缀之后，因此对 `.json` 文件和以对象开头的未知扩展名文件读取完整内容。读取保持串行，真实 File 的完整分类文本不进入批次缓存；载入阶段再次读取。每次异步读取后核对请求代次，已取消的读取不继续解析或载入。
- 新增 6 项单测，覆盖混合批次顺序、顶层字段与转义键、完整 JSON 要求、长元数据和空白前缀、损坏文件及分类期间的替换请求。修复前 5 项失败，另 1 项取消回归原本通过；修复后专项 **43/43**、全量 **950/950**，全量耗时 25.67 秒。
- 远端快照：`/home/wzh/my_code/netlistGraphBuilder/input_review_20261110`。日志在 `dc_runs/review/before.log`、`focused.log`、`unit.log`、`architecture.log`；架构检查 247 模块、585 依赖，未解析/跨层/环均为 0；247 个 JS 源文件与本地 SHA-256 完全一致。
- 本轮只改共享输入分类和 UI 文件读取，未修改 parser、inference、graph、layout 或 renderer，因此未重复综合配对、mapped 和布局基准。上一轮 94/94 综合配对及默认 mapped 的 24 项既有失败记录保留；浏览器退出清理限制仍未解决，本轮未新增浏览器全绿记录。
- Windows 平台专属发布检查在本地 ignored `dc_runs/input_review/release` 隔离副本运行 `npm run release:windows -- -SkipTests`；C# 编译及启动/HTTP 冒烟通过。初次校验发现 archive 快照中 7 个 `.gitkeep` 的换行与工作区不同，同步这些占位文件后重新构建。最终 ZIP 内全部 255 个 src 文件（含隐藏占位文件）、用户指南及 ELK 许可证共 257 个文件的哈希与工作区一致；ZIP SHA-256：`9592e803131f8d88a93c13317cf24c10750c580be1dee41d9a268ad7c4396532`。
