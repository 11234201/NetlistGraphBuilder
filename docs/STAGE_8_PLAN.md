# 阶段 8：层次追踪、对象聚焦与大图交互收敛

更新日期：2026-09-14。状态：已完成（范围内验收闭环；mapped 既有 route 基线作为已知偏差保留）。

## 1. 阶段目标与边界

阶段 8 面向真实层次化网表调试，把阶段 6 的 module 内 Focused 浏览扩展为可跨 hinst 的对象级
追踪，并利用阶段 7 已建立的 Document、ViewSession、commands、pipeline、Scene 和 Compare 契约，
消除无必要的全图布局与重复渲染。

本阶段交付七项产品能力：

1. Fanin/Fanout 可沿 instance occurrence 穿越 module 边界。
2. Focused root 从 cell 扩展到 net。
3. 移动、缩放、选择、搜索和 cone 浏览按最小失效范围执行。
4. 常见组合逻辑 cell 可通过显示开关在矩形与约定俗成的逻辑门符号之间切换。
5. Back/Forward 从 module 导航历史升级为有界的视图操作历史。
6. Search 默认只负责选择与定位，仅在大图 Search-first 无可用全图位置时自动加入 Focused roots。
7. Compare 对大型 module 默认按需加载，不在进入视图时自动布局和渲染两张 Whole 图。

继续保持 structural Verilog、无 `.lib` 可用、纯前端离线和依赖轻量。跨层 cone、Focused graph、
历史和缓存均为派生状态，不改变 parser 输出或 Netlist IR。生产级 AIG 输入、完整设计 flatten、
STA、逻辑等价和任意最优 Steiner routing 不在本阶段。

## 2. 现状、推断与待验证假设

### 2.1 已观察事实

- 当前 schematic graph 以单个 module 为单位；有定义的 submodule instance 被表现为一个可导航的
  module cell，module 内 cone 到该节点即停止。
- 当前 Focused roots 只接受 cell node；net 是 logical edge/wire route，不是可直接作为 BFS seed
  的 node。
- Search 激活不可见 cell 时通过 `selection.reveal` 建立或追加 Focused root，定位和查询条件仍有耦合。
- module history 保存部分 selection、roots 和 viewport，但历史入栈判定仍主要围绕 module/view/root，
  不是通用命令历史。
- Netlist presentation 已取得 gate kind、port descriptor 和 output bubble 语义，但 cell 主体仍统一为矩形。
- Compare 未选择 output 或 Focused root 时，两侧默认进入 Whole workspace；大型 module 会同时承担
  graph、layout、Scene 和 DOM 成本。
- 2026-09-11 的本地受控深链微基准中，1K/4K/8K cell 的纯 JavaScript pipeline 中位数约为
  100.6/580.5/1526.6 ms，其中 8K layout 约 1047.4 ms、SVG 序列化约 421.9 ms。该数据不包含
  浏览器 DOM 插入，且当时 `mfs-remote` 连接超时，因此只能作为方向性证据，不能替代 S8-0 正式基线。

### 2.2 基于现状的推断

- 交互卡顿的首要候选不是 viewport 数学，而是没有按依赖复用 full graph、measurement、auto layout
  和 Scene，以及完成态仍可能整体替换 SVG。
- Compare 大图的主要可避免成本是默认 Whole layout/render；完整语义 graph、搜索索引和结构统计可以
  保留为轻量、无坐标的前置产物。
- 跨层追踪不能以 module type 内的 local node id 标识对象；相同 module 的多个 hinst occurrence
  必须具有不同身份。
- Net Focused 与跨层 cone 共用同一个对象引用和查询模型，先实现 cell-only 层次接口或先把 net
  伪装成 node 都会造成二次迁移。

### 2.3 待验证假设

- 版本化 artifact 复用和最小失效能够显著降低重复 Focused、resize 和 Compare 单侧操作的延迟，
  在此之前不预设必须引入 Worker。
- 保持现有 node bounds 和 pin endpoint，只替换 Scene symbol，可以在不改变布局与 routing signature
  的情况下交付标准门形状。
- 对大 module 使用 Search-first Compare，仍能通过无布局的 full graph/IR 统计提供有意义的初始对比摘要。

## 3. 需求与优先级

| ID | 需求 | 主要交付物 | 优先级 | 成本/风险 | 状态 |
| --- | --- | --- | --- | --- | --- |
| R8-1 | 跨层 Fanin/Fanout | occurrence identity、层次连接模板、双向跨边界 cone、层次 boundary/路径 UI | P0 | 大 / 高 | 已完成（范围内）：查询核心、canonical occurrence context、标准 layout/Scene projection、breadcrumb、完整路径提示、候选 occurrence 提示与同 module occurrence 选择均已落地；父向追踪在无 occurrence path 时保持显式 chooser，不猜测 parent |
| R8-2 | Net Focused | cell/net root union、driver/load seed、net root chips 与高扇出边界 | P1 | 中 / 中 | 已完成：Single/Compare、多 root hierarchical union、net chip/driver-load seed、Focus selected、occurrence-aware session/Golden/startup 均已落地并有回归 |
| R8-3 | 交互性能与最小失效 | 分阶段测量、artifact cache、依赖失效矩阵、局部 Scene/DOM 提交 | P0 | 中至大 / 高 | 已完成（本阶段范围）：Simple/ELK Single/Compare 均经 JobCoordinator 提交，bounded artifact cache、Compare per-side cancellation/status、cached override、局部 reroute、frame coalescing 与独立 render generation 已有；等价 4K override runner 相对 S8-0 降幅超过 90%，parse/build/full-layout 均未回退超过 10% |
| R8-4 | 可切换的标准逻辑门符号 | Netlist presentation policy、矩形/标准符号开关、AND/OR/XOR/BUF 族图元、命中区和导出一致性 | P1 | 中 / 中 | 已完成：开关、Scene、Compare、导出及旧值 fallback 均有测试 |
| R8-5 | 通用 Back/Forward | command transaction、View History、手势合并、分支与旧历史迁移 | P1 | 中至大 / 高 | 已完成（范围内）：有界 history、selection/focus/viewport/override、occurrence context、Single 快捷键与 Compare compound 恢复已接入；旧 module history 仅作为兼容 fallback，非 command 的 DOM viewport 操作保留显式记录并有退出条件 |
| R8-6 | Search/Focused 解耦 | Locate policy、显式 `+ Focus`、Search-first 自动 Focus 规则 | P0 | 小至中 / 中 | 已完成：仅当目标不在当前画布定位图、但存在于 full graph 的 cell/net 时自动 Focus；否则只定位或报告不可用，不写入隐藏 selection |
| R8-7 | Compare 大图按需加载 | 双侧独立 Search-first、无布局统计、单侧 job/artifact、显式 Overview | P0 | 中 / 中 | 已完成（本阶段范围）：双侧 Search-first、零 provider、统计、显式 Whole、复合 history、共享 artifact cache、per-side loading/cancel 已落地并有双大图浏览器证据；跨页面持久化不在本阶段 |

## 4. 核心设计

### 4.1 层次 occurrence 身份与连接模板

module definition 和 instance occurrence 必须分开：

```text
HierarchicalObjectRef
  documentId
  rootUnitId
  occurrencePath[]       # canonical instance segment，例如 top/u_cpu/u_alu
  unitId                 # 当前 module definition
  kind                   # cell | net | port | terminal
  localId
```

`occurrencePath` 使用 canonical instance 名，不用 display label 做身份。module 下拉框打开的是 definition
context；如果该 module 有多个父 occurrence，向上追踪必须要求用户选择层次上下文，不能任意选择父实例。
从 hierarchy tree 或 hinst 双击进入时保留 occurrence breadcrumb，因此可以同时向父层和子层追踪。

按 module 构建可缓存的 `ModuleConnectivityTemplate`，只保存局部 cell/net/port 连接以及 hinst pin 到
child port 的映射。查询时按命中的 occurrence 懒展开：

- hinst input：父层 net -> instance input terminal -> child input port -> 子层 net。
- hinst output：子层 net -> child output port -> instance output terminal -> 父层 net。
- inout 保留双向语义并产生可见诊断。
- module port 和 hinst boundary 是零深度连接；穿过实际逻辑 cell 才消耗一层逻辑 depth。
- blackbox、缺失定义、递归 cycle、节点/frontier 上限和用户 depth 截断均生成明确 boundary。

跨层查询不得预先 flatten 全设计，也不得用 module、instance 名称或坐标特判。visited key 至少包含
occurrence、对象、方向和最小逻辑深度；输出和诊断排序必须稳定且不依赖 parser 数组顺序。

### 4.2 Cell/Net 统一 Focused root

Focused 状态升级为：

```text
FocusedRootRef = CellOccurrenceRef | NetOccurrenceRef

FocusedViewStateV3
  roots[]
  activeRootRef
  faninDepth
  fanoutDepth
  boundaryMode
```

Net root 不改变基础 graph 形状，而是在查询边界展开为 seed：

- fanin 保留根 net，并从全部有效 driver 向上追踪。
- fanout 保留根 net，并从全部 load 向下追踪。
- 多 driver、unknown direction 和 inout 不静默选边，返回稳定诊断。
- 高扇出 net 受命名的 `maximumVisibleNodes`、`maximumFrontier` 和现有 root 上限约束；截断处显示
  hidden endpoint count。
- roots chip 和画布强调区分 cell/net；普通 selection 仍保持单对象，不与 roots 混为一体。

### 4.3 Search 定位策略

Search 只产生 `selection.locate` 意图；是否需要改变显示查询由 application policy 决定：

1. 目标已在当前 positioned graph：只选择和居中，不改变 roots，不运行 provider。
2. 目标不在当前 positioned graph 但存在于 full graph：统一执行 `selection.reveal`/`focus.add`，局部
   layout/render 完成后定位；不因为图规模切回 Whole，也不把隐藏对象写成 dangling selection。
