# ELK-Q03 首批质量分歧卡

日期：2026-10-12；D01/D02 in_progress，D03 已受控修复并复核。性能暂停。
这是 [验收计划](../plans/elk_level_acceptance_plan.md) 的逐缺陷记录，不是修复完成报告。

## D01：dp002 长距离 reset/clock fanout 的过多折点

- 固定输入：manifest `mapped_large_dp002`，完整图、hub 开启、无 collapse/override。
- 同次运行：服务器 `dc_runs/q02_mapped_sample_20261012`，两 provider 输入 digest 均为
  `sha256:458b7eafec40891b1d89c27a7078756306f88e0dd814fb6c751ce6fcf51ae008`。
- 最差逐边反例：`edge:input:rst_n:cell:_842_:rst_n:1066:hub-out`，
  `hub:rst_n:1` → `cell:_842_` RN；ELK 8 折点／候选 50。
  整体 maximum 为 22／50，不是这条边的同边对照。126 条逻辑边的候选折点更多。
- 硬几何：ELK 8 项／候选 0 项。参考硬违规不豁免候选，也不能消除软质量反例。
- 候选相位 witness：`dc_runs/q03_dp002_reset/phase_witness.json`，输入 hash 与比较 run 相同。
  59 个 dummy，P4 已有 20 个不同 y，P5 保留这 20 个 y；不能单凭这个记录指责 P5。
- 四个 P4 候选均 feasible：RIGHTDOWN 37470、RIGHTUP 36818、LEFTDOWN 31972、LEFTUP 43214；
  当前选择最小高度 LEFTDOWN。合法最小高度选择可能仍有较差直线率，不允许换成 fixture 专属偏好。

可证伪假设：长 dummy 链在 P4 之前的排名/排序/合并结构已有不同；若相同输入 upstream 的
P2/P3 不同，先定位最早分歧。只有前置图一致时才比较 BK root/align/innerShift/compaction。
后续先扩展实际 provider 输入 importer，取得 pinned Java 全相位证据；它与 vendored elkjs
不是同一个参考，必须分别登记。暂时不增加数值阈值，不把局部截图作用户接受。

已否定的修复猜测（均未改生产代码）：

1. `onlyDummies` 初始 true 是 bug：pinned `BKAlignedLayout` 本身初始化为 true，由 `BKAligner` 更新。
2. 跨 class 固定 node spacing 是 bug：`BKCompactor` 跨 class 同样使用 `SPACING_NODE_NODE`，
   class 内才使用 dynamic vertical spacing。
3. `favorStraightEdges` 应默认 false：`Layered.melk` / `GraphConfigurator` 的 ORTHOGONAL 默认 true，
   与当前候选一致，不能为了较低折点反转默认值。
4. 缺少直线优先级常数：当前适用 upstream processor 没有赋值证据，默认 priority 0 不构成已证明缺项。

## D02：SOP015 排序分歧，尚不能判定为缺陷

输入为既有 pinned Java oracle imported 图，不与产品最终几何指标混用。
`compare_native_phases.mjs` 现在对照完整 layer order 和三个 resolved spacing，而不只检查 scalar。
`dc_runs/q03_order_differences.jsonl`：前五个机制 oracle P1/P2/P3 顺序一致；SOP015 P1 一致，
P2 objective 64/64、7/7 层、rank 一致，P3 的 layer 2/3 首次不同。
Upstream P3 phase crossings 7，候选 5；它不是产品最终 logical crossings 28/6。

可证伪假设：P3 port distributor／sweep schedule 与约定适配存在未解释差异。
下一步对照完整源码流程与事件；更少交叉不能自动证明适配正确，合法 tie 也不能自动判 bug。

## 退出要求

每项取得可重现的最小反例或前置图一致证据、明确 owning boundary 和独立源码依据后，
才能安排一次一个假设的 Q04 修改。D03 已按此程序准入；D01/D02 不得跳过归因。
现在没有性能优化、UI 切换或发布。

## D03：相同前置图上的 BK compaction 差异

