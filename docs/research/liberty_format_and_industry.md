# Liberty 格式与工业实现公开资料调研

日期：2026-11-10。范围：标准单元 Liberty 文本 `.lib` 的读取与结构语义增强。不是操作系统静态链接库 `.lib`，也不是新增完整 STA。

本文仅使用公开官方产品资料、厂商公开培训与可核查开源代码。商业工具解析器内部源码、具体容错算法与当前版本完整语法覆盖不可见；不能将下面的产品行为描述当作内部实现审计。开源候选与测试库见[开源调研](liberty_open_source_and_fixtures.md)，实施路线见[阶段 5 计划](../STAGE_5_PLAN.md)。

## 1. 工业工具可核查的做法

| 体系 | 已核查的公开事实 | 对本项目的启示（建议） | 本轮证据边界 |
| --- | --- | --- | --- |
| **Synopsys Liberty / Library Compiler** | TAP-in 将 Liberty 定位为门级 timing/noise/power/test 建模格式；获取格式资料需要注册并接受对应许可。官方 Library Compiler 培训目录包含库结构与创建流程 | 把库看作有身份和诊断的独立源数据，语法读取后再建立语义索引；不要把 `.lib` 等同于 pin 名称表 | 培训目录可检索，课程正文未读取；没有运行 `lc_shell`，不宣称当前命令选项或商业二进制库格式兼容 |
| **Synopsys PrimeLib / PrimeTime** | PrimeLib 官方说明包含库表征与 QA、多 PVT、生成供 PrimeTime 使用的高级 Liberty 模型 | 库名、PVT、来源文件是不同维度；当前只消费结构字段也应保存来源身份，未来才可能扩展 timing 元数据 | 产品功能声明，不是 parser 代码或性能实测；不能据此承诺签核精度 |
| **Cadence Liberate / Liberate Trio** | 官方公开介绍说明 Liberate 生成 Liberty；Trio 可生成 AOCV/SOCV/LVF，面向局部和全局变化建模 | 合法工业库包含大量与本阶段无关的 timing/power/variation 内容；必须安全跳过而非简单拒绝整份文件 | Liberate RAK 摘要可检索，直接打开受 403 限制；Trio 页面正文可读，未运行商业工具 |
| **Cadence Innovus 的 MMMC 工作流** | Cadence 工程师 2022 年公开培训分别介绍 library set、RC corner、timing condition、delay corner、constraint mode、analysis view；library set 可以关联多份 `.lib` | 多个角的同名 cell 不应按文件加载先后静默覆盖；需要明确库集合/选择绑定，但本项目不必复制完整 MMMC 系统 | 厂商原始培训资料的公开托管副本，反映该资料版本的工作流，不能推断所有当前版本 CLI 行为 |