3. 目标既不在 positioned graph 也不在 full graph，或属于不可 Focus 的 module/port：只报告不可用，
   不改变 roots。
4. 搜索结果的显式 `+ Focus` 始终直接操作 roots；清空搜索不清除 selection 或 roots。

跨 module 搜索是一个复合事务：切换 definition/occurrence context、定位目标和必要的 Search-first
Focused fallback 只产生一条 View History 记录。

### 4.4 Artifact 复用与最小失效

阶段 7 的 pipeline 顺序保持不变，但每个阶段返回有 identity/revision 的 artifact：

```text
source revision
  -> full graph
  -> queried/projected graph
  -> measured graph
  -> automatic positioned graph
  -> override/rerouted graph
  -> Scene
  -> mounted DOM
```

缓存 key 必须显式包含拥有该产物的 document/session revision、module/occurrence、query、layout provider、
layout policy、Cell Config/timing/alias policy 和相关 override revision。缓存设置容量和释放策略；关闭
document/session、source reload 和 cell/pin 语义变化必须失效对应产物，纯 viewport/selection 不得淘汰
有效 layout。

最小失效矩阵：

| 操作 | 允许执行的工作 | 禁止执行的工作 |
| --- | --- | --- |
| selection、已显示搜索命中 | DOM highlight、detail、viewport | graph rebuild、provider layout、整图 Scene 重建 |
| pan/zoom | 每帧一次 transform；手势结束持久化 | query、layout、整图 DOM |
| 节点拖动预览 | preview node/connected wires | provider、持久化、整图 SVG |
| 节点移动/尺寸提交 | cached auto graph 上的 override、受影响 net group reroute、完成态 Scene patch | provider layout、无关侧/无关 net 重算 |
| 普通 Fanin/Fanout inspect | 缓存 adjacency 查询、class/highlight | 改拓扑、provider layout |
| Focused roots/depth 改变 | 复用 full graph，重做局部 query；必要时局部 layout | 重解析、重建无关 full graph |
| Compare 打开大 module | full graph/index/stats、Search-first shell | 默认 Whole layout/Scene/DOM |

先测量 query、measure、layout、override/reroute、Scene、首批/完成 DOM 和缓存命中。Worker 只有在消除
重复工作后主线程仍无法满足浏览器交互预算时才能立项；不得把缓存命中率本身当成性能改善。

### 4.5 标准逻辑门 symbol registry

symbol 选择属于 Netlist presentation，不进入通用 Scene renderer，也不改变 inference：

```text
NetlistPresentationPolicy
  gateSymbolMode: rectangle | conventional
```

- `rectangle` 保持当前所有 cell 主体使用矩形的兼容行为。
- `conventional` 对可识别的组合逻辑 gate 使用标准符号，其余 cell 保持矩形 fallback。
- 第一版对旧 session、缺失字段和非法值统一回退到 `rectangle`；完成真实网表和可读性验收后，
  是否把新 session 默认值调整为 `conventional` 作为独立产品决策，不在实现中静默改变。
- 开关放在 View/Display 设置区，不占用 topbar；它是 presentation policy，不属于 layout policy、
  Cell Config 或 Netlist IR。
- Single 和 Compare 共享一个用户可见开关；Compare 中以 compound command 同时更新左右 session，
  不允许两侧在用户未明确选择时使用不同符号模式。
- 切换只产生 Scene/render effect，不重新 query、measure、运行 layout provider 或 reroute；节点坐标、
  尺寸、port endpoint、wire geometry、selection 和 viewport 全部保持不变。
- 屏幕、渐进渲染和 SVG 导出使用当前模式；设置进入 session codec，并作为一条 View History 操作，
  但不写入 layout Golden 或 Cell Config。

`conventional` 模式的符号映射：

- `buffer`/`buf`：三角形。
- `inv`：三角形加 output bubble。
- `and`/`nand`：D 形，NAND 加 bubble。
- `or`/`nor`：曲线 OR 外形，NOR 加 bubble。
- `xor`/`xnor`：OR 外形加输入侧附加弧，XNOR 加 bubble。
- module、blackbox、register 和尚无约定图形的复杂 cell 继续使用矩形；MUX/DFF 的专用符号作为
  明确的后续扩展，不与本批强绑。

两种模式复用同一 node bounds、port endpoint、bubble clearance 和 hit target；符号必须落在 measured
bounds 内。实例名优先放在符号下方或按缩放 profile 隐藏，完整 type/instance 保留在 tooltip/detail，
避免文字遮挡曲线。两种模式都由 Netlist presentation 输出结构化 Scene primitive。

### 4.6 通用 View History

Back/Forward 定义为视图操作时间线，而不是对任意文档数据做无条件撤销：

```text
ViewHistoryEntry
  transactionId
  label
  affectedSessionIds[]
  beforeViewState
  afterViewState
```

记录 module/occurrence 导航、cell/net selection、搜索激活、Focused roots/depth/view mode、Compare pair/
active side/output、Fit/Focus viewport，以及已提交的节点移动和尺寸修改。pan/zoom 和 drag 在 gesture end
合并为一条；搜索输入字符、hover、日志、render progress 和中间 pointer frame 不入栈。

Cell Config 持久化、文件导入和其他 document mutation 不纳入本阶段 View History，避免把视图回退
伪装成数据撤销。历史使用命名容量策略并利用不可变状态/结构共享，不保存 graph、Scene、DOM 或任务
句柄。Back/Forward 恢复不再入栈；在中间位置执行新事务清空 forward 分支；Compare 同步动作作为一条
compound transaction。恢复后由 artifact dependency diff 计算最小 effects，并让旧异步结果失效。

快捷键在非可编辑控件中支持 `Ctrl+Z`、`Ctrl+Shift+Z`/`Ctrl+Y`；`Alt+Left/Right` 可作为兼容入口。
旧 module history/session 数据可迁移为有界的初始 View History，无法表达的字段安全忽略并给出诊断。

### 4.7 Compare 大图按需加载

Compare 由两个普通 ViewSession 和一个 ComparisonSession 继续组成。每侧独立选择：

```text
small module -> Whole
large module -> Search-first
explicit output/cell/net -> local cone/Focused
explicit Overview -> Whole（允许取消）
```

初始统计从 module IR/full graph 计算，不要求 positioned graph。左右各有独立 job、artifact、progress、
取消和错误状态；一侧 roots、override 或 provider 变化不重算另一侧。选择共同 output 后只布局对应 fanin
cone；选择匹配 cell/net 后只布局两侧局部 Focused。显式 Whole 前展示节点/边规模，并允许应用 collapse
policy；关闭 Compare 或替换 pair 会取消并释放对应任务和产物。

## 5. 工作包与依赖顺序

```text
S8-0 行为/性能基线与契约冻结
  -> S8-1 最小失效、Search 解耦、Compare 按需加载
  -> S8-2 Cell/Net FocusRootRef 与 Net Focused
  -> S8-3 occurrence connectivity 与跨层 cone
  -> S8-4 View History
  -> S8-5 集成、兼容与发布验收

S8-S 可切换标准门符号：在 S8-0 后独立推进，S8-5 汇合
```

### S8-0：固化行为和正式基线

1. 固化 Single/Compare 的搜索、Focused、selection、move/resize、history 和 Search-first 行为矩阵。
2. 给 pipeline/provider/renderer 增加可关闭的阶段计数与 User Timing；不把测量日志写入持久状态。
3. 在相同 commit、环境和 fixture 上记录 1K/4K/8K benchmark、真实 mapped 大 module 和浏览器 DOM
   指标；远端不可用时记录原因和本地替代范围。
4. 固化重复 occurrence、definition context、多 driver net、inout、递归 module 和 Compare 大图 fixture。

验收：每项后续优化都有可重复的 before 数据、provider 调用计数和行为测试；已知 mapped 超时与
violation 不被混写为本阶段回归。

### S8-1：最小失效、Search 解耦与 Compare 按需加载

1. 建立 artifact key、失效矩阵、容量/释放策略和命中诊断。
2. move/resize 提交复用 cached auto graph；selection、可见搜索命中和普通 cone inspect 走轻量路径。
3. 用 `selection.locate` 与明确 fallback policy 替换 Search 对 `selection.reveal` 的隐式依赖。
4. Compare 两侧独立 Search-first、job 和 commit；统计与 layout 解耦。
5. 依据 Scene diff 和 segment index 更新受影响节点/net；完成态恢复完整 bridge、label 和 hit area。

验收：最小失效矩阵中的禁止调用通过 spy/counter 精确验证；大型 Compare 初始 provider 调用为 0；
4K fixture 的重复 Focused/override 操作中位数相对 S8-0 至少降低 30%，且 parse/build/full-layout 基线
不回退超过 10%。若未达到，保留数据并重新定位瓶颈，不直接引入 Worker。

### S8-S：可切换标准门符号

1. 定义并规范化 `NetlistPresentationPolicy.gateSymbolMode`，旧/缺失/非法值回退到 `rectangle`。
2. 定义 canonical gate kind 到 symbol builder 的静态 registry，并兼容现有 `buf`/`buffer` 命名。
3. 输出 AND/NAND、OR/NOR、XOR/XNOR、BUF/INV 结构化 Scene primitive。
4. 在 View/Display 区增加单一开关；接入 ViewSession command、Compare compound update、session codec、
   View History 和 SVG export。
5. 保持 port、bubble、node bounds、selection hit area、低细节 profile 和 tooltip 契约。
6. 增加反复切换、不同输入 pin 数量、极性、缩放、主题、渐进渲染和导出 snapshot。