已新增只用于研究的 raw pre-P4 core probe，不经过候选 P1/P2/P3，不进入生产 layout pipeline。
六个既有 oracle 四候选全部匹配；dp002 的相同 upstream pre-P4 图为 11351 nodes/12913 edges。
四候选 root/align/sink/innerShift/blockSize/shift 均完全相同，最终 block y 仍有差异：
RIGHTDOWN 53、RIGHTUP 4858、LEFTDOWN 0、LEFTUP 1。RIGHTUP 高度候选 46388.5／upstream 44753。
实际选中的 LEFTDOWN 完全匹配，所以此缺项不能直接解释 D01 的当前 50 折点。

H04：threshold/deferred straightening 的 first-edge 消费没有遵守 P3 的端口顺序。
源码 `ThresholdStrategy.SimpleThresholdStrategy.pickEdge` 按 `LNode.getIncomingEdges/getOutgoingEdges`
迭代；候选 `context.incident` 当前从全局 edge array 收集。先仅在研究 context 中改为 clockwise
owned-port order，保持 align、前置图、spacing、队列策略不变。若所有 y 差异消失才考虑证明与最小反例；
若仍存在则保留失败，继续定位，不能直接发布算法修改。

H04 结果：研究 context 仅按 owned-port clockwise 顺序排列 incident edges，四候选的全部
root/align/sink/innerShift/blockSize/shift/y 和高度立即完全匹配（`bk_clockwise_incident.json`）。
源码依据与同输入反证闭合，D03 准入一次 Q04：在共享 BK neighborhood 边界保留 P3 port order，
同一 port 内仍按 canonical edge ID tie，避免 raw array 顺序依赖。新增四节点固定-block 反例和排列测试。
修复不改变排名、align、spacing、队列、次数或 validator，不声称 D01 随之关闭。

D03 正式复核：最小反例、确定性/fixture、六个既有 raw BK oracle 均通过；dp002 raw BK 四候选全部
匹配（未使用研究 override）。`npm test` 727/727；11 synthetic + 6 产品候选均零硬违规；
原 45 秒、47 full-node strict 门禁 46/47，dp020 45066 ms 超时。完整记录见
[Q04 修复报告](elk_quality_bk_port_order_20261012.md)。Benchmark 因性能暂停未运行。
D01 同边仍 8/50，126 条边折点更多；D03 功能修复完成不代表质量或交付验收完成。

## D01 H05：相同 pre-P3 输入的排序隔离（继续）

`q03_p3_isolation/dp002` 冻结实验：actual upstream retained P3 crossing counter 为 46821，候选 counter
完全匹配。在 exact upstream ranks/ports/initial layer order 下，候选 selected crossings 49475（高于
upstream），但它及七次固定 attempts 的 reset 59-dummy 链均只有一个高度、一个 BK root。
因此没有复现实际产品模型的 20 个高度；不能把原 50 折点归因成 P3 实现单独偏差。
该排序软质量差异仍保留，不能用长链同高掩盖更多 phase crossings。

下一假设 H06：P0 对 portless 节点共享一个 role 虚拟端口，与 upstream 每 logical endpoint 隐式端口
不同，改变 P3 hyperedge 分组及 merge/BK 的链结构。研究 ablation 固定 P1/ranks/seed，只拆隐式 port
身份，保留相同点坐标、bubble、测量和全部逻辑/物理 lineage。未证明前不改生产适配器。

H06 已取得受控证据（`dc_runs/q03_p3_isolation/aliases`）：共享 role 模型精确复现原 tracked P3 order
（差异 0）及选中链 20 个高度。仅拆隐式 source 身份后，386 个 source ports 替代原 2 个；59 个 dummy
在四个 BK 候选中均只有一个高度/root。P1/ranks/perturbation key 固定，点坐标不变；variant input digest
分别保存，并未伪称两个 canonical input 相同。不同 hyperedge 分组的 crossing scalar 不直接作质量胜负。
Primary source `ElkGraphImporter.java:1140/1156` 对没有 LPort 的逐边端点调用 `LGraphUtil.createPort`；
`1163–1167` 只有实际同一 port 多边才标记 HYPEREDGE。Owning boundary 是 application adapter/P0。