来源：[Synopsys TAP-in](https://www.synopsys.com/community/interoperability-programs/tap-in.html)、[Library Compiler 官方课程目录](https://training.synopsys.com/learn/course/external/view/elearning/1071/library-compiler-introduction-and-creation-of-libraries)、[PrimeLib 官方产品页](https://www.synopsys.com/implementation-and-signoff/signoff/primelib.html)、[Cadence Liberate 公开 RAK 摘要](https://support1.cadence.com/public/docs/content/20466590.html)、[Liberate Trio variation modeling](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/library-characterization/liberate-trio-characterization-suite/process-variation-modeling.html)、[Cadence 原始培训，2022-10-07，第 21–32 页](https://indico.in2p3.fr/event/26958/contributions/108925/attachments/73140/104908/part3.pdf)。

**可以采纳的工程原则**：解析、校验、链接、分析分层；来源与条件可追踪；缺项和冲突有明确诊断；只在消费者需要时物化大数据。最后一项主要由开源 reader 的实现支持，是本项目的设计建议，不声称它就是商业工具内部算法。

本轮没有签署格式下载协议、获取非公开规范、使用商业许可证或访问用户工艺库。搜索中的 Design Compiler 手册镜像直接打开失败，因此不作为命令或 `.db` 细节的证据。`.db` 读取不在本阶段范围。

## 2. 读取功能需要分清三层

```text
Liberty text -> lexical / structural reader -> Library IR
                                                   |
Verilog text -> structural parser -> Netlist IR -> semantic resolver
                                                   |
                                   graph / hierarchy -> layout -> scene
```

- **语法层**回答“这个组叫什么、有哪些参数和属性、源位置在哪”；不依据单元名猜 NAND/DFF，也不修改 Verilog IR。
- **库语义层**回答“哪个 cell/pin、方向是什么、function 指向什么信号、是不是顺序单元、属于哪个库”；只验证本阶段承诺的语义。
- **消费层**将库信息与明确用户覆盖、现有命名规则组合，决定连接方向、可显示的门种类和来源。timing 报告导入仍独立，不从库表擅自算出 Slack。

这与当前项目 `parser -> netlist IR -> inference/analysis -> layout -> render -> UI` 的边界兼容，是建议实现结构，尚未成为运行时实现。

## 3. 必须在设计阶段明确的格式问题

| 类别 | 典型形式/问题 | 建议处理 |
| --- | --- | --- |
| 嵌套语法 | `library(...) { cell(...) { pin(...) { ... } } }`；simple/complex attribute 混用 | 用带状态 lexer 和结构 reader；不能靠跨行正则或简单寻找下一个 `}` |
| 字符串与注释 | 引号内含括号/花括号/注释符，转义引号、反斜杠续行、CRLF | 字符串、注释、普通 token 各有状态；诊断保留 offset/行列 |
| 未使用的大块 | `timing`、`internal_power`、lookup tables、CCS/LVF 等 | 消费词法结构但不构造无用大数组；区分“结构上跳过成功”和“已验证完整语义” |
| function | `!A`、`A'`、`A B`、`A*B`、`A&B`、`A+B`、`A|B`、`A^B`、括号、常量 | 单独表达式 parser；明确优先级，不使用 JavaScript `eval`，不做无界等价搜索 |
| 顺序单元 | `ff`、`latch`、内部状态符号，输出 function 可能只引用状态变量 | 先识别顺序结构；不能看到 `function: IQ` 就归为 buffer；未支持模型保留为黑盒 |
| 三态与双向 | `direction: inout`、输出的 `three_state` 条件 | direction 与驱动使能是两回事；保持 conservative 连接关系并标注，不把三态输出误转为普通 BUF |
| 电源地 | `pg_pin`、`pg_type`、相关电源属性 | 独立于信号 pin 保存或显式略过；不因缺 signal direction 自动生成普通数据输入 |
| 总线与 bundle | `type` / `bus_type` / range / `bus_naming_style`，pin bit 或多名称参数 | 不能压成一个标量名或随意展开位序；MVP 至少检测并诊断，后续做继承、成员与连接位映射 |
| 多输出 | 不同输出各有 function；反相关系可能不一致 | 以 output pin 保存语义；暂不把一个复杂多输出 cell 强行归为全局 NAND/INV 符号 |
| 库冲突 | 多 corner、同名 library/cell、重复 pin/属性 | 保留候选与来源，明确选择；禁止静默 last-write-wins |
| include 与扩展 | `include_file`、用户定义属性/组 | 本阶段不自动联网或读取任意本地路径；若未提供 include 内容，明确诊断文件不完整，不能悄悄算作完整导入 |

语法参考来自 [OpenSTA structural grammar](https://github.com/parallaxsw/OpenSTA/blob/044c18fd67770315c8783fc227a6a2e31d13f341/liberty/LibertyParse.yy)、[OpenSTA function grammar](https://github.com/parallaxsw/OpenSTA/blob/044c18fd67770315c8783fc227a6a2e31d13f341/liberty/LibExprParse.yy)、[Yosys Liberty frontend](https://github.com/YosysHQ/yosys/blob/ad78a39992898a4aa8ec38744255442bc8d6a16c/frontends/liberty/liberty.cc) 与 [liberty-db 类型实现入口](https://github.com/zao111222333/liberty-db/tree/c1e36c1298892355843871076140fbcad4083c69/src)。这些源码是实现参考；最终接受语法与宽容扩展应在 fixture 中明确，不能声称覆盖完整最新规范。

## 4. 与仓库当前实现的接入分析

以下是本轮读取 `a8a1a0e` 工作树源码后观察到的事实：

1. [defaultCellRules.js](../../src/infer/defaultCellRules.js) 按类型名和引脚名推断；黑盒 fallback 还可能补足输入/输出。库声明方向不能被这类兜底重新改写。
2. [graph.js](../../src/netlist/graph.js) 的 `getCellPinDirections` 当前优先使用真实子模块端口方向，再使用实例 override、Cell Config、命名规则。已有 `moduleLibrary` 是 **Verilog 模块定义集合**，不要拿同名字段存 Liberty。
3. [cellConfig.js](../../src/infer/cellConfig.js) 是严格 v1 用户配置；字段没有 library/corner/function/source span。把库压成这个格式会丢失来源，也把自动导入误标为 `user-config`。
4. [hierarchy_connectivity.js](../../src/domains/netlist/hierarchy_connectivity.js) 单独调用 `inferPinDirection`；[netlist_feature.js](../../src/domains/netlist/netlist_feature.js) 的 connectivity 模板目前只按 document 对象缓存。库变更后必须使这条路径与普通图同步更新。
5. [workspace_identity.js](../../src/app/workspace_identity.js) 已包含 Cell Config 依赖；库集合的内容版本和绑定策略也应进入相应计算身份，不能只用同一个文件名。
6. [netlist_feature.js](../../src/domains/netlist/netlist_feature.js) 的 `queryView` 通过领域投影进入共享工作区；新库导入用例应放在领域层，DOM 控制器只触发命令，main 保持组合边界。

**建议的优先级**：真实子模块定义继续拥有模块身份与有效端口方向；对外部 leaf cell 的每个字段按“显式实例覆盖 → 用户 Cell Config → 选定 Liberty 声明 → 内置规则 → fallback/unknown”解析。direction、gate kind、function 的来源分别记录，不使用一个 cell 级来源标签冒充全部字段来源。库与人工覆盖冲突可见，但不悄悄撤销人工修正。

特殊边界：综合库若同时以 Verilog stub 模块形式加载，当前代码会将其作为子模块。第一版沿用此身份判定并报告冲突，不能仅因名字出现在 `.lib` 就把真实层次改成 leaf；stub 绑定策略另列后续项。

**建议的失败模型**：新导入先解析、校验、准备绑定，再原子提交。结构破坏（未闭合组/字符串）、资源超限、依赖缺失导致的整体不完整应保留上一份有效库及画面；合法文件中的个别不支持语义可明确降级，方向等已验证字段仍可使用。卸载库后恢复原有无库行为。

## 5. 当前结论与待验证项

- 结构浏览需要的是可靠接口语义；完整 NLDM/CCS/LVF、插值、寄生参数和 STA 传播是另外的工程目标。
- 原生 JS reader 的风险主要在语法边界、稀有库结构和大文件内存，不在提取 `direction` 本身；必须先建立最小反例和真实库差分。
- 工业工具内部实现不可公开核查；本轮没有证明与 Synopsys/Cadence 的完整兼容。若后续有可用商业环境，可对相同授权语料做补充对照，不能把其结果或私有库自动提交到仓库。
- 待实测：真实库字段覆盖、未知组跳过的内存收益、浏览器导入/取消延迟、加载库后完整图与跨层连接一致性、同名文件不同内容的缓存失效。
