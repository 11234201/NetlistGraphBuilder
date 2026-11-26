# 7. AIG 工作区完整指南

> 返回 [完整使用教程目录](../USER_GUIDE.md) · 上一章：[6. Show Path 路径追踪与逻辑级数](06-show-path.md)

本章全面覆盖独立 **AIG（And-Inverter Graph）工作区** 的导入与同页多图管理、`.level` 层级与裕量报告、BLIF 名称映射、视图与高亮、Focused 局部逻辑抽取、结构重收敛与逻辑块（XOR / XNOR / MUX）识别、点相关查询、容量边界及可复现练习。

> AIG 工作区采用本地离线 **Graphviz（Viz.js / WASM）** 曲线布局，与门级网表的 `AnchorLayered → ELK → Simple` 正交布局流水线相互独立；“重收敛”和“重汇聚”在本教程中指同一结构，界面名称为 `Reconvergence`。

---

## 7.1 导入、同页多份 AIG 与 Search-first 筛选

### 打开、粘贴与追加多份 AIG

- **打开主图**：通过 `File → Open design…`、`File → AIG + Level → Open AIG…`、拖放或全局粘贴导入 **ABC `write_dot` 生成的 AIG `.dot`** 或 **平坦两输入组合 `.blif`**；也可使用 `File → AIG + Level → Paste AIG…` 粘贴文本并直接选择 `Logic View`、`Search-first` 或 `Standard` 视图提交（失败时保留输入与上一张图）。
- **同页多份 AIG**：通过 `File → AIG + Level → Add AIG file(s)…`、`Append pasted AIG…`、一次拖入多份 AIG 或远程命令 `aig add` 可在同一浏览器页面保留多份独立的 AIG（上限 **64 张图、总源码 32 MiB 字符**）。
  - 通过全局栏的图选择器（`Active AIG graph`）或远程命令 `module open <gN>` 即时切换。
  - 每张图各自独立保存其 **Level 附件、视图模式、Focused roots、选中对象与视口**。
- **取消导入**：导入或布局进行期间可点击 `File → AIG + Level → Cancel AIG import` 安全中止并保留原视图。

### 在布局前筛选大型 AIG（Search-first）

对于节点较多、预计全图 Graphviz 布局会超时的 AIG：

1. 在 `File → AIG + Level` 中勾选 **`Open AIG in Search-first`**（或在 `Paste AIG…` 的 View 下拉框选 `Search-first`），再打开或拖入文件。
2. 导入完成后立即建立搜索索引，此时 Graphviz 调用次数为零。
3. 通过顶部 `Search`（按原始 ID 或 BLIF 设计名）点选结果进入 **`Focused`**，或在 **`Show Path`** 中指定起终点并 `Apply`，Graphviz 仅布局筛选后的子图。
4. 清空 roots 或关闭最后一个路径筛选会回到索引视图；如需布局完整源图，清除 Show Path 后点击 `Whole`。

---

## 7.2 AIG `.level` 层级与裕量报告

完整规范见 [`docs/design/aig_level_format_spec.md`](../design/aig_level_format_spec.md)。可在 `Open design…`、拖放或服务器文件选择器中同时选中 AIG 与 `.level` 文件，也可在 AIG 打开后通过 `File → AIG + Level → Open levels…` / `Paste levels…`（远程命令 `level open` / `text open level`）补载或替换。

### 两种输入形式

1. **两列主输入初始层级简写（无表头）**：每行填写“主输入名 非负整数”，例如 `a 3`。未列出的主输入默认从 `0` 起算；系统从各主输入 `at_level` 向下游传播所有 AND 与 PO 的 **拓扑层级（`Topology level`）**（每经过一个 AND 取两输入最大值 `+ 1`，反相边与 PO `+ 0`），并同步更新逻辑关键路径。
2. **带表头的 AT / RT / Slack 报告**：首行含 `point` 以及 `at_level`、`rt_level`、`slack_level` 中至少一项（可选 `kind` 列指定 `pi` / `po` / `and` / `constant`）。同时给出 AT 与 RT 且省略 Slack 时，自动推导 `slack_level = rt_level - at_level`。
   - **语义约定**：**仅主输入（PI）的 `at_level` 参与下游拓扑层级传播**；内部节点与输出上的 `at_level`、`rt_level`、`slack_level` 作为外部报告值原样保留并展示。

