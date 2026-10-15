# 隐式端口身份 / P3 key 因果隔离

状态：研究诊断完成，未准入生产。contract1.1.0/package0.2.0不变。

预登记假设：原D01端口身份迁移失败，是否主要由随机key随身份变化引起？复用原试验 `virtual:JSON.stringify([nodeId,role,edgeId])` 身份公式。通过own adapter/index/P3 dataURL研究注入，不恢复生产trial。natural正常使用新P0 digest；frozen仅让P3消费同一baseline组件P0 key，完整inputDigest始终真实；组件按真实node集合匹配，缺key拒绝，不回退。

frozen是诊断控制，不可部署；没有挑选hash/seed、改工作顺序、叠加D04或改validator。

| 场景 / 指标 | natural | frozen baseline key |
| --- | ---: | ---: |
| EQ1471碎片组 | 15 | 14（ELK13） |
| EQ1471逻辑线长 | 6451442.694 | 8445691.694 |
| EQ1471逻辑交叉 | 31642 | 31387 |
| EQ1471物理交叉 | 23211 | 24464 |
| dp002逻辑线长 | 17794442.392 | 16256776.392 |
| dp002逻辑交叉 | 44065 | 43905 |
| dp002物理交叉 | 19640 | 20016 |
| dp002最大折点 | 10 | 18 |
| 同条reset边折点 | 4 | 4 |

三例（SOP015、EQ1471、dp002）两组均hard0，SOP指标不变。natural精确恢复原D01失败指标，确认不是另一个端口方案。冻结key没有关闭EQ门禁，且线长退步更大；“仅key导致退步、固定旧key即可修好”假设否定。端口拓扑本身与搜索轨迹均有影响，不能靠备用seed修复。

同时完成merge边界核对：完整source DFS与当前DSU一致（无label作用域），不应改成endpoint-only。三条durable scheduled边界完整semantic nodes/ports/edges匹配，三个absent processor明确拒绝；actualEQ merged0、actualdp merged886均完整匹配。缺processor没有算作算法通过。

## 证据与复现

远端 `/home/wzh/my_code/netlistGraphBuilder-elk-quality-20261012`：

```text
node tools/research/elk_phase_oracle/probe_merge_boundary.mjs dc_runs/q03_eq1471_attempt01/output/eq012_1471_focused_3_3.json dc_runs/q03_merge_eq1471
node tools/research/elk_phase_oracle/probe_merge_boundary.mjs dc_runs/q03_upstream_dp002_attempt02/mapped_large_dp002.json dc_runs/q03_merge_dp002
node tools/research/elk_phase_oracle/run_alias_key_products.mjs natural dc_runs/q03_alias_key_natural sop015_5426_focused_3_3 eq012_1471_focused_3_3 mapped_large_dp002
node tools/research/elk_phase_oracle/run_alias_key_products.mjs frozen dc_runs/q03_alias_key_frozen sop015_5426_focused_3_3 eq012_1471_focused_3_3 mapped_large_dp002
```

每run有before/after文件集冻结、provider输入digest、完整graph/SVG/指标。独立 `q03_merge_alias_final`504文件前后一致，743/743 unit；runtime仍 `sha256:404874badfee3691412d407fc71ea1d4be297664814b6e6d8fc6f9887041633c`。新增身份、不变性、真实provenance/研究key与merge边界测试3/3。

无新47worker结果、benchmark或UI切换；原46/47与dp02045秒超时保持未通过，性能暂停。

下一入口：已读取GraphInfoHolder，source distributor在graph创建时拥有而非每attempt切换；继续核对ISweepPortDistributor factory与随机源调用。D04不通过未关闭，不能以诊断控制替代正式修复；任何新source策略须提前登记固定对照，不调seed、不按fixture选策略。