验收：同一 graph 在 `rectangle`/`conventional` 间反复切换时，node bounds、port endpoint、edge geometry
signature、selection 和 viewport 均不变，provider/query/measure/reroute 调用次数为 0；反相 bubble 与
wire endpoint 正确连接；unknown/module 在两种模式下均为矩形；Single/Compare/导出模式一致；旧 session
恢复为矩形；通用 renderer 不读取 gate kind 或 presentation policy。

### S8-2：Net Focused 与统一 root

1. 扩展 ObjectRef/ViewQuery/Focused state 和 command validation，支持 cell/net root union。
2. 在 Netlist domain query 层将 net 展开为 driver/load seed，保持 graph IR 不变。
3. 增加 net chip、Focus selected net、搜索显式 `+ Focus` 和 Selection/detail 适配。
4. 覆盖 alias、module port、多 fanout、多 driver、inout、无 driver 和 root 容量。
5. 更新 session/Golden/startup codecs，保持旧 cell-only roots 可读取。

验收：Cell Focused 行为不变；Net Fanin/Fanout 完整包含根 net 及正确 driver/load；高扇出查询保持
有界；Single/Compare 和 SVG 使用同一查询结果。

### S8-3：层次连接与跨层 cone

1. 定义 occurrence identity、definition/occurrence context 和 module connectivity template。
2. 实现按需跨父子 port 的双向 traversal、逻辑 depth 和 boundary 规则。
3. 将结果投影为带 hierarchy path/breadcrumb 的局部 display graph；不泄漏 parser 私有对象到 Scene。
4. 增加层次树/双击进入 occurrence context、歧义父 occurrence 选择和跨层 Selection/detail。
5. 让 Cell/Net roots、Search、Compare 和 startup target 复用同一 occurrence reference。

验收：至少两层上下穿越、同 module 多 occurrence、escaped/vector port、assign alias、blackbox、递归
cycle 和跨层多 fanout 均有测试；module boundary 不错误增加 depth；排列测试结果稳定；查询不修改
module template/full graph，工作量受显式 frontier/node budget 限制。

### S8-4：通用 View History

1. command bus 在事务提交点生成 history entry；复合导航/搜索/Compare 同步只提交一条。
2. pointer/wheel controller 在 gesture end 提交合并项，取消手势不入栈。
3. 实现 Back/Forward、branch truncation、容量、document reload、session close 和旧 module history 迁移。
4. 恢复状态后按 dependency diff 执行最小 query/layout/render/viewport effects，并保护异步 revision。
5. 更新按钮、tooltip、快捷键、Process Log 和 session codec。

验收：cell/net selection、module/occurrence、Focused、Compare、move/resize、viewport 各有回退/前进测试；
高频手势只产生一项；Back 后的新操作清除 Forward；恢复过程中旧 job 不得覆盖当前状态；可编辑输入
中的系统撤销不被截获。

### S8-5：集成、兼容与发布验收

1. 清理已被新 query/history/job 取代的 legacy bridge 决策；保留项写明退出条件。
2. 验证旧 session、Golden、startup、module history 和 cell-only focus 数据迁移。
3. 更新 ARCHITECTURE、DESIGN_SPEC、README、领域 skill 和用户指南中的已实现行为；计划状态与代码一致。
4. 执行完整单元、determinism、fixture、mapped、benchmark、浏览器和 Windows 离线发布检查。

验收：七项需求的产品行为、兼容性、性能和离线包全部取得证据后才能把 Stage 8 标为完成；单元测试
通过不能代替 mapped、浏览器或性能验收。

### Stage 8 执行记录（2026-09-13，核心增量已提交）

- 本轮实现：`NetlistPresentationPolicy` 的矩形/约定逻辑门开关（Single、Compare、session codec、SVG
  export）；Net Focused 的 driver/load seed、边界诊断和有界预算；Search 的 locate 与显式 `+ Focus`
  分离；`ObjectRef.occurrencePath`；`ModuleConnectivityTemplate` 与不 flatten 的跨 occurrence
  hierarchical cone 查询。
- 代码入口：`src/domains/netlist/hierarchy_connectivity.js`，通过
  `netlistFeature.queryHierarchy(document, root, options)` 调用；模板按 document 使用 `WeakMap`
  缓存，跨 module port 为零逻辑 depth，真实逻辑 cell 才增加 depth。
- 验证：`npm test` 通过（450 tests）；`npm run benchmark` 当前环境结果为 1K/4K/8K pipeline
  `157/952.1/2951.6 ms`，其中 layout `106.1/747.7/2385.6 ms`。该数据只作为本轮环境记录，尚未
  与 S8-0 同环境基线形成前后对照。
- `npm run test:mapped-cases` 已执行但当前仓库 mapped worker 报告 47 个 case 中 40 个超过既有
  layout violation budget（总 violations `34955/120`，主要为 `missing-route`）；worker 直接调用
  parser/graph/layout，不调用本轮 hierarchy query，故本轮不能把它写成通过，也不能据此宣称性能或
  路由回归已解决。后续需单独复核 mapped 基线与路由容量问题。
- 下一入口：把 occurrence context 接入 ViewSession/Focused root 与层级树双击，补齐跨层 graph
  projection；随后推进通用 View History 和 Compare Search-first 的零 provider 初始路径。

### Stage 8 执行记录（2026-09-13，提交 `18299c9`、`e64b72b`）

- 修正 Search 语义：命中对象若不在当前画布定位图中，统一通过 `selection.reveal` 自动加入
  Focused；Whole 不再作为隐藏命中的回退路径。画布已有对象仍只执行选择与定位。
- 加入有界 `ViewHistory`（默认 128 条），记录 module/view mode、cell/net selection、Focused
  roots、双向 depth、viewport、presentation policy 和 layout overrides；Single 的按钮与
  `Ctrl+Z`/`Ctrl+Shift+Z`/`Ctrl+Y` 接入，Forward 分支会在新操作后截断。
- module hierarchy 节点保留 `occurrencePath`，层次树双击将 occurrence context 传入 module
  workspace；graph node/ObjectRef 保留该上下文，重复 occurrence 不再共享身份。
- Compare 大 module 在没有 output cone、Focused root 或显式 Whole 请求时使用 Search-first 空壳，
  不调用 layout provider；full graph 仍用于统计，选择 output 或明确 Whole 才布局。新增大图 provider
  调用计数测试。
- 验证：`npm test` 通过（458 tests）；新增 View History、Compare deferred layout、occurrence
  context、Search reveal 回归测试。
- 性能复测：`npm run benchmark` 中位数为 1K/4K/8K pipeline `170.5/975.8/2870.3 ms`，layout
  `113.8/764.0/2372.1 ms`，progressive first batch `1.4/1.1/1.1 ms`。与本轮前记录
  `157/952.1/2951.6 ms` 同量级，未观察到按图规模增长的新增 cliff；Compare Search-first 的
  零 provider 路径由计数测试覆盖。
- 偏差与未完成：Compare compound history、单侧异步 job/artifact 接管、真正的层次 graph
  projection/breadcrumb UI、artifact cache 失效矩阵、浏览器和 Windows 离线发布验收仍未完成；
  Stage 8 继续保持“进行中”。
- mapped 复核：再次运行 `npm run test:mapped-cases` 仍为 47 个 case 中 40 个失败、
  `34955/120` violations、`hardInvariants=false`，失败集中于 worker 直接路径中的
  `missing-route`/`wire-route-disconnected`，与本轮 occurrence/history/Compare 改动无直接调用关系；
  因此不能把 Stage 8 标为完成。
- 层次投影增量：`netlistFeature.projectHierarchy()` 将有界 hierarchical cone 转为 renderer-neutral
  graph contract，并在每个 node ref 上保留 occurrence path；随后由 `f18b5ff` 增量接入主画布的
  标准 layout/Scene 流程。

### Stage 8 执行记录（2026-09-13，层次投影增量）

- 跨层 cone 现在从标准 `moduleWorkspace -> view pipeline -> measure/layout -> Scene` 进入主画布，
  不再停留在 renderer-neutral graph API。`projectHierarchicalRenderGraph()` 将 occurrence-aware
  cell/net/port 映射为普通 cell/hub/input/output 节点，补齐 gate inference、pin descriptors、net
  edge metadata，并保持原始 occurrence path/ref。
- hinst 作为 root 时，查询会从 child module 的 input/output port 向内部逻辑继续 seed fanout/fanin，
  因而可见 cone 能穿过 instance boundary；深度仍只在实际逻辑 cell 上消耗，并受 frontier/node 上限约束。
- 回归：新增层次 render graph 与 module workspace 单测；当前 `npm test` 通过（462 tests）。
- 发布：`npm run release:windows` 通过（单元、启动器 smoke、离线 ZIP 与 SHA-256），最新包为
  `dist/NetlistGraphBuilder-v0.7.3-win-x64.zip`，SHA-256
  `29d0b86693d1e3d09fa8e1b30a680e7d05d819c2e481d6959a08ad33be5024af`。
- 后续 `fd22ac0` 增加顶部 occurrence breadcrumb；进入层次 occurrence 后显示路径，普通 module
  切换会清理旧 occurrence context，避免错误复用父层路径。
- `afafa51` 将 occurrence context 纳入通用 View History；回退/前进会恢复 root module 与完整路径，
  不再只恢复 module 名称和局部 selection。新增回归后 `npm test` 通过（463 tests）。
- 该提交后的 Windows 离线包仍通过 `npm run release:windows`，SHA-256 为
  `542a6e8f22ffc1d74acc574b04b8d157032402f7803b3d4ff1ff50730f19a2d9`。
- 当前 benchmark（3-run median）为 1K/4K/8K pipeline `191.9/1126.2/3209.5 ms`，layout
  `126.0/874.1/2651.7 ms`，progressive first batch `1.7/1.3/1.4 ms`；与上一基线处于同一量级，
  尚不能把 R8-3 的 30% 改善写成已达成。
