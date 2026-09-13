# 阶段 8：层次追踪、对象聚焦与大图交互收敛

更新日期：2026-09-13。状态：进行中（核心增量已提交，验收闭环尚未完成）。

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
| R8-1 | 跨层 Fanin/Fanout | occurrence identity、层次连接模板、双向跨边界 cone、层次 boundary/路径 UI | P0 | 大 / 高 | 进行中：查询核心、canonical occurrence context 与标准 layout/Scene projection 已落地；breadcrumb、歧义 parent context 与完整路径 UI 仍待补齐 |
| R8-2 | Net Focused | cell/net root union、driver/load seed、net root chips 与高扇出边界 | P1 | 中 / 中 | 进行中：Single/Compare 基础能力已落地，完整层次 root UI 仍待补齐 |
| R8-3 | 交互性能与最小失效 | 分阶段测量、artifact cache、依赖失效矩阵、局部 Scene/DOM 提交 | P0 | 中至大 / 高 | 进行中：Simple/ELK Single/Compare 均经 JobCoordinator 提交，bounded artifact cache、Compare per-side cancellation/status、cached override、局部 reroute、frame coalescing 已有；30% 改善证据与 workspaceRequest 最终退场仍待补齐 |
| R8-4 | 可切换的标准逻辑门符号 | Netlist presentation policy、矩形/标准符号开关、AND/OR/XOR/BUF 族图元、命中区和导出一致性 | P1 | 中 / 中 | 进行中：开关、Scene、Compare、导出已落地 |
| R8-5 | 通用 Back/Forward | command transaction、View History、手势合并、分支与旧历史迁移 | P1 | 中至大 / 高 | 进行中：有界 history、selection/focus/viewport/override、occurrence context、Single 快捷键与 Compare compound 恢复已接入；完整 command-bus 收口仍待补齐 |
| R8-6 | Search/Focused 解耦 | Locate policy、显式 `+ Focus`、Search-first 自动 Focus 规则 | P0 | 小至中 / 中 | 进行中：定位与显式 Focus 已解耦 |
| R8-7 | Compare 大图按需加载 | 双侧独立 Search-first、无布局统计、单侧 job/artifact、显式 Overview | P0 | 中 / 中 | 进行中：大图默认零 provider、统计、显式 Whole、复合 history、共享 artifact cache、per-side loading/cancel 与 ELK JobCoordinator 已落地；持久 artifact 接管仍待补齐 |

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
2. 当前是小图 Focused 且目标在 full graph：切回或复用 Whole artifact 定位，原 roots 保留。
3. 当前是大型 module Search-first，且没有可用 Whole positioned artifact：自动 `focus.add`，局部
   layout/render 完成后定位。
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
  `28d65a921881dbc44530b06ec6db348c4bc28d8a5c13eaf007f5b3c19dfd17d2`。

### Stage 8 执行记录（2026-09-13，canonical occurrence 导航）

- 层次树现在同时保留展示路径（`top/u_child:child`）与 canonical instance path（`u_child`），双击导航
  传递 `rootModuleName + occurrencePath`；这修复了 UI 进入子 module 后 connectivity resolver 无法定位
  parent occurrence 的问题。新增 hierarchy domain/controller 回归，当前 `npm test` 通过（465 tests）。
- hierarchical cone 的 boundary diagnostics（blackbox、recursive cycle、missing occurrence、frontier
  limit 等）现在随完成态 graph 进入 Diagnostics 面板；Compare 两侧 diagnostics 也会合并显示。
- module history 也保存 canonical occurrence context，与通用 View History 的恢复语义一致；新增回归后
  `npm test` 通过（466 tests）。当前离线包 SHA-256 为
  `354ec81b81e8ad8a156429dfa15b9d3bed26e302cfe1fa83aa8389628d4896df`。

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

## 6. 验证矩阵

| 变更 | 最低验证 |
| --- | --- |
| occurrence identity / hierarchy query | 重复 occurrence、上下穿层、歧义 context、cycle、escaped/vector/inout、排列不变性 |
| Cell/Net Focused | driver/load、alias、多 driver、高扇出预算、输入不变性、Single/Compare 一致 |
| Search policy | Whole 可见定位不改 roots；小图隐藏目标复用 Whole；Search-first 大图才自动 Add |
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
