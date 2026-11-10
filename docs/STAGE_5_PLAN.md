# 阶段 5：可选 Liberty 读取与语义增强

更新日期：2026-11-10。开发分支：`codex/liberty-reader`；起始代码：`a8a1a0e`。

状态：**首版实现与验证已完成（默认 mapped 存在已复现的基线失败）**。用户后续授权详细计划与编码测试，实际范围见 [实施计划](plans/liberty_reader_implementation.md)，证据与限制见 [验证报告](research/liberty_reader_validation.md)。

后续重新取得两套库，完成 94 组 fresh synthesis 配对、独立接口/真值与浏览器检查，见[重新综合验证](research/liberty_synthesis_validation.md)。首轮 4 个综合超时及成功重跑记录均保留。

调研依据：[开源实现、解析库与测试语料](research/liberty_open_source_and_fixtures.md)、[格式与工业实现公开资料](research/liberty_format_and_industry.md)。执行状态统一记录于[执行计划](plans/execution-plan.md)与[工作日志](progress/work-log.md)。

## 1. 目标与范围

可选读取标准单元 Liberty `.lib`，提高 cell/pin 语义可靠性，保留精确来源与诊断。无库仍是正常默认路径；未知或不支持的单元继续以 blackbox 浏览。库读取不改变 Verilog parser 的纯结构职责。

第一轮交付以标量 pin 接口为核心：library/cell/pin、direction、原始 function、源位置，以及对 sequential/three-state/pg_pin/bus 等结构的识别与支持状态。布尔表达式识别、总线位语义、多库管理分阶段准入；不得把“能跳过”描述成“完整支持”。

本阶段不做完整 timing/power 数值模型、NLDM/CCS/LVF 插值、STA/Slack 计算、商业二进制 `.db` 读取、任意规模布尔等价验证、库写回或 group collapse。第一版不承诺 `.lib.gz`；若扩展，需把解压后大小和取消能力纳入统一输入限制。

## 2. 建议技术路线与替代方案

| 方案 | 判断 | 改选条件 |
| --- | --- | --- |
| 原生 JS lexer + 结构 reader + 选择性 Library IR | **已采用**；符合当前离线 ESM、无 bundler/安装步骤的运行契约 | 真实语料证明语法覆盖和资源预算可接受后准入 |
| Rust liberty-db + WASM | 候补；类型覆盖和表达式模型值得参考 | JS 实测确有瓶颈，且固定 WASM 构建、依赖许可、包体和浏览器成本可接受 |
| Python/Rust 命令行预处理成版本化库摘要 | 可作为可选大库入口及开发期差分工具 | 用户流程确需超大库；不能替代默认浏览器直接读取功能 |
| 嵌入完整 OpenSTA/OpenTimer | 当前不选 | 只有产品另行进入 STA 范围时再评估 |

原生 JS 方案须从词法状态与分组结构开始，不写跨文件大正则提取器。读取未知组仍检查字符串/注释/括号平衡，但不建立 timing/power 表格数组；语法检查成功不等于完整库语义验证成功。

## 3. 模型、接入和来源策略

### 独立 Library IR

已建立独立 `LibraryDataset`（libraries + cells 索引），包含源文件名和大小、不可变附件身份、library 名称、cell/pin canonical 与 display 名、direction、原始 function、source span、诊断、支持状态。保留可获得的 PVT 标记作为来源信息，不生成时序结果。名称索引避免原型键碰撞，不对 cell/pin 统一转大写。

库数据为不可变源数据；选用哪个库/如何处理同名 cell 属于显式绑定策略。不要借用现有 `moduleLibrary`（它表示 Verilog 模块集合），也不要自动转成 v1 Cell Config 后持久化为用户编辑。

### 共享语义解析

- 真实子模块继续拥有模块身份和有效端口方向；leaf cell 按字段执行“实例显式 override → 用户 Cell Config → 选定 Liberty 声明 → 内置规则 → fallback/unknown”。已由共享 resolver 实现；配置与库冲突保留诊断。
- direction、function、gate kind 分别标记来源。用户配置与库冲突应能查看；Liberty 声明不能被 blackbox 的输入/输出兜底改写。
- `graph.js` 与 `hierarchy_connectivity.js` 消费同一解析规则，Single/Compare 使用同一库快照与绑定版本。层次模板缓存、工作区缓存和任务身份都要包含库语义版本。
- 对未支持的 sequential/three-state/多输出功能采用保守黑盒标签，不因 cell 命名或 `function: IQ` 错画 BUF。方向已知时仍可使用准确连接。
- 同名 Verilog 模块与 Liberty cell 的身份冲突必须可见；第一版保持既有 module 优先规则，不启发式吞掉真实层次。Verilog stub 的特殊绑定另行设计。

### 导入生命周期

由 Netlist 领域用例负责解析、诊断、准备库绑定及提交，UI 只发命令；通用 application 层只调度，不解析 Liberty。main 只增加必要组合接线，并遵守其缩减行数预算。

采用 prepare/commit：新输入成功准备后原子替换；结构错误、资源超限或无法满足的 include 依赖不覆盖有效状态。任务可取消，过期结果不得提交。显式卸载后恢复无库推断。第一版库内容默认只保留在当前运行状态，刷新后提示重载；若增加 Session/Golden 保存，需单独版本化 codec 和大小策略，不悄悄写入 localStorage。

多文件中同名 cell 不按导入顺序取胜。初版可直接报告冲突并保留旧库，后续增加显式库绑定；同接口跨 PVT 候选也不能擅自合并 function。`include_file` 暂不自动解析外部路径，必须诊断；将来只允许明确提供的文件集合内解析，且检测循环与深度。