### 面板与视图联动

- `Navigator → Design`：展示 `Maximum output level`、`Level file` 与 `Reported points`。
- `Navigator → Objects`：展示并支持按 `Topology level` 排序。
- `Inspector → Analysis`：并列展示 `Topology level` 与 `Reported AT level`、`Reported RT level`、`Reported Slack level`（或 `Slack level (RT − AT)`）。
- `Standard` 视图按已占用拓扑层级的先后顺序分层排布（含带非零初始层级的独立支路）；`Logic View` 允许端口靠近相连逻辑。
- 再次加载新 Level 会校验通过后替换旧 Level；每张 AIG 的 Level 附件随图独立保存，在多图切换与标签页刷新后自动恢复。

---

## 7.3 图元约定、对象浏览与 BLIF 名称映射

- **图元与极性**：信号自下向上流动——**正三角形**为主输入（PI），**倒三角形**为主输出（PO），**椭圆**为二输入 AND 节点；**虚线边**表示逻辑反相（含输出端反相），实线边表示正相传输。PI/PO 保留原始信号名，内部 AND 采用稳定编号。
- **`Navigator` 面板**：
  - `Design`：规模统计、最大逻辑深度/最大输出拓扑层级、Level 信息与分析摘要。
  - `Objects`：默认列出输入/输出，可按类型（PI / PO / AND / Constants）、名称或来源 ID、关键路径与扇出筛选，按名称/深度/拓扑层级/扇出排序（每页最多 100 项；点击 `Show selection` 跳转至当前选中项所在页）。**列表筛选仅过滤左侧列表，不裁剪画布。**
  - `Names`（存在 BLIF 名称映射时显示）：使用独立注释行 `# <BLIF信号ID> <设计名称>` 定义映射（保留层次分隔符与方括号）。画布与导出 SVG 显示原始信号名，顶部 `Search` 与 `Names` 页可按设计名、原始 ID、画布节点 ID 检索并跳转；同名或一对多映射会在 `Names` 列出全部候选，冲突与未声明信号汇总在 `Log` 中。
- **`Inspector` 三页签**：
  - `Connections`：独立输入槽位（Input slots）、边极性与上下游邻接节点，点击输入槽位可直接选中对应连线。
  - `Analysis`：逻辑深度/拓扑层级、Reported AT/RT/Slack、扇出引用统计，以及当前对象的相关逻辑块/重收敛列表。
  - `Source`：原始来源 ID、归一化折叠的 BUF/NOT 别名链、极性、映射设计名与源文件行列位置（支持一键复制）。

---

## 7.4 视图模式与高亮叠加层

新导入的 AIG 默认使用 **`Logic View`**（刷新已有会话沿用原画法）。上下文栏 `View` 可切换：

- **`Standard`**：按逻辑深度（或加载 Level 后的已占用拓扑层级）严格分层。
- **`Logic View`**（原 ABC 视图）：允许输入与输出靠近各自相连的逻辑，输出不强制统一排在顶层。

切换视图会重新布局，但复用同一文档已有的结构分析结果。

| 控件 | 位置与用途 |
| --- | --- |
| `Highlight connections` | 上下文栏，默认 `All`。选 PI 时绿色向下游追踪；选 PO 时蓝色向上游追踪；选 AND 时上游蓝色、下游绿色各自计算级数；选边时标记两端点。可选 `Off`、`1 level`、`2 levels`… 或 `Custom…` 输入正整数实时预览（`Enter` / 失焦保存，`Esc` 或非法值恢复），范围外灰显。 |
| `Block labels` | `Settings → AIG overlays`；在已识别逻辑块正相根附近显示类型标签，保留原始 AND 节点。 |
| `Dim outside selected result` | `Settings → AIG overlays`；在 Analysis 中选中逻辑块或重收敛对时淡化外围逻辑。 |
| `Logical critical path` | `Settings → AIG overlays`，默认关闭；红色高亮最长逻辑深度/拓扑层级路径（整数级数，非物理 STA 延时）。 |
| `High fanout` / `≥` | `Settings → AIG overlays`，默认关闭；橙色外框标记扇出引用数达到阈值（默认 `≥ 2`）的节点。 |