D01 准入 Q04 单变量试验：修正隐式 endpoint identity；保留显式引脚共享、测量、端点坐标、物理 net、
算法 policy、超时和 validator。先 owning-boundary 单测/排列，再完整 P5、17 质量样本和 47 原 worker。
目前只证明 P4 链分裂来源，不证明最终折点改善或无回归，不关闭 D01。无 UI 切换或性能工作。

Q04 试验未接纳并回退：同条 reset 50→4，但 EQ1471 fragmentation 15 > ELK 13，dp002 总逻辑线长
约翻倍。六产品零硬违规不能豁免此退步。见 [隐式端口失败试验](elk_quality_implicit_ports_20261012.md)。
H06 的输入语义归因保留；要继续隔离 order/seed/merge，不能恢复共享端口后宣称该缺陷已消失。

## D04：显示名泄漏到 P3 perturbation key（已定位，试验未接纳）

独立冻结 run `dc_runs/q03_display_name`，已回退 D01 adapter 试验后执行。六个既有 oracle 的 IDs、
节点测量、端口、边与 policy 完全不变，仅将 displayName 替换为 `display-only:<canonical ID>`。
Non-display P0 semantic digest、P1 orientation、P2 ranks 全部相同；原始输入仍 mutable 且未改动。

Smoke 的 P3 layers 0/1/2 改变；SOP015 的 layer 3 改变。两者 selected crossing scalar 未变
（分别 0 与 6），因此“交叉一样”不能证明顺序稳定。其余四项 selected order 没变但 perturbation key
均改变。Source/measurement 未变，这是名称与算法决策的泄漏，不是标签变长导致尺寸改变。

Owning boundary：`ir.js` 的完整 canonical inputDigest 正确包括显示元数据（用于完整 provenance）；
`p3_ordering.js` 用这个 digest 初始化 randomStream，错误地把元数据消费为排序输入。
现有 contract `Common identity and ordering` 明确 display names 不参与 ties；该项目稳定身份适配规则
不是 upstream 坐标必须相同的要求。实验使用旧的共享隐式 port，未混入失败 D01 修复。

下一 Q04 准入要求：P0 提供独立的 ordering digest（仅固定身份、已测量结构/几何和策略），P3 消费它，
完整 inputDigest 仍保留显示元数据。新增 rename-only、排列、完整 package geometry/observer 测试。
比较字段变化先版本化契约；不得沿用诊断里的强塞 seed，更不允许根据某 fixture 选择一个“好”key。
需要 fresh phase/reference、17 样本、完整 unit 和原 47 strict worker；失败同样不能豁免。

独立 Q04 已实施并回退：23/24 首批测试；六 oracle 名称隔离、完整 geometry、observer 与 P3 reference
均通过，但 EQ1471 fragmentation 15>13。见 [结构排序哈希试验](elk_quality_ordering_digest_20261012.md)。
仅试一个 key 定义，没有为通过门禁寻找备用 hash/seed。D04 仍打开，当前候选保持旧版本。

## EQ1471 后续相位隔离（进行中）

实际输入 787/1085 已取得 pinned upstream 完整 oracle。Imported 模型 P1/ranks/objective 完全相同，
首个差异 P3；exact pre-P3 candidate crossing 40215 vs upstream 39860。同 raw pre-P4 四候选结构/高度
一致，但 LEFTDOWN 1 个、LEFTUP 2 个 y 差异仍保留。不能用近似相同关闭 D01/D04 或 15/13 门禁。
输入哈希、CLI 反证、残余事件证据缺口与下一步见 [EQ1471 相位记录](elk_quality_eq1471_phase_20261012.md)。

BK 三处 y 后续已归因：同 port 内选边 tie 导致，研究回放恢复全部 17369 事件及四候选字段；属于当前
canonical-ID tie 适配，不是空间/queue/边界 threshold bug，不改生产。详见
[BK 选边归因](elk_quality_bk_edge_ties_20261012.md)。P3/fragmentation、D01/D04 仍未闭合。
