# H08 静态模块提取（2026-10-15）

最新状态：完整静态 H08 入口、共享 workspace 集成单测与浏览器 ES-module smoke 已通过。
最终运行时 `8c24f7d7…` 原47/45s/no-collapse/hard 47/47；完整单元804/804（另加评审导出器测试，
运行时代码哈希不变）。11组新增机制视觉评审等待用户决定，UI registry 和 Windows 发布尚未切换。
本文件早期“corpus12/12”是12条报告：11个可绘制机制图加1条专用探针，不是12张视觉图。

## 范围和停止条件

将已验收研究组合逐步迁为浏览器离线原生 ES modules，不改变质量策略，不启用 UI。
不增加 fixture/实例名特例、不放宽校验、47-case 数量或原 45 秒超时。
原研究快照的通过记录不能替代最终静态 provider、UI 和 Windows 离线包验收。

## 第一批：唯一实现

- `physical_anchor_adjacency.js`：同物理网、节点、侧和精确局部锚点的 scratch adjacency 星形连接；
  不合并 canonical ports，不修改 edges/ports。保持原排序和链接插入顺序。
- `structural_ordering_key.js`：原 D04 摘要定义，排除 displayName，保留完整 inputDigest 的来源身份。
- 两个研究入口 re-export 同一函数；测试以函数身份相等防止定义分叉。
- 非法锚点输入改为 P5 PhaseError，不改变合法输入行为。

远程环境 `/home/wzh/my_code/netlistGraphBuilder-physical-anchor-20261013`：

- `dc_runs/h08_static_helpers_unit_20261015.log`：787/787 单元通过。
- `dc_runs/h08_static_helpers_products_20261015`：三个 Focused 和 sop001/eq006/dp002，
  与原 `h08_products` / `h08_mapped` 的完整 geometry/evidence 与最终 SVG 字节一致。
- `dc_runs/h08_static_helpers_47_20261015`：独立冻结全图 47/47，通过原 45000ms、
  no-collapse、hard 门禁；硬违规 0/0，最大 layout 37666ms、heap 455MiB。
  before/after 一致，runtime `d799cff1b520e47b1d650c35e316367f7771ac35264658afd99a3f82460a78a8`。

## 第二批：共享测量

将 P5 层宽/局部 x 对齐公式提取为 `measureLayerAlignment`，P3 group-band 预测也消费它。
输入必须已完成 port/margin measurement；helper 不读取 y、slot、route 或未来 phase。
仍按有连接的端口数计入方向权重，重复逻辑边不重复增加端口权重；保持原浮点运算顺序。
forecast 仍保留 self-loop 和合并列限制，本轮不扩展支持范围。

第二批远程结果：789/789 单元通过；六个产品的完整几何/相位证据及 SVG 字节保持一致；
合成 corpus 12/12 零硬违规（新增场景视觉仍 pending）。常规 Simple benchmark 的
1024/4096/8192 full-node 均 routed、零违规，layout 中位数 198.7/1546.9/6037ms；
这是默认 provider 的共享路径证据，不是候选 provider 的性能结论。
独立冻结原 47-case 复验完成：47/47、硬违规 0/0、原 45000ms、no-collapse，
最大 layout 37469ms、heap 800MiB。before/after 一致，runtime
`e889fb38e6e0926e9e88bfc010f23fd91cbd1052ed10cbc28c250c8e98eebfd8`，file set
`a654db278e5a38e97f94a11c1ffce442fcdb234c264b29a847c42a18bee5088d`。
结果位于 `dc_runs/h08_shared_alignment_47_20261015`。不以第一批/本批单次耗时或 heap
差异推断性能趋势；保留前轮超时证据，不宣称性能稳定。

后续还需静态 P0/P3 策略、完整入口、
相位/排列/改名测试、全图与 benchmark，再按计划接线 UI、验收离线包。

## 下一静态入口的边界

- core 消费显式规范化的分组提示，不读取 Focused query、DOM 或 Netlist IR 私有字段；
  适配器沿用公共图的拓扑派生分组，保留 Single/Compare 共享边界。
