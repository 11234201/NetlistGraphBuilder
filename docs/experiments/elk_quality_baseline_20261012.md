# ELK-Q01 质量基线与证据清单

日期：2026-10-12（Asia/Shanghai）；Q01 状态：completed；Q02 仍 in_progress。
依据：[后续计划](../plans/elk_level_acceptance_plan.md)。性能暂停，dp020 失败保留。

## 冻结协议

- 原产品场景保留现有 SOP015/EQ 门禁，零硬违规与完整物理拓扑不变。
- 新合成场景首先冻结输入、完整配置、哈希和同视口协议；软指标先 observation-only，不自动宣布视觉通过。
- 同输入、同尺寸、同端口、同 seed，对照 vendored elkjs 0.11.1；已有 Java oracle 只用于相位证据。
- 合成图从已有 imported snapshot 或 test-only generator 取得；两侧直接使用同一 canonical port DTO。
  这是算法机制对照，不假装走过 parser/Focused/UI 产品链路。产品链路由三项实际 Focused 对照另验。
- 两侧经过相同 shared labels、physical wire tree、validator 和 Scene；只整体平移，不能修节点、bend 或 slots。
- 保存 before/after 文件清单，文件集合哈希变化则整次 frozen run 作废。
- 新场景的数值门禁待审查，不从实验结果倒推宽松阈值；用户视觉结论不可被绿色数值覆盖。

## 初次清点：18 个正式 manifest 场景

“相位证据”指已有 P1～P5/final upstream 快照，不等于当前候选已通过该场景。
六个缺失 generator 在本轮补为 test-only 输入；生成器测试和布局运行结果另行记录。

| 场景 | 清点时输入 | 完整 upstream 相位证据 | 当前视觉验收状态 |
| --- | --- | --- | --- |
| oracle_smoke_001 | inline + imported snapshot | 有 | 待扩展 |
| p5_critical_split_001 | 白盒机制 probe | 仅机制证据，不是完整图 | 不适用 |
| chain_4 | inline + imported snapshot | 有 | 待扩展 |
| diamond | inline + imported snapshot | 有 | 待扩展 |
| balanced_tree_depth_3 | 仅 generator 声明 | 无 | 未运行 |
| unbalanced_tree_shared_leaf | 仅 generator 声明 | 无 | 未运行 |
| reconvergent_long_edge | inline + imported snapshot | 有 | 待扩展 |
| multi_port_fanout_hyperedge | inline + imported snapshot | 有 | 待扩展 |
| cycle_and_self_loop | 仅 generator 声明 | 无 | 未运行 |
| external_boundary_ports | 仅 generator 声明 | 无 | 未运行 |
| disconnected_components | 仅 generator 声明 | 无 | 未运行 |
| unequal_heights_dense_ports | 仅 generator 声明 | 无 | 未运行 |
| sop015_5426_focused_3_3 | 实际 Verilog + captured input | 有 | 已有局部开发者检查，非用户整体验收 |
| eq012_1471_focused_3_3 | 实际 Verilog | 无 | 已有根节点局部检查，非整体验收 |
| eq012_clk_focused_1_1 | 实际 Verilog | 无 | 已有 hub 局部检查，非整体验收 |
| mapped_small_sop001 | 实际 Verilog | 无 | 未完成同视口质量审查 |
| mapped_medium_eq006 | 实际 Verilog | 无 | 未完成同视口质量审查 |
| mapped_large_dp002 | 实际 Verilog | 无 | 未完成同视口质量审查 |

另外三个 self-loop upstream probe 是辅助相位证据，不混入正式 18-case 覆盖数。

## 版本核对

- 初始本地审计覆盖 320 文件；本地/旧远端快照算法文件一致，但 README、Java harness、run_oracle.sh 不同。
  新质量快照同步这三项后重新冻结；原 2026-10-11 日志不覆盖、不改写。
