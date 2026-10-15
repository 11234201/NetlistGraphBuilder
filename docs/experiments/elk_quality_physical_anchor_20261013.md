# H07/H08：独立逻辑端点与共享物理锚点

日期：2026-10-13。状态：假设登记，未进入生产。

H07 固定 clk1/1 对照：baseline/K/P/K+P 逻辑线长25409459/25409459/40936322.791/40951682.791；物理交叉1535/1535/163968/163968。K仅改变少量唯一物理长度，P主导退步。净表/派生输入digest均641506；未改变测量或选择seed。G在net-root视图没有hint，不是原因。

已观察实现：P0隐式端点逐逻辑边独立标识符合固定ELK importer；P5 `createRoutingBoundaries` 的组件由port-id邻接BFS生成，不把同点port连通。独立identity不自动表示独立物理锚点。当前ELK来源本身也按端口连接定义hyperedge，故下面是明确的项目物理net共享策略，不是逐源码复制或修复ELK缺陷。

H08唯一候选：在每个boundary中，同nodeId、同side、完全相同local(x+anchor.x,y+anchor.y)、同physicalNetId的端点可以额外连通，用canonical代表作星状邻接。保留全部port identities/edge lineage/measured geometry/P0-P4；只影响P5segment/dependencies/slots。约束由原严格validator决定，不能以同net豁免节点避障或端口接入。

预期：减少同一物理锚点的重复平行干线和通道宽度，保持D01独立长边链的折点收益。未知：合并segment可能增加dependency-cycle分裂或触发障碍，必须实际同P4/全P5验证，不能根据CLK单例宣称成功。

准入：最小不同net/不同点/不同side/不同node反例、原输入不变和排列稳定；旧source精确模式不改；固定六产品、11合成、47严格回归（原45s，超时失败）。benchmark仍暂停，所以复杂度相关生产准入未闭合。禁止按fixture/fanout阈值选择旧/新模型或调整容差。

执行位置修订：不编辑正在执行47回归的旧目录，单独检查并创建 `/home/wzh/my_code/netlistGraphBuilder-physical-anchor-20261013`，复制源和fixtures，不复制dc_runs。C01随后完成39/47，8超时，零完成项硬违规；H08不覆盖该失败。

实现 `physical_anchor_routing.mjs`：仅scratch adjacency加canonical代表星状链接；固定P5 import boundary注入，不改生产文件。两个边界测试通过：错net/node/side/point不连接、完全相同P4中2segment→1，完整logical identity保留，严格路由合法，输入不变；节点/边排列后的完整P5几何及事件一致。scratch边查找数组仍保留输入顺序，测试只对该annotation规范排序，未放宽几何比较。固定ELK来源 `p5edges/orthogonal/HyperEdgeSegment.java:118–138` 确认按connectedPorts递归，与新策略分开说明。

530文件快照下完整unit与11合成/六产品正在运行；生产runtime404874仍不变。计划 `ELK-H08-ANCHOR`，性能暂停/最终视觉/发布门禁仍开放。

## H08 已完成的质量与因果结果

759/759 unit、530文件before/after相同；后续扩展H08改名/排列及真实phase取证后新冻结另记。11可绘制合成、六产品均hard=0，SOP既有数值门禁全部通过；源机制probe不计视觉。

| 场景 | H08 逻辑线长 | 逻辑/物理交叉 | 唯一物理长度 | 碎片 / 最大折点 |
| --- | ---: | ---: | ---: | ---: |
| SOP5426 | 13854.167 | 10 / 7 | 13455.667 | 0 / 4 |
| EQ1471 | 4864879.694 | 37985 / 1984 | 927642.800 | 0 / 4 |
| EQ clk | 25330562.791 | 327680 / 1535 | 345316.000 | 0 / 2 |
| sop001全图 | 3042.333 | 3 / 3 | 3002.333 | 0 / 4 |
| eq006全图 | 929716.606 | 6617 / 980 | 436576.333 | 0 / 4 |
| dp002全图 | 13878108.392 | 53673 / 13135 | 6676644.333 | 0 / 12 |

dp002 tracked reset仍4折，非maximum12。相对C01 all无alias，线长/物理线改善，但EQ逻辑交叉31135→37985，dp00244443→53673、eq0064967→6617；hidden labels分别918/897/164，也有代价。不能用共享线降低来隐藏逻辑交叉增加。相对同次ELK EQ线长6194000.043/交叉31878/21187，dp00216320414.325/43025/17679；不存在所有指标支配ELK的结论。

真实四场景同前置验证：SOP/EQ/clk/dp002各9个P0～P4 checkpoint完整序列/digest相同，输入不变，结果hard=0。P5 segment数EQ3097→2694（3组/403别名链接），clk2050→1028（2组/1022链接），dp00211854→11470（2组/384链接）；SOP无共享变化。宽度EQ6886→2916、clk11067→897、dp00219643→15443；高度完全相同。这证明变化只在P5，不是挪树、缩放或更改seed。`probe_physical_anchor_causality.mjs` / `dc_runs/h08_causality` 保留所有phase hashes。

最终47全图原45s严格worker：43/47，完成项零硬违规，dp020、eq011、sop014、sop015超时。531文件before/after相同；`dc_runs/h08_47/results.json`保留全部逐例数据。43/47不能替换生产历史46/47，也不能用C01无alias39/47的改善冒充准入成功。benchmark继续暂停；静态候选尚未生产化或切UI。

最终完整unit759/759，531文件冻结相同、runtime404874仍未变；扩展改名/排列覆盖H08开关所有组合。`dc_runs/h08_final_unit.*`与`h08_causality`属于最新工具快照，之前530文件的run单独保留。

## 视觉与收尾决定

EQ同尺度公共overview6374×33190、根及四分支600窗口已保存，SOP公共overview1483×3109、5426根600、5404树600/1200窗口已保存。所有完成态SVG保留标签、bridge和背景分支；不分别Fit、不改变布局。SOP新root位于全图更低区域，5404输入支路更紧凑；EQ仍有长线/空白和标签隐藏代价。观察可支持进一步评审，不能代替用户批准。

本地浏览器产物：`dc_runs/h08_anchor_visual/`、`dc_runs/h08_sop_visual/`，loopback5193。ELK参考复用前已校验完整SVGhashc5d9...；旧C01和旧working-order视觉产物均未覆盖。

研究结论：保留H08原型与全部失败证据；不正式准入、不切UI、不改package/contract、不删除旧代码、不发布。继续性能暂停意味着不能修复当前4超时、完成benchmark或关闭最终交付门禁；用户视觉决定也仍待取得。进入正式共享测量/P0-P3-P5版本化契约和静态实现之前，必须明确这些准入缺项如何处理，不能把Node研究编译器当成浏览器静态包交付。
