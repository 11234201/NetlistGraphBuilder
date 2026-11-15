# AIG Graphviz 有界布局参数验证

日期：2026-11-15。范围：AIG 的 Graphviz 曲线布局；不涉及 Netlist provider 或冻结的 Simple。

## 观察与验证计划

生产嵌入的 Viz.js 3.31.0 / Graphviz 16.1.0 在 80 级串联重汇聚测试上超过 20 秒。固定输入包含 82 PI、240 AND、1 PO（323 节点）、481 条逻辑边、最大 AND 深度 160。该失败保留为原始无迭代限制配置的证据，不能通过缩减规模或延长超时掩盖。

远端快照与日志：`/home/wzh/my_code/netlistGraphBuilder/aig_integration_20261115/model_tests/benchmark-aig.json`。同轮宽图和高扇出为 242 节点/240 边，布局分别 98.8/97.9 ms；80 级链为 163 节点/161 边，布局 3244.7 ms。测试环境 Node 24.16.0；并发存在独立映射网表回归，因此耗时不作为跨机器承诺。

验证顺序：固定上述输入与 20 秒 Worker 终止上限，只改变 Graphviz 文档化的迭代参数；先测重汇聚，再对候选配置重跑四类图，核对几何完整性、层级方向、节点/边数量、可重复性及成对格式的一致性。参数只在 benchmark 中提供明确枚举；采用生产配置前由主集成任务审核。

## 一手资料

- [nslimit](https://graphviz.org/docs/attrs/nslimit/) 限制计算横向坐标的 network simplex 迭代数；给定值乘节点数，未指定时为 INT_MAX。
- [nslimit1](https://graphviz.org/docs/attrs/nslimit1/) 控制分层的 network simplex 迭代数；未指定时为 INT_MAX。
- [mclimit](https://graphviz.org/docs/attrs/mclimit/) 是 crossing minimization 的 MinQuit / MaxIter 缩放因子，默认 1，对应基准 8 / 24。

以上为 2026-11-15 查阅的 Graphviz 官方文档。迭代参数属于质量/成本偏好，不能替代 Worker 的硬超时与取消，也不能保证任意图都在预算内完成。

## 复现

在远端快照根目录运行：

```sh
AIG_BENCHMARK_CASE=reconvergent AIG_BENCHMARK_POLICY=simplex2 node tools/benchmark-aig.mjs
```

其他候选枚举：`simplex2_mincross025`、`simplex025_mincross025`、`simplex0_mincross025`。默认 `default` 使用当前生产投影；`AIG_BENCHMARK_SIZE` 保留 80，允许显式 20–250。每例始终使用独立 Node Worker，20 秒后终止并返回失败。下面的有效实验已经采用，仅 `simplex2` 做了实跑；未实跑候选不作性能或质量声明。

## 实测结果

保持固定输入、固定 20 秒硬超时，仅加入 `nslimit=2,nslimit1=2`，不改变 `mclimit`、分层分组、样条、节点尺寸或字体。原始结果位于同目录 `benchmark-simplex2-full.json`：

| 图形 | 节点 / 边 | 深度 | 初次布局 ms | 同实例复跑 ms | 检查 |
| --- | --- | --- | --- | --- | --- |
| 宽图 | 242 / 240 | 1 | 98.2 | 61.0 | 通过 |
| 长链 | 163 / 161 | 80 | 276.3 | 226.9 | 通过 |
| 串联重汇聚 | 323 / 481 | 160 | 1987.2 | 1812.0 | 通过 |
| 高扇出 | 242 / 240 | 1 | 93.9 | 61.7 | 通过 |

四例全部检查：每个节点/边 ID 均保留；各 AND 逻辑深度分组中心 Y 一致，PI 同底层、PO 同顶层；每条信号边保持 BT 流向；曲线与箭头完整；两次几何对象严格相等。WASM 冷初始化约 20 ms，Scene 实际惰性 primitive 消费 4–9 ms。RSS 最大约 157 MB。该表是特定环境的实测，不能推导任意拓扑的响应时间保证。

另以既有 ABC 可执行文件从原始 `shared_cone.aig` 重新生成 DOT 与 BLIF，生产导入后模型彼此一致，并与既有真实 fixture 一致。再用原生 Graphviz `dot -Tdot_json` 独立解析新 DOT，与生产 DOT parser 得到相同规范化图。固定小样例在加入迭代限制前后完整几何不变，两种输入格式的新几何也严格相等。证据 `oracle-checks.json`，复现脚本 `aig_oracle_probe.mjs` 均位于上述远端目录。

采用决策：生产 `AIG_GRAPHVIZ_POLICY` 固定两个 network simplex 上限为 2，显示版本推进至 2；缓存键包含完整生成 DOT，因此参数进入缓存身份。仍保留 Worker 的 20 秒硬终止与取消机制。原始无上限配置的超时不会被覆盖成通过记录。

采用后的生产路径原样复跑（不设置实验环境变量）见 `benchmark-production.json`：四例初次布局为 97.0 / 283.2 / 2160.5 / 95.2 ms，最大 RSS 161.2 MB；全部几何完整性、层级、方向及重复性检查继续通过。原生解析器校验使用系统 Graphviz 2.43.0。
