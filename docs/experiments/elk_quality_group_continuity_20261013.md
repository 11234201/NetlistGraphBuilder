# P3 连续性研究与三因素对照

日期：2026-10-13。研究策略未进入生产或 UI；性能保持暂停。

## 机制与范围

显式派生输入提供拓扑成员身份，P3 不读 query、IR 或 DOM。原始 rank 连续性不能代理最终画面：P5 的局部 x 对齐会拆分视觉列。仅用测量、端口 incidence 和 margin 预测视觉 band，实际 SOP/EQ 相对 x 误差均为 0。当前研究拒绝 self-loop 和不足以隔开 rank 的间距；生产化前必须共享拥有该公式的测量服务，不能复制私有公式。

前三个固定候选 original/band-first/band-center 只重排成员原槽位。EQ 后两个虽然消除碎片，却增加 P3 交叉，均被拒绝。第四个候选 group-sweep 在完整扫层中按 degree 加权的组 barycenter 排序，保持组内相对次序、非成员槽位、端口和约束；仍使用原尝试日程，并要求交叉不高于原候选。不是后置 packing 或 collapse。

## 全部预登记因素结果

G=分组扫层，K=原 D04 唯一定义结构键，P=原 D01 独立隐式端点。未试备用 seed 或 hash。

| 模式 | EQ 碎片 | EQ 线长 | EQ 逻辑/物理交叉 | dp002 线长 | reset 折点 / 全图最大 |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 12 | 4628808.600 | 39406 / 1797 | 8712479.000 | 50 / 50 |
| G | 0 | 5177808.600 | 35653 / 1600 | 8712479.000 | 50 / 50 |
| K | 15 | 6900480.600 | 35832 / 1721 | 8828177.000 | 54 / 62 |
| P | 15 | 6451442.694 | 31642 / 23211 | 17794442.392 | 4 / 10 |
| K+P | 13 | 6544942.694 | 31274 / 22913 | 15919308.392 | 4 / 12 |
| G+K | 15 | 6900480.600 | 35832 / 1721 | 8828177.000 | 54 / 62 |
| G+P | 0 | 8356853.694 | 31549 / 23988 | 17794442.392 | 4 / 10 |
| G+K+P | 13 | 6544942.694 | 31274 / 22913 | 15919308.392 | 4 / 12 |

所有 24 次产品结果 hard=0，SOP 既有门禁均通过。SOP 无 K 时线长24936.167、交叉6/5；有 K 时13854.167、交叉10/7。ELK EQ 碎片13、线长6194000.043、交叉31878/21187；dp002 线长16320414.325。

G 单独使 EQ 碎片12→0、逻辑交叉下降约9.5%、物理交叉下降约11.0%，线长增加约11.9%，仍短于 ELK。G+P 连续性改善但线长显著退步。K+P 与三项全开的最终指标相同，不能声称 G 帮助组合通过。下一步记录各组合每个候选的交叉预算、合法性和评分，定位未接纳原因；不放宽门禁、不挑策略直接部署。

## 验证与证据

组合拒绝原因已定位：K 下 original P3交叉2243，band-first2407、band-center2457、group-sweep2642；三项全开时 original39662，三个分组候选40037、40038、40190。候选均满足顺序约束、碎片均0，却全数超出原交叉预算，因此选择 original。两组视觉 band 相对x误差仍0。不能通过放宽交叉预算冒充修复；下一项应研究约束拥有层的结构连续性与交叉冲突，而非继续调 seed。

远程目录 `/home/wzh/my_code/netlistGraphBuilder-elk-quality-20261012`。
产物 `dc_runs/c01_factor_<mode>`；工具 `run_cohesion_factor.mjs`、`summarize_cohesion_factor.mjs`。节点边输入 digest 在同场景两 provider 间一致，输入不突变。

冻结单测754/754，522文件 before/after一致；生产 runtime `sha256:404874badfee3691412d407fc71ea1d4be297664814b6e6d8fc6f9887041633c` 未变。新增汇总/诊断工具在该冻结之后，需下一次冻结验证，不能将754报告当其验证。历史47全图仍46/47，dp020原45秒超时；不属于本研究新结果。

诊断工具更新后再次冻结：`c01_admission_final` 523文件前后一致，754/754单测通过，生产runtime仍未变。

本表不构成 ELK 水平声明，也不替代同尺度视觉审查、正式契约及完整回归。

## C01-04：单元与 singleton 共同排序（执行中）

