# UI 工作台改造计划

日期：2026-11-12。状态：实现与自动化验收完成；Windows 人工 GUI/系统缩放复核未验证，见末尾验收边界。代码核对基线：`0446644`。

本计划将现有工作台调整为“全局操作、就近分析、独立对象检查”的桌面工具。优先恢复选中对象后的分析连续性、Compare 配置可达性和画布空间，再统一视觉样式。保留现有功能与数据语义，分阶段迁移，避免一次性重写整个界面。

用户已授权根据计划持续开发到结束。实施阶段按本计划逐批更新 [设计规范](../DESIGN_SPEC.md)、[架构说明](../ARCHITECTURE.md) 和 [用户指南](../USER_GUIDE.md)，使文档描述与实际交付同步。

## 1. 范围与约束

### 1.1 改造范围

- 全局工具栏、模块导航、搜索结果、Single/Compare 切换。
- 画布上下文工具栏、Whole/Focused/Search-first 状态、roots 管理、视口操作。
- Selection 检查器、连接与层次追踪、时序详情、Net routing、Adjust 属性。
- Layout、View、Timing、Cell Config、Liberty、导入导出与 Golden 入口。
- 设计统计、诊断、任务状态、过程日志、快捷键与帮助。
- 桌面响应式、键盘可达性、长名称、多列数据、错误与空状态。
- 必要的 UI 控制器、UI 偏好存储、浏览器测试和离线资源集成。

### 1.2 保持的产品边界

1. 继续使用离线原生 ES modules；不引入 React/Vue、运行时组件库、在线字体、CDN 或 bundler。
2. 保留 `parser -> IR -> analysis -> layout -> render -> UI` 边界，不以 UI 改造为由调整解析、推断或布局算法。
3. [Simple 冻结](simple_layout_freeze_baseline.md)持续有效：算法、候选、策略、默认值、几何、路由状态与诊断均不得因本项目改变；不刷新其期待值掩盖差异。
4. 不恢复 graph group-collapse。本文的面板收起仅指工作台外壳，与图分组折叠无关。
5. 保留 `DEFAULT_LAYOUT_PROVIDER_ID` 与既有回退、取消语义。界面显示名称变化不得改变 provider ID。
6. 不新增独立双侧追踪深度、单侧 Whole、任意面板拖拽停靠、多工作区标签、完整命令面板或新的分析算法。
7. 首版以桌面鼠标和键盘为主；深色主题、手机触控工作台、minimap、完整国际化作为后续独立需求。

## 2. 基线与目标

### 2.1 已观察事实

下列结果来自 2026-11-12 当前源码的浏览器检查，使用内置示例、默认 300px 侧栏；是该状态的测量值，不代表所有网表。

| 问题 | 证据 | 影响 |
| --- | --- | --- |
| 对象详情被配置项挤到下方 | 1440×900 下 Selection 内容约从 y=1289 开始；搜索选中后侧栏仍停在顶部 | 找到对象后无法立即查看连接 |
| Compare 设置不在进入后的首屏 | 同尺寸下 Module Compare 设置约从 y=937 开始 | 进入模式后仍需寻找模块选择和同步设置 |
| 顶部自动换行不稳定 | 1440px 下 More 独占第二行，其 176px 菜单左边界约为 x=-84 | 菜单内容实际被裁切 |
| View 区域过大 | 无 roots 时仍约占 426px 高度 | 空状态与禁用操作占据主要空间 |
| 详情横向溢出 | 侧栏内容宽约257px，时序表约334px，整侧栏 scrollWidth 超过可见宽 | 多层横向和纵向滚动 |
| 底部空间重复占用 | 收起的日志栏约43px，状态栏28px | 日志未展开也持续挤占画布 |
| 操作名称接近、影响不同 | Focus selected object、Set selected as Focused、Add selected | 视口定位和图范围变更难以区分 |

基于这些事实，优先假设是：重新分配信息和操作位置，比单独调整配色更能改善读图效率。右侧检查器的具体宽度、页签数量和工具栏密度仍需在真实网表中验证。

### 2.2 成功标准

- 默认桌面且 Inspector 已打开时，选中 cell/net/port 后，对象名、类型与关键连接入口立即出现在检查器首屏；无需先滚过 Layout、Timing 或统计区。用户主动关闭或使用窄屏抽屉时，选择摘要立即更新，一次操作打开后直达当前对象详情。
- 进入 Compare 后，A/B 模块、Apply、分屏与同步入口可直接看到。
- 1366×768 默认 Single 状态：中央画布宽不低于约1000px、高不低于约640px；不同时默认展开左右两条宽侧栏。
- 1440×900 顶栏不因内容自然换行；所有菜单在视口内可读、可点击。
- 页面与整侧栏无水平滚动；允许连接/时序数据区域内有明确的横向滚动。
- 面板开关、页签切换、布局外壳 resize 不调用 layout provider、不改 roots、不产生图布局历史项。
- 全部现有功能在迁移清单中有去向，关键工作流通过真实鼠标/键盘验证。
- 默认 provider 的正确性回归无新增失败；Simple 的既有失败证据单列，不作为修复授权。

## 3. 目标布局

