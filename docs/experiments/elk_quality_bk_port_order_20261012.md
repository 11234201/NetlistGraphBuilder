# ELK-Q04 D03：BK threshold 的端口顺序语义修复

日期：2026-10-12。D03 功能修复与正确性复核完成；整体 ELK 水平尚未达到，性能仍暂停。

## 依据与单变量实验

- Primary source 固定于 ELK `28e5173243cab0cf4e2c9816c803bc0d5c47ab24`。
  `ThresholdStrategy.SimpleThresholdStrategy.pickEdge()` 选择第一个 eligible incident edge；
  `graph/LNode.java:343` / `:357` 逐 port 拼接 incoming/outgoing，因此必须消费端口顺序。
- 候选此前从全局 logical edge array 收集 `context.incident`，会覆盖 P3 已确定的 clockwise port order。
- `probe_bk_from_oracle.mjs` 直接使用 upstream pre-P4 图，不经过候选排名/排序：
  dp002 11351 nodes/12913 segments。Baseline 四候选的 root/align/sink/innerShift/blockSize/shift 均一致，
  RIGHTDOWN/RIGHTUP/LEFTUP 的 y 仍分别有 53/4858/1 差异，RIGHTUP 高度为 46388.5/44753。
- 仅在研究 context 中将 incident 按 owned-port order 排列，全部四候选七组字段和高度即完全一致。
  此后在生产共享 BK neighborhood 边界实施同一规则；同 port 内仍用 canonical edge ID tie。
- 不修改 ranking、median alignment、spacing、queue/retry 数量、P5、validator 或后置节点位置。
  没有实例名、坐标或 fixture 专属分支。

## 耐久最小反例

`tests/unit/elk_native_bk_threshold.test.js` 的四个固定单节点 block 隔离 threshold 消费：
c 的 high WEST port 是第一个 clockwise port，但其 edge ID 排在后面。正确 bound 为
`50 + 15 - 20 = 45`；错误全局 edge order 给出 spacing floor 30。
测试同时验证 input immutability 与 node/edge/port 数组排列稳定性，不依赖大型产品 fixture。

## 冻结复核

服务器目录：`/home/wzh/my_code/netlistGraphBuilder-elk-quality-20261012`。
算法 run：`dc_runs/q04_bk_port_order`；Node v24.16.0；contract 1.1.0/package 0.2.0。
完整 before/after 文件清单（477 文件）相同，runtime digest：

```text
sha256:404874badfee3691412d407fc71ea1d4be297664814b6e6d8fc6f9887041633c
```

| 检查 | 实际结果 | 产物 |
| --- | --- | --- |
| 最小反例、P4、raw BK、确定性与 fixture | 11/11 | `focused.log` |
| dp002 同 upstream pre-P4 四候选 | 所有字段/高度一致，无研究 override | `dp002_bk_isolated.json` |
| `npm test` | 727/727 | `unit.log` |
| 同输入 11 个 synthetic | 候选全零硬违规，before/after hash 一致 | `synthetic/`、`synthetic.log` |
| 三 Focused + 三 mapped | 候选全零硬违规，before/after hash 一致 | `product/`、`product.log` |
| 原 45 秒、47 full-node strict workers | 46/47；dp020 超时 45066 ms；完成项零硬违规 | `mapped.log` |
| Benchmark | 未运行，用户明确暂停性能；此验证保留未完成 | 不伪造结果 |

命令记录：

```sh
node --test tests/unit/elk_native_bk_threshold.test.js tests/unit/elk_native_p4.test.js tests/unit/elk_quality_bk_probe.test.js tests/unit/layout-determinism.test.js tests/unit/layout-fixtures.test.js
node tools/research/elk_phase_oracle/probe_bk_from_oracle.mjs dc_runs/q03_upstream_dp002_attempt02/mapped_large_dp002.json dc_runs/q04_bk_port_order/dp002_bk_isolated.json
npm test
MAPPED_CASE_PROVIDER=elk-native-candidate MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-hard
```

完整 Java 辅助 oracle：harness 1.4.0，JUnit 6/6，265 MB 留服务器。
Captured provider display hash 与产品比较及候选 witness 相同；Java 与 vendored elkjs 指标仍分开。
P0 有 1×1 ELK ports／候选 point anchors、bubble endpoint、388 个隐式 hub ports 的显式适配差异。
P1 方向全部一致，P2 objective 12913/12913、65/65 层；26 个 rank tie 不同。
不能据此宣称整个 P0～P5 完全等价。

收尾研究-only 修改（对称文件差分单测与 CairoSVG CSS 兼容）在独立
`dc_runs/q04_final_unit` 重新冻结 478 文件、前后 fileSetEqual，`npm test` 728/728。
其算法 runtime digest 与上面的 47-case run 相同；727 和 728 是两次不同完整文件快照，不合并日志。

## 未解决项与下一入口

- D01：dp002 reset 同一条边仍是 ELK 8／候选 50 折点，126 条边折点更多。
  修复仅使逻辑总长度从 8712709 降到 8712479；没有解决长链分裂，不能用这 230 的改善关闭反例。
- D02：SOP015 在既有 imported oracle 上 P3 layer 2/3 顺序不同；尚未证明是合法适配或缺项。
- 后续优先固定 P0/P2 及 port geometry，分离 P3 order 对 dummy chain 的影响，再做最小长 fanout 反例。
  BK 同前置图已有直接匹配证据，不继续盲调 BK 常数或做后置树打包。
- Q02 整体概览已生成，但极大图缩小到公共 800×700 时细节不可读；canonical 局部不代表全面视觉通过。
  还需可追溯的分段/分支审查和用户 Q06 接受。
- 原 dp020 失败、benchmark 未完成与 T01/Q07/Q08 blocked 保留。未接入 registry、删除旧实现或发布。

## 视觉产物的边界

Q04 完整 SVG 与 graph 留服务器；同公共 origin/viewBox 的小 PNG 和按同 canonical object 的局部 SVG
回传忽略 QA 目录。浏览器审查为 1280×900，完成态标签、junction/bridge/hit area 不省略。
服务器 CairoSVG 2.9.1 安装在实验隔离目录，不是产品依赖。
初次 rasterizer 无法解析导出 CSS `var(--wire)`，近乎空白的截图被拒绝。研究工具仅在已有 `<style>`
中解析原 root 变量，保持坐标、线宽、几何及用户文本；纠正后的工具另存 SHA-256，不混入在跑的算法冻结。
修正后仍因极小 zoom 无法读清的大图概览不作为可读性通过证据。