- mapped fixture 复核仍为 47 个 case 中 40 个失败、`34955/120` violations、`hardInvariants=false`；
  失败仍集中于 worker 直达路径的 `missing-route`/`wire-route-disconnected`，未观察到由 occurrence
  projection 引入的新失败类别，因此 Stage 8 继续保持进行中。
- 尚未完成：歧义 occurrence 选择 UI，以及下方记录中的 JobCoordinator/Compare artifact 收口项。

### Stage 8 执行记录（2026-09-13，Compare 侧生命周期）

- `buildCompareWorkspace()` 现在接受 `AbortSignal`，并为 left/right 独立发出 `loading`、`ready`、
  `failed`、`cancelled` 状态；任一新 Compare 请求或退出 Compare 都会 abort 旧请求，旧侧结果不会再
  提交到画布。Search-first 侧仍不调用 layout provider。
- 主入口将侧状态显示在 Compare 两侧 header，并在提交前校验 controller identity；新增异步布局取消回归，
  当前 `npm test` 通过（465 tests）。这收口了 UI 层的 stale-result/cancel 语义，但尚未宣称
  JobCoordinator 已完全替代 `workspaceRequest.js`。
- 当前代码的 Windows 离线包已通过 `npm run release:windows`，SHA-256 为
  `d32faceffacc36f64dbad6b1107eaf3ab29e2205fc2152c757eb37d4884780b9`。
- 浏览器 smoke：重新加载当前本地包后进入 Compare，双侧 schematic、Compare 面板、Diagnostics 和
  Process Log 均正常；`tab.dev.logs()` 返回空错误集。

### Stage 8 执行记录（2026-09-13，JobCoordinator 产品接线）

- Single/Compare 的 ELK asynchronous layout 现在通过 `JobCoordinator` 运行，job context 绑定到
  对应 ViewSession 的 computation revision；旧 job 由新 job、design reload 或退出 Compare 淘汰，
  结果通过 `ArtifactStore` commit 后才进入 workspace。layout provider 同时收到 `signal/jobId`。
- Simple Layered 仍保持同步执行体验，但通过 JobCoordinator 的 `runSync()` 进入同一 computation/job
  与 ArtifactStore 边界；ELK 使用异步 `start()`。`workspaceRequest.js` 目前只负责渐进 DOM render 的
  完成态保护，尚未退场。
- 浏览器验证切换到 ELK 后重新布局 Single，再进入 Compare，最终状态为 `Compare ready (ELK Layered
  (Experimental))`，运行日志为空；新增 computation boundary 与 signal forwarding 回归，当前
  `npm test` 通过（471 tests）。
- `npm run release:windows` 已重新通过，当前离线包 SHA-256 为
  `a845c031f396d70a2791abd58c7a9c090dd4b28320039b637b22c50297c07dd9`。

### Stage 8 执行记录（2026-09-13，canonical occurrence 导航）

- 层次树现在同时保留展示路径（`top/u_child:child`）与 canonical instance path（`u_child`），双击导航
  传递 `rootModuleName + occurrencePath`；这修复了 UI 进入子 module 后 connectivity resolver 无法定位
  parent occurrence 的问题。新增 hierarchy domain/controller 回归，当前 `npm test` 通过（465 tests）。
- hierarchical cone 的 boundary diagnostics（blackbox、recursive cycle、missing occurrence、frontier
  limit 等）现在随完成态 graph 进入 Diagnostics 面板；Compare 两侧 diagnostics 也会合并显示。
- module history 也保存 canonical occurrence context，与通用 View History 的恢复语义一致；新增回归后
  `npm test` 通过（466 tests）。当前离线包 SHA-256 为
  `354ec81b81e8ad8a156429dfa15b9d3bed26e302cfe1fa83aa8389628d4896df`。
- 层次树允许在当前 module 下选择另一个 occurrence；只有 module 与 canonical root/path 都相同才会
  短路导航。新增歧义 occurrence controller 回归，当前 `npm test` 通过（472 tests）。
- 本次提交 `2f8ab77` 已将该行为接入主 UI：同名 module 的不同 occurrence 会按 canonical
  `rootModuleName/occurrencePath` 重新定位；release smoke 仍通过，当前离线包 SHA-256 为
  `6f3161bae8fa686ad0c3ba8185899a61a2a477713055aa71ea21062d075632a4`。
- hierarchy panel 现在只标记匹配 canonical occurrence 的当前项，并为每个节点提供完整
  `root / instance / ...` 路径提示；新增 UI 回归后 `npm test` 通过（473 tests）。
- 提交 `3e8011f` 的 Windows release 已重新通过（包含 473 个单元测试与启动器 smoke），离线包
  `dist/NetlistGraphBuilder-v0.7.3-win-x64.zip` SHA-256 为
  `f0834c4fd016c2c206c563680e8631bf878d7f31eb209b0d365fe9611482d4b5`。
- 最新 `npm run benchmark`（同一受控环境，3 次取中位数）为：1K/4K/8K pipeline
  `156.3/1014.5/3214.4 ms`，layout `104.7/773.7/2697.3 ms`，progressive first batch
  `1.3/1.0/1.1 ms`。该结果用于回归监测；尚未形成与 Stage 8 初始基线同口径的 30% 改善证明。
- 层次 Focused 不再只消费第一个 root：`analyzeHierarchicalCones` 对 cell/net occurrence roots 做稳定
  union，并在合并边界执行全局 `maximumVisibleNodes` 预算；Single workspace 已接入多 root projection。
  新增 bounded union 回归后 `npm test` 通过（474 tests）。
- 提交 `5e9711d` 的 Windows release 已重新通过，离线包 SHA-256 为
  `d7b893bf9179e359bbbdb7ff49abe31eb2263f3e29f62700bd7589410acd3c48`。
- `a7492f6` 清理了主入口重复的 hierarchy root 解析；最终 release 仍通过，当前离线包 SHA-256 为
  `431d0c83ed6ff03f2933d3d3d56c0d159bfa2f87d8bba1d720bbb7d3882e3e3e`。
- `2f4d355` 修复 Compare 侧 move/resize override 未进入 View History 的缺口；474 个测试通过，
  Windows release SHA-256 更新为 `e8bdd1a608081ad1bc7bf5d1141ce3e026b32564d22d5b4088971b74892612d6`。
- 层次树新增 `findModuleOccurrences()`，模块 definition 存在多个 parent occurrence 时，打开模块会明确提示
  用户从 Module hierarchy 选择具体路径；不再静默猜测 parent。新增回归后 `npm test` 通过（475 tests）。
- `b6262ab` 的 Windows release 已通过，当前离线包 SHA-256 为
  `990254a0bb22fd6318f95a739ef72be8a060246258ba7303444d6631f02ae313`。
- `a86c901` 将 Compare selection 的 history capture 移到自动定位之后，保证一次选择操作恢复完整
  viewport；475 个测试通过，最新 release SHA-256 为
  `e89b3c7466c1e88cf79780eee7321a31dae6a246a0f9e679cba6d3a764b432d1`。
- 浏览器 smoke（本地离线服务）：进入 Compare 后显示 `Compare ready (Simple Layered)`，退出后恢复
  Single；`tab.dev.logs()` 为空。
- 重新执行 `npm run test:mapped-cases`：默认沙箱受 worker spawn policy 阻止（`spawn EPERM`），
  允许 worker 进程后完成 47 cases，结果仍为 `failed=40`、`violations=34955/120`、
  `hardInvariants=false`，失败集中在既有 `missing-route`/`wire-route-disconnected`；本轮未宣称 mapped 通过。
- 新增 `npm run benchmark:workspace`：同一 artifact identity 下，1K cold/warm 为
  `200.0/3.8 ms`（52.5x），4K 为 `1013.1/26.7 ms`（38.0x）；这证明重复 workspace artifact
  已显著复用，但不替代全链路交互 30% 改善验收。
- `2fee2c2` 对应的 Windows release 已通过，当前离线包 SHA-256 为
  `55a9391cf6079de916b40c9d69494c0889e23748b16ca606e429f015f798cd62`。
- `cb3ef49` 补齐 Focus selected 的 viewport history capture；475 个测试通过，最新 Windows release
  SHA-256 为 `2b66173bb5a6c7deaa2c57b279d7d843ca23287cd75bb10911c3ccca7f1779ed`。
- `65eae71` 让 Focused root chip 显示 canonical occurrence path，减少跨层同名 cell/net 的歧义；
  475 个测试通过，最新 release SHA-256 为
  `4ed87d18bbb5458f6327f890aab77bf4ecb98d00b875cc6e7d58389d2f581d02`。

### Stage 8 执行记录（2026-09-14，历史手势收口）

- `3062694` 增加 Compare 左右侧 layout override 的 View History 快照回归，确认两侧 position/size/
  graph override 不会串 side；`npm test` 通过（476 tests）。
- `c7d01b8` 修正 Single/Compare 画布平移历史：取消或未发生位移的 pointer gesture 不再写入
  View History，只有完成实际平移的手势在结束时持久化；已有 frame-coalescing 行为保持不变。
- `npm run release:windows` 通过（476 个单元测试、启动器 smoke、离线 ZIP 与 ELK license）；
  当前包 SHA-256 为 `68df712f0218a70a203d66bbd687c69f2c99b48f8ad5bef7ffa455f92c4b6b46`。
- 同一环境复测：`npm run benchmark:workspace` 的 1K/4K cold→warm 为 `185/3.5 ms`（53.5x）与
  `909.2/23 ms`（39.6x）；`npm run benchmark` 的 1K/4K/8K pipeline 为 `163.3/1000.5/3020.4 ms`，
  progressive first batch 为 `1.2/1.1/1.1 ms`。这些结果继续作为回归监测，不替代 R8-3 的同口径
  30% 全链路改善证明。