上述高亮与标签开关均即时更新，**不触发重新布局**，且随独立 SVG 导出。选中结构分析结果时以结构高亮为主并暂停连接高亮；点击普通节点或 `Clear highlight` 即可恢复。

---

## 7.5 AIG Focused 局部逻辑

BLIF 与 ABC DOT 均支持从 PI、PO、AND 或常量抽取局部逻辑：

- 选中节点后点击 `Focused` 或 Inspector 的 `Replace roots`；在搜索结果或 Inspector 点击 `Add to Focused` 追加根（最多 **32 个 roots**），`Whole` 清除 Focused 裁剪。
- `Fanin` / `Fanout` 控制沿输入/输出扩展的步数（均设为 `0` 时仅保留 roots 及其直接连线）。
- 跨越当前范围的边界以带 `In` / `Out` 的半透明虚线框标出（虚线边表示反相，下游相同信号与极性会列出负载数）。单次抽取上限为 **512 个真实节点**，达上限时状态栏与 `Log` 提示截断。
- 搜索始终覆盖完整源图；直接激活标记为 `Outside Focused` 的搜索结果或 Inspector 连接会将其追加为 root 并定位。切换视图保留范围，支持视图历史撤销/重做、刷新恢复与导出当前子图 SVG。

---

## 7.6 结构分析：重收敛、逻辑块识别与点相关查询

导入或切换范围后，打开 **`Navigator → Analysis`** 查看当前展示子图的后台分析结果：

### Reconvergence（重收敛）

- 列出 `Stem`（分叉点）到 `Merge`（汇合点）的结构重收敛；点击一行以蓝色 / 橙色高亮两条仅共享起点和终点的见证路径 A / B，详情显示端点、AND 深度与沿途节点（`edges` 为边数而非时间延迟）。
- 按需计算完成后，`Path union` 给出通往同一汇合点的路径并集，额外路径以青色显示。

### Blocks（逻辑块识别）

- 自动识别 **XOR2**、**XNOR2** 与二选一 **MUX2**（覆盖典型 AND/反相边及有界 cut 内等价变体），可按 `Root type` 筛选。
- `Function at the positive root` 展示根节点出边取反前的函数；`Root output uses` 逐条列出下游输出槽、边极性与接收端实际函数（如同一 XNOR 根驱动实线得 XNOR、驱动反相虚线得 XOR）；中间节点外引支路列在 `External uses of internal signals`。
- `candidates` 为合法边界候选数，`distinct roots overall` 为不同根总数；同一根的正反相用途不重复计作两个物理块。

### 从节点查找相关结构（点相关查询）

选中节点或边后打开 **`Inspector → Analysis`**，有相关结果时会显示 `Related blocks` 与 `Related reconvergence`（最多展开前 20 项，点击跳转到左侧 `Navigator → Analysis` 对应项并高亮，点 `Locate` 才移动视口）：

| 查询对象 | 当前关联范围 |
| --- | --- |
| 节点的逻辑块 | 节点为块内部 AND 成员或边界输入时关联（仅作块外负载不关联；查询 PO 时请先在 `Connections` 点击其驱动 AND） |
| 节点的重汇聚 | 按已保存的两条见证路径索引（含 Stem、Merge 与沿途节点；仅出现在其它路径并集中的节点可能漏关联） |
| 一条边 | 合并两端点的关联结果 |
| 节点附近 N 跳 | 结构列表尚不支持按跳数筛选；画布连接高亮请使用 `Highlight connections` |

### 分析状态、预算与重试

- 状态包含 `Waiting to analyze` / `Analyzing…`（可点 `Cancel` 取消）、`Analysis complete`、`Partial results`（达工作量/cut/搜索规模预算，查看 `Reached` 原因）、`Analysis cancelled` / `Analysis unavailable`（点击 `Analyze again` 重试）。
- 结构分析与路径详情单次超时 **15 秒**（与 Graphviz **20 秒**布局超时独立计时）。取消或失败后切换视图不会自动重启分析；路径并集失败时仍可查看两条见证路径，再次点击结果可重试并集。