- 完整 canonical inputDigest 继续标识源输入；另记录版本化策略及规范化提示摘要，
  不把 H08 开关或分组来源隐藏在动态编译源码里，也不改变现有 ordering key 定义。
- P3 继续固定原三候选加一个 unit-sweep 候选，原搜索预算、约束及 crossing 上界不变。
- 不支持的 forecast 范围必须显式诊断/定义行为，不能悄悄扩大容差或增加 fallback。
- 先让研究对照与静态入口完整等价，再版本化正式入口；UI registry 最后接入，Simple 默认不变。

## 第三批：P0/P3 机制静态化

新增静态模块 `implicit_endpoints.js`、`order_group_bands.js`、`order_group_score.js`、
`order_group_candidates.js`、`group_sweep.js` 及 P3 内部诊断边界 `order_group_contract.js`。
研究入口只 re-export 相同函数；研究扫描编译器仍用于原有接缝，不冒充完整静态 provider。
保留原 tolerance=2、候选预算、分组键/单例键、degree 权重、评分 tuple、成员与候选顺序，
以及原 phase evidence 字段名；正式版本化入口尚待下一集成步骤，不在本批变更。
非法分组改为 P3 PhaseError，缺失端口改为 adapter PhaseError；合法输入规则不变。

远程 focused 15/15、完整单元 792/792 通过；新增测试验证研究/静态函数身份相同、
所属阶段错误诊断及传递依赖只使用离线相对 `.js` 模块，无 Node/Buffer/动态源码编译。
六个产品完整几何/相位证据及 SVG 与 H08 一致。
corpus 12/12 零硬违规；本批独立冻结原 47-case/45000ms/no-collapse/hard 47/47 通过，
硬违规 0/0，最大 layout 41710ms、heap 444MiB。before/after 一致，runtime
`629344499694846ec937b3114c79ed36eb1068c710972cc792fae67fe0118c45`，file set
`554e381ef280797c69b94da9c9f3e8c67a5c7cb640d52d27b9dd7982dbbbcec7`。
结果在 `dc_runs/h08_static_groups_47_20261015`；本批不沿用第二批结果，不切换 UI/默认 provider。
常规 `npm run benchmark` 本批再次通过：Simple full-node 1024/4096/8192 均 routed、
零违规，layout 中位数 219.8/1761.6/7313ms，日志 `dc_runs/h08_static_groups_benchmark_20261015.log`。
这是默认 provider 证据，不外推为 H08 候选性能或稳定性结论。

## 第四批：完整固定 H08 入口与验收

- package0.3.0/base IR1.1.0/H08 profile1.0.0。`h08.js` 是固定、可 clone 后直接导入的浏览器原生入口；
  不需要研究源码编译器、Node、联网或安装。`index.js` 的 baseline 默认行为继续用于相位对照。
- P0 规范化并冻结公共分组提示，独立记录策略/提示摘要，保留完整来源和结构排序摘要。
  P3 通过显式内部扫描上下文接入固定 unit-sweep，P5 显式启用精确物理锚点连接。
  算法及策略元数据从同一个 `ORDER_GROUP_POLICY` 消费容差和候选上限。
- 研究接缝随显式参数更新，仍作受控对照；静态入口逐相位/全量输出比较通过。
  Single/Compare 的共享 workspace 原先没有把取消信号转发到 provider，本批修正了该边界。
  候选集成测试验证 Single/Compare 同路径、override 不改自动图、SVG 导出、Search-first 零布局、
  异步取消不发布半成品；未把候选提前注册进 UI。

### 首次正式失败与有界诊断

首次静态 runtime `bcbd7b34ef18bf5c952aa4dd081f67f16ae857030802d7f046f122c79d2be7c4`
在 `dc_runs/h08_static_entry_47` 原门禁46/47，唯一 dp020 超时，完成项硬0。不得用此前研究版通过替代。
同环境研究/静态各一次45000ms均超时；按只读CPU/SMT采样选4个较空闲物理核的亲和性对照仍均超时。
两组完整结果保留在 `h08_static_dp020_control_valid` / `h08_static_dp020_affinity_control`，
不由此断言一定是环境或算法。首次 `..._control` 使用错误 dp 路径而非 datapath，两个 ENOENT
明确排除，不计作算法测试。所有计时限制、全图和严格校验保持不变。