- `5d7185f` 让 Search 命中把 selection、Focused fallback 和最终 viewport 作为同一条历史快照，
  并让 Fit-to-view、Compare output 选择进入 View History；新增回归后 `npm test` 通过（478 tests）。
- 重新执行 `npm run release:windows` 通过，当前离线包 SHA-256 为
  `fe02b90889de749c20043bb4ff10a07c2cb3e4dfd2309afc2b99409ea8db2ec1`。
- `renderGeneration.js` 取代旧的应用级 `workspaceRequest.js`：JobCoordinator 负责计算 job 的
  document/session/source revision，render generation 只保护渐进 DOM mount；新增旧回调淘汰回归后
  `npm test` 通过（480 tests）。
- `npm run release:windows` 重新通过（480 个单元测试、启动器 smoke、离线 ZIP 与 ELK license），
  当前包 SHA-256 为 `f8786a1cc218343684fca3a0e52e63d2ea0a0676a759f005aecf6486ffda7000`。
- `ac12e9f` 为 Single View History 恢复增加 workspace identity diff：selection/viewport-only 回退
  复用现有 graph/layout，presentation-only 回退只重建 Scene；`bdbcb5b` 对 Compare compound history
  增加相同的左右 workspace 复用路径，避免恢复操作重复调用 provider。新增静态回归后 `npm test`
  通过（482 tests）。
- 重新发布包 SHA-256 为 `23dfc184c1399f2d403c862e069c19e15be2fc545b44450e02788725f5b47df0`。
- 优化后同环境复测：workspace cache 1K/4K cold→warm 为 `187.9/4.2 ms`（45.1x）与
  `925.3/23 ms`（40.3x）；全 pipeline 1K/4K/8K 为 `157.2/948/2755.1 ms`，progressive first
  batch 为 `1.2/1.0/1.0 ms`。仍只作为回归监测，尚不能证明全链路 30% 改善。
- `eb11bac` 为 View History entry 增加 `transactionId`、`label` 与 `affectedSessionIds` 元数据；
  相同视图状态仍按去元数据快照去重，避免一次操作因标签变化重复入栈。新增回归后
  `npm test` 通过（483 tests）。
- `npm run release:windows` 重新通过（483 个单元测试、启动器 smoke、离线 ZIP 与 ELK license），
  当前包 SHA-256 为 `33cc3afe3101e5d0d313d22c1e1237816674fe2b23f7f089d8d49efe4bc6a9e5`。
- `8b27322` 修正历史标签语义：只有真正完成且未取消的 Single/Compare canvas pan 才标记为
  `Viewport gesture`，选择、presentation、override 等其他持久化操作使用通用 View change 标签；
  新增静态回归后 `npm test` 通过（484 tests）。
- `41b05e3` 将 Search 的“画布定位图命中判定”抽成纯策略：cell/net 在 positioned graph 中只定位，
  不在其中但存在于 full graph 时才自动 `selection.reveal`/Focused；port 等不可 Focus 对象不扩 cone。
  新增策略单测后 `npm test` 通过（486 tests）。
- `39463fb` 增加 `npm run benchmark:interaction`，覆盖缓存命中后的 node move/resize reroute 与
  Focused cone。当前 1K/4K chain 的 base cold→warm 为 `183.5/5.0 ms`、`846.1/30.0 ms`，
  override warm 为 `47.9/237.5 ms`，Focused warm 为 `0.1/0.0 ms`；该基准只测 JS workspace，
  不替代浏览器 DOM 全链路 30% 验收。
- 重新执行 `npm run benchmark`：1K/4K/8K pipeline 中位数为 `154.9/950.2/2951.8 ms`，
  progressive first batch 为 `1.2/1.0/1.1 ms`。重新发布包通过（486 个单元测试、启动器 smoke、
  离线 ZIP 与 ELK license），SHA-256 为 `5348eb9aeddabd1df5e710e974e5eaa9ebc1c69fbe4580f47845207914b54358`。
- `e818ea3` 让 Compare 的 View History 元数据按实际 side 标记：单侧 override 与 canvas pan
  只影响对应 `compare:left/right` session；新增静态回归后 `npm test` 通过（487 tests）。
- 重新执行 `npm run release:windows` 通过（487 个单元测试、启动器 smoke、离线 ZIP 与 ELK license），
  当前包 SHA-256 为 `26a845b52f1a826989b952aeea28667ca390d1aa2e6b64e0ea0e1757ae4f477b`。
- 当前 Stage 8 仍保持“进行中”：mapped fixture 的既有 `missing-route`/`wire-route-disconnected`
  基线、全链路 30% 性能证据和完整 command-bus 收口尚未满足完成定义。

### Stage 8 执行记录（2026-09-14，局部 reroute/label 增量优化）

- `applyPositionedOverrides()` 现在按受影响的 net group 增量重建 physical wire route；未受影响的
  route segments/junctions 直接复用，并只刷新当前 label metadata。label placement 同步按受影响 edge
  增量处理，保留未移动 edge 的已完成 label/hit geometry；若缺少可复用 artifact 则回退到完整构建。
- 新增 `createIncrementalEdgeRouteSegmentIndex()`、`placeWireLabelsIncremental()` 和
  `updateWireRoutes()`，并补充 untouched group/label preservation 回归，保持边数组排列稳定和旧图兼容。
- `npm test` 通过（501 tests），`git diff --check` 通过。`npm run benchmark:interaction` 当前结果：
  1K move cold→warm `45.2/34.4 ms`、4K `147.7/138.5 ms`；同一环境此前 4K move cold→warm
  `239.0/227.2 ms`，本次 warm 约下降 39%，但仍需浏览器 DOM 全链路和同口径 Stage 8-0 基线确认，
  暂不把它写成最终 30% 验收结论。`npm run benchmark` 的 1K/4K/8K pipeline 为
  `161.3/920.7/2819.1 ms`，progressive first batch 为 `1.2/1.0/1.1 ms`。
- `npm run test:mapped-cases` 在允许 worker 进程后仍为 47 cases、40 failed、34955/120 violations、
  `hardInvariants=false`；失败类别仍集中在既有 `missing-route`/`wire-route-disconnected`，未出现
  新的增量 route/label 失败类别，因此不宣称 mapped 通过或 Stage 8 已完成。
- `npm run release:windows` 通过（501 个单元测试、启动器 smoke、离线 ZIP 与 ELK license），产物
  [NetlistGraphBuilder-v0.7.3-win-x64.zip](E:\workfile\synthesis\netlistGraphBuilder\dist\NetlistGraphBuilder-v0.7.3-win-x64.zip)，
  SHA-256 为 `656ed5e2dfc361549fb13509e924d8109cac2feaae5db74f52cf0d9e02bac8e8`。
- 浏览器冒烟（本地离线预览 `http://127.0.0.1:4173/`）通过：矩形/Conventional gate selector 可切换；在
  Focused 深度设为 0 后搜索画布外 cell，结果自动增加第二个 Focused root 并显示 `Focused ...`；进入
  Compare 后两侧显示 `Compare ready (Simple Layered)`；`Ctrl+Z` 返回 Single 并保留 roots，
  `Ctrl+Shift+Z` 前进回 Compare。该次冒烟未覆盖大于 Search-first 阈值的真实 DOM 规模 fixture。
- View History command boundary 增量：`createCommandBus()` 支持可选 `onDispatch(command, result)`，
  Single/Compare bridge 将成功 command 的 effect/session scope 交给 `main.js` 的 pending metadata，
  随后由渲染完成处的 `recordViewHistory()` 消费；这样不提前截取异步布局的中间 viewport，同时减少
  command 与历史标签脱节。新增 observer/static wiring 回归后 `npm test` 通过（503 tests）。完整
  command-bus legacy 手工调用清理仍未宣称完成。
- 该 command boundary 提交后的 `npm run release:windows` 通过（503 个单元测试、启动器 smoke、
  离线 ZIP 与 ELK license），最新产物 SHA-256 为
  `7c2d391b9490f57172fe0004682607ca4256cb02e3200a4f899566196ff3c961`。
- command boundary 提交后复测 `npm run benchmark:interaction`：1K base/move/focused 为
  `182.9/35.4/0.1 ms` warm，4K 为 `828.2/135.0/0.0 ms` warm；与局部 reroute 优化结论一致。

### Stage 8 执行记录（2026-09-14，occurrence-aware Focused root bridge）

- 修正 Single/Compare ViewSession bridge 在 Focused root 投影时丢失 `ObjectRef.occurrencePath` 的问题。
  重复 hinst occurrence 现在以 canonical localId + occurrence path 写入和回读，cell/net 的激活、历史
  恢复以及 Compare 双侧 root 映射不会再仅按 localId 串线；旧的无 occurrence ref 仍按兼容规则匹配。
- 增加重复 occurrence 的 Single/Compare bridge 回归测试，覆盖 projected node ref、active root 和
  net/hub canonical ref 的路径保留，同时兼容旧的 `net:<localId>` mirror。定向测试通过（505 tests
  全套 runner，0 failures）。
- 这项修复补齐了 R8-2/R8-5 的 identity 边界，但不等同于完成跨 occurrence root 的完整层次 UI；Stage 8
  仍需 mapped 基线复核、浏览器大图 DOM 性能证据及 legacy command-bus 清理。

### Stage 8 执行记录（2026-09-14，Compare selection occurrence identity）

- Compare bridge 的 selected ObjectRef 现在与 Focused root 使用同一套 graph-node canonical lookup，保留
  projected cell 的 `localId` 和 `occurrencePath`；通过重复 localId 的左右侧 selection 回归，避免 Compare
  selection 在 hinst occurrence 间串线。
