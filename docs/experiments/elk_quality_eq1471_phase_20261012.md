# ELK-Q03 EQ1471：实际相位证据，尚未闭合质量差异

日期：2026-10-12。状态 in_progress；性能暂停、候选未接 UI。

## 输入与冻结

实际 `eq012_1471_focused_3_3`，787 nodes/1085 edges，hub 开启、无 collapse/override。
捕获保持实际 provider arrays、测量、显式 ports 与 portless node endpoints，未为 ELK 伪造共享端口。

- Provider input：`sha256:e22a133d17735d8e5356d8b48fe7ec9d32d575cb6a8bed1cba1e178e49c1c22b`。
- TSV input：`sha256:550d85d603d1bb48fb208ec927a7b61118397b075734e494ddb5828103910182`。
- Pinned Java oracle：`sha256:57fed052a179bd0573c5891fc3cd3d603239eb002cf0f15671b6021145b69f2c`。
- Upstream commit `28e5173243cab0cf4e2c9816c803bc0d5c47ab24`，harness 1.4.0，JUnit 6/6。

远端 `netlistGraphBuilder-elk-quality-20261012/dc_runs/q03_eq1471_attempt01`：485 文件冻结一致，
完整 imported→P1→P2→split→P3→merge→P4→P5→restore→final；409 个隐式 ports。
身份、测量、全部 logical/physical lineage 与 processor snapshots 核验通过。原始大 JSON 留远端。

首个对照调用发现 `compare_native_phases.mjs` 原 CLI 忽略文件参数，只循环六个耐久默认 oracle。
那份 JSONL 已隔离为 `six_default_comparison.jsonl`，不作为 EQ 证据。补显式文件入口，并测单文件只一项、
默认六项及 missing file 明确失败。实际比较使用独立 `attempt02` 冻结，不倒填 attempt01。

`attempt02` 486 文件前后一致，runtime digest
`sha256:404874badfee3691412d407fc71ea1d4be297664814b6e6d8fc6f9887041633c`，与已验证 Q04-D03 相同。
完整 `npm test` 732/732。当前生产 package 0.2.0/contract 1.1.0；两个失败试验均已精确回退。

## 已定位与未定位

以下是 Java imported 模型上的候选相位比较，不是旧 application adapter 的端口模型对齐，
也不是 vendored elkjs 的产品几何指标或 15/13 fragmentation 的直接证明。

| 观察 | 上游 Java | 候选 | 结论 |
| --- | --- | --- | --- |
| P1 working orientation | — | 差异 0 | 本 imported 模型一致 |
| P2 objective / layers / ranks | 3144 / 12 | 3144 / 12；rank 差异 0 | 不修改 rank 凑图 |
| 独立 pipeline P3 crossings | 39860 | 42746 | firstDifference 是 P3 order，layers 1～11 不同 |
| Exact upstream pre-P3 P3 crossings | 39860 | 40215 | 同前置 counter 精确匹配；仍多 355，不等于质量通过 |
| Exact pre-P4 BK root/align/sink/innerShift/blockSize/shift | — | 四候选零差异 | 大部分 BK 内部结构匹配，但还不能说完全一致 |

Same-pre-P3 使用真实 ranks、ports、测量、initial order；retained upstream counter 重现 39860。
不能把 42746→40215 的差异直接归因于某一种初始化字段，下一步需独立冻结字段做单变量隔离。
研究 tracked edge 按 upstream working rank span 最大、canonical ID tie 预登记选取：
`edge:input:clk:cell:_1746_:clk:1647:focus-in:hub-out`，8 个 dummy；source order、候选 selected 和七 attempts
均只有一个高度/root。这条链不代表全部 EQ 分支已易读，也不关闭既有 fragmentation 回归。

Exact pre-P4 为 2846 nodes/3144 edges；四候选 feasible、height 均与上游相同：
RIGHTDOWN 32121.5、RIGHTUP 33747.5、LEFTDOWN 31976.5、LEFTUP 32665.5。
RIGHTDOWN/RIGHTUP 完全匹配；LEFTDOWN 的一个 block y 相差 108，LEFTUP 两个相差 126，
位于外部 salt_q 输出节点。`matches:false` 必须保留，不能把高度相同写成所有坐标相同。

后续 BK 直接事件已取得因果收口：同 owned port 内回放上游选择即恢复全部 17369 事件和四候选所有字段。
三处差异归为已声明的 canonical-ID tie 适配；不复制原分配顺序进入生产。原候选仍非逐坐标相同。
见 [BK 选边归因记录](elk_quality_bk_edge_ties_20261012.md)。最终完整 unit 737/737，runtime 不变。

## 下一入口

1. 在 fixed proper graph 上分离 initial layer order、clockwise port order 和其他 pre-P3 字段，不挑 seed。
2. 已完成：对三个残余 BK y 差异记录 actual threshold/deferred pick-edge 和处理顺序，区分为 stable tie。
   当前 `PhaseOracleTest.portRecord` 把 incoming/outgoing edge IDs 排成集合；不能由它反推 ELK 的端口内
   first-edge 消费顺序。直接 sidecar 的十图 observation 不变已核验，不因此修改生产。
3. 取得最小反例与 owning boundary 后再进入独立 Q04，重新验证 D01/D04 与 EQ1471，而非恢复失败方案。

此轮没有新接纳的生产算法改动，没有 fresh 47-worker 或 benchmark。相同 runtime 的既有全图结果
仍 46/47、dp020 原 45 秒超时，性能/切换/发布阻塞未解除；不能断言达到 ELK 水平。
