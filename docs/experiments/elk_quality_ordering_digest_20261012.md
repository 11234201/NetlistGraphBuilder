# ELK-Q04-D04 结构排序哈希试验：未接纳，已回退

日期：2026-10-12。独立于隐式端口试验；性能暂停，UI registry 未切换。

## 已证明的缺陷

只改六 oracle 的 displayName、固定测量/IDs/ports/edges/policy，non-display P0、P1 与 P2 完全相同。
Smoke（6 nodes/8 edges）layers 0/1/2 改变；SOP015 layer 3 改变。P3 randomStream 消费包含显示名的
完整 canonical digest，违反现有身份契约。完整 provenance digest 包含显示名本身没有错。

## 唯一试验方案

临时 contract 1.2.0/package 0.3.0：P0 增加 `orderingDigest`，hash canonical nodes（仅排除 displayName）、
edges/self-loops/physical nets/normalized policy，不含 contract metadata；P3 消费该字段及原显式 seed。
完整 inputDigest 不删元数据，各相位与完成结果保留两种 digest。上游 oracle schema 1.1.0 不变。
没有尝试备用哈希、调 seed、加尝试次数或修改排序/spacing/validator，也未恢复 H06 端口改动。

## 冻结结果

远端 `netlistGraphBuilder-elk-quality-20261012/dc_runs/q04_ordering_digest`；486 文件 before/after 一致，
runtime digest `sha256:19428ee343a33320a2edb992149044b5b86b157f1462f5d8dd40a87bef8d68b8`。
`before_source` 和 `trial_source` 保留精确源文件与新增专用测试，可恢复；不作为当前候选验收。

24 项 focused/reference/package/研究测试为 23/24。新增 3 项 owning-boundary 测试通过，覆盖六 oracle
rename-only 完整几何、observer、排列、输入不变、测量/policy 改变必须改 key、缺 key 拒绝而非 fallback。
六参考 P3 crossing quality、完整 package 硬几何均通过。再次运行显示名 probe 的全部 changedLayers 为空。

失败项：EQ1471 fragmentation 15 > 同次 ELK 13（旧候选 12）。证明名称隔离实现正确，不等于满足产品
质量门禁。没有运行该失败试验的完整 unit/17 quality/47 worker/benchmark，不能虚报这些通过。

## 决定

未接纳，已精确回退试验涉及的生产源码、版本和契约；新增仅用于该版本的生产测试移出活动测试集，
远端 trial_source 可恢复。保留 rename-only 研究探针及 D04 缺陷，不宣称显示名泄漏已修复。
当前重新回到 contract 1.1.0/package 0.2.0。两个正确语义试验都触发 EQ1471 的同一门禁，需要取得
actual upstream EQ1471 的完整 P3/order/merge/BK 证据，先解释差异，不以 hash/seed 搜索解决。
