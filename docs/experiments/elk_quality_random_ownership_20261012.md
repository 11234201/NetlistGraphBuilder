# P3 随机源与 distributor ownership 研究

状态：completed（研究试验未准入生产）。不是整体ELK验收完成。

## 源码依据与预登记

完整读取固定ELK GraphInfoHolder、ISweepPortDistributor、LayerSweepCrossingMinimizer及BarycenterHeuristic。
source每graph创建一次distributor，随机boolean选两种模型；LayerSweep保存nextLong派生seed，在随机尝试前reset；方向boolean、首层double、扰动/未知barycenter float。当前候选的拓扑digest LCG和attempt交替模型是既有独立适配，完整digest使displayName进入随机源是已证明D04。

预登记四组：当前；仅source随机源rng；仅graph-owned模型model；两者combined。仅combined为后续候选，单因素仅作归因，禁止根据结果挑另一组部署；不改变显式seed、不选择备用hash、不叠加隐式端口/工作顺序。

研究模块通过own-code dataURL替换，src和UI registry始终未改。source Random按48位递推独立表达；真实JDK17直接执行 `random_vectors.java` 验证signed nextLong、mixed boolean/double/float位序。四组向量完全一致，derived `-4964420948893066024`、model layer_total。

限制：canonical P1没有上游随机tie消费历史；这里只验证显式seed入口下的ownership控制，不声称完整ELK随机轨迹或浮点barycenter完全一致。当前double port-rank/perturbation公式未随此试验调整。

## 产品消融

| 场景 / 指标 | 当前 | rng | model | combined |
| --- | ---: | ---: | ---: | ---: |
| SOP015逻辑线长 | 24936.167 | 18019.167 | 18214.167 | 18214.167 |
| SOP015逻辑交叉 | 6 | 4 | 4 | 4 |
| SOP015物理交叉 | 5 | 4 | 4 | 4 |
| SOP015碎片组 | 0 | 0 | 0 | 0 |
| EQ1471逻辑线长 | 4628808.6 | 4908777.6 | 6736753.6 | 4788478.6 |
| EQ1471逻辑交叉 | 39406 | 36821 | 34491 | 36886 |
| EQ1471物理交叉 | 1797 | 1803 | 2206 | 2007 |
| EQ1471碎片组 | 12 | 14 | 14 | 14 |

三个Focused各研究组hard0；SOP已有列数/线长/交叉门禁通过。EQ同次ELK碎片13，预定combined14>13失败；两个单因素亦14，不存在可挑选的通过组。时钟场景逻辑指标基本不变，combined唯一物理线长340206（当前345316），仍不能抵消EQ失败。

combined已证明P3 rename/permutation完整事件不变，但产品失败，D04仍未修复；不以相位语义更接近source或SOP改善准入。未运行失败候选mapped、17全质量、47worker、benchmark，不虚报通过。

## 约束后处理核查

完整InLayerConstraintProcessor仅处理TOP/BOTTOM节点位置，不是通用树块连续性算法。actualEQ1471和dp002的该processor前后所有层顺序均完全不变（changedLayers=0）。否定“漏执行该processor导致当前反例”的怀疑，不加入无证据的post-sort修补。

## 冻结、复现和决定

远端 `/home/wzh/my_code/netlistGraphBuilder-elk-quality-20261012`：

```text
node tools/research/elk_phase_oracle/run_random_products.mjs combined dc_runs/q03_random_combined
node tools/research/elk_phase_oracle/run_random_products.mjs rng dc_runs/q03_random_rng
node tools/research/elk_phase_oracle/run_random_products.mjs model dc_runs/q03_random_model
```

run各自记录provider输入digest和before/after源码清单；完整graph/SVG/metrics留在该目录。直接JDK向量命令使用已有JDK17绝对路径，不安装依赖。
独立 `q03_random_final`509文件前后一致，745/745 unit；production runtime始终 `sha256:404874badfee3691412d407fc71ea1d4be297664814b6e6d8fc6f9887041633c`，contract1.1.0/package0.2.0。

决定：未准入生产，D01/D04/整体质量未关闭。没有运行中的远端测试；性能暂停、历史46/47与dp020原45秒超时保留。

下一决策：现有已核对的merge、BK、InLayerConstraint边界没有支持新增坐标修补的证据；初始化/随机策略试验不能解决EQ连续性门禁。若研究拓扑分组与连续性软目标，应先明确允许扩展P3策略/目标、更新冻结契约和计划，再设计统一规则、固定候选与消融；不能暗中将其插为按fixture修复。该扩展尚未获得用户明确决定。
