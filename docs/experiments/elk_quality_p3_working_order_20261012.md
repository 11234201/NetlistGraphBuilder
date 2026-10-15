# P3 attempt 工作顺序对照

状态：诊断与单变量研究试验 completed；未准入生产，整体ELK验收未完成。

## 源码与假设

固定 Eclipse ELK `28e5173243cab0cf4e2c9816c803bc0d5c47ab24`，完整核对 `LayerSweepCrossingMinimizer.java`（740行）与Barycenter调用尾部。
`minimizeCrossingsWithCounter`在非改善sweep后返回旧分数，但工作顺序不恢复。`setCurrentlyBestNodeOrders`与`saveAllNodeOrdersOfChangedGraphs`仅保存SweepCopy，最后transfer恢复最优输出。当前候选在失败sweep和attempt结束时均恢复retained。两者控制流不同；这本身不证明哪种最终图更好。

预登记单变量：仅在own-code dataURL研究模块移除两处恢复，不改变模型、RNG、输入、rank、port tie、迭代预算或validator；生产src从未修改。研究provider/corpus包装器复用既有比较工具，仅替换own P3模块导入，没有UI注册或隐藏fallback。D01/D04失败方案未恢复。

## 相位与直接见证

实际EQ1471 exact pre-P3：40215→39885，上游39860。五个小oracle均0；SOP015 exact pre-P3：5→6。attempt-start只读事件证明baseline下一attempt来自上一次retained，控制组来自终止工作顺序；observer与无observer完整layer/分数相同。研究provider不可变性、排列测试通过。

相位交叉数改善没有被当作产品验收。

## 同次产品对照

| 场景 / 指标 | 当前baseline | 研究trial |
| --- | ---: | ---: |
| EQ1471逻辑交叉 | 39406 | 35852 |
| EQ1471物理交叉 | 1797 | 1889 |
| EQ1471逻辑线长 | 4628808.6 | 4836314.6 |
| EQ1471碎片组 | 12 | 13（同次ELK13） |
| dp002逻辑交叉 | 37572 | 34691 |
| dp002物理交叉 | 4473 | 3636 |
| dp002逻辑线长 | 8712479 | 7950195 |
| dp002最大折点 | 50 | 52 |
| 原定dp002 reset边折点 | 50 | 42（ELK8仍未达到） |

三Focused、三个mapped场景均hard0。SOP015/clk与mapped_small完全不变；mapped_medium交叉相同，线长487632.333→488010.333。11可绘制合成图完整指标均不变且hard0；额外critical split条目仍为机制probe，不伪装成可绘制case。

EQ1471 vendored ELK仍有其自身6项硬违规；不以此放宽候选hard0。两provider输入摘要一致，原始graph/SVG/完整指标留在远端。

## 同尺度视觉检查与决定

computer-use浏览器观察：三列相同画布；整体公共窗口6374×32578，局部以`cell:_1471_`与`cell:_1465_`为canonical锚点、600×600相同尺寸，仅平移。完成态SVG保留labels/bridges/junctions。整体微缩图只作追溯，不是视觉通过证据。

观察到trial中1465与1471相对垂直距离增大；局部仍可追连线，但未证明可读性改善。结合EQ线长/物理交叉/碎片退步和dp002最大折点退步，决定**暂不接纳生产变更**。这不是用户最终视觉批准，不能关闭Q02/Q06。

截图（忽略产物）：[焦点](../../dc_runs/p3_working_visual/focus1471.png)、[上游分支](../../dc_runs/p3_working_visual/branch1465.png)、[公共整体](../../dc_runs/p3_working_visual/overview.png)。本地GUI是平台能力例外；仅三SVG约38.9MB、节点索引及截图留在该scoped忽略目录，未搬回大graph/测试产物。viewer与127.0.0.1:5192服务保留供查看。

## 复现与验证

工作区：`/home/wzh/my_code/netlistGraphBuilder-elk-quality-20261012`。

```text
node tools/research/elk_phase_oracle/probe_p3_working_order.mjs dc_runs/q03_eq1471_attempt01/output/eq012_1471_focused_3_3.json dc_runs/q03_p3_working_attempt01
node tools/research/elk_phase_oracle/compare_complete_layouts.mjs dc_runs/q03_p3_working_products_baseline
node tools/research/elk_phase_oracle/run_p3_working_products.mjs dc_runs/q03_p3_working_products_trial
node tools/research/elk_phase_oracle/run_p3_working_products.mjs dc_runs/q03_p3_working_mapped_trial mapped_small_sop001 mapped_medium_eq006 mapped_large_dp002
node tools/research/elk_phase_oracle/run_p3_working_corpus.mjs dc_runs/q03_p3_working_corpus_trial
```

baseline mapped/corpus使用对应既有compare工具，同参数。独立完整unit740/740，`dc_runs/q03_p3_working_final.{before,after}.json`499文件前后一致。产品/corpus各自运行内冻结通过。
运行时仍`sha256:404874badfee3691412d407fc71ea1d4be297664814b6e6d8fc6f9887041633c`，contract1.1.0/package0.2.0。47worker本轮未重跑；历史46/47、dp020原45秒超时仍未通过，benchmark/性能继续暂停。

下一入口：不能继续靠初始化或seed试探解决EQ碎片。D01隐式端口、D04结构key仍开放，应在保留各自失败证据的前提下研究P3输入语义与P5长链质量的联动；任何多变量试验须预先登记独立对照，不直接混进生产。最终交付还需质量冻结、用户视觉决定与未通过的性能/产品门禁。