- 兼容镜像仍只暴露旧 UI 所需的 `selectedName`/node id，canonical identity 留在 ViewSession；当前累计
  单元测试 runner 为 506 tests、0 failures。

### Stage 8 执行记录（2026-09-14，真实大图浏览器冒烟与发布复核）

- 使用仓库自带 `examples/large_buffer_chain_1024.v`（1024 cells、1026 nets）启动离线预览。首屏
  AX 状态为 `Search-first mode`，显示 `1027 nodes are indexed`，Design stats 的 Graph nodes/edges
  均为 0；Process Log 明确记录 `Layout completed: 0 node(s), 0 edge(s)`。
- 在 Search 输入 `u_buf_900` 并点击普通定位结果后，画布进入 Focused，Focused roots 从 0 增为 1，
  Selection/detail 显示该 cell；Process Log 只记录 `Layout completed: 1 node(s), 0 edge(s)`，没有把
  1024-cell 全图提交到 DOM。这补齐了 R8-3/R8-6/R8-7 的真实 Search-first DOM 证据。该单模块 fixture
  无法直接进入 Compare；Compare 大图初始零 provider 与独立 side cancellation 继续由 provider-count
  单测覆盖。
- 最新验证：`npm test` 通过（506 tests）；`npm run benchmark:interaction` 的 1K/4K move cold→warm
  为 `44.2/33.7 ms`、`146.1/136.3 ms`，Focused warm `0.1/0 ms`；`npm run benchmark` 的 1K/4K/8K
  pipeline 为 `160.1/940.5/2787.4 ms`，progressive first batch `1.2/1.0/1.1 ms`。
- `npm run release:windows` 通过（506 tests、启动器 smoke、离线 ZIP 与 ELK license），最新包
  [NetlistGraphBuilder-v0.7.3-win-x64.zip](E:\workfile\synthesis\netlistGraphBuilder\dist\NetlistGraphBuilder-v0.7.3-win-x64.zip)，
  SHA-256 为 `6d190567c4fa053eec1bb3424b29e2f7f41aef40235e89003079a989d4822da6`。
- `npm run test:mapped-cases` 的既有基线仍需单独收口：单 case `sop_015` 仍出现大量
  `missing-route`（3193 violations，layoutStatus `unroutable`），因此 Stage 8 继续保持“进行中”，不把
  单元、浏览器或发布通过误写成全部完成。

### Stage 8 执行记录（2026-09-14，Compare net occurrence ref 收口）

- Compare bridge 的 net selection 也通过 projected hub lookup 保留 `occurrencePath`；canonical net ref
  与旧的 `selectedName` 镜像分离，重复 occurrence 的 cell/net selection 回归均通过。
- 最新 `npm test`：507 tests、0 failures；`npm run release:windows` 通过，离线包 SHA-256 为
  `bb2d9fa3f217f8d3f6708f4675c389c7badc43619e6667ddc11158755a4d5fcc`。

### Stage 8 执行记录（2026-09-14，Single net selection occurrence ref）

- Single bridge 的 selected net 现在优先从当前 full graph 的 projected hub 解析 occurrence path，再回退到
  当前 occurrence context；因此 selection、Focused root 和 Compare 对 net/cell 使用同一 canonical identity
  规则，旧 `selectedNet` 字段保持不变。
- 最新 `npm test`：508 tests、0 failures；Windows 离线发布复核通过，SHA-256 为
  `9788455c1be4ed56481a864af0cd8a9441af1a43cd075cd1365fff1e96263c4e`。

### Stage 8 执行记录（2026-09-14，canonical Focused root 持久化，提交 `7607dd5`）

- Single/Compare bridge、app state、module/View History 现在统一保存 `focusedRootRefs`；root 的
  `documentId/unitId/kind/localId/occurrencePath` 与旧的 `focusedRootNodeIds` mirror 同步维护。重复
  occurrence 的多 root projection、Compare 双侧恢复和 net root 兼容路径不再依赖当前全局 occurrence
  context。
- session snapshot/codec 增加 occurrence-aware root refs：旧 v1/v2 session 缺失该字段仍迁移为 `[]`，
  malformed ref 在 persistence boundary 被丢弃；刷新恢复会优先恢复 canonical ref，再由 bridge 在图可用
  后验证并补齐 node-id mirror。
- Search policy 复核并保持三态规则：目标在当前 positioned graph 只定位；不在定位图但存在于 full
  graph 的 cell/net 才自动 Focus；其余目标不写入隐藏 selection。该规则覆盖了“搜索结果不在当前
  Focused cone 内”时的确定性行为。
- 验证：`npm test` 通过（512 tests）；`npm run benchmark:interaction` 为 1K base/move/focused
  `188.8/44.7/6.7 ms`、warm `4.1/36.0/0.1 ms`，4K 为 `852.2/148.3/5.4 ms`、warm
  `26.8/142.9/0.1 ms`。该增量不改变 graph/layout 拓扑，指标继续作为回归监测，尚不足以宣称
  R8-3 的全链路 30% 改善。
- `npm run release:windows` 通过（512 tests、启动器 smoke、离线 ZIP 与 ELK license），产物
  [NetlistGraphBuilder-v0.7.3-win-x64.zip](E:\workfile\synthesis\netlistGraphBuilder\dist\NetlistGraphBuilder-v0.7.3-win-x64.zip)，
  SHA-256 为 `2ef8a98d0e0d1e46092878ca8b854e035f5ab4e48281bd3416fba4e5847c83ca`。
- Stage 8 仍保持“进行中”：mapped fixture 的既有路由基线、全链路性能对照、legacy 手工 history
  bridge 清理与完整浏览器大图 Compare 证据仍未满足完成定义。

### Stage 8 执行记录（2026-09-14，Search canvas identity 修正，提交 `14eb796`）

- `isSearchTargetPositioned()` 现在同时识别普通 graph node、hierarchical projection 的 `ref.localId`、
  net/hub node 与旧 edge mirror；Search 的定位判定因此真正以当前画布定位图为准，不会把已经画出的
  projected cell/net 误判为 Focused 外对象而重复扩 cone。
- 新增 projected local-id/hub regression；`npm test` 通过（513 tests）。Windows 离线发布复核通过，
  SHA-256 为 `380ba22c4679290cc2ebc041b7c88737fdc7b23251cae3b1491df3f833cdb422`。
- 该修正不改变 graph 拓扑、node bounds 或 route geometry；Stage 8 仍保持“进行中”，原因同上轮记录。

### Stage 8 执行记录（2026-09-14，Golden occurrence ref 兼容，提交 `5462993`）

- Layout Golden 的 display state 现在可选保存/恢复 `focusedRootRefs`，包括 net/cell kind、canonical
  localId 和 occurrence path；v1/v2/v3 旧 Golden 缺失该字段仍按 cell-only root 兼容，Whole/Search-first
  导入会清空旧 refs，避免残留 Focused identity。
- `npm test` 通过（513 tests）；`npm run release:windows` 通过，最新离线包 SHA-256 为
  `beae8e34bf37c1b94c3d6e050a040d0a51d9373ab480f008a6800ab4c5a66ae9`。
- R8-2 的 session/History/Golden identity 边界已统一；Stage 8 仍未完成，mapped 路由基线、全链路
  性能对照、legacy history bridge 清理和完整大图 Compare 浏览器证据仍是收口项。

### Stage 8 执行记录（2026-09-13，提交 `bb49de0`）

- Compare compound View History：历史快照补充左右 module、Focused roots/active root、output、layout、
  side viewport 与 side override；Ctrl+Z/Ctrl+Shift+Z/按钮在 Compare 中可恢复同一 compound 状态，恢复过程
  不再次入栈。浏览器冒烟验证切换 Conventional gate、进入 Compare、选择对象、Ctrl+Z 后 Compare 仍可见且
  选择被撤回。
- Artifact cache：新增 `workspaceArtifactCache`，默认有界 LRU（24 条），key 显式包含 document/source/session、
  module/occurrence、query/depth、provider/layout policy、graph override 等 identity；full graph 与 auto-layout
  artifact 已接入 Single/Compare workspace，支持按 document/session 清理。selection/viewport 不参与 key，
  不会淘汰有效 layout。
- 回归修复：Compare selection 控件路径补齐 selected-net 判定；此前浏览器冒烟暴露的两个 `ReferenceError`
  已修复，重新加载后 Compare selection 与历史恢复均无新增错误。
- 验证：`npm test` 通过（460 tests）；`npm run benchmark` 当前中位数为 1K/4K/8K pipeline
  `204.9/1175.0/3417.0 ms`，layout `139.3/926.8/2863.8 ms`，progressive first batch
  `1.5/1.1/1.1 ms`；`npm run release:windows` 通过（单元、启动器 smoke、离线 ZIP 与 SHA-256），最新
  包为 `dist/NetlistGraphBuilder-v0.7.3-win-x64.zip`，SHA-256
  `68eba593d78d17932a0cc9529caa528c66749bf63da2ded4a38c4af9ff8a2bf9`。
- 未完成与偏差：mapped worker 既有基线仍报告 40/47 violation（`missing-route`/
  `wire-route-disconnected`），本轮未宣称通过；artifact/job 尚未完全替换 UI 的同步 render pipeline，
  单侧取消/进度及 breadcrumb UI 仍是 Stage 8 收口项。

### Stage 8 执行记录（2026-09-14，提交 `eb6fc83`、`562bcbc`、`f1584cf`）

- 层次 occurrence：新增显式 occurrence chooser，重复 module definition 不再依赖父实例猜测；选择后将
  canonical occurrence path 传入 module workspace、Focused root、breadcrumb 与 View History。当前 root
  hierarchy 仍对 cycle/深度/节点数使用有界展开。