源码事实：固定提交 `28e5173243cab0cf4e2c9816c803bc0d5c47ab24` 的 `ForsterConstraintResolver.java` 中 `handleViolatedConstraint` 将违反 successor 的两组按要求顺序合并，在全层 group 列表按新 barycenter 重新插入；内嵌 `ConstraintGroup` 累加 summedWeight/degree，无 degree 时显式处理未知值。source 的 `IN_LAYER_LAYOUT_UNIT` 用于 north/south port dummy，不等于本项目 fanin 成员；不能说 source 自动支持当前结构分组。

试验推断：C01 锁住非成员槽位是额外策略限制，可能阻止单组重心与相邻 singleton/dummy 的自然排序。预登记一个 `unit-sweep` 替换原第四候选（仍4个），保留原加权规则，只改变所有 unit 的混排范围。每个 visual band/membership 是独立 unit，其他节点是 singleton；不读取名称/坐标，不继承 dummy 身份。原 constraints resolver 仍 authoritative；分组被其拆开时最终评分如实记录。

四个固定研究组合 G、G+K、G+P、all；对照前节对应模式。准入仍 crossings<=原候选，所有产品 hard=0、SOP 门禁、EQ 和逐例线长/物理交叉审查，不调整阈值。未知是否有收益；未选择任何新策略。源码检查最初误将导出目录当 Git 仓库失败，随后在 `/home/wzh/open_source/elk-research-28e5173` 用 `git show` 读取固定提交，无修改第三方源码。

实现与测试：`cohereLayoutUnits` 是纯函数；band/membership JSON tuple 与 singleton tuple 分离，防止身份碰撞。顺序单位无 all-pairs/graph-size retries，只在原扫层排序点使用。新增3单测覆盖加权单位、非成员可移动、成员内部/排列/不变性、band 隔离及完整 proper 顺序。产物 `dc_runs/c01_units_<mode>`；完整单测冻结 `c01_units_final`。

### C01-04 结果：研究假设成立，组合不准入生产

| unit-sweep 模式 | EQ 碎片 | EQ 逻辑线长 | EQ 逻辑/物理交叉 | EQ 唯一物理长度 |
| --- | ---: | ---: | ---: | ---: |
| G | 0 | 4865392.600 | 35153 / 1199 | 821923.800 |
| G+K | 0 | 6580574.600 | 32674 / 1348 | 948346.800 |
| G+P | 0 | 6700569.694 | 31169 / 22673 | 6184632.800 |
| all | 0 | 6487779.694 | 31135 / 22984 | 5983429.800 |

SOP/dp002 各组合指标与前节对应 slot-sweep 模式相同，无硬违规。all 的 P3 unit-sweep 39523<=original39662，被正常接纳；原两个late候选40037/40038仍被拒绝。predicted/final visual碎片0，raw rank碎片5，relative x errors0，再次证明不能用 raw rank 指标冒充视觉分组。

扩展11可绘制合成图、三个Focused、三个mapped分层样本全部hard=0；单独机制probe仍不计视觉通过。最新共享研究编译及rename/节点边排列测试757/757，526文件前后一致。production runtime404874不变。合成图都是显式端口，无fan-in hints，不能拿该结果证明分组策略覆盖self-loop。

重要反例：clk1/1 baseline逻辑线长25409459.000/物理交叉1535/唯一长度345316.000，all为40951682.791/163968/35721294.000；同次ELK37066181.498/131838/33127559.200。逻辑交叉327680→261888、hidden labels1950→1696，却不能抵消长线及物理线退步。all 暂不准入，不按 EQ 单例选策略。需要单独隔离K/P在高扇出场景的首个分歧，不调magic阈值。

本地EQ公共overview6886×33190；四个branch与root600窗口、root2400窗口已检查，完整SVG标签/bridge保留。观察：trial清除了若干无关branch穿插、局部节点仍有长输入线/空白；微缩整体无法批准可读性。`dc_runs/c01_units_visual/` 保存可交互对照和截图；仅代理视觉检查，用户最终意见待取得。

C01 all研究组合原47全图/45s/严格validator结果：39/47通过，完成项零硬违规，8超时（dp020、eq011、eq012、sop004、sop011、sop012、sop014、sop015）；528文件 before/after相同。此结果不能替代生产历史46/47，反而阻止该组合准入。未启动profiling/benchmark或增加超时。失败日志与完整逐例结果在 `dc_runs/c01_review_47/`；H08另用隔离快照，不改写本次失败。
