# BLIF 适配与网表局部路径分析实施计划

日期：2026-11-18。需求已对齐，实施尚未开始。按本次调整，先完成并独立验收 R1–R5，Show Path 连同双 level、界面和存档变更整体放到最后。当前只更新计划与开发规范，不修改功能代码。

本计划让 BLIF 能导入完整的两输入逻辑并追溯设计名称，为 AIG 增加 Focused，并在 Netlist 和 AIG 中提供可与 Focused 配合的 Show Path。两侧重收敛均限定于当前展示的逻辑子图。路径信息同时列出起点、终点、源图 level 和相对 level。

## 1 已确认需求与交付边界

| 编号 | 已确认需求 | 交付内容 | 实施批次 |
| --- | --- | --- | --- |
| R1 | BLIF 先补齐两输入逻辑 | 支持零、一、两输入 `.names` 的完整布尔函数，包含 `-`、多行 cover、XOR/XNOR；继续转换为 AND 与反相边 | 先行 P1 |
| R2 | 读取头部名称映射 | 输入、输出、内部信号均支持原始 ID 和映射名搜索、映射表、节点详情与定位 | 先行 P2 |
| R3 | BLIF 支持与 Netlist 一致的抽逻辑功能，名为 Focused | AIG 的 BLIF 与 ABC DOT 共用多根、Fanin/Fanout 深度、追加/替换 roots、Whole 恢复 | 先行 P4 |
| R4 | 重收敛两边都做，只分析当前展示子图 | Netlist 新增入口，AIG 调整分析作用域；列表、路径详情和高亮使用同一范围 | 先行 P5 |
| R5 | `UNIT_XXX_GATE` 显示中间完整门名 | 展示 `XXX`，包含中间的下划线；完整原始 cell type 继续可查 | 先行 P3 |
| R6 | 独立的 Show Path，支持多起点、多终点、单端 cone 与 Focused 配合 | 从当前模块/AIG 完整源图提取所有指定端点之间的路径并集，再按 Focused 收窄显示；列举端点及两种 level | 最后 P7 |