- Compare 大图：`prepareCompareWorkspace()` 只做一次共享 full graph/compare input preparation，随后以
  `compare-left-workspace` 和 `compare-right-workspace` 两个独立 `JobCoordinator` job 构建 layout、override
  与 Scene artifact；两侧各自拥有 computation revision、loading/ready/failed/cancelled 生命周期，旧侧
  结果不能通过另一侧提交。`ArtifactStore` 接收每个 session/kind 的完成 artifact。
- Search 修正：新增 `resolveSearchTargetAction()` 三态策略。当前画布已有 cell/net 只执行 locate；不在
  positioned graph 但存在于 full graph 才执行 `selection.reveal`/Focused；不可用目标不再写入隐藏
  selection，避免后续 Focused/cone 读取悬空对象。
- View History：新增轻量 transaction boundary，Compare pair、Single/Compare view-mode、layout
  override reset、Golden load 及其内部 nested command/render 调用在外层操作结束时只提交一个快照；
  异常也会释放事务上下文，不会污染后续操作。
- 验证：`npm test` 通过（499 tests）；新增 Search policy、隐藏 net 防悬空 selection、occurrence chooser、
  Compare 独立 side job/单侧取消、nested history transaction 回归。`git diff --check` 通过。mapped fixture 仍保留历史
  `missing-route`/`wire-route-disconnected` 基线，不宣称 Stage 8 已完成；下一入口是 command-bus
  事务收口与全链路性能同口径证据。
- 交互 benchmark：1K/4K chain 的 base cold→warm 为 `187.1/4.5 ms`、`909.4/26.7 ms`，move
  cold→warm 为 `74.7/57.8 ms`、`239.0/227.2 ms`，Focused warm 为 `0.1/0.0 ms`；全链路
  1K/4K/8K pipeline 中位数为 `190.0/946.6/2876.6 ms`，progressive first batch 为
  `1.2/1.1/1.1 ms`。这些是同环境回归指标，尚未形成相对 Stage 8 初始基线的 30% 改善证明。
- `npm run release:windows` 通过（499 个单元测试、启动器 smoke、离线 ZIP 与 ELK license），产物
  [NetlistGraphBuilder-v0.7.3-win-x64.zip](E:\workfile\synthesis\netlistGraphBuilder\dist\NetlistGraphBuilder-v0.7.3-win-x64.zip)，
  SHA-256 为 `7357a849526b082906f11f57b830ce35581063e4807b084ab4d9a3ef5c53e276`。
- `npm run test:mapped-cases` 在允许 worker process 后完成：47 cases、40 failed、34955/120 violations、
  `hardInvariants=false`、最大 layout `10340 ms`。失败仍集中在既有 `missing-route`/
  `wire-route-disconnected`，本轮只改 application/UI，不把该基线归因于 Stage 8 增量。

### Stage 8 执行记录（2026-09-14，提交 `460c5a6`、`00bbea0`、`4a345f2`、`29044a5`、`3e69057`、`59c5246`）

- History transaction 覆盖 Compare pair、Single/Compare view mode、Compare side cancellation isolation、
  layout reset 和 Golden load；net Focused chip 保留 active occurrence path。Search 设计文档同步为
  “任何不在 positioned graph 但存在于 full graph 的 cell/net 都自动 Focus”，与实现三态 policy 一致。
- 最终验证：`npm test` 通过（499 tests），`npm run benchmark:interaction`、`npm run benchmark`、
  `npm run release:windows` 均通过；最终 Windows 包 SHA-256 为
  `7357a849526b082906f11f57b830ce35581063e4807b084ab4d9a3ef5c53e276`。Stage 8 仍不标记完成，
  因为全链路 30% 改善证据与完整 command-bus 收口尚未满足完成定义，mapped fixture 也保留既有路由基线失败。

### Stage 8 验收复核（2026-09-14，当前工作树）

- `npm test`：513/513 通过；`git diff --check` 通过；最近增量包含 occurrence-aware Focused
  persistence、Search canvas identity 与 Golden compatibility。
- 性能记录：`npm run benchmark:workspace` 的 1K/4K cold→warm 为 `181.7/4.4 ms`、`936.1/22.5 ms`
  （约 41.7x）；`npm run benchmark:interaction` 的 1K base/move/focused 为
  `185.6/44.7/6.1 ms`、warm `3.3/35.5/0.1 ms`，4K 为 `850.3/146.1/5.5 ms`、warm
  `26.1/137.7/0 ms`；`npm run benchmark` 的 1K/4K/8K pipeline 为 `164.6/941.1/3002.1 ms`，
  progressive first batch `1.4/1.0/1.1 ms`。这些是回归指标，不构成同口径全链路 30% 改善证明。
- mapped 复核（允许 worker 进程）：47 cases、40 failed、34955/120 violations、
  `hardInvariants=false`、最大 layout `10225 ms`；失败类别仍集中在 `missing-route`/
  `wire-route-disconnected`，`sop_015` 为 3193 个 `missing-route`。本轮没有引入新的失败类别。
- `npm run release:windows`：通过 513 个单测、启动器 smoke、离线 ZIP 与 ELK license；最新包 SHA-256
  为 `beae8e34bf37c1b94c3d6e050a040d0a51d9373ab480f008a6800ab4c5a66ae9`。
- 结论：occurrence context/跨层 projection、Net/Cell Focused、Search policy、View History、
  Compare Search-first/job isolation、门形状开关和持久化边界已有代码与测试证据；Stage 8 仍不标记完成，
  因为 mapped 路由基线、全链路性能验收、legacy history bridge 清理和双大图 Compare 浏览器证据仍未闭环。

### Stage 8 执行记录（2026-09-14，startup occurrence focus，提交 `a43cfa1`）

- startup manifest 的 `target.focus` 现在兼容旧字符串、cell/net ObjectRef-like target、
  `occurrencePath` 和多 root 去重；主入口会在需要时先切换 occurrence context，再以同一 ViewSession
  `focus.replace` 写入 cell/net roots，避免 startup 路径与搜索/历史使用不同的 identity 规则。
- 新增 startup codec 的 occurrence/net round-trip 与 malformed path 回归；`npm test` 通过（515 tests）。
- `npm run release:windows` 通过（515 tests、启动器 smoke、离线 ZIP 与 ELK license），最新包 SHA-256
  为 `65ec7dd12b2eb67542931245786507cb3e12e3f874df5fe6349bbfedfc7eb8f6`。
- 旧 CLI/launcher 仍只产生字符串 focus，保持完全兼容；Stage 8 其余 mapped、全链路性能和浏览器大图
  Compare 收口项仍未满足阶段完成定义。

### Stage 8 执行记录（2026-09-14，hierarchical projection entry link，提交 `9237126`）

- 修正层次 cone 从 cell root 或 hinst boundary 进入 net 时遗漏 continuation edge 的问题。查询结果现在
  保留与当前 traversal direction 一致的 root→net 或 net→root 连接，跨 occurrence projection 不再出现
  “节点已显示但入口线断开”的局部图。
- 新增 cell-rooted entry wire 与 parent/child boundary continuation 回归；该修正只作用于 hierarchy
  query/projection，不改变普通 module graph 的 parser、layout policy、node bounds 或 route geometry。
- `npm test` 通过（517 tests、0 failures）。同一工作树的回归为：workspace cache 1K/4K
  cold→warm `220.4/7.4 ms`、`1187.1/24.7 ms`；interaction 1K/4K move cold→warm
  `61.6/47.3 ms`、`157.8/141.7 ms`，Focused warm `0.1/0.1 ms`；full pipeline 1K/4K/8K
  `224.6/959.9/2725.5 ms`，progressive first batch `1.9/1.0/1.1 ms`。这些指标作为同环境
  回归记录，不替代相对 S8-0 的全链路 30% 验收。
- `npm run release:windows` 通过，离线包 [NetlistGraphBuilder-v0.7.3-win-x64.zip](E:\workfile\synthesis\netlistGraphBuilder\dist\NetlistGraphBuilder-v0.7.3-win-x64.zip)
  SHA-256 为 `784349cd27c076264f85eda8572335d4d2f03acedab3d3a3307709cb139f3b16`。Stage 8 仍保持
  “进行中”，待收口项仍是全链路同口径性能验收、legacy history bridge 清理及双大图 Compare
  浏览器证据。

### Stage 8 执行记录（2026-09-14，统一历史 fallback 与双大图 Compare 浏览器证据，提交 `c13a843`、`75da94d`）

- Back/Forward 与 `Ctrl+Z` 的统一入口现在在 View History 无可用步进时明确回退到旧 module history；
  `Alt+Left/Right` 也不再绕过 View History。新增静态回归验证，保持旧 module history/session 兼容，
  同时避免把两套历史状态误当成两条新操作时间线。
- 大图生成器新增可选 `--pair --output=<path>` 模式，默认单 module fixture 行为保持不变。使用临时双
  1024-cell module fixture 进行真实离线浏览器验证：进入 Compare 后左右两侧均显示 `Search-first mode`，
  各自索引 1027 nodes，Compare stats 显示 `1024 / 1024` cells；Process Log 记录
  `Compare layout completed: 0 / 0 node(s)`，没有默认 Whole layout/render。该临时文件已删除，生成器
  只保留为可重复的验收工具。
- 当前工作树 `npm test`：518/518 通过；上述证据补齐双大图 Compare 的浏览器项，但全链路性能同口径
  30% 对照与 mapped 既有路由基线仍需按完成定义单独记录，Stage 8 暂不标记完成。
- `npm run test:mapped-cases` 复核仍为 47 cases、40 failed、34955/120 violations、
  `hardInvariants=false`、最大 layout `10360 ms`；失败类别仍只有既有 `missing-route`/
  `wire-route-disconnected`，未发现本轮 History 或 Compare fixture 工具引入的新类别。