- 工具扩展后，哈希清单也纳入 tests/helpers、tests/reference、tests/unit，保证生成器和测试可追溯。
- 历史 718/718 和 46/47 的运行时源码哈希未记录，不倒填。当前哈希不能证明历史运行是当前版本。
- 新服务器项目：`/home/wzh/my_code/netlistGraphBuilder-elk-quality-20261012`；Node v24.16.0。
  本地只做小型源码哈希/文件检查；布局、测试和完整 SVG 在服务器执行。
- 初次本地哈希清单：忽略的 `dc_runs/elk_quality_20261012/local_baseline.json`。
  初次远端清单：服务器 `dc_runs/q01/baseline.json`；最终 Q02 run 使用自己 before/after 清单。

## 本轮入口

1. 补齐六个 test-only generator，测试端口与共享物理 net 的稳定性。
2. 对 11 个可绘制 synthetic 图逐个运行同输入 ELK/候选对照，probe 另列。
3. 保存失败，不以重新生成输入、改变数据规模或夹带生产修复消除失败。
4. 运行结束才记录数量、指标、截图和结论；以下证据只描述已经执行的范围。

## Q02 已执行结果

- 六个 generator 已补为 test-only 输入，manifest 未变；11 个可绘制合成图同输入对照均零硬违规。
  split probe 单独处理。冻结 run 为服务器 `dc_runs/q02_synthetic_neutral_20261012`，
  before/after 文件集合 hash 相同；runtime digest 为
  `sha256:63f422c839f8c47b02c7767cf2a62aca3b65a799fa6c5062846df9126e9d82fb`。
- 11 图开发者同视口检查已执行（1280×900、公共 viewBox、100%），截图保存于忽略 QA 目录；
  十图逻辑长度与 ELK 一致，密集端口为 878.4/745.6，physical crossings 均 18。
  合成 oracle box 用中性 Scene，产品 Netlist Scene 不变；不是用户或产品 UI 验收。
- 三个固定 mapped 的同输入对照 `dc_runs/q02_mapped_sample_20261012` 已完成并冻结。
  候选均零硬违规；small SOP 整体、中 EQ/大 DP 的预登记 canonical 节点局部已审查。
  中/大图整体概览及完整分支追踪仍未完成。

| mapped 样本 | 节点/边 | ELK/候选硬违规 | ELK/候选最大折点 | 审查状态 |
| --- | --- | --- | --- | --- |
| sop001 | 见逐例 report | 0/0 | 8/4 | 整体开发者检查；非用户接受 |
| eq006 | 182/313 | 4/0 | 8/4 | `_168_` 局部检查；整体待补 |
| dp002 | 717/1393 | 8/0 | 22/50 | `_715_` 局部检查；明确长 fanout 退步 |

dp002 126 条边的候选折点更多；最差 reset 同一条边 ELK 8／候选 50。
没有用更少总交叉/总长度掩盖该反例，已登记 [Q03 分歧卡](elk_quality_divergences_20261012.md)。
三项 Focused 本轮新冻结尚未运行；已有历史局部记录仍单列，不能与本轮合并。
首轮完整单元为 722/722（服务器 `dc_runs/q02_unit_complete.log`），后续研究工具改动需要新复核。
正式 47-case 仍为历史 46/47、dp020 45 秒超时；本轮研究/test-only 工作不替代该失败。

## Q04 后续证据（不覆盖以上 Q02 历史）

BK threshold 端口顺序缺项已由 same-pre-P4 四候选和 primary source 证明，并实施单变量修复。
新 run `dc_runs/q04_bk_port_order`：727/727 unit、11 synthetic + 6 产品候选零硬违规，
固定 47 full-node 原 45 秒 strict workers 46/47；dp020 45066 ms timeout。
本轮不再仅引用历史 46/47。新的运行前后 477 文件 hash 一致，runtime digest 与旧 Q02 不同，
详见 [Q04 报告](elk_quality_bk_port_order_20261012.md)。

审计工具后续纳入 `examples`，并补双向 added/removed/changed 文件差分；CLI 单独报告 fileSetEqual。
原冻结 runner 始终直接比较 fileSetDigest（包括新增文件），因此此诊断修复不使此前相等的冻结清单失效。
仍不以相同 package version 合并不同 file hash 的运行。
