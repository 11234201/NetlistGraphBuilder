# ELK-Q03 EQ1471 BK：三处坐标差异已归因，不修改生产 tie

日期：2026-10-12。状态 completed（仅本项诊断）；整体质量验收仍 in_progress。性能暂停。

## 问题与来源

actual EQ1471 同 pre-P4 图 2846 nodes/3144 edges，四候选 root/align/sink/innerShift/blockSize/shift
及高度一致，但 LEFTDOWN 一个 y 相差 108、LEFTUP 两个 y 相差 126。不能由高度相同宣称完全匹配。
输入、原 oracle 与早期结果见 [实际 EQ 相位记录](elk_quality_eq1471_phase_20261012.md)。

依据 pinned ELK `28e5173243cab0cf4e2c9816c803bc0d5c47ab24` 的完整 `ThresholdStrategy`、
`BKCompactor.placeBlock` 和 `BKAlignedLayout` 流程，与候选 `bk_alignment.js` / `bk_compaction.js` 对照。
当前候选明确按 owned clockwise port order、同 port 内 canonical edge ID 选择首个 eligible edge。
该 tie 是稳定身份适配，不依赖 parser/原始 array 的分配次序。

曾提出“只在有 neighbor 时调用 threshold”的子假设，但完整源码尾部的 else 也调用；立即否定。
没有运行这个 guard，更未修改生产。此反证保留，避免以后重启错误方案。

## 只读事件与完整性

Harness 1.5.0 新增独立 traceVersion 1.0.0 `<case>.bk_decisions.json`，保留 schema 1.1.0 主快照不变。
记录实际 threshold、bound-pick、deferred、finish、post-pick、move、逆序 retry，不调用随机数或改变数据。
JVM 指数/owned port ordinal 仅通过同一个 connected pre-P4 图解析；不能把原已排序的 incidence 集合当作
上游实际 first-edge 顺序。选边比较使用精确端点身份；不能声称恢复了未记录的平行边 allocation ID。

十个旧完整图（含 EQ 和三个 self-loop aux）全部旧内容去 harness provenance 后完全相同，JUnit 6/6。
候选只读 observer 由当前原核机械派生，未写回生产；六 oracle 四候选与原结果逐字段一致。
比较器只有 coordinate 字段允许既有 1e-7 容差；IDs、order、flags 精确，四方向每个 root 恰好一次 finish
是必要覆盖条件，空/partial sidecar 明确拒绝，不 fallback 成“全匹配”。

## 首次分歧和单变量回放

| 候选 | 上游／原候选事件数 | 原候选首次分歧 | 研究-only 回放 |
| --- | --- | --- | --- |
| RIGHTDOWN | 4525 / 4525 | 无 | 全事件、全部 BK 字段匹配 |
| RIGHTUP | 4455 / 4455 | 无 | 全事件、全部 BK 字段匹配 |
| LEFTDOWN | 4192 / 4180 | event 2129：`_1291_` 同 Z port，上游选择 long-edge dummy，候选选择 Focused output | 全事件、全部 BK 字段匹配 |
| LEFTUP | 4197 / 4188 | event 1889：`_2529_` 同 Q port，上游选择内部 cell，候选选择 Focused output | 全事件、全部 BK 字段匹配 |

原 threshold/deferred/finish/bound-pick 数量相同，随后 move/retry 数量不同。不能先改变 spacing、delta
或可移动空间公式。研究回放仅在**同一个 owned port 内**提升 recorded choice，不跨 P3 port order，
不跳过 used/finished/onlyDummies 等原 eligibility；冲突选择明确拒绝，无 rule/seed 搜索。

结果：17369 个事件完整匹配；四候选七字段、height、feasible 全部匹配，三处 y 差异归零。
这是因果证据：差异来自同 port 内的先后选择，再影响 straightened flags 和 deferred movement。
不是已证明的 queue/空间公式或边界 threshold 缺项。

## 决定、产物与验证

保留当前生产 canonical-ID tie，不复制上游分配顺序进入算法；没有 fixture 名称规则、固定坐标修补，
没有把回放器接入 UI。原候选仍有三处坐标不同，但已解释为声明范围内的稳定 tie 适配。
这不关闭 P3 的 355 crossing gap、D01/D04 的失败试验或 EQ fragmentation 门禁，更不代表达到 ELK 水平。

所有大产物在 `/home/wzh/my_code/netlistGraphBuilder-elk-quality-20261012/dc_runs/`：

- `q03_bk_events_attempt01`：Java 主快照/sidecar、十图 observation check、候选原事件；488 文件冻结。
- `q03_bk_events_attempt02`：原事件 first divergence；490 文件冻结。
- `q03_bk_events_attempt03`：单变量回放；492 文件冻结，原完整 unit 736/736。
- `q03_bk_events_final`：增加空/partial 证据拒绝后的独立复核，完整 unit 737/737，回放再次全匹配。

Runtime digest 仍 `sha256:404874badfee3691412d407fc71ea1d4be297664814b6e6d8fc6f9887041633c`，
生产 contract 1.1.0/package 0.2.0。未 fresh 重跑 47 worker/benchmark；相同 runtime 的既有 46/47、
dp020 原 45 秒超时照常保留，未切换、删旧或发布。

下一项：固定 actual pre-P3，对 initial layer order、port order、其余 geometry 分别做单变量隔离，
保持同一 perturbation key；不要用合法 BK tie 继续修图，也不恢复此前两个失败方案。
