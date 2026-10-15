# EQ1471 P3 初始化消融

状态：初始化诊断完成；排序过程归因仍未完成。生产运行时未改。

固定实际 oracle 的 P1 与 P2 ranks、canonical identities、输入 digest 和 policy；仅在 research 工具中组合层初序、端口顺序与几何三类观察输入。八组为预先固定的完整组合，不搜索随机键。

远端目录：`/home/wzh/my_code/netlistGraphBuilder-elk-quality-20261012`。
输入：`dc_runs/q03_eq1471_attempt01/output/eq012_1471_focused_3_3.json`。
命令：`node tools/research/elk_phase_oracle/isolate_p3_initialization.mjs <input> dc_runs/q03_p3_initialization_attempt02`。

| 替换输入 | 初始交叉 | 选中交叉 |
| --- | ---: | ---: |
| 无 | 184391 | 42746 |
| 层顺序 | 100446 | 42524 |
| 端口顺序 | 182281 | 39860 |
| 层与端口顺序 | 98336 | 40215 |

添加几何替换后四组数字均不变。比较原始字段：10 层顺序不同、2060 个节点的端口数组/顺序字段不同；节点几何和端口几何差异均为 0。这里端口差异包含 dummy 的 order 字段，不能将 2060 全解释为有效排名改变。

上游选中交叉数为 39860，但八组最终均有 11 层顺序不同。因此端口组数值相同不代表轨迹、完整结果或产品布局相同。全观察组合恢复已有 40215 结果，355 差距未被“修复”。下一步需拆开实际有效的 normal/dummy 端口变化，并核对 pinned distributor 与 sweep 的决策，不能复制上游数组顺序或挑选种子。

新增六 oracle 边界测试验证完整观察组合 exact nodes/layers、全部组合 identities/edges/随机键不变与 caller 不变性。初次完整单测 738/738 通过，但诊断 runner 在测试期间增强，该次不作为最终冻结证据；另行执行前后 SHA 冻结的完整复测。运行时摘要仍为 `sha256:404874badfee3691412d407fc71ea1d4be297664814b6e6d8fc6f9887041633c`。

独立冻结复测：`dc_runs/q03_p3_initialization_final.{before,after}.json`，495 文件，`fileSetEqual=true`、`runtimeEqual=true`；`dc_runs/q03_p3_initialization_final.unit.log` 为738/738通过。文档收尾在本地追加，不混入远端冻结测试。

此研究没有 P5 产品、17 场景视觉、47 worker 新验收结论。性能继续暂停，历史 dp020 超时保持未通过。

## 普通端口 / dummy 控制

追加四组预定义控制，不改变随机键或层选择：normal-only 的 mask2/3 完全复现 all-ports 的39860/40215；dummy-only 的 mask2/3 完全复现无端口替换的42746/42524。结果在 `dc_runs/q03_p3_initialization_scope/report.json`。因此此样本中有效端口变化来自普通节点；dummy order字段差异没有解释力。

已完整核对 pinned `NodeRelativePortDistributor.java` 与 `LayerTotalPortDistributor.java`：当前只支持WEST/EAST，相关正反排名公式没有发现新缺项。待验证：普通端口的几何同位排序/显式约束是否不同，以及这种合法tie能否解释P3轨迹；尚无新增生产修复准入证据。

## 同位端口源码归因

普通节点仅 `hub:clk:1` 发生变化：140端口，其中139个EAST端口全为零尺寸、同位，另一个WEST端口同位。canonical前序为 `1,10,100,101,...`，观察顺序为 `1,2,3,4,...`（均指dummy-port身份后缀）。完整读取 pinned `PortListSorter.java`：FIXED_POS比较同侧坐标，相同坐标返回0，`Collections.sort`保留创建顺序；当前P0同位时使用canonical-ID tie。因此差异是合法tie适配，不是坐标或分配公式缺项。禁止以数值39860的控制组为由复制创建顺序，禁止按数字后缀特殊处理生成身份。

这解释了端口消融的因果来源，不证明355完整观察输入差距必为某个算法bug，也不关闭D01/D04或产品碎片门禁。后续研究必须转向排序决策和产品质量，而非继续调初始数组或种子。

normal/dummy版本独立冻结复测：`dc_runs/q03_p3_scope_final.{before,after}.json`，495文件完全一致，unit738/738。随后仅增强研究runner的provenance、见证与运行内冻结；需另行复跑该runner。

最终增强runner已在 `dc_runs/q03_p3_initialization_provenance` 复跑，12组结果全部恢复，`runtimeEqual=true,fileSetEqual=true,differences=[]`。原始顺序完整见report，不依赖聊天截断的端口输出。