P0 先核对日志与失败基线，P6 独立验收前五项。P7 只能在 P6 的先行功能验收完成后开始；前五项不得依赖 Show Path 核心算法、端点控件、双 level 或其存档格式。每项功能自开发开始就执行 [错误日志开发与验收要求](../SKILLS_AND_RULES.md#7-错误日志开发与验收要求)，不能统一拖到收尾补日志。

本轮不扩展多于两输入的 BLIF `.names`，不引入 `.latch`、`.subckt`、AIGER、AIG Compare 或 Netlist→AIG 转换。现有 Netlist Compare 需要两侧一致接入新功能，AIG 仍限现有 Single 工作区。Show Path 限当前 module/occurrence 或当前 AIG，不自动展开整个层次设计。

继续遵守离线原生 ES modules、源模型不可变和 Simple 冻结约束，不引入 group collapse。后续 AIG Compare 与转换仍由[原后续路线图](aig_followup_roadmap.md)管理。

## 2 当前实现与改动依据

计划基线为 `master` 的 `ab908ac`。需求核对时工作树干净。以下是代码观察与最小导入结果，不代表新增能力已经实现。

| 当前事实 | 依据 | 对实施的影响 |
| --- | --- | --- |
| `.names` 已接受两输入、`0/1/-` 和多行 cover，最终只归约为常量、别名或单个可反相 AND | [aig_semantics.js](../../src/domains/aig/aig_semantics.js) | 不重写已有 cover 解释；补齐其无法表达的 XOR/XNOR |
| `-1 1` 加 `1- 1` 的 OR 最小样例导入成功；`01 1` 加 `10 1` 的 XOR 报子集不支持 | 通过现有 `importAigSource` 的最小验证 | OR 纳入回归，不能把 `-` 本身描述成当前不支持 |
| BLIF parser 在读取行时剥离 `#` 注释 | [blif_parser.js](../../src/domains/aig/blif_parser.js) | parser 需保留映射声明及位置，名称绑定留给后续语义层 |
| AIG 规范化重新编号，BUF/NOT 通过带极性的来源映射归并 | [aig_normalize.js](../../src/domains/aig/aig_normalize.js) | 原始 `n3` 不等于画布 `n3`；映射必须通过 provenance 连接 |
| AIG 的 `focused` capability 为 false，投影消费完整 model | [aig_feature.js](../../src/domains/aig/aig_feature.js) | 需要真正的子图查询、布局和工作台状态接入，不能仅开放按钮 |
| 重收敛实现依赖 AIG 的 PI/AND 类型与 level 排序 | [structure_reconvergence.js](../../src/domains/aig/structure_reconvergence.js)、[structure_index.js](../../src/domains/aig/structure_index.js) | 提取中性拓扑内核，Netlist 提供自己的信号与单元适配 |
| 分析服务按 document 创建，同文档的已完成结果会复用 | [workspace_analysis.js](../../src/application/workspace_analysis.js) | 查询范围变化必须失效；仅比较 document 会产生旧结果 |
| Netlist 黑盒标题按开头字母截取，`UNIT_...` 得到 `UNIT`；已识别单元优先使用 gate kind | [graph.js](../../src/netlist/graph.js) | 完整中段标题属于展示规则，不能直接用改动共享测量输入解决 |
| Focused 默认限制为 32 roots、512 节点、1024 frontier | [view_policy.js](../../src/foundation/view_policy.js) | AIG 沿用统一范围策略，不另设隐含上限 |

工作区、渲染和测试边界遵循 [AGENTS.md](../../AGENTS.md)、[项目技能](../skills/netlist-schematic/SKILL.md)、[架构](../ARCHITECTURE.md)及[阶段 8 计划](../STAGE_8_PLAN.md)。历史阶段文档中的旧状态不覆盖本计划的代码观察。

## 3 图范围和功能组合

本节包含最终 P7 的组合设计。先行 P0–P6 只实现 `sourceLogicalGraph → Whole/Focused → visibleLogicalGraph`，保持 Whole、搜索和 roots 的现有行为。仅为当前子图分析明确真实成员和作用域，不提前增加 Path 中间图、查询开关、双 level 字段或未来用途的存档迁移。

### 3.1 三个需要分开的图

| 图 | 内容与用途 |
| --- | --- |
| `sourceLogicalGraph` | 当前模块/occurrence 或 AIG 的完整语义连接。用于端点解析、Show Path、源图 level；不含布局 dummy、hub 等装饰节点 |
| `pathLogicalGraph` | Show Path 开启时，源图中满足查询的路径并集或单端 cone；关闭时等于源图 |
| `visibleLogicalGraph` | 在路径结果上应用 Focused 后，实际选入当前视图的真实节点和连接。重收敛只消费此图 |

```text
不可变源模型
  → 完整语义连接与来源索引
  → Show Path 路径或 cone 查询（可关闭）
  → Focused 范围裁剪（可关闭）
  → 当前展示逻辑子图 ──→ 当前子图重收敛
  → 截断边界与领域显示投影
  → 布局 → Scene → 画布与 SVG 导出
```

“当前展示”指已经提交的逻辑查询范围，不指屏幕像素范围。平移、缩放、淡化外围节点、低缩放隐藏标签和分批 DOM 挂载都不改变它。未完成的新查询不能混入当前分析结果。

Net routing 的“不布线”保持既有语义：它只省略几何线条，保留当前逻辑子图中的真实连接。分析可经过这些连接，详情标出“不布线连接”，不能为高亮悄悄恢复布线。Show Path/Focused 排除的节点和连接则完全不能参与当前子图重收敛。

### 3.2 开关和搜索行为

| 操作 | 状态与结果 |
| --- | --- |
| 应用 Show Path | 保留 Focused roots/深度，按新路径范围重算有效 roots；报告范围外 roots，不偷偷删除它们 |
| 开启或调整 Focused | 只在 `pathLogicalGraph` 中追踪，不从源图重新引入路径外逻辑 |
| 切换 Whole | 清除现有 Focused roots/cone，显示当前 Show Path 的完整结果；Show Path 仍保持开启 |
| 关闭 Show Path | 保留草稿端点，解除路径过滤；Focused 如开启，重新作用于完整源图 |
| Clear Show Path | 清除该功能的端点和过滤条件，不清除 Focused 配置 |
| Focused roots 全在路径范围外 | 展示明确的空结果与修正入口，不静默退回 Whole |
| 搜索命中当前已绘制对象 | 只选中并定位，不计算新布局 |
| 搜索命中路径内但 Focused 外对象 | 复用现有追加 root 行为，重算局部图后定位 |
| 搜索命中 Show Path 外对象 | 标明“当前路径范围外”，可加入起点/终点；不绕过过滤条件自动展示 |

端点输入、roots 和普通 selection 是三个独立状态。Show Path 菜单编辑为草稿，Apply 才提交；失败或取消保留上一成功画布。无路径是合法的空结果，必须区分于输入无效或计算失败。

上下文栏同时标明 `Whole / Focused` 和 `Show Path` 的启用状态，例如 `Whole · Show Path`，避免把“完整路径结果”误认成“完整模块”。

## 4 两输入 BLIF 与名称映射

### 4.1 逻辑范围与转换

保留现有 `.model/.inputs/.outputs/.names/.end` 平坦组合子集及续行处理。`.names` 支持 0、1、2 个声明输入；三输入以上即使部分列为 `-` 也明确报超出本轮范围。

两输入真值表共 16 种函数，全部覆盖：两个常量、两个输入各自的正反相、可由一个带反相输入/输出的 AND 表达的八种函数、XOR 和 XNOR。继续接受同相 ON cover 或 OFF cover、重叠/重复 cube、空 cover；混合 ON/OFF cover 保持明确拒绝，不猜测含义。

XOR 使用固定的三 AND 分解，例如 `p=a&!b`、`q=!a&b`、`y=!(!p&!q)`；XNOR 复用相应输出极性。内部生成 ID 使用不会与用户名称碰撞的命名空间，来源绑定到所属 `.names` 及行号，不能为内部辅助点捏造独立设计名称。

常量、BUF/NOT、AND/OR/NAND/NOR 等已有可导入文件保持原拓扑与来源语义。此次不进行全图重综合、结构哈希合并或重写既有 AND。分解后的对象也计入导入预算，不能通过扩展真值表绕过现有对象上限。

parser 仅保存声明、cover 和映射注释；函数分类、拆分、别名极性及名称绑定由 AIG 语义/规范化边界负责。声明顺序、cover 行顺序或输入与相应 cover 列的同步置换不改变逻辑和确定性输出。

### 4.2 映射数据与冲突处理

识别形如 `# <sourceSignalId> <mappedName>` 的独立注释行，首先作为带来源位置的候选记录，完成声明解析后再绑定有效信号。名称的 `/`、`[]`、转义字符和层次内容完整保留；普通说明性注释不进入搜索。

每条可显示映射至少保留 `sourceSignalId`、`mappedName`、source span、对应的 `normalizedNodeId`、反相标志和用途。一个原始信号可以同时对应驱动节点及 PO 用途；多个原始别名也可以指向同一规范化节点。

- 完全相同的映射去重；同一原始 ID 的不同名称保留候选并标冲突，不用后一个悄悄覆盖前一个。
- 多个 ID 使用同名时搜索列出全部对象，不能自动合并拓扑。
- 无对应声明的候选可在映射诊断中查看，不生成虚构节点；缺失映射回退原始名称。
- 名称元数据不参与 canonical identity 排序。仅增加、删除或改变映射注释不能改变逻辑节点身份、极性或源图 level。
- 分解 XOR 的最终输出挂接原始信号映射；辅助点详情显示“由该输出的 `.names` 生成”。折叠 NOT 后仍可区分原信号与其反相用途。

### 4.3 搜索、映射表和节点详情

P2 的全局 Search、Navigator Objects 搜索规范化 ID、原始 ID、映射名及名称片段；最后 P7 的 Show Path 端点选择器再复用同一索引。结果同时显示命中名称、原始 ID、对象类型和当前是否可见，重名候选由用户明确选择。

Navigator 增加可筛选、分页的 Names 映射表，列为“原始 ID / 映射名称 / 画布节点 / 极性或用途 / 来源”。提供定位和复制；不能把上千条记录一次性塞入 DOM。输入输出优先显示映射名，内部点保留短 ID；完整映射名在悬浮、Inspector 摘要/Source、连接端点和路径信息中可见。

选择内部辅助点时展示其所属源逻辑，不能把同一个映射名误标成多个独立原始节点。所有名称通过共享安全文本边界输出，SVG 导出与屏幕使用相同显示策略。

## 5 AIG Focused

BLIF 与 ABC DOT 使用同一 AIG view query，不另建 BLIF 专用工作台。支持 PI、PO、AND 和常量等真实节点作为 roots，复用现有 roots 追加、替换、删除、活动 root 和最多 32 roots 的交互。重叠 cone 按身份去重。

P4 直接从现有 AIG 源图抽取 Focused，不等待 Show Path。首次交付即包含 roots/深度的历史、刷新恢复和 SVG 一致性；只迁移 Focused 所需状态。P7 再将其输入改为可选路径结果，不能为未来 Path 在 P4 先做全工作台重构。

Fanin/Fanout 深度沿用现有连接步数口径，与现有连接高亮含义一致；Show Path 的逻辑 level 使用第 7 节定义，不能将两者混称。深度 0 保留 root，本轮不修改 Netlist 原有 Focused 深度算法。

裁剪后只将可见节点、相关边和必要截断边界交给 Graphviz。边界注明上游/下游、源信号、极性及截断原因，不伪装成真实 PI/PO；它们不成为重收敛的分叉/汇合候选。原始 level、名称及 provenance 不因重新布局改变。

Standard 与 Logic View、Inspector、搜索定位、连接高亮、结构高亮和 SVG 导出消费同一子图。可见范围外的 Inspector 连接可保留为导航信息，但必须注明范围外，点击时遵守第 3 节搜索规则。重复应用相同查询复用已完成产物，不能无条件重跑 Graphviz。

## 6 最后阶段的 Show Path 查询与交互

第 6、7 节全部安排在 P7。设计保留，暂不在先行批次实现算法、按钮、端点状态、双 level 或相关存档。

### 6.1 起点终点

Netlist 接受当前模块内的 port、net、cell 和明确 pin；AIG 接受真实节点及通过原始 ID/映射名解析出的信号。映射别名携带原始极性和用途，不丢失到规范化 ID 后混淆原名。

选择 net 时使用完整 driver/load 关系；选择多输出 cell 时保留各输出端的独立来源，面板列明展开的端点。未知方向、多驱动或 inout 不能静默选择一个 driver，按可证明连接查询并报告歧义。

cell 作为起点时从有效输出端出发，不计该起点自身的门代价；组合 cell 作为终点时包含该门并按输出端列出 level。时序/黑盒 cell 作为终点时停在输入边界，作为起点时从输出边界出发；指定 pin 则严格使用该 pin，不自动换成另一端。一个 cell 的各端 level 不同，应分别列明，不能任意选一个数作为整个 cell 的值。

每侧显式选择的起点和终点分别去重，初始上限各为 32，统一由 Show Path policy 归一化。单端查询自动发现的另一端边界不套用这 32 项选择上限，使用分页和结果预算，并明确报告截断。单一 token 可以表示多个候选，但不能未消歧即提交；跨 module 命中先走已有模块导航，不在一次查询中混合不同模块。

| 起点集合 S | 终点集合 T | 精确结果 |
| --- | --- | --- |
| 非空 | 非空 | 所有从任一 S 到任一 T 的合法有向路径的节点与边并集 |
| 非空 | 空 | S 的 Fanout cone，自动列出真实终止边界作为实际终点 |
| 空 | 非空 | T 的 Fanin cone，自动列出真实来源边界作为实际起点 |
| 空 | 空 | Apply 无效，提示至少指定一端，保留已有结果 |

不穷举路径组合。对合法组合 DAG，双端查询用多源正向可达和多终点反向可达的交集提取节点，按同一可达条件筛选真实边。单端查询使用对应方向的可达集。某个指定终点位于另一个终点上游时，不能把它当成所有遍历的强制停止点。

S 与 T 含同一对象时允许零长度路径，列出该对象，相对自身 level 为 0。各端点的不可达状态单独显示；存在部分连通端点时保留成功部分。预算不足和不支持的环不能报告成“无路径”。

### 6.2 组合边界与环

Netlist 只在已知方向的组合连接上追踪。寄存器输出为新组合区段的源，数据/控制输入为终止边界，不建立 D→Q 或 CLK→Q 的组合穿越。未展开的子模块、黑盒和未知方向形成明确边界，不能假定其内部所有输入与输出相连。

具有已知方向的多输出组合单元保留 output-pin 身份；没有足够布尔依赖信息时，结果明确是结构连通性，不承诺逻辑可激活性。路径查询不自动使用网表实例名猜测单元功能。

通过强连通分量或等价线性检查识别组合环。涉及环而无法保证正确路径成员或最大 level 的查询返回明确 unsupported/partial 状态，不能删一条边后宣称精确结果；受影响的最大 level 显示不可定义。独立、未受环影响的组合区域仍可正常分析。

### 6.3 界面与 Focused 组合

上下文栏增加独立 `Show Path` 控件，包含可多选搜索的 Starts/Ends、Apply、Clear 和启用状态。Inspector 和搜索结果提供 `Add as start` / `Add as end`。端点编辑期间不逐键重算布局。

成功应用后展示可收起的信息区：查询范围、指定起点/终点、实际自动边界、两种 level、不可达项、完整/截断状态、节点/边计数。起终点列表分页，能复制名称并定位当前可见对象。大结果可直接使用 Focused 缩小；不强制先布局整个路径结果再应用已启用的 Focused。

Focused 截断处单列“当前显示边界”，不能替换或冒充用户指定端点。被 Focused 隐藏的指定起终点仍在信息区列出并标明不可见。路径上某个门的旁路输入用有名称的输入边界表示，旁路驱动逻辑不会自动加入路径成员。

## 7 最后阶段的两种 level 口径

两种 level 都是逻辑级数，不是时延，也不是布局坐标或 Graphviz rank。

| 字段 | 定义 |
| --- | --- |
| 源图 level | 当前完整源图组合区段中，从合法源边界到对象的最长逻辑深度；裁剪、布局、显示模式变化均不重编号 |
| 相对 level | 从指定或自动确定的实际起点到对象，合法路径上的最小/最大逻辑深度；显示为 `min…max`，相等时显示一个数 |

AIG 的 PI/常量为 0，AND 增加 1，反相边和 PO 增加 0，保持现有 `AND depth` 口径。XOR 分解后按实际 AND 深度计数，通常为两级，不能按原 `.names` 数量计成一级。

Netlist 每经过一个实际组合 cell 增加 1，包含显式 BUF/INV；port、net、assign 别名和显示边界不增加级数。寄存器 Q、黑盒输出和当前模块/层次输入等作为组合区段边界从 0 起算，注明来源类型；不推测边界外的真实深度。寄存器输入沿上游区段获得 level，不把时序单元整体算作一次组合穿越。

相对级数不计起点自身的门代价，起点相对自身为 0；继续经过的组合 cell/AND 才累加。源图层级之差不能替代相对最小/最大级数，重收敛处可能有不同长度路径。

多源摘要对所有可达来源的相对值取最小/最大，详情按起点展开。某个起点同时位于另一条起始路径中时，保留来自不同起点的真实距离，不把全部项强制归零。仅指定终点时，先从源图 cone 解析实际起点，再计算相对值。

相对 level 基于完整 `pathLogicalGraph`，Focused 只影响可见性，不能改变已算出的值。若路径结果本身不完整，level 同样标注 partial；不能把截断子图的最长值作为精确最大值。

例：`s→g1→t` 与 `s→g2→g3→t` 中，`g1/g2/g3` 是一级门，`t` 是零代价输出端，则 `t` 相对 `s` 为 `1…2`。Focused 隐藏 `s` 或一条支路后，该值保持不变；当前子图重收敛则必须依据剩余可见路径重新判断。

## 8 当前子图重收敛

保留[既有 AIG 结构分析计划](aig_structure_analysis.md)中的定义：同一非恒定源分叉后，存在两条内部节点不相交的有向路径，在某个逻辑节点汇合。只共享祖先、单纯高扇出、两分支已经汇合后的公共尾段，以及同源直接接入同一门两个输入槽位，都不能额外计成普通重收敛。

P5 只需要当前 Whole/Focused 的真实子图和组合连接适配，不依赖第 6、7 节的任意端点查询或完整 level 服务。见证路径仍显示现有意义的门级数/边数；固定分叉点到汇合点的详情在该子图内查询，沿用/抽取现有详情算法。P7 完成后自然接收新的最终可见范围，不重新设计重收敛定义。

AIG 保留 PI/AND 的信号语义；Netlist 的分叉必须对应同一物理源输出或 net，不能把同一 cell 的两个不同输出强行并为一个源。Netlist 两条见证路径的内部独立性按实际逻辑单元核对，不能仅因 pin ID 不同，把经过同一个中间 cell 的两条连接算作独立分支。

分析输入只包含 `visibleLogicalGraph` 的真实节点和边，排除显示边界、fanout hub、布局 dummy 以及隐藏源模型中的绕路。虚拟输入边界不冒充真实分叉点；如果实际分叉点被裁掉，只显示当前子图能证明的结果。序列单元、黑盒、层次和环遵守第 6 节组合边界。

列表展示分叉点、汇合点、两条确定性见证路径、相应逻辑级数及完整状态。选中结果的详情可查询两端之间的当前子图路径并集，但不能调用不受范围限制的全图 Show Path 去补齐外部支路。点选高亮不移动视口，Locate 才定位，沿用现有分析交互。

更改 Focused、Show Path、模块/occurrence、源数据或连接语义后，取消旧分析并按新范围计算；旧结果不留在新图中冒充有效结果。平移、缩放、拖动节点、布局 provider 和纯样式变化不重算拓扑分析。

Netlist 在 Navigator 增加 Analysis/Reconvergence，在 Inspector 提供结果详情和节点关联。Compare 只分析各侧自己的子图；选中结果带 A/B 标识，不跨侧查找路径。AIG 原有 Blocks 的函数类别不扩展，接入局部图时只报告成员完整且在当前作用域内成立的块，不能因隐藏部分成员而伪造一个新的完整块。

结果数或计算预算耗尽时保留已证明的结果，并显示 Partial results、原因及当前作用域；“当前子图没有发现”不能表述为整个设计不存在重收敛。

## 9 UNIT 显示名和 Simple 冻结

完整匹配固定包装 `UNIT_<非空中段>_GATE`，显示中段原有内容，包含 `_` 和数字。`UNIT_AND_GATE` 显示 `AND`，`UNIT_ADFFR_PN_GATE` 显示 `ADFFR_PN`；匹配不完整、无 `_GATE` 后缀或非 UNIT 类型保持原规则。只剥离一层固定包装，不能再对中段用首段字母正则截成 `ADFFR`。

显示标题与 cell type、instance、gate kind、引脚推断分别保留。显式用户设置的标题优先于自动标题；已有 Cell Config/Liberty 优先级不变。本任务不因为中段看起来像某种门，就无依据改变其引脚方向或逻辑功能。矩形图显示中段标题，标准门符号保持正确图形并提供完整类型提示。

采用 Netlist presentation 的派生显示标题，先保证布局输入的旧标题、尺寸和端口不变。长中段在现有节点范围内适配文字，完整值在 tooltip/Inspector 保留；不用修改 `getCellTitle()` 的共享行为顺便改变 Simple 测量。若活跃 provider 需要按新标题测量，必须作为其独立展示/测量策略接入，且 Simple 同输入同选项的 geometry、route status、diagnostics 与 policy 保持原结果。

验收直接比较冻结前后的 Simple 输出，不刷新 Simple 期望值。任何失败单独记录，不能以本需求为由修复、重构或解除冻结。冻结边界见 [Simple baseline](simple_layout_freeze_baseline.md) 和当前 AGENTS 指令。

## 10 模块职责和状态契约

### 10.1 责任分配

以下新增文件名是实施时的候选拆分，接口定稿应服从现有目录职责，避免为了名称机械拆文件。

本表描述全计划最终边界。先行批次只落地 BLIF/映射、UNIT 展示、AIG Focused、visible scope 和重收敛所需改动；`path_query.js`、完整 `logical_levels.js`、`showPath` 字段、端点 UI 以及承载 Path 的 Golden 版本全部留给 P7。基础日志先复用现有框架，不建设另一套日志平台。

| 边界 | 现有接入点 | 计划改动 |
| --- | --- | --- |
| BLIF 结构解析 | `domains/aig/blif_parser.js` | 保存映射注释候选及位置，不做逻辑分类或显示转换 |
| AIG 语义与来源 | `aig_semantics.js`、`aig_normalize.js`、`aig_query.js` | 两输入完整分类、XOR 分解、生成点来源、映射索引和搜索 |
| 领域中性契约 | `contracts/view_query.js`、`domain_feature.js`、`object_ref.js` | Show Path 纯查询数据、分析范围描述和可选领域贡献点 |
| 共享拓扑算法 | `analysis/` 下新增 `path_query.js`、`logical_levels.js`、`reconvergence.js` 等 | 只消费中性节点、边、代价和边界规则；不读 DOM，不按 domainId 分支 |
| 领域适配 | `domains/netlist/` 与 `domains/aig/` 的 query/feature | 提供对象解析、组合连接、合法分叉/汇合、级数代价、来源与显示投影 |
| Netlist 查询管线 | `netlist_view_query.js`、`netlist_graph_projection.js` | 在布局变换前组合 Path 与 Focused，保留当前逻辑子图产物 |
| AIG 查询管线 | `aig_feature.js` 及新增 `aig_view_query.js` | 从全图投影改为查询后投影，保留原始 level，生成必要边界 |
| 工作区协调 | `application/workspace_analysis.js`、`domain_workspace.js`、`view_commands.js` | 依据范围缓存/取消分析、提交事务、历史和失败恢复；算法由 feature 注入 |
| UI | `ui/` 新增 Show Path、端点信息、映射表控制器并复用既有 roots/分析面板 | 处理草稿、分页、定位、复制与轻量高亮，不直接遍历源网表 |
| 兼容桥接 | `app/domain_workbench.js`、Single/Compare bridges | 提供窄查询和 commands；完整用例放 application，局部临时状态放控制器 |
| 存档 | `persistence/`、Netlist `layout_golden.js` | 新查询字段、旧版本迁移和来源身份校验 |

共享算法放在领域可依赖的 `analysis/` 边界，公共 application 通过 DomainFeature 调用，不能新增 application→analysis/domains 的越层导入。现有 AIG block 布尔识别继续留在 AIG 领域，仅提取可复用拓扑部分。

`main.js` 只承担入口装配。确有新增 wiring 时，先提取完整责任并降低架构行数上限，不提高上限，不压缩代码规避检查。旧控制器的 capability 声明随使用关系更新，不扩大完整全局 state 的传递。

### 10.2 查询状态与计算产物

| 数据 | 所属位置 | 关键约束 |
| --- | --- | --- |
| Show Path enabled、starts、ends | ViewSession 的独立 `showPath` 字段，经 commands 写入 | 规范化 ObjectRef/信号用途，稳定去重；不同于 Focused roots |
| Focused roots、active root、depths | 现有 ViewSession 字段 | 保留现有语义，AIG 通过相同命令边界接入 |
| 输入草稿、搜索候选页码 | 所属 UI controller | Apply 前不写查询、不调 provider，不进入历史 |
| 完整源图索引、路径成员、level、当前子图及映射反查 | ArtifactStore 或有界领域缓存 | 可重算产物，不序列化进 Session |
| 分析结果、详情和作用域身份 | 绑定已提交 workspace 的分析产物 | scope 必须匹配，过期 job 不能提交到新图 |

分析作用域键至少包括 document/source revision、unit/occurrence、有效连接配置版本、当前真实节点/边成员及分析策略版本。详情缓存不能只用 `(stem, merge)`，还须包含作用域。拓扑相同的布局变化复用分析；Show Path 变化而 Focused 后成员未变时，可复用重收敛，但路径 level/端点信息按新路径查询更新。

源图 level 缓存不随 Focused 失效；相对 level 缓存按完整 Path 查询失效；重收敛缓存按 visible scope 失效。名称显示或面板分页不触发这些计算。成员指纹使用稳定顺序，不依赖 parser 数组或 DOM 挂载顺序。

新增查询状态使用可序列化数组和对象，不保存计算索引 Map、Worker、闭包或 Scene；不扩大既有快照工具的拒绝范围。Artifact 的快照仍允许已有惰性 Scene 读者，不能将 Session 的严格规则套到渲染产物上。

### 10.3 历史、恢复、Compare 和导出

Apply、Clear、启停 Show Path 和 Focused 修改分别作为可撤销事务；输入中间态不入栈。失败/取消不提交查询结果、计算产物或历史条目。返回上一个状态时恢复端点、roots、视口及适用的覆盖。

Netlist Compare 的 A/B 各自保存 Path 端点、结果和分析作用域。现有 Sync Focus roots 仅同步 roots，不隐式同步 Show Path；Sync pan/zoom 也不改变路径状态。本轮不增加 Path 同步开关或 AIG Compare。

AIG 刷新恢复在 P4 先增加 Focused 状态，读取现有 v1 存档时默认 Whole；P7 再增加 Path 状态，早期存档默认 Path 关闭。Netlist session/历史编解码在 P7 同步扩展；承载 Path 的 Golden 使用可识别的新格式版本，继续读取现有 v1–v3。旧存档不能把节点序号当成来源稳定 ID 盲目重挂；来源不匹配时明确提示并保留可恢复的源文档。

SVG 导出使用当前完成态子图、名称和分析标记，并在独立说明区列出查询起终点、两种 level 及截断状态；不能只导出短 ID 丢掉用户要求的路径信息。该说明区不参与 provider 布局，不改变 Simple 几何。无 Show Path 时不增加空说明区。

## 11 复杂度和预算

本节的路径及双 level 预算在最后 P7 定稿；先行批次只测量导入、映射、Focused 和当前子图重收敛的成本，不把未来 Path 压力测试作为前置开发任务。

Show Path 的并集提取及单次 DAG level 计算目标为 `O(V+E)`；不能为每一对端点重新遍历全图，不能枚举指数数量的全部路径。多源分项 level 可使用按来源的有界状态或按需计算，最坏成本显式计入“起点数 × 图规模”，显式起点数受统一上限控制。自动发现的大量起点使用一次多源动态规划计算汇总值，按需读取指定来源的分项，不能创建无界的“全部来源 × 全部节点”矩阵。

重收敛保留既有有界搜索原则，先构建共享邻接和拓扑索引，再按候选和预算工作；不新增全图两两配对或随规模扩大重试次数。Netlist 多 pin/多输出的投影必须保留成本记录，避免隐含的高阶连接膨胀。

| 项目 | 初始策略与确定方式 |
| --- | --- |
| Focused roots / 节点 / frontier | 沿用 32 / 512 / 1024，不修改现有 Netlist 策略 |
| Show Path 起点 / 终点 | 每组 32，由一个 policy 统一归一化；超限明确反馈 |
| BLIF 导入 | 沿用现有源字符和对象限制，计入分解新增对象及映射索引成本 |
| 重收敛 | 以现有工作计数、reach nodes、结果数和详情预算为基线；适配后同机测量，再固定领域明确的策略 |
| Path 源图查询、结果、level 缓存和页面长度 | 最后 P7 的 S71 用已选规模样例记录占用与访问计数后确定具体值，不散落在 UI/算法中，不承诺无界大图 |

时间上限仅负责取消和响应保护，结果覆盖由确定性工作计数与稳定排序决定。超限后给出范围、原因，不自动放宽预算重试。路径已求出但布局规模过大时可使用 Focused；源图查询本身超预算时需缩小端点或模块范围，Focused 不保证减少这一步的计算量。Show Path 的大成员集合可以直接交给 Focused 后再布局；不得截掉未布局的完整路径数据而还把 level 标为精确。

列表分页、结构分析和布局均可取消。切换文件、模块、查询或 Compare 活动侧时，旧结果只能回到其原所属会话。手势热路径仍只做轻量变换，不布局、不全量重建 SVG、不写存档；完成态恢复完整标签、几何和命中区。

## 12 具体行动规划

本节取代上一版 P0–P7 的排序与依赖，所有功能实现任务当前均未开始。顺序为：**日志与基线 → BLIF 两输入 → 名称映射 → UNIT 标题 → AIG Focused → 两侧当前子图重收敛 → 先行验收 → 最后实现 Show Path**。每个任务完成后填写实际变更、验证命令、日志位置、结果和偏差，不提前标记交付。

### 12.1 日志现状与统一要求

已有 [Process Log](../../src/app/processLog.js)、[详情快照](../../src/foundation/log_details.js)、[日志控制器](../../src/ui/process_log_controller.js)及 [failure logging 测试](../../tests/unit/failure_logging.test.js)，支持错误展开、去重、JSONL 导出、脱敏和有界存储。新增开发硬要求已写入 [AGENTS.md](../../AGENTS.md) 和 [SKILLS_AND_RULES 第 7 节](../SKILLS_AND_RULES.md#7-错误日志开发与验收要求)。

本次代码检查发现的具体补齐点：AIG `structure_worker.js` 只返回 `name/message`，`structure_runtime.js` 仅据此重建 Error；`workspace_analysis.js` 失败状态只保留 `error.message`；AIG 工作台部分保存/清理失败只记录消息，缺少原异常。P0 先打通这些本次会用到的链路；其他日志覆盖随对应功能任务完成，不做全仓无关的 catch 重写。

沿用现有日志 phase，BLIF 语法归 `parse`、导入归 `import`、Focused/重收敛/未来 Path 归 `graph`，持久化/导出分别归 `persistence`/`export`；业务动作放 `details.operation`，例如 `blif.adapt`、`aig.focused.query`、`reconvergence.run`。不得直接使用未注册的 `analysis` 阶段而被日志归一化悄悄改写。

每次有效失败记录原异常、稳定 code、操作/请求关联 ID、可用的文件/行列/对象 ID、documentRevision、module/occurrence、session/Compare 侧、viewScopeId、规模/预算及保留旧画布等恢复动作。Worker 的原始 stack/cause/diagnostic 按有界纯数据传回，记录器接收后保持可读。UI 状态可保留简短 message，但异常不能在到达日志拥有者之前被降成一个字符串。

日志脱敏之后逐项核对必要上下文，不能记录整个 source/model/session。采集与写日志只在操作/阶段边界发生；读取当前图统计复用既有结果，不为日志重复遍历大图。业务错误只记录一次，主动取消、被替换任务、无结果不报 error，预算受限/映射冲突记录 warning 和完整性说明。普通未匹配 UNIT 类型属于正常回退，不制造警告。

### 12.2 阶段和独立交付门禁

| 阶段 | 具体交付 | 前置条件 | 退出条件 |
| --- | --- | --- | --- |
| P0 日志与基线 | L01–L03；真实最小样例、已有失败、当前错误上下文链路与远程基线 | 本次规划 | 可注入并查看/导出 AIG import/analysis/storage 的原始错误，取消/去重不退化；不添加 Path 基建 |
| P1 BLIF 两输入 | B11–B13；16 种函数、XOR/XNOR 分解、稳定来源与诊断 | P0 | 独立真值 oracle 和导入失败日志通过，已有 AND/NOT/OR 行为保持 |
| P2 名称映射 | N21–N23；注释映射、搜索、Names 表、详情/定位/导出 | P1 | 原始 ID/设计名称/画布节点及极性往返正确，冲突/无匹配诊断可查 |
| P3 UNIT 标题 | U31–U32；完整中段展示、显式覆盖、Simple 隔离 | P2 完成后执行；技术上仅依赖 P0 | UNIT 显示正确，普通类型不变，Simple 几何/路由/诊断无变化 |
| P4 AIG Focused | F41–F44；独立局部查询、边界、控件、历史/恢复及可见范围身份 | P2、P3 | BLIF/DOT 和两种 View 的多根/深度/导出一致，失败保留旧图，完全不依赖 Show Path |
| P5 当前子图重收敛 | C51–C54；共享拓扑内核、Netlist 适配、两侧 scope 与异步详情隔离 | P4 | Whole/Focused 正负例、独立 oracle、Compare 隔离及分析错误日志通过 |
| P6 先行功能验收 | A61–A63；R1–R5 全量回归、日志验收、离线包和使用说明 | P1–P5 | 前五项具有独立可交付结果；无隐藏 Path 功能或依赖，无需等待 R6 |
| P7 Show Path 最后实施 | S71–S75；路径/level、组合查询、UI、历史/存档、导出与最终回归 | P6 验收完成 | R6 以及与 R1–R5 的组合用例通过，早期交付行为不回归 |

P6 是前五项的独立验收门禁，不代表必须先发布版本或推送远端。P7 以前只保留设计文档，不写占位 Path 字段、不迁移其 Golden 格式、不实现完整双 level 服务，也不为了未来 Path 重构现有 Focused。重收敛本身需要的固定两端详情查询不属于产品 Show Path，限定在当前分析 scope 内即可。

### 12.3 可直接执行的任务清单

**P0 日志与基线**

- [ ] **L01 固定基线与失败清单**：在 `mfs-remote` 核对现有项目状态，建立隔离任务目录及 `logs/`；记录 commit、环境、默认 provider。选定 OR/XOR、带映射、UNIT、可裁掉一支的重收敛等小样例，保存既有导入/分析错误和 Simple 只读对照。
- [ ] **L02 打通异常上下文**：修改 `domains/aig/structure_worker.js`、`structure_runtime.js`，保留跨线程错误信息；在 `application/workspace_analysis.js` 通过窄回调向操作拥有者报告原异常与 scope；补 `app/domain_workbench.js` 本次涉及的持久化失败上下文。不改变算法、超时、重试或 Simple 输出。
- [ ] **L03 日志失败验证**：扩展现有 `aig_structure_runtime`、`failure_logging`、存储/Process Log 测试，注入 Worker 错误、初始化/消息错误、超时、非 Error 抛出值和存储失败；验证 Log 展开和 JSONL 中的原始诊断、归属、去重、取消及记录器故障处理。

**P1 BLIF 两输入**

- [ ] **B11 补函数分类与分解**：在 AIG semantics 边界补 XOR/XNOR，保留 parser 纯结构和已有函数归约；新增内部 ID/生成来源规则并计入对象预算。
- [ ] **B12 完整逻辑回归**：在 `tests/unit/aig-import.test.js` 及必要的小型 BLIF fixtures 覆盖 16 种真值、ON/OFF cover、`-`、重复/置换、常量/别名和真实 OR/XOR 样例；使用独立求值器。
- [ ] **B13 导入错误闭环**：在 `aig_diagnostics.js`/导入边界提供稳定诊断 code、`.names` 输出 ID、行列、输入数量和限额原因；验证三输入拒绝、坏 cover、缺失信号、分解超限，日志和旧画布状态均正确。

**P2 名称映射**

- [ ] **N21 保存与绑定映射**：`blif_parser.js` 保存候选注释，semantics/normalize 绑定真实声明；新增有界反查索引，覆盖 NOT/PO 用途、XOR 辅助点来源与冲突记录。
- [ ] **N22 接入用户入口**：`aig_query.js`、`ui/aig_panels.js` 和相关面板控制器提供设计名称搜索、分页 Names 表、复制、定位、Inspector 和端口显示；SVG 使用同一安全显示文本。
- [ ] **N23 名称和诊断验收**：补重名、冲突、无匹配、特殊字符、声明/注释置换、搜索到同一规范化点但极性不同的用例；冲突日志按导入汇总计数和有界样本，不能每行刷 warning。

**P3 UNIT 标题**

- [ ] **U31 局部显示规则**：在 `domains/netlist/` 的 presentation 边界解析固定包装，尊重实例显式标题；不改 parser、gate kind 或共享 provider 输入。
- [ ] **U32 展示与冻结验收**：补 AND/ADFFR_PN/数字/多下划线及非匹配样例，检查 Single/Compare、矩形/符号、详情和导出；执行冻结输出对照。未知类型正常回退不报错，真实渲染失败复用既有 render 日志。

**P4 AIG Focused**

- [ ] **F41 实现独立子图查询**：新增 `aig_view_query.js`，接入 `aig_feature.js` 的 query/project，保留 sourceRefs/level/极性；按已有 Focused 预算输出截断边界和真实可见成员。
- [ ] **F42 接入控件和状态**：通过既有 view commands/roots 帮助器开放 Add/Replace/Remove、Fanin/Fanout 和 Whole；`domain_workbench` 只保留窄桥接，必要的新控制器放 `ui/`。搜索只在 Focused 范围语义内 reveal，此时没有 Path 过滤。
- [ ] **F43 完成首版恢复链路**：本阶段同时接入 Focused 历史、刷新恢复、Standard/Logic View、Inspector、SVG 导出和失败/取消回滚；只增加所需 Focused 存档字段。
- [ ] **F44 验证范围与日志**：多根/零深度/预算截断、过期 roots、切换查询、Graphviz 失败和恢复错误；验证节点/边数、scope、roots 有界摘要及保留旧画布信息可读，取消不报错。

**P5 两侧当前子图重收敛**

- [ ] **C51 提取必要拓扑内核**：从现有 AIG 重收敛中抽取中性邻接/候选/两条见证和固定两端详情算法到 `analysis/`；不提取或提前实现任意端点 Show Path 或全图双 level。
- [ ] **C52 接入 Netlist 适配**：将当前可见真实逻辑节点和连接投影到分析内核，处理多输出 pin、寄存器/黑盒/层次边界、重复输入及环诊断；补当前子图的独立小图 oracle。
- [ ] **C53 统一作用域与入口**：改 `workspace_analysis.js` 和领域 feature/分析桥接，以 document revision + unit/occurrence + visible scope + policy 标识服务和详情；接 Netlist Navigator/Inspector，保留 AIG 现有入口，保证 Compare 独立。
- [ ] **C54 范围和故障验收**：验证裁掉一支后不再报告全图重收敛、隐藏区绕路不算、平移/缩放不重算；注入分析/详情 Worker 失败和乱序响应，检查 partial/budget/timeout、scope 和旧 job 隔离日志。

**P6 前五项独立验收**

- [ ] **A61 正确性与回归**：运行单元/架构、AIG、相关 determinism/fixture、全节点 mapped 和真实工作区/Compare 浏览器链路，逐项标记 R1–R5，保留现有失败证据。
- [ ] **A62 性能和错误可诊断性**：远端做同机 benchmark；逐项实际打开 Log 并导出 JSONL，核对第 12.4 节场景。前五项没有 Show Path 也能独立通过，不以 R6 未完成阻止验收。
- [ ] **A63 文档与离线包**：更新已实现的 BLIF/映射/Focused/重收敛/UNIT 用户说明和实际契约；构建并验证受影响的 Windows 离线包。报告明确“R1–R5 已验收，R6 尚未开始”，不提前更新 Show Path 的用户能力描述。

**P7 Show Path 最后实施**

- [ ] **S71 路径与双 level**：落实第 6、7 节的多源/多终点可达并集、单端 cone、端点展开、组合边界与 min/max；增加独立路径 oracle 和访问/内存预算验证。
- [ ] **S72 组合查询**：在两领域实现 Path→Focused→visible scope，复用已有 Focused 与重收敛范围边界；此时才接入 `pathLogicalGraph` 和相关缓存键。
- [ ] **S73 独立操作界面**：接入起终点搜索/Add as start/end、Apply/Clear、Whole 与 Path 独立状态、端点/双 level 信息区和范围外搜索行为；不逐键布局。
- [ ] **S74 历史与导出**：此时扩展 ViewSession、Netlist/AIG 存档、Compare 独立 Path、Golden 格式和 SVG 查询说明，迁移 P4 已交付的 Focused 存档。
- [ ] **S75 最终验收**：运行 R6 及所有组合/回归/离线验证；实际触发无路径、非法/歧义端点、预算、取消、存档和导出失败并检查日志。R1–R5 与 Simple 冻结对照继续有效。

### 12.4 每项功能必须交付的日志证据

| 功能与场景 | 记录边界和最低上下文 | 验收证据 |
| --- | --- | --- |
| BLIF 解析/适配失败 | import 拥有者记录原异常；parse/adapt 的 code、fileName、行列、声明输出 ID、输入数量/预算 | 坏 cover、三输入和分解超限各有精确 diagnostic，原工作区保持 |
| 映射冲突/无匹配 | 导入结果汇总 warning；计数、有限原始 ID/行号样本、采用的回退策略 | 其他映射仍可用，不改变身份，不逐行重复日志 |
| UNIT 标题 | 不匹配是正常回退；渲染异常沿既有 render 边界记录 cell ID、类型与错误 | 普通未知类型不产生 error，已有渲染错误测试覆盖新标题链路 |
| Focused 查询/布局/恢复失败 | query/layout/persistence 各归属边界；roots/深度摘要、节点/边计数、scope、provider、是否保留旧图 | 失败注入后 Log 和 JSONL 可定位；取消/过期操作不污染当前视图 |
| 重收敛 run/detail/超时 | 分析拥有者；operationId/job、scope、结果 ID、预算/耗时、Worker 原异常 | 原始 worker 堆栈/原因可读，两侧不串，详情失败不覆盖列表成功状态 |
| 分析 partial/组合环 | warning + reason、覆盖范围/计数、使用限额；不伪造 exception | 不误报 complete/无结果；相同任务只保留一次有界摘要 |
| 存储/导出失败 | persistence/export；operation、会话、格式、异常和后续动作，禁止完整快照 | 配额/损坏存档/导出失败可诊断，连续自动保存失败去重 |
| 最后阶段 Show Path | graph 拥有者；端点有界摘要、scope、预算、partial/无路径状态、原异常 | 无路径为正常结果；真正失败有上下文，Filtered/Focused 前后归属一致 |

每个任务完成必须同时给出“正常行为测试、所触及失败日志测试、必要的浏览器 Log/JSONL 验证”。没有新增可失败边界的纯显示改动复用已有边界测试，不为日志虚构错误或给每个纯函数加 try/catch。

## 13 验收矩阵

本表覆盖全计划。P6 验收 R1–R5 及相应公共边界/日志行，暂不执行 Show Path、双 level、Path 存档和组合过滤用例；P7 才补齐这些条目，并对先行已通过项执行受影响回归。每次记录须标明批次，不能将未执行的 R6 算入先行通过率。

| 验收项 | 必测内容 | 通过标准 |
| --- | --- | --- |
| 两输入真值 | 16 函数全部 4 行；ON/OFF 同相 cover、`-`、重复/重叠行；零/一输入、同信号重复输入；用户 OR/XOR 样例 | 独立真值求值与导入 AIG 完全一致，不复用被测分类器当 oracle |
| BLIF 错误与预算 | 三输入、混合相位、非法行、缺失引用、多 driver、循环、分解后超限 | 错误含来源位置；不清空上一有效工作区，不导入部分错误逻辑 |
| 名称映射 | PI/PO/内部点、层次/转义/特殊字符、重名/冲突/无匹配、NOT 别名、XOR 辅助点 | 原名→节点及节点→原名往返正确，极性明确，无假映射或 HTML/SVG 注入 |
| 顺序无关 | 节点/边/声明/cover/映射行/起终点/roots 排列；输入与 cover 列同步交换 | 逻辑、结果成员、规范化身份、见证选择及布局满足各自确定性约束 |
| AIG Focused | PI/PO/AND 多根，深度 0/1/多级，重叠、边界极性、搜索追加/替换、Whole | 真正只布局目标子图，两种 AIG View 与导出范围一致，源模型未变 |
| Show Path | 多起多终、交叉与重叠路径、单端 cone、S=T、部分/全部不可达、Path 外搜索 | 成员与小 DAG 的独立全路径 oracle 一致；不把路径列表穷举带入生产实现 |
| level | 长短分支、多个来源、仅终点、起点为内部逻辑门、XOR、BUF/INV、寄存器/黑盒边界 | 源图 level 和相对 min/max 单位准确，Focus 前后不变，未知/partial 不伪装精确 |
| 组合边界 | 多输出 cell、不同源 pin、层次边界、DFF 数据/时钟/复位、未知/inout、多驱动、组合环 | 不穿越禁止边界、不合并独立来源，异常范围和完整性明确 |
| 重收敛正确性 | 两条独立路径、嵌套/重叠、公共尾段、退化重复输入、同 cell 不同 pin、常量 | 当前子图 oracle 一致，两条见证真实且内部独立，额外路径详情限同一 scope |
| 范围负例 | 全图有重收敛但一条支路/分叉点被裁掉；只在隐藏区能连通；切换范围 | 不报告全图结果；缩放/平移不改变结果，改变查询才正确失效 |
| 异步与缓存 | 快速修改 Path/Focused、换文件、取消、详情请求乱序、同文档不同子图 | 旧任务不能提交新范围；纯样式和布局更新复用拓扑结果 |
| 会话与 Compare | A/B 不同 Path/roots，roots 同步、历史、旧存档迁移、刷新、Golden、源不匹配 | 端点/level/结果不串侧，旧会话默认关闭新查询，错误恢复不绑定错对象 |
| UNIT 与冻结 | AND、ADFFR_PN、含数字和多 `_`、非匹配类型、显式标题覆盖、两种符号 | 中段完整正确，类型与语义未被改写，Simple 既有输出对照不变 |
| 真实工作区集成 | 导入→query→layout→Scene→JobCoordinator→ArtifactStore→提交 | 至少保留每领域一条真实链路，不用全层 mock 遮蔽快照/闭包问题 |
| 详细错误日志 | 本次触及的 import/query/analysis/worker/persistence/export 失败、partial、取消、去重、非 Error 和记录器故障 | 原异常/stack/cause/diagnostic 与操作/scope 可定位，Log 和 JSONL 均可读，不丢上下文、不重复报错、不泄露完整输入 |
| 大图性能 | 多分支 DAG、高扇出、深链、大量映射、多端点、频繁切换 Focused | 有界访问/内存/结果量，可取消；无全路径枚举、两两扫描和高频事件全量布局 |

P6 浏览器验收场景：导入带映射的 OR/XOR BLIF → 搜索 `in_96` → 检查映射与辅助点来源 → 多 root Focused → 调整深度并检查当前子图重收敛 → 撤销/重做 → 刷新 → SVG 导出。Netlist 使用组合/时序边界与 UNIT cell 样例验证相同作用域规则，再验证 Compare 两侧独立；按第 12.4 节另行注入失败，打开 Log 并导出 JSONL。

P7 在上述已通过流程中加入多起终点 Show Path、单端 cone、双 level、Path/Focused 组合、端点不可达/隐藏及新存档迁移；最终再验证两领域及 Compare 的相关回归。

## 14 验证环境与命令

遵循 `linux-ssh-workspace` 技能：后续完整构建、测试、benchmark 和浏览器计算优先在 `mfs-remote` 的 `/home/wzh/my_code/netlistGraphBuilder` 下执行。写入前检查远端目录/Git 状态，保留已有工作；日志、依赖、临时数据和大产物留远端，仅带回小型结果摘要。Windows 发布构建和平台 GUI 烟测使用本地是平台能力需要，执行前记录理由和输出范围。

本轮仅更新 Markdown 计划、开发规范与索引入口，允许本地运行轻量文档链接检查；不为此运行完整单元、mapped、benchmark 或发布构建。

实施阶段的基础验证命令：

```bash
npm test
npm run test:architecture
npm run test:aig
npm run test:mapped-cases
npm run benchmark
npm run benchmark:aig
npm run benchmark:aig-structure
npm run test:aig-browser
npm run test:aig-views
npm run test:aig-structure
npm run test:ui-workbench
npm run test:process-log
npm run test:docs
```

mapped 执行前在 Linux 设置 `MAPPED_CASE_NO_COLLAPSE=1`，正式记录所用 provider，并从 `DEFAULT_LAYOUT_PROVIDER_ID` 读取默认值，保留显式 provider 覆盖。产品要求完整 47 个 mapped 用例与硬违规检查；历史超时独立保留，不以删除用例或改为 Simple 默认绕过。

子图投影/布局输入变化须执行现有 determinism 与 fixture invariant 测试；新增逻辑在所属边界补独立测试。后续新增浏览器/路径基准脚本及其确切命令在对应阶段记录，不把尚不存在的脚本写成已可运行。

涉及离线发布输入的阶段运行 `npm run release:windows`，验证无网启动、新功能可用、vendored ELK/Graphviz 许可证和资源完整。发布产物验收不等于上传、发布版本或推送远端；这些动作需遵循之后的任务范围。

性能报告必须包含同机前后对照、Node/浏览器版本、输入规模、所选 provider、运行次数、中位数/P95、峰值内存或其测量限制，以及取消/预算情况。先通过正确性，再用数据判断性能，不以基准代替功能验收。

## 15 风险控制与文档收尾

| 风险 | 控制与验收 |
| --- | --- |
| 映射注释改变规范化编号或把极性弄反 | 名称元数据与 canonical identity 分离，覆盖别名和输出用途往返测试 |
| AIG 辅助点增加后存档误定位 | 来源身份与版本校验，已有可导入图保持原身份，新语义变更才调整相应版本 |
| 当前子图仍复用全图分析服务 | 把 visible scope 纳入服务与详情缓存生命周期，增加同文档不同范围并发测试 |
| 多端点 Path 变成指数枚举 | 可达集合求并集，DAG 动态规划算 min/max，限定来源数和工作预算 |
| 将 Focused 局部 level 当全图 level | 源图与 Path level 独立缓存，Focused 只过滤显示，不重编号 |
| 多输出、黑盒、寄存器制造虚假路径 | 输出 pin 身份及组合边界显式建模，缺失信息带诊断，不能猜测穿越 |
| 新标题扩大节点影响 Simple | 派生显示标题与测量隔离，冻结输出独立对照，不刷新旧期望 |
| UI 工作继续堆入 main/domain_workbench | 新控制器和 application 用例承担完整责任，使用窄 callback/commands 接线 |

实现时更新 `USER_GUIDE.md` 的 BLIF 格式、映射搜索、Focused、Show Path、level 和重收敛说明，并提供小型可复现示例。`ARCHITECTURE.md`、`DESIGN_SPEC.md` 仅在实际契约落地后同步；不提前将本计划中的设计写成当前事实。

每阶段记录以本文件为唯一实施进度入口，已有 AIG 专项计划保留历史验收。只有当 R1–R6 功能、回归、离线验证及明确的性能边界都有证据时，才可标记本轮完成。

R1–R5 的先行完成状态由 P6 独立记录，允许在 R6 尚未开始时明确交付前五项；不能为了等待 Show Path 而推迟已有功能的日志、文档和离线验证。下一次实际开发从 **L01 → L02 → L03** 开始，再按第 12 节任务顺序执行。

## 16 当前交付记录

- 2026-11-18：用户确认两输入 BLIF、两领域当前子图重收敛、多起终点 Show Path 与 Focused 组合、两种 level 同时展示，其他按已对齐需求执行。
- 2026-11-18 首版：完成现状检查及实施计划；当次两个文档的 27 个相对链接缺失 0，差异格式检查通过，未执行实现阶段。
- 2026-11-18 调整：用户要求 Show Path 最后实施，并将详细错误日志落实为开发要求。已将前五项改为 P0–P6 独立任务与验收，R6 全部移到 P7，加入 L/B/N/U/F/C/A/S 任务清单及日志证据矩阵；更新 `AGENTS.md`、`docs/SKILLS_AND_RULES.md` 和路线图入口。本次未修改运行时代码、测试或发布产物，全部实现任务仍未开始。
- 本次文档验证：`node tools/check_docs_links.mjs AGENTS.md docs/SKILLS_AND_RULES.md docs/plans/blif_focused_show_path_2026_11.md docs/PLAN.md` 检查 36 个相对链接，缺失 0；`git diff --check` 通过。内容复核确认前五项不依赖 Show Path，日志要求和各任务失败验收对应，所有任务仍未勾选。仅四份 Markdown 文档有变更，未运行功能测试或基准，未暂存、提交或发布。

