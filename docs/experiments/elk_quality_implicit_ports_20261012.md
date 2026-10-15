# ELK-Q04-D01 隐式端口试验：未接纳，已回退

日期：2026-10-12。性能继续暂停；未切换 UI provider。

## 源码与单变量依据

Pinned ELK `28e5173243cab0cf4e2c9816c803bc0d5c47ab24` 的 `ElkGraphImporter.java:1140/1156`
对没有显式 LPort 的边端点逐边调用 `LGraphUtil.createPort`；同 port 多边才成为 hyperedge。
候选共享 role 虚拟端口与此不同。Q03 研究-only 固定实际 P1/ranks/seed、相同坐标，只拆身份：
原模型精确复现 tracked P3 order 和 20 个链高度，拆分后四个 BK 候选均只有一个高度/root。
这定位了 adapter/P0 差异，但没有证明完整产品净收益。

试验只改候选 application adapter：隐式端点 ID 由 node/role/logical edge 派生，显式 pin 仍共享；
孤立 portless 节点不造端口。未改算法 policy、测量、P1～P5、validator、45 秒预算或 UI registry。
完整运行使用新的真实 canonical digest，不把研究中冻结的 seed 强塞给产品。

## 冻结证据与结果

远端 `/home/wzh/my_code/netlistGraphBuilder-elk-quality-20261012/dc_runs/q04_implicit_ports`。
484 文件 before/after 完全一致；runtime digest
`sha256:511e341fdb398599f301046f516b89cbd21f216b2533535cc292eade99ed29ce`。
试验源码和专用测试保存在该 run 的 `trial_adapter.js` / `trial_adapter.test.js`。

20 个 focused/reference/determinism/fixture 测试为 19/20：两项隐式端口、排列、端点与输入不变
通过；EQ1471 的同次 fragmentation 门禁失败。六个产品同输入对照的候选硬违规均为零。
该硬通过不能覆盖软退步，也不证明全部 47 图通过。

| 项目 | Q04-D03 基线候选 | 隐式端口试验 | 同次 ELK |
| --- | --- | --- | --- |
| dp002 同条 reset 边折点 | 50 | 4 | 8 |
| dp002 比 ELK 更多折点的边数 | 126 | 2 | — |
| dp002 总逻辑线长 | 8712479 | 17794442.392 | 16320414.325 |
| EQ1471 fragmentation | 12 | 15 | 13 |

SOP015 指标不变，已有软门禁通过。新 dp002 maximum bends 为 10，不能误写成 tracked reset 的 4。
不同 port 模型的 phase crossing scalar 不直接作优劣比较；完整最终指标必须单独审查。

## 决定与后续

未接纳：局部折点明显改善，但已有 EQ1471 门禁失败、dp002 线长约翻倍。不得调整门禁、
挑固定 seed、只拆 fixture 的 hub、增加后布局挪动，或以这次结果关闭 D01。
已回退本次 adapter/README/契约试验；移除仅为该试验新增的生产断言测试（远端可恢复）。
Q03 两项 importer/alias 研究测试及源证据保留。未运行该失败候选的完整 unit、11 synthetic、
47 worker 或 benchmark；先决质量门禁已失败，不能据此宣称回归通过。

下一入口：分离隐式身份造成的 P3 port order、perturbation key 和 merge 变化，与上游同前置图对照；
独立核对“display names 不参与 ties”的现有契约，若违规先登记新缺陷，不与该试验混合修复。
既有 dp020 超时与交付阻塞仍保留。