---

## 7.7 格式与容量边界

- **BLIF 子集**：支持 `.model`、`.inputs`、`.outputs`、`.names`、`.end`、注释、`\` 续行及所有零/一/两输入组合函数的 ON/OFF cover（`-` 为无关项，XOR/XNOR 自动展开为 3 个 AND + 反相边）。拒绝一般多输入逻辑、`.gate` / `.subckt` / `.latch` / `.exdc`、无驱动信号、多驱动冲突或组合环路，并报告位置。
- **独立性与折叠**：独立重复的 AND 节点保留各自身份；纯 `BUF` / `NOT` 链折叠为带极性的来源别名（记录在 `Inspector → Source`）。
- **容量与超时上限**：单个 AIG 或 `.level` 文件上限 **16 MiB** 字符；AIG 对象总数上限 **100,000**；同页 AIG 集合上限 **64 图 / 32 MiB**；Graphviz 单次布局超时 **20 秒**（超时或格式错误原子保留原视图，不回退到网表布局器）。
- **离线运行**：Graphviz / Viz.js / WASM 随包分发，无需联网或本机安装 ABC / Graphviz。

---

## 7.8 动手练习与最小示例

### 练习 1：结构分析（[`examples/aig_structure_demo.blif`](../../examples/aig_structure_demo.blif)）

该示例包含 `x = a XOR b`、`q = a XNOR c`、`y = s ? x : q`：

1. `File → AIG + Level → Open AIG…` 打开 `examples/aig_structure_demo.blif`，切至 `Navigator → Analysis`，默认预算下显示 `Analysis complete`、`Reconvergence (6)` 与 `Blocks (3)`。
2. 点击一条重汇聚结果观察蓝色路径 A、橙色路径 B 与青色 `Path union`，点击 `Locate` 定位。
3. 切至 `Blocks`，用 `Root type` 依次筛选 XOR2、XNOR2、MUX2（各 1 个候选）；选中 MUX，对照正相根公式与 `Root output uses` 中 `y` 的反相虚线还原效果。
4. 选中输入 `a`，在 `Inspector → Analysis` 验证点相关跳转；切换 `Standard` / `Logic View` 并开关 `Block labels` 与 `Dim outside selected result`，最后 `File → Export SVG` 导出。

### 练习 2：BLIF 名称映射与 `.level` 报告

在 `File → Open design…` 中同时选中 [`examples/aig_mapped_names.blif`](../../examples/aig_mapped_names.blif) 与 [`examples/aig_mapped_names.level`](../../examples/aig_mapped_names.level)：

1. 顶部 `Search` 输入 `in_96` 定位 PI（画布显示原始端口名 `n0`）。
2. 在 `Navigator → Names` 输入 `n3`，点击 Canvas ID 并在 `Inspector → Source` 查看原始 ID、设计名、极性与注释行号。
3. 选中输出 `n3`，在 `Inspector → Analysis` 核对 `Topology level = 4`、`Reported AT level = 4`、`Reported RT level = 3`、`Reported Slack level = -1`；选中驱动 `n2` 的内部节点查看自动推导的 `Slack level (RT − AT) = 2`。

### 最小可运行 BLIF 示例

将以下内容保存为 `aig_demo.blif` 或直接粘贴至 `File → AIG + Level → Paste AIG…`：

```blif
.model aig_demo
.inputs a b
.outputs y yn
.names a b n
11 1
.names n y
1 1
.names n yn
0 1
.end
```

导入后可在 `Navigator → Objects` 切至 `AND` 查看内部与门（`AND depth = 1`、`Fanout references = 2`），选中 `yn` 观察 `Inverted` 虚线边，勾选 `Settings → AIG overlays → High fanout` 查看橙色高扇出外框。

---

> 下一章：[8. SSH 远程工作台、命令行启动器与 EDA/Tcl 集成](08-remote-workbench-and-eda.md)