## 4. 分阶段开发与准入

粗略成本按单人专注工作日估计，包含专项测试、不含未知商业库兼容成本；不是完成时间承诺。

| 阶段 | 优先级 / 成本 | 可证伪假设与工作 | 验收 / 主要风险 | 当前状态 |
| --- | --- | --- | --- | --- |
| L0：基线与契约 | P0 / 1–2 天 | 标量接口足以解决首批方向错误；固定测试库/工具版本与输出契约，先记录无库基线 | 选定真实 cell 对照表、资源限制与性能门槛在实现前冻结；风险是只挑简单 gate | 完成：913 项基线与统一资源限制 |
| L1：reader 与 Library IR | P0 / 2–4 天 | 扫描结构并跳过大表可保留正确接口，降低保留模型内存 | 自写语法反例全过；Nangate/IHP 支持子集字段零未解释差异；未支持项有诊断；截断/超限不提交 | 完成：三份真实库字段差分零 |
| L2：共享语义接入 | P0 / 2–3 天 | 一个 resolver 可让普通图、层次分析和 Compare 一致 | 输入不变性、来源优先级、方向冲突、库卸载及缓存失效测试；47 个原有 full-node mapped case 保持门禁；风险是漏掉独立推断路径 | 完成接入：缓存/优先级测试、47 图等价；mapped 与 HEAD 同为 24 例既有失败 |
| L3：导入 UI 与工作区 | P0 / 2–3 天 | 可取消的原子导入不会破坏现有画面与双侧状态 | 文件选择/拖放一致、错误保留旧图、来源可见、HTML/SVG 转义、过期任务不提交、离线浏览器实际验证 | 完成：实际浏览器与离线包验证 |
| L4：function 与特殊单元 | P1 / 2–4 天 | 有界表达式分类能提升标签且不误标复杂单元 | 支持 NOT/AND/OR/XOR/括号/常量/隐式 AND；MUX/AOI/OAI 只在识别证据充分时显示；FF/latch/三态/多输出反例不误判 | 完成首版子集；AOI/OAI 保持复杂黑盒 |
| L5：bus、多库与启动器 | P1 / 3–5 天 | 显式范围/绑定可避免靠字符串猜测 | bus/type/bundle 成员方向和位序、同名库冲突、导入顺序不变性；如新增 `--liberty`，四类启动器及 Tcl 协议一致 | 部分完成：显式 type bus、冲突拒绝；bundle/区间简写/启动器延期 |

先完成 L0，再实现 L1；L2/L3 形成首个可用版本。L4/L5 不阻塞标量 MVP，但 UI 必须标示其未支持状态。新增 gate kind 若超出现有 Cell Config/Scene 支持集合，需要单独扩展契约，不能只新增一个字符串然后假设渲染支持。

## 5. 验证矩阵

| 边界 | 必需证据 |
| --- | --- |
| 词法/结构 | CRLF、注释内/字符串内分隔符、转义与续行、空组、simple/complex 属性、深嵌套、超大 token、非法/截断输入、重复标识符、未知组后续 cell 正常读取 |
| 库语义 | 缺/非法 direction、inout、pg_pin、同名 cell/pin、多个 library、bus/bundle 检测、sequential/三态标记；名称区分大小写且原文可追溯 |
| function | 语法优先级与有限真值表对照；常量、顺序状态、多输出、条件三态；超预算时明确不分类，不做指数级无界搜索 |
| 解析器差分 | 固定版本工具读取相同文件，逐项比较共同支持的字段；不能把 Yosys 忽略 cell 后的成功退出当全库通过 |
| 图与层次 | 库/Netlist IR 深冻结输入；Single/Compare/跨层 driver-load 结果一致；真实子模块优先；人工覆盖和 fallback 来源清晰 |
| 生命周期 | 同名文件换内容、库替换/卸载、旧任务晚返回、失败回滚、两侧 Compare 更新与取消、缓存键包含语义版本 |
| 大库 | 固定输入大小梯度、timing/power 密集块；记录 wall time、峰值内存、保留模型大小、取消响应。原文字符串本身占 O(N)，不得宣称整体常量内存 |
| 产品回归 | `npm test`、`npm run test:architecture`、`MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases`；复杂度变化运行 `npm run benchmark`；新增包资源/启动参数时验证 Windows/Linux 发布 |

正式测试与构建优先在 `mfs-remote`；项目位于 `/home/wzh/my_code/netlistGraphBuilder`，第三方源码位于 `/home/wzh/open_source/<repository-name>`。使用隔离快照或工作目录，不覆盖服务器上已有用户工作；大库、依赖、差分结果与日志留在服务器，仅带回小报告和必要 fixture。

L0 必须命名并集中定义输入字节数、nesting/token/cell/pin/诊断数量与取消预算，固定后不因单个失败样例私自放宽。扫描工作量目标随输入大小近似线性；索引排序等额外工作独立计量。性能结论必须带输入/工具版本与硬件环境。

## 6. 本轮收尾与下一步

- 已完成：开发分支与调研、L0–L4 首版 reader/Library IR/共享语义/UI、真实库差分、资源基准、无库基线与 Windows 包验证；新增两库 × 47 RTL 的综合配对、独立真值及浏览器验证。
- 保留限制：默认 Simple mapped 的既有失败已用原始 HEAD 对照复现；L5 中 bundle/成员区间简写、启动器导入等尚未实现，库仍为页面内存附件。
- 后续按 L5 的明确需求扩展接口和加载入口；已有验证工具与固定库/RTL 可作为新增能力的回归基础。新能力不能绕过已冻结的资源、来源优先级和共享 Single/Compare 契约。