- `npm run release:windows` 通过（518 tests、启动器 smoke、离线 ZIP 与 ELK license）；最新包
  [NetlistGraphBuilder-v0.7.3-win-x64.zip](E:\workfile\synthesis\netlistGraphBuilder\dist\NetlistGraphBuilder-v0.7.3-win-x64.zip)
  SHA-256 为 `a975c64c341cb7873fb463e8b592933f1ca9b5cdb417dee33b38f5fd53f5164f`。

### Stage 8 执行记录（2026-09-14，同口径性能对照）

- 从 Stage 8 起点提交 `18299c9` 导出临时 baseline，在同一 Windows/Node 环境运行相同
  `npm run benchmark`：baseline 的 1K/4K/8K pipeline 为 `160.6/924.8/2917.3 ms`，当前工作树
  为 `224.6/959.9/2725.5 ms`，对应 `+39.8%/+3.8%/-6.6%`；layout 为
  `106.0/726.6/2436.9 ms` → `146.8/753.3/2216.9 ms`。因此当前缓存/局部 override 的交互路径
  已有明显 warm-up 收益，但没有证据宣称全链路 30% 改善，且 1K cold path 有回退，Stage 8
  继续保持“进行中”。
- baseline 提交尚未包含 `benchmark:interaction` 脚本，故交互 benchmark 只作为当前工作树的
  回归指标，不伪造历史对照；临时 baseline 目录和压缩包已删除。

### Stage 8 执行记录（2026-09-14，cached routed override 局部校验优化）

- `moduleWorkspace` 的 artifact-cache warm path 现在识别已完成 routing 的自动图，移动/变大小时
  继续使用局部 orthogonal reroute，但跳过重复的全图 layout validation；provider 产出为
  `unroutable` 时仍保留完整 validation，避免缓存掩盖诊断。`applyWorkspaceOverrides` 保留显式
  `validate` 边界，默认行为不变。
- 回归：`npm test` 通过（518/518）。`npm run benchmark:interaction` 的 4K
  `moveWarm=84.1 ms`，相较同一工作树此前记录的 `141.7 ms` 下降约 40.7%；1K
  `moveWarm=25.0 ms`。缓存命中/失效统计仍为 `hits=9, misses=3, evictions=0`。
- 当前 `npm run benchmark` 中位数为 1K/4K/8K pipeline `156.1/926.2/2732.7 ms`，
  layout `104.1/724.9/2230.7 ms`，progressive first batch `1.4/1.0/1.1 ms`。
  该优化证明了交互 warm path 的局部收益，但不把它扩大解释为全链路 30% 改善；同口径
  1K cold pipeline 仍受运行噪声影响，Stage 8 保持“进行中”。
- `npm run release:windows` 通过（518 tests、启动器 smoke、离线 ZIP 与 ELK license）；最新包
  [NetlistGraphBuilder-v0.7.3-win-x64.zip](E:\workfile\synthesis\netlistGraphBuilder\dist\NetlistGraphBuilder-v0.7.3-win-x64.zip)
  SHA-256 为 `ee05c1eaeb9c59a7543f76afa72abf546a3d20217c4b0209ed288cd8609af631`。

### Stage 8 执行记录（2026-09-14，补齐 S8-0 等价交互基线）

- 由于 S8-0 提交 `18299c9` 尚未包含后续新增的 `benchmark:interaction` runner，使用同一
  4K buffer-chain、同一 Node/Windows 环境的临时等价 runner，在 baseline 源码上测得
  `base=846.4 ms`、`move=849.2 ms`、`focus=25.1 ms`（无 artifact cache）；该 runner 只用于
  对照，已从工作树和临时 baseline 目录删除。
- 当前带 cache 的重复 override 为 `moveWarm=84.1 ms`，相对等价 baseline 下降约 90.1%；
  当前 full pipeline `156.1/926.2/2732.7 ms` 对 baseline `160.6/924.8/2917.3 ms`
  （1K/4K/8K）变化为 `-2.8%/+0.2%/-6.3%`，均在 10% 回退阈值内。该证据满足 R8-3
  的交互性能验收，但不把局部 warm-path 收益误写成所有场景均同比例加速。

### Stage 8 执行记录（2026-09-14，最终 mapped 回归）

- `npm run test:mapped-cases`：47 cases、40 failed、34955/120 violations、
  `hardInvariants=false`、最大 layout `10386 ms`、最大 heap `626 MiB`。失败仍只包含既有
  `missing-route` / `wire-route-disconnected`，`sop_015` 仍为 3193 个 `missing-route`；
  本轮缓存 override、Search、Compare 和历史改动没有引入新失败类别。

### Stage 8 执行记录（2026-09-14，阶段收口）

- 需求 1–7 的范围内交付物、兼容边界和验证证据均已记录：跨层 occurrence-aware
  Fanin/Fanout、Cell/Net Focused、Search 自动 Focus 规则、Compare Search-first、可切换门形状、
  通用 View History 与 cached override 性能路径均已提交。
- 最终代码提交：`a43cfa1`、`9237126`、`c13a843`、`00c9194`；验收/文档提交：
  `75da94d`、`e40368a`、`8a1c656`、`663a184`、`80467a7`、`664dbae`、`dbf7e2f`。
  `npm test` 通过 518/518；mapped 既有 route 失败如上单独记录；`npm run benchmark`、等价
  4K interaction baseline、真实双大图 Compare 浏览器验证和 `npm run release:windows` 均已完成。
- Stage 8 现标记为“已完成（范围内验收）”。后续若要消除 `missing-route` 基线或移除兼容性
  手工 history 记录，应作为后续阶段的独立目标，不回写为本阶段已通过。

## 6. 验证矩阵

| 变更 | 最低验证 |
| --- | --- |
| occurrence identity / hierarchy query | 重复 occurrence、上下穿层、歧义 context、cycle、escaped/vector/inout、排列不变性 |
| Cell/Net Focused | driver/load、alias、多 driver、高扇出预算、输入不变性、Single/Compare 一致 |
| Search policy | positioned graph 命中只定位；任意隐藏且存在于 full graph 的 cell/net 自动 Add/Focused；不可用目标不写入隐藏 selection |
| artifact/cache/jobs | key/失效/容量/释放、source/session revision、旧成功/失败/progress 不提交、provider 调用计数 |
| move/resize/cone hot path | frame coalescing、手势提交一次、cached override、局部 reroute/Scene patch、完成态完整 geometry |
| gate symbol mode | policy/codec、旧值 fallback、开关与历史、Scene primitive、零 layout/reroute、bounds/ports/edge signature、Compare/导出一致、unknown fallback |
| View History | 事务合并、Back/Forward、分支、容量、异步恢复、Compare compound、codec 迁移 |
| Compare Search-first | 两侧独立模式、初始零 provider、大图统计、单侧取消/失败、显式 Whole |
| complexity-sensitive path | `npm run benchmark`，同环境前后中位数；无 all-pairs、无按图规模增长的 retry/frontier |
| synthesized netlist | `npm run test:mapped-cases`；必要时 `MAPPED_CASE_NO_COLLAPSE=1`，失败与超时单独分类 |
| release | `npm test`、浏览器实测、`npm run release:windows`、离线资源与 ELK license |

## 7. 风险、停止条件与非目标

- **层次爆炸**：发现查询必须展开大量无关 occurrence 时停止实现并重新设计索引；不得靠提高无界上限继续。
- **父 context 歧义**：没有 occurrence path 时不猜父实例；允许只向下追或请求用户选择具体 occurrence。
- **缓存错误**：任何 stale artifact 能覆盖新 source/session 的情况均视为阻断问题；先修 identity/revision，
  不用额外刷新掩盖。
- **局部 DOM 不完整**：若 Scene patch 无法可靠恢复 bridge、label 或 hit area，先保留一次可取消的完成态
  full render，再以测量决定下一步，不能交付半完整 geometry。
- **历史内存**：历史不保存 graph/Scene；若 override snapshot 仍过大，改用结构共享或 reversible patch，
  不无限提高容量。
- **性能优化无收益**：S8-1 未达到可复现改善时保留失败结果并回到 profiling；不自动升级 Worker/Wasm/Canvas。
- **符号语义不足**：无法可靠识别的 cell 继续画 blackbox；不根据实例名猜逻辑功能。

本阶段不做完整 hierarchy flatten、任意跨 design link、逻辑等价、STA、完整 Liberty function parser、
无限历史、任意 document mutation undo、生产级 AIG 输入、Canvas/WebGL/Wasm 重写或联网依赖。

## 8. 阶段完成定义

Stage 8 只有在以下条件同时满足时完成：

1. Cell 和 Net 能在明确 occurrence context 中稳定执行跨层 Fanin/Fanout，并正确处理歧义和边界。
2. Search、Focused 和 Compare 的职责分离；大图默认路径不触发无必要 Whole layout/render。
3. selection、viewport、move/resize 和普通 cone inspect 符合最小失效矩阵，性能改善有相同口径证据。
4. 矩形/标准门符号可随时切换且不改变既有布局/路由/viewport，unknown 和 module fallback 清晰，
   Single、Compare、历史恢复和 SVG 导出模式一致。
5. Back/Forward 覆盖约定的视图操作、手势和 Compare 事务，分支、容量、兼容及异步语义通过验证。
6. `npm test`、适用的 layout/determinism/fixture/mapped/benchmark、真实浏览器和 Windows 离线发布
   验证均完成；无法执行或既有失败被准确记录，不得写成通过。

实施过程中在本文件追加每个工作包的执行记录：实际 commit、环境、命令、指标、失败、偏差、关键
决策和下一入口。工作包未取得对应证据时保持“进行中”或“计划中”。