### 3.1 工作台区域

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ NGB  File  Liberty  Cell Config       Search…       Single / Compare   ? │
├──────────────────────────────────────────────────────────────────────────┤
│ Navigator  ← →  module / occurrence   Whole | Focused   View Layout …   │
│ [Compare 时：A 模块 / B 模块 / Apply / 分屏 / 同步 / Output cone]          │
├──────────────┬──────────────────────────────────────┬────────────────────┤
│ Navigator    │ [Focused 时：roots、Fanin / Fanout]   │ Inspector          │
│ Hierarchy    │                                      │ 对象名 / 来源 / A/B │
│ Design       │              Schematic               │ Zoom / Add / Replace│
│              │                                      │ Connections        │
│ 可收起/固定  │          Single 或 Compare A/B       │ Timing / Adjust    │
├──────────────┴──────────────────────────────────────┴────────────────────┤
│ Ready / 任务进度    模块范围 / Provider       Diagnostics 0    Log 0      │
└──────────────────────────────────────────────────────────────────────────┘
```

这是区域关系图，文字不要求全部在一行永久展开。全局栏负责文件和工作模式；上下文栏负责当前视图；右侧 Inspector 负责选中对象。每项操作的归属稳定，缩小窗口仅收纳次要项。

### 3.2 尺寸与响应式规则

| 可用 CSS 宽度 | 默认面板 | 工具栏与画布策略 |
| --- | --- | --- |
| ≥1600px | Navigator 240px，Inspector 336px，均可收起与调宽 | 全局栏48px、上下文栏40px、状态栏24px；剩余空间给画布 |
| 1280–1599px | Navigator 默认收起；Inspector 320px | 层次导航临时抽屉；Inspector 保留固定槽位；禁止顶栏自动换行 |
| 1024–1279px | 左右面板默认收起，按需打开单个抽屉 | 搜索和主操作保留，次要操作进入有名称的菜单；不同时叠两层抽屉 |
| 760–1023px | 紧凑兼容模式 | 模块与搜索允许明确的第二行，顶部总高度有界；画布和全部命令仍可到达 |
| <760px | 非首版完整工作区目标 | 提供明确的窗口过窄提示；文件和退出/收起入口不得被裁切 |

- 宽度按 CSS viewport 判断；同时验证系统缩放和浏览器缩放，不能只测试物理分辨率。
- 1366px 默认画布约为 `1366 - 320 - 6 = 1040px`。默认未展开日志与 Focused 条带时，高度约为 `768 - 48 - 40 - 24 = 656px`。
- Focused 条带最多追加40px；Compare 配置条最多追加44px。两者同时出现时仍使用固定预算，不随 roots 个数无限长高。
- 用户主动固定导航或调宽检查器后，以中央画布至少640px为布局下限；不足时转抽屉。不得通过减少字号硬塞控件。
- 顶栏按固定优先级收纳：先收起品牌全称，再将 Cell Config 与辅助工具收入 File 工具组，最后把搜索改成可展开的搜索入口。文件入口、工作模式和可见的搜索入口始终保留；常规桌面搜索框目标宽240–480px。禁止依靠 `flex-wrap` 随机把最后一个控件挤到下一行。
- Inspector 宽度可在320–560px间调整，Navigator 可在220–360px间调整；具体归一化由单一 UI 布局策略函数负责。
- 新会话根据断点给默认值；用户主动选择优先，断点临时收纳不覆写其已保存偏好。不得随每次 resize 来回开关面板。
- 面板开关与窗口尺寸变化保持当前缩放比例及画布中心附近的世界坐标；不自动 Fit，不重跑布局。显式 Fit 才改变阅读比例。

## 4. 完整控件迁移清单

| 现有能力 | 目标入口 | 保留或澄清的语义 |
| --- | --- | --- |
| Open/Paste netlist、Open/Paste timing | File → Import 分组 | 文件、粘贴、全局拖放继续走同一用例；保留大文本预览保护 |
| Export SVG、Save/Load Golden | File → Export / Layout snapshot 分组 | 保留当前范围、指纹校验和旧存档兼容；Compare 禁用 Export SVG 与 Save Golden；Load Golden 成功校验后退出 Compare、恢复对应 Single 模块 |
| Liberty | 顶部独立 Liberty 入口 | 空库/已加载/导入中状态可见；保留取消、替换、卸载和诊断；收起不取消 |
| Cell Config 导入、导出、Reset all | 顶部 Cell Config 管理入口，紧凑时移入 File 工具组 | 类型级持久化配置；不与 Liberty 卸载混为一个动作 |
| Edit selected type | Inspector 类型字段旁 `Edit cell type…` | 明示影响同类型实例；复用现有编辑器 |
| 模块层次与实例 occurrence | Navigator → Hierarchy；上下文栏显示当前位置 | 定义名、实例路径分别保留；歧义父实例继续显式选择 |
| Design stats | Navigator → Design | 标明当前模块与可见图范围；Compare 标明 A/B 来源 |
| Back / Forward | 上下文栏导航组 | 完整 View History，保留现有快捷键与事务语义 |
| Fit | 画布工具组 `Fit view` | Single 适配当前视图，Compare 适配双侧；保留现有 View History，与 Zoom to selection 分开 |
| Search | 全局栏主搜索框 | 保留 module、port、net、instance、cell type 全部对象类别 |
| 搜索结果主体 / + Focus | 结果行的主操作 / `Add to Focused` 次操作 | 已绘制对象定位；未绘制 cell/net 自动追加局部根的既有规则不变 |
| Whole / Focused | 画布上下文栏模式组 | Search-first 另有明确状态，不误标为 Whole |
| Fanin / Fanout depth | Focused 条带 | 保留0–99、现有归一化和提交语义；Compare 当前深度共享 |
| root chips、激活、追加、移除、清空 | Focused 条带及完整 roots 浮层 | 保留32个 roots、canonical identity、cell/net 与 occurrence |
| Focus selected object | `Zoom to selection`，Inspector 和选中摘要入口；保留 F | 当前图对象仅改变视口；保留旧的图外 cell 转为 Focused 的回退语义，并在帮助中说明 |
| Set selected as Focused | Inspector `Replace Focused roots` | 用当前选择替换 roots；与追加操作明确分开 |
| Add selected / Remove selected | Inspector 或 roots 条带 | 追加/移除当前对象，按钮状态反映是否已有此 root |
| Show aliases / Fanout hubs / Gate symbols | View 菜单 | 前两项改变派生显示图；符号切换是展示策略，三者不能统称“零计算” |
| Provider / Wire spacing / Cell spacing | Layout 浮层 | 完整名称可读，数值只显示一次；沿用现有范围、4的倍数吸附和策略边界 |
| Adjust layout / Reset layout | 上下文栏模式入口 / Layout 菜单 `Reset view overrides` | 持续显示 Adjust 状态；Reset 清除位置、尺寸及 graphOverrides（含属性、pin direction、Net routing 排除）；Compare 作用于双侧 |
| 节点尺寸、实例属性、单实例 pin direction | Inspector → Adjust，仅该模式开放 | 实例级覆盖，与类型级 Cell Config 清楚区分；逐项重置保留 |
| Timing Metric / Threshold | Timing 浮层 | Single、Compare、SVG 共用全图策略；不引入按侧独立指标 |
| 对象时序、badge 勾选与位置、Default badges | Inspector → Timing | 表内横向滚动或宽抽屉；数值含义、已选 badge、位置策略及默认值恢复入口保留 |
| cell/net/port/hinst 对象详情 | Inspector 固定头部 + Connections 页签 | 保留来源、方向、驱动/负载、Traversal、Current module/Parent occurrence |
| Net routing 开关及恢复 | Net Inspector → Routing 区 | 不布线仍保留实体和连接信息；alias、历史与 Golden 语义不变 |
| Compare 模块选择、Apply、退出 | 双画布上方配置条 | 进入后立即可达；候选选择未 Apply 时明确标为未应用 |
| 分屏与两种 Sync | Compare 配置条 | A/B 为稳定身份；位置为上/下或左/右；两个同步开关独立 |
| Output cone / Output depth | Compare 配置条分析组 | 保留与 Whole、Focused roots 的现有转换规则；不新增第二套状态 |
| Diagnostics | 状态栏计数 → 底部诊断页签 | 错误/告警数可见，无诊断时不占常驻大块空间 |
| Process Log | 状态栏计数 → 底部日志页签 | 保留级别/阶段、Auto-scroll、复制、导出、清空、错误详情 |
| 进度、取消、失败反馈 | 状态栏与对应画布状态 | Compare 单侧任务不覆盖另一侧；失败/取消不静默清空有效结果 |

## 5. 关键交互设计

### 5.1 选择与连接追踪

Inspector 默认显示对象摘要和 Connections；名称可换行、完整复制，canonical name 与显示名分别提供。选中后的主操作始终在顶部，不随表格纵向滚动离开视野。

Connections 先展示 driver/loads 或 pin 连接，再提供 Traversal 与跨层区。Current module 和 Parent occurrence 使用标题、作用域说明及轻量底色共同区分；保留关联跳转、子模块双击进入和父实例消歧。不存在的父层区不显示空表。

Inspector 使用 Connections / Timing / Adjust 页签，类型不适用时给明确解释或不展示对应页签。对象切换保持适用的当前页签；新对象内容重置到顶部。选中同一对象的时序更新不反复重置滚动。大连接列表采用分页或有界增量展示，初始目标最多100行；这只限制 DOM 展示，不截断连接查询和导出语义。

检查器主动关闭后，不因每次选中强制展开；上下文栏显示可点击的选择摘要。窄屏抽屉也由用户打开，防止一次点击遮掉图。宽屏保留 Inspector 槽位，无选择时显示简短提示与当前模块摘要，不反复改变画布宽度。

### 5.2 搜索与 Focused

搜索结果保持类别、对象名、模块/实例上下文。长名字有完整名称查看入口；精确对象名匹配的可读性优先，但首版不改搜索排序算法。定位与 Add to Focused 使用分离的按钮，不能把整行点击等同于替换根。

当目标不在当前可定位图中时，按既有策略追加 root，并用状态反馈说明“已加入 Focused”；UI 消费现有定位策略的结果，不重新实现对象判定。无结果时保留输入并显示当前检索范围，不把空结果当成解析失败。

Focused 条带只在相关模式出现：显示模式、root 数量、有限数量的 chips、Fanin/Fanout 深度。超过可见预算的 roots 收到 `All roots (N)` 浮层；完整列表可搜索、定位、逐个移除和清空。最大根数仍为32。增加、替换、删除的可用状态与命令结果同步。

`Zoom to selection` 对当前图对象只定位，图外 cell 保留旧的 Focused 回退行为；`Add to Focused` 追加；`Replace roots` 替换。帮助与教程明确该边界，不借此次改名改变既有命令语义。

Search-first 画布显示索引规模、搜索入口及显式 Whole 操作。提示文案同时覆盖 cell 和 net；不自动布局超大 Whole 图，不引入“看起来像空白”的成功状态。

### 5.3 Compare

进入后立即展示 A/B 模块、Apply、退出、分屏方向和同步入口。A/B 身份稳定，内部 `left/right` key 不改：上下布局显示 `A · Top` / `B · Bottom`，左右布局显示 `A · Left` / `B · Right`。

每侧标题显示完整模块名的查看方式、当前模式和任务状态。点击某侧后，活动侧、Inspector 来源与 roots 来源同时有文字和边框提示。小屏不复制两份检查器；同一 Inspector 通过明确的 A/B 来源展示当前选择。

保留以下现有行为，相关控件标明作用范围：

- Whole 作用于双侧，清除双侧 roots 和 Output cone，再按现有规则请求全图。
- Focused 操作基于活动侧；Sync Focus roots 继续按已有匹配规则联动。
- Fanin/Fanout 深度当前是共享值。UI 标为 `Both views`，不伪造单侧输入。
- Sync pan/zoom 与 Sync Focus roots 独立配置；Output cone 和 depth 保留既有分析语义。
- 首版保留当前默认上下分屏及用户已有选择；不为视觉改版改变默认分析结果。
- 当前 Compare 下 Export SVG 与 Save Golden 都不可用，继续保持并解释。Load Golden 仍可用，但成功校验后退出 Compare 并恢复对应 Single 模块；界面提前说明这一结果。双画布导出/快照属于独立功能，不以移动 File 菜单顺带开放。
- 未匹配差异属于启发式结构比较，不标成“逻辑不等价”；没有匹配对象时明确反馈，不猜匹配。
- 大模块仍独立进入 Search-first，取消某侧不取消另一侧。

配置条不能变成另一条长表单：模块、Apply 与模式常显；次要同步/输出锥细项进入具名菜单，并在关闭后留下当前状态摘要。

### 5.4 Layout、Timing 与编辑作用域

Layout 使用一次滑块加一次数字输入，删除旁边重复 output。滑块拖动首先更新读数预览；昂贵计算在提交时统一触发，精确语义以现有 owning boundary 为准。显示首选 provider 与实际回退 provider 的区别，不把一次回退写成新偏好。

Adjust 开启后始终显示模式状态；浏览、节点移动与表单编辑不会混淆。实例覆盖、Cell Config 类型规则、Liberty 来源分别标注影响范围。现有 Reset layout 实际同时清除位置、尺寸和整个 graphOverrides，包含实例属性、引脚方向与 Net routing 排除；Compare 下双侧一起清除。新文案使用 `Reset view overrides` 并说明范围，不把它描述成只撤销节点移动。已有取消/保存/逐项重置行为与错误处理保留，不新增隐式保存。

Timing 的全局策略和对象 badge 选择分开呈现；在 Inspector 中说明当前指标过滤是否影响已选 badge。无时序时提供 Import timing 入口。宽表固定 pin 列或提供摘要视图，完整 AT/RT/Slack/Delay/Slew/Edge 不因窄屏丢失。

### 5.5 导入、日志与异常

保留批量输入顺序、Golden 指纹验证、未知单元降级、无库可工作、库刷新后重载等现有行为。初始内置示例保留并标明 Sample，避免被误认为已导入的用户设计。

状态栏合并 Ready、当前任务、诊断与日志入口。底部抽屉展开高度限制在 `min(240px, 35vh)` 附近，允许用户调节但保证可关闭；打开日志不创建视图历史。任务详细信息进入日志，用户操作反馈显示可读摘要。

错误在用户处理或后续成功替代前保持可见；提示说明失败阶段及可执行的下一步。主动取消不伪装为错误，不触发布局回退。恢复失败、导入失败和渲染失败沿用既有错误边界，不能用新 toast 吞掉异常。

### 5.6 状态覆盖矩阵

| 状态 | 必须呈现的信息和操作 |
| --- | --- |
| 内置示例 / 无选择 | Sample 标记、文件入口、选择提示；无整屏引导遮挡 |
| 无 Liberty / 无时序 / 未知 cell | 正常工作；可选补充数据入口；未知来源可查看 |
| 无搜索结果 / 长名称 / 多 roots | 明确检索范围、完整名称、有限高度列表 |
| Search-first | 已索引状态、cell/net 搜索入口、显式 Whole |
| 布局中 / 渐进渲染 / 取消 | 阶段、作用域、可用取消、仍有效的结果 |
| 导入错误 / Golden 不匹配 | 可理解的错误及现有有效数据；不得显示为成功 |
| Compare 单侧未就绪或失败 | A/B 独立状态、另一侧继续可用 |
| Adjust / 手工覆盖存在 | 模式、覆盖范围、对应 Reset 入口 |
| 持久化不可用 / 旧会话 | 默认外壳可用；兼容恢复失败有日志，不影响新会话操作 |

## 6. 视觉与可访问性

### 6.1 视觉系统

- 保留浅色、低饱和工程工具方向。画布为浅中性色，工具面板用轻背景区别区域，边框仅用于结构。
- 使用统一 CSS tokens 管理背景、正文、次要文字、边框、强调、选中、危险、间距和控件高度；先收敛在现有 `styles.css`，避免过早引入资源拆分风险。
- 工作台正文13–14px，次要信息12px，关键模块/对象名称不小于13px；代码名使用现有等宽系统字体。标题主要靠字重和空间区分。
- 普通控件32px、紧凑控件28px、图标按钮32×32px；间距以4px为基本单位，常用8/12/16px，圆角4–6px。
- 主操作、次操作、切换状态和危险操作分别定义样式；禁用状态有语义解释，不仅把整个区域变浅。
- 首版只减弱背景网格与工具外壳噪声，保留节点、引脚、导线的几何及文字测量参数。画布文本重新测量、LOD 阈值调整另行规划。
- 选中、Focused root、时序违例、Compare 差异须定义叠加优先级并保留可辨认的线型/线宽信息；不得仅换颜色导致一种状态盖掉另一种。
- 若调整 schematic 色彩或线条样式，同步核对 `svgExport.js` 的独立导出样式；导出结果保持相同语义。不能假设页面 CSS 自动进入 SVG。
- 首版沿用英文工程控件名，统一术语、大小写、动词；中文说明集中在帮助/用户指南。清理同一流程中的随机中英文切换，不建立两套临时翻译表。

### 6.2 键盘、焦点与点击目标

沿用 F、历史导航与现有表单快捷键。新增 `/` 聚焦搜索仅在非输入区有效，Escape 按最上层浮层逐级关闭并把焦点还给触发器。不得接管编辑器、输入框、浏览器原生快捷键或把输入文字当命令。模块树、roots、模式按钮和菜单全部可用键盘操作；帮助入口列出实际支持的快捷键。

普通 UI 文本以4.5:1为对比度目标；图标按钮/小型可点击控件至少24×24 CSS px，常用操作采用上述更大的32px目标。菜单和抽屉不能完全遮住当前键盘焦点，焦点轮廓可见。参考 [W3C 文本对比度说明](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)、[点击目标尺寸说明](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) 和 [焦点不被遮挡说明](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)。这些是本轮验收条目，不代表已完成整个 WCAG 合规认证。

浮层必须具备边界约束、最大高度、内部滚动、外部点击关闭与 Escape 关闭；长列表打开后允许键盘到达最后一项。隐藏面板内的控件不可继续出现在 Tab 顺序中。对话框保留 focus trap 与关闭后的焦点恢复；图表和状态消息不持续打断读屏。

## 7. 工程落点与状态所有权

### 7.1 模块职责

| 层 | 改造职责 |
| --- | --- |
| `index.html` | 工作台区域和稳定挂载点；保留唯一的 input/dialog/command target，迁移时避免重复 ID |
| `styles.css` | 设计 tokens、断点、外壳布局、控件状态；优先不拆资源 |
| `src/ui/` | 新增工作台面板/浮层/Inspector DOM 控制器，复用 viewport、pointerSession、frameScheduler |
| `src/app/` | 既有 inspector、compare、focused、sidebar 等适配器逐项转接窄查询/命令；不扩充全局 legacy port |
| `src/application/` | 继续拥有选择、roots、视图历史、任务和副作用；仅在确有新用例时增量扩展 |
| `src/persistence/` / `src/platform/` | 版本化 UI 偏好编解码与存储适配；不把 DOM 或大图塞入 Session |
| `src/render/` | 首选不改几何与场景构建；如改语义样式，核对 SVG 导出并触发对应回归 |

可采用 `workbench_shell_controller.js`、`inspector_tabs_controller.js`、`popover_controller.js` 等按职责命名的新模块，最终文件划分以实际职责为准，不建立通用 UI 框架。优先复用既有 `disclosure.js`、`workbench_elements.js` 及对象/时序/编辑面板的渲染逻辑。

`main.js` 只组装、注入、接线。当前架构测试的上限是515行，旧说明里的611不能作为新增预算；每次新增组合接线前先迁移完整职责并相应降低上限，禁止压缩代码或提高门限。既有 app 控制器继续遵守520行门限，不能把 main 的逻辑集中转移成另一个大型控制器。

### 7.2 状态与持久化

| 状态 | 所有者与恢复规则 |
| --- | --- |
| 网表、Liberty 附件、分析产物 | 现有 Document/Artifact 边界，UI 不复制 |
| module/occurrence、selection、roots、depth、viewport、override | 现有 ViewSession/commands/bridges，保留历史与存档语义 |
| 面板开关、固定宽度、上次 Inspector 页签 | 独立版本化 UI preferences；不产生图 revision，不进入 Golden |
| 打开的菜单、搜索输入焦点、临时编辑草稿 | 拥有该交互的 controller 临时状态，不长期保存 |
| Compare 活动侧与配置草稿 | 复用既有 Compare 状态边界；显示身份不另建一套 left/right 映射状态 |

UI 偏好读取需类型/范围校验与未知字段容错；旧 `sidebarWidth` 等仅在真实存在对应存档字段时做单向迁移，不凭假设造迁移。布局偏好恢复失败回到断点默认值，不影响网表会话。首次发布不改 Session/Golden 格式；如实现确需新增业务字段，另列 codec 迁移和旧文件兼容测试。

### 7.3 性能约束

- 选择变化只更新 Inspector 与既有选择高亮，不整页重建、不复制完整图、不重复绑定事件。
- 面板 resize 复用 pointerSession 与 frameScheduler；每帧仅轻量 CSS/transform，结束后提交 UI 偏好一次。不得每个 pointermove 存储或运行 provider。
- DOM 中最多保留一个活动 Inspector 内容区，隐藏页签按需更新。连接多时有界呈现，不用全量节点/边列表为显示侧栏做扫描。
- 已有 roots、模式与间距的命令副作用保持单一所有者，避免 UI 事件和旧 controller 同时提交两次。
- 渐进渲染、取消、过期任务隔离、Scene 惰性读取闭包保持不变。外壳切换不得破坏正在挂载的 SVG。

## 8. 分阶段实施

每阶段结束记录实际变更、基线差异、验证结果与未解决问题；只有达到本阶段退出条件才推进依赖阶段。阶段可单独审查和回退，不保留两套长期运行的完整 UI。

| 阶段 | 工作内容 | 退出条件 | 依赖 / 估计 |
| --- | --- | --- | --- |
| U0 基线与布局样稿 | 固定样本、尺寸与流程；记录当前测试失败；做 Single/Focused/Compare 三种静态布局样稿 | 功能清单逐项对应，1366px 空间预算可容纳；明确已有失败 | 无；0.5–1人日 |
| U1 现有界面缺陷修复 | 菜单边界约束、顶部溢出策略、时序表局部滚动、重复数值 | 1440px More 不裁切，侧栏无整体横向滚动；无业务变化 | U0；0.5–1人日 |
| U2 新工作台外壳 | 全局栏/上下文栏/状态栏、可收起 Navigator、独立 Inspector 容器、偏好边界 | 3种桌面尺寸稳定；面板交互0次 provider 调用；main 门禁通过 | U1；2–3人日 |
| U3 Inspector 迁移 | 对象头部、Connections/Timing/Adjust、类型编辑与 Net routing | 选中后关键详情可见；连接追踪、时序、覆盖、恢复均可用 | U2；2–3人日 |
| U4 搜索与聚焦整理 | roots 条带、精确命名、Search-first 提示、搜索次操作、历史提示 | Add/Replace/Zoom 无歧义；0/1/32 roots 与 cell/net/occurrence 行为保持 | U3；2–3人日 |
| U5 Compare 整理 | 顶部配置、A/B 标识、活动侧反馈、输出锥与同步入口 | 无需下滚配置；Whole/共享深度等原语义通过；单侧取消隔离 | U2/U3/U4；2–3人日 |
| U6 附属流程收敛 | File/Liberty/Cell Config、日志与诊断、帮助、失败和空状态 | 迁移清单无遗失；导入失败/Golden mismatch/无库均有正确反馈 | U2；1–2人日 |
| U7 视觉与键盘统一 | tokens、密度、状态层级、网格、焦点和文案，必要时同步 SVG 样式 | 视觉/键盘矩阵通过，无文字测量和图几何漂移 | U3–U6；1–2人日 |
| U8 全链路与离线交付 | 完整回归、浏览器可达性、性能差异、双平台资源、文档收尾 | 第9节清单满足，既有失败和新增差异已分清，发布输入完整 | U7；2–3人日 |

估计合计13–21人日，以一名熟悉仓库的工程师计，不是固定发布日期；为旧控制器耦合、跨平台和状态恢复问题预留约20%缓冲。U3与U6可在窄接口稳定后并行，U5需等待选择与聚焦契约稳定。U1可作为独立修复先交付，U2–U8按完整工作流逐步替换。

## 9. 验证与发布

### 9.1 测试分层

| 变更 | 必须验证 |
| --- | --- |
| 本轮计划文档 | Markdown 相对链接、diff 空白检查；不启动构建/性能测试 |
| 每个运行时实现阶段 | `npm test`、`npm run test:architecture`、受影响的真实浏览器流程；边界逻辑有针对性单测 |
| 外壳/布局偏好 | 断点归一化、存储异常、事件释放、resize每帧合并、无 provider/业务历史副作用 |
| 选择/roots/Compare | 现有 workspace 与 commands 测试，加真实搜索→选择→连接→Focused→历史的流程 |
| 导入/Liberty/日志入口迁移 | 运行受影响的 `npm run test:workbench`、`npm run test:liberty-browser`、`npm run test:process-log`，增加真实可见控件路径 |
| 会话与 Golden 恢复 | 既有旧版 Session/Golden fixtures、指纹不匹配、roots/depth/override/provider 偏好恢复；损坏 UI preferences 不阻断业务会话 |
| 图准备或 renderer/展示策略可能影响综合设计 | `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases`；默认读 `DEFAULT_LAYOUT_PROVIDER_ID` 并报告选中值 |
| 布局/路由行为触及 | 专项、determinism、fixture invariant 及完整门禁；原则上应从本 UI 项目拆出 |
| 复杂度敏感的 DOM/图/渲染路径 | `npm run benchmark` 及已有 interaction/workspace 基准的受影响项，保存同机前后结果 |
| 前端发布输入改变 | `npm run release:windows`；检查 Linux CMake 资源打包及离线启动；保留 ELK license |

不为简单颜色/间距写镜像 CSS 实现的单测；用浏览器边界与实际可达性验证。样式改变也不自动授权跑全图算法优化。

### 9.2 浏览器矩阵与判定

- 主尺寸：1366×768、1440×900、1920×1080；紧凑补充：1024×768、760px宽。检查100%、125%、150%缩放和需要时200%下的控件可达性。
- 主要浏览器：实际 Windows Chrome/Edge 与 Linux Chromium；Python/Node/离线启动器至少各有相关启动冒烟覆盖，不声称全浏览器认证。
- 样本：内置双模块示例、层次与转义长名称、net roots、高扇出、大模块 Search-first、未知 cell、无/有时序、无/有 Liberty、已有 Golden/Session、Compare 一大一小/双大模块。
- 层次检索、父实例消歧、cell/net/port详情、Net routing、实例覆盖与类型配置均需要至少一条可达路径。
- 鼠标点击和键盘操作必须由真实可见控件触发；不可用 `evaluate(button => button.click())` 或强制 click 证明布局可用。现有 workbench e2e 可复用业务断言，但需要补正常点击与遮挡检查。
- 截图基线至少覆盖 Single 无选择/有选择、Focused 多 roots、Compare、Inspector Timing、长层次路径、导入错误、日志展开、Search-first。截图是视觉证据，不能替代状态断言。
- 新增重复事件、未处理异常、失效焦点、不可关闭浮层、隐藏控件继续可聚焦均为阻断问题。
- 同一输入/选项下核对自动布局坐标、路由与诊断；不以新截图期待值替换几何基线。

### 9.3 性能目标与预算

面板开关、页签切换、选择详情更新的 UI 可见反馈目标为100ms以内（固定验收机器、预热后记录至少20次的 p95）；新引入的外壳逻辑不得产生超过50ms的主线程长任务。此为实施目标，U0需记录设备和现状后再评估，不宣称现状已达标。

针对纯 UI 操作，provider 调用次数必须为0；纯面板偏好不应增加图计算 revision。复杂操作另按对应工作区现有语义统计。大图交互采用同一机器、同一 provider、同一输入和相同缩放状态进行前后对照；超过约10%的稳定回退需要解释或修复，噪声不能算作提升。

### 9.4 计算与离线资源

单测、浏览器自动化、mapped、benchmark、Linux 构建优先在 `mfs-remote` 的 `/home/wzh/my_code/netlistGraphBuilder/ui_workbench_redesign_<日期>` 隔离目录执行。依赖、构建、截图与详细日志留在远端；只回传必要小报告。Windows 原生 GUI、系统缩放和 Windows release 属于本机专用验证，执行前记录原因。

当前 Windows 脚本复制 `index.html`、`styles.css` 和 `src/`；Linux CMake 显式收集根 HTML/CSS、`src/**/*.js` 与 ELK。若新增 CSS 文件、图标或字体，必须同步两个打包清单及离线资源测试。首版优先使用系统字体和随源码内联的小型 SVG 图标，避免新增外部资源依赖。

## 10. 风险、回退与完成定义

| 风险 | 控制方式 |
| --- | --- |
| 两条侧栏吞掉小屏画布 | 以1366px作为主要设计约束，默认收起导航；断点策略先于视觉细节 |
| 搬动控件时意外改变业务作用域 | 命令复用；明确 Compare Whole、共享 depth、全图 Timing 与类型/实例配置 |
| 新 Inspector 变成第二条长表单 | 固定对象头部、有限页签、有界连接列表；统计/诊断独立入口 |
| 控件重复绑定或旧 DOM 引用失效 | 单一挂载点、唯一 ID、控制器生命周期与 dispose 测试；按完整流程迁移 |
| UI 偏好污染 Golden 或历史 | 独立 codec/存储；业务状态继续由既有 Session 所有 |
| 样式改变导致测量或导出偏差 | 初期保持 schematic 字体/尺寸；必要样式同步 SVG export 并检查几何 |
| 自动测试通过但控件看不见 | 增加非强制真实点击、键盘、边界矩形和截图证据 |
| 构建漏收新资源 | Windows 与 Linux 清单双检，断网启动和资源失败检查 |
| baseline 早已有失败 | U0保存证据；区分新增回归；不顺带修复被冻结的 Simple |

每阶段使用明确路径的可审查改动；未经额外要求不自动提交或推送。运行时迁移失败时回退该完整阶段，同时恢复对应文档，不通过保留两套分歧的控制器长期维持兼容。新增 UI preferences 可被旧版本忽略，不破坏业务存档。

完成时需同时满足：迁移清单全部有可用入口；核心流程与关键异常状态通过；3种主桌面尺寸无控件裁切；默认桌面选择详情和 Compare 设置首屏可达，关闭检查器时按2.2节一次操作可达；图与 Simple 契约无变化；必要门禁与离线资源验证完成；设计规范、使用指南和本计划的实际状态同步。只完成换色、截图或单个正常案例不算整轮改造完成。

首个实施批次为 U0＋U1；随后交付新外壳和 Inspector，再迁移 Focused/Compare。静态样稿中的尺寸或控件密度可以在 U0根据空间验证调整，业务边界必须保持上述约定。

## 实施记录

- 2026-11-12 U0：原始 HEAD `0446644` 同步到远端 `/home/wzh/my_code/netlistGraphBuilder/ui_workbench_redesign_20261112/baseline`；candidate 独立副本。原始完整单测1061/1061通过，workbench、Liberty browser、Process Log browser基线均通过。复用服务器已有Playwright与Chrome，不增加运行时依赖。
- U1–U6：以第3节布局预算和三种模式的分区为样稿，先迁移现有唯一DOM入口，再组合独立UI shell、Inspector与业务事件；保持既有命令作用域。`.vscode/settings.json` 是用户已有修改，未触及。

### 2026-11-12 最终实施结果

| 阶段 | 实际交付 |
| --- | --- |
| U0 | 保存原始 HEAD 与独立 baseline；按本计划空间预算直接实现 Single / Focused / Compare，使用真实页面截图验证，而非另交一套静态设计稿 |
| U1 | File 等弹层统一边界定位；Timing 表局部横滚；数值控件消除重复展示；修复导航树及紧凑工具栏的内部尺寸溢出 |
| U2 | 全局栏、上下文栏、Navigator、Inspector、状态栏与抽屉落地；UI preferences 独立 codec/存储；main 从515行降至468行，门限降为470 |
| U3 | 固定对象摘要、Connections / Timing / Adjust 页签；完整名称与复制；连接100行/页、关联目标20项/页；同对象页签/滚动保持 |
| U4 | 有界 Roots 菜单、过滤、原生键盘按钮；Add / Replace / Zoom 命名及 Search-first 提示；重绘恢复根按钮焦点 |
| U5 | Compare 配置置顶、永久 A/B 标识、活动侧及来源反馈；保留 Whole/Reset 双侧、共享深度、Single 导出限制；真实 SVG 占用标题下方完整区域 |
| U6 | File、Liberty、Cell Config、Golden、日志、诊断及帮助入口齐全；文件选择完成/取消后才关闭导入菜单，Liberty 管理浮层仍保持展开 |
| U7 | 统一外壳色彩/控件密度/焦点；面板开合及拖宽保持世界中心、像素比例与现有LOD；显式Fit重建尺寸基线，不被延迟补偿覆盖 |
| U8 | 下表自动化门禁、双平台离线构建及截图复核完成；Windows实际Chrome/Edge和系统缩放矩阵保留为未验证项 |

### 最终验证证据

远端目录：`/home/wzh/my_code/netlistGraphBuilder/ui_workbench_redesign_20261112`。
环境：Node24.16.0、Playwright1.64.1、Linux Google Chrome146.0.7680.164；产品 provider 为 `native-layered`（`DEFAULT_LAYOUT_PROVIDER_ID`）。

| 检查 | 结果与证据 |
| --- | --- |
| 完整单测 | 1098/1098；`candidate-unit-final.log`，33.12s |
| 架构 | 268 modules / 636 edges；未解析依赖、越界和循环均0；main468行 |
| UI浏览器专项 | 9/9；1366×768、1440×900、1920×1080、1024×768、760×768；`ui-browser-release-verified/report.json` |
| 默认可用画布 | 1366下1040×656；1440下1114×788；1920双侧停靠后1332×968 |
| Compare真实图 | 左右分割SVG分别516/517×584；上下分割1040×274/275；连续换向与Fit后所有节点完整落在各自SVG内 |
| 键盘与长数据 | 普通/键盘File选择器共30次；Escape逐层关闭；root激活焦点保持；162字符名称与106pin分页；滚动摘要/页签不重叠 |
| Search-first | 520cell输入不自动Whole；搜索后绘制9个局部节点 |
| 原有浏览器回归 | workbench、Liberty、process-log全部通过；`release-*-browser.log`；Process Log保留预期注入异常断言 |
| 纯UI响应 | 面板/页签/选择各20次预热样本，DOM click至第二动画帧p95为33.0/28.8/36.7ms；主线程LongTask0；新增布局调用0 |
| 离线请求 | UI专项pageerror、requestfailed、外部origin请求均0 |
| full-graph mapped | `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases`：47/47，violations0/120，max38078ms，maxHeap686MiB；标准门禁，未宣称hard模式 |
| 工作区对照 | 相同provider的1024/4096cell interaction benchmark前后均完成；单次采样未形成稳定性能结论，不把噪声视为提升 |
| Node/Python启动 | `npm run test:launcher`通过 |
| Linux离线包 | 最终源码CMake构建及CTest6/6；新增模块由src glob嵌入；`native-test-final.log` |
| Windows离线包 | 本机`npm run release:windows -- -SkipTests`通过编译及HTTP启动冒烟；完整单测由远端提供；270个HTML/CSS/JS文件与源码哈希一致，ELK许可一致 |
| 文档与清单 | README、USER_GUIDE、DESIGN_SPEC、ARCHITECTURE已同步；140个HTML ID唯一；diff空白检查通过 |

Windows产物：`dist/NetlistGraphBuilder-v1.3.2-win-x64.zip`，SHA-256：
`98859e84e984e20e9bf111406c7158f5f817566eafaa00cf029db0c921ed39cd`。

必要小报告与最终截图位于本地 ignored `dc_runs/ui_workbench_redesign/`；完整日志、早期失败截图及构建产物保留远端。没有暂存、提交、推送或对外发布。用户已有 `.vscode/settings.json` 修改保持原状。

### 修正记录与验收边界

- 首轮候选1084/1085，唯一失败为旧app-ui源码断言仍要求Hierarchy在topbar和旧More菜单；更新到新的唯一入口契约后全量通过，未删除业务断言。
- 真实浏览器发现并修复：导航grid最小尺寸、紧凑按钮文字外溢、A/B活动类名、Escape同时关两层、resize误改LOD、根重绘失焦、Compare旧absolute标题使SVG误占28px行、Liberty加载后被误关。每项都保留早期证据并以最终候选复验。
- 文件选择器剩余间歇失败来自headless测试临时启用拦截的竞争。测试在页面创建时预启用filechooser监听，仍使用真实click/key事件与原超时；最终30次严格通过。
- 保留图外cell的既有Zoom→Focused回退；教程和Help已说明。首版未调整搜索排序、provider、解析/推断、图布局、路由、schematic字体或全局LOD策略，也未改变Session/Golden格式。
- Windows发布构建属于本机专用能力。人工Chrome复核被Computer Use工具以“无法可靠确认当前URL”为由中止；未改用其它UI手段绕过。真实Windows Chrome/Edge、125%/150%/200%系统或浏览器缩放未核验，1024/760的CSS视口测试不冒充该矩阵。
- 本轮不宣称完整WCAG认证、所有浏览器认证或通用性能提升。深色主题、手机触控、minimap和新增分析能力仍在范围外。

### 2026-11-12 追补：左右面板隐藏入口

- 用户要求左右 UI 可隐藏以扩大画布。保留已有独立开关与偏好边界，将标题的 `×` 明确为带方向箭头的 `Hide`；顶部 Navigator / Inspector 增加面板图标、展开高亮及动态 Show/Hide 无障碍名称，收起后始终可分别恢复。
- 远端完整单测1099/1099，浏览器专项9/9；两侧隐藏后，1366/1440/1920窗口画布分别为1366×656、1440×788、1920×968。新增断言覆盖标题收起、顶部独立恢复、刷新记忆、世界中心/像素比例保持、图几何不变和布局调用不增加。紧凑1024/760回归通过，页面异常/请求失败/外部请求均0。
- 证据为远端 `panel-hiding-unit.log`、`panel-hiding-ui-verified.log`、`ui-panel-hiding-verified/report.json`；首轮新增测试错误使用不存在的 `#workspace`，修正为实际 `.workspace` 后完整复验，原失败记录保留。小报告与复核截图取回本地 `dc_runs/ui_workbench_redesign/panel-hiding/`。
- Windows离线包重新编译及HTTP冒烟通过，并在原地址 `http://127.0.0.1:7724/` 重启预览；本次ZIP SHA-256为 `ba8e52ad7267d1851bca00e61930aeccc574ecc2e7118fd247112a271fa366d5`。此前包哈希作为原批次证据保留。

### 2026-11-12 v1.4.0 发布验收

- 将工作台改造、左右面板隐藏与教程维护合并为`v1.4.0 — UI 工作台改造版`。更新版本号、CHANGELOG、README及教程的版本边界；不再将新界面作为标为v1.3.2的试制包交付。
- 发布范围为52个UI、测试与文档文件；用户VS Code设置和ignored构建输出不入库。采用Git暂存树导出的隔离源码构建双平台程序，运行时不含未暂存内容。
- 发布快照复验：单测1099/1099、UI浏览器9/9、架构268模块/636边零违规、文档相对链接56/56、Linux CTest6/6、Windows启动冒烟及270个运行时文件/随附文档/ELK许可哈希一致。发布验证目录为`/home/wzh/my_code/netlistGraphBuilder/release_v1_4_0_20261112`。
- Windows EXE版本1.4.0.0；Linux x86-64单文件以glibc2.35构建；另附ngb.tcl，各下载附件有SHA-256。前述人工Windows浏览器和缩放矩阵限制继续适用。
- [v1.4.0版本页](https://github.com/11234201/NetlistGraphBuilder/releases/tag/v1.4.0)提供正式附件与校验值；之前的试制包哈希仅作为历史记录。