既有研究 loader 在原45秒内捕获第一次完整 P3 输入（87MB，仅远端），没有 onPhase/observe 追踪。
实际41079 nodes、93556 ports、46782 edges、70 layers，所有边为 inter_layer。V8单次有界采样
P3约18.1s，Map查找25%、inLayerScore自身5.4%；最终结果摘要为
`e2d3a6de35ff45e3cc298c0bad1d2461da5eaea07a8f790334932f000879f2a1`。

### 只改变表示/恒零分支

- P1 以原 node ordinal 最小堆替代 `ids.find`，sources/sinks、最大出流选择、权重与所有决策不变。
  100组完整旧实现差分含环、平行边、自环、隔离节点、优先级及排列。
- 对完全跨层的固定 incidence，层内交叉项数学恒为0。只对冻结 own-data node/port/edge-kind 建立
  私有 WeakMap 证明；每次核对 scratch maps、数组引用/长度/每个成员及 layer IDs，变更/可变/getter
  走原计算。不省略任何硬路由检查。旧 counter/P3/P1 完整实现保存在 tests/reference。
- 实际完整P3固定一对全字段相同；old12055ms/current9291ms，摘要仍e2d3a6de…。
  此一对仅作诊断，不宣称统计收益或正式全图通过。

### 冻结验收结果

1. `h08_static_zero_47` runtime d8b34b32…：47/47、hard0/0、45000ms/no-collapse，
   maxLayout37600ms、最高heap采样1318MiB；前后文件一致。保留该较高heap记录，不宣称内存稳定。
2. 规范化唯一命名策略后的最终 `h08_profile_final_47`：47/47、hard0/0、45000ms/no-collapse，
   dp020/maxLayout40534ms、最高heap采样543MiB；before/after全部一致。runtime
   `8c24f7d7697e3f01d1b3f151086c95220b4dc35f0208a480a936a43c1da4429a`，file set
   `f2ae9141b873e8fcc1ee554349834cae205a017c5193940b041c77380d0222ac`。
3. 最终相位/集成单元802/802；随后增加纯评审导出器2例后804/804。最终baseline与47快照
   runtimeEqual=true，仅新增导出工具和它的单测两个非运行时路径，差分完整保留。
4. 六产品 nodes/ports/edges/wireRoutes/bounds/validation/排名证据和完成态SVG与原H08完全一致。
   11个可绘制合成图也与首次静态输出的全部几何及SVG相同；专用探针不是视觉图。
5. 本机仅执行必要GUI检查：`tests/e2e/h08_offline_smoke.html` 在原生浏览器直接导入最终静态模块，
   全相位完成、输入不变、结果冻结、取消检查 PASS。未把它当真实产品UI切换或离线ZIP验收。

### 待用户视觉签收的产品准入

已生成共同原点/共同实际bounds的11组对照；去掉的只有SVG渲染器默认最小画布空白，所有几何/标签保留，
两侧不分别Fit。可复现工具 `export_corpus_review.mjs` 附来源runtime/摘要及viewport清单。
仅272KB原SVG和小型摘要回传本地，87MB实际输入、所有全图/CPU日志仍留远端。
用户已收到视觉问题，当前尚未回复；不能擅写通过。已签收的SOP015/5404与EQ1471只在限定范围继承。

UI registry 仍是原实验Native；Simple默认不变，旧实现未删除，未构建/覆盖Windows包。
Windows编译器已只读确认可用，既有v1.0.1产物保留；待视觉准入后才执行UI接线、产品浏览器实测、
新版本离线包及原47原生provider复验。本批未stage、commit或发布。

最终同运行时常规benchmark：Simple full-node1024/4096/8192均routed、hard0，layout中位数
222.8/1605.2/6848.5ms（`h08_acceptance_final_benchmark.log`）；不是候选性能结论。
本地与远端最终599文件清单 runtimeEqual=true/fileSetEqual=true。唯一先发现的差异是远端既有
历史README本地缺失，已原样恢复后完全一致；新H08文档单列，不借文档搬迁改变测试快照。
