# 3. 网表浏览、搜索、层次导航、Focused 与重收敛分析

> 返回 [完整使用教程目录](../USER_GUIDE.md) · 上一章：[2. 导入设计、多文件合并、Liberty 库与 Cell Config](02-import-and-libraries.md)

本章介绍网表工作区的模块层次导航、全局搜索、画布交互、Inspector 详情与跨层连接追踪、`Whole` / `Focused` / `Search-first` 视图，以及当前子图的重收敛路径分析。

---

## 3.1 模块选择与层次树导航

### 选择模块与层次树（`Navigator → Hierarchy`）

- 点击顶部 `Navigator` 打开左侧面板，在 `Hierarchy` 页签可按模块名或实例名筛选并点击切换模块（也可通过全局 `Search` 检索模块）。
- 层次树展示从顶层模块向下的实例路径：普通项格式为 `instance : module`，顶层根节点仅显示模块名。当前激活节点高亮，上下文栏与树标题显示 `module @ instance/path`，标明当前所在的实例上下文（Occurrence context）。
- **有界展开保护**：为防止递归例化或超大规模层次耗尽内存，层次树最多展开 **2000 个节点、最大嵌套深度 64 层**；达到上限时显示 `More instances omitted`，遇到递归引用时标记 `cycle`（仅为显示保护，不代表解析出错）。
- 当某子模块被多处例化且仅按模块定义名打开时，系统不会盲目猜测父实例，而是在 `Hierarchy` 中提供显式实例选择器（Occurrence chooser）供用户指定实例路径。

### 双击进入子模块（`hinst` 钻取）

当画布中的子模块实例（Hierarchical instance，简称 `hinst`）引用了当前网表中真实存在的 `module` 定义时，**双击该实例**即可直接钻取进入对应的子模块实例上下文。真实子模块的端口方向严格取自其自身 `module` 端口声明。

### 统一视图历史（View History）

上下文栏的 `←` / `→` 按钮（快捷键 `Ctrl+Z` / `Alt+Left` 后退，`Ctrl+Shift+Z` / `Ctrl+Y` / `Alt+Right` 前进）事务化记录并恢复以下状态：

- 当前模块与层次实例路径（Occurrence breadcrumb）
- 视图模式（`Whole` / `Focused` / `Search-first`）
- `Focused` 根节点集合（roots）与 Fanin / Fanout 深度
- 当前选中对象（Selection）与视口缩放平移（Pan / Zoom）
- 已提交的手工校准（Overrides），以及 Compare 两侧各自的选中项、Focused roots、视口与 Output cone 状态

后退后执行新的视图操作会自动裁剪原有前向分支；导入新设计时清空旧历史栈。焦点在文本输入框内时不拦截浏览器原生撤销。

---

## 3.2 顶部全局搜索

顶部搜索框支持跨模块检索五类网表对象：`Module`、`Port`、`Net`、`Cell instance`、`Cell type`。每条结果标注类别、名称与所属模块。

**键盘操作**：非编辑状态下按 `/` 聚焦搜索，`ArrowUp` / `ArrowDown` 移动候选，`Enter` 激活，`Esc` 收起，点击右侧 `×` 清空。

**激活与聚焦行为**：

- **点击结果主体或按 `Enter`**：
  - 若目标对象**已在当前画布中绘制**，仅选中并将其居中定位，**不修改**现有 Focused roots。
  - 若目标单元**未在当前画布中绘制**（例如处于 `Search-first` 空画布或当前 `Focused` 范围外），自动进入 `Focused` 视图并将该对象**追加**到现有 Focused roots 集合。
- **点击结果右侧 `Add…`**：
  - `Add to Focused`：无论是否已绘制，均显式追加至 Focused roots（已存在则不重复添加）。
  - `Add as start` / `Add as end`：直接将其加入 `Show Path` 起点或终点（见 [6. Show Path 路径追踪与逻辑级数](06-show-path.md)）。
- **跨模块结果隔离**：激活其他模块的搜索结果时，先切换至目标模块工作区，原模块的 Focused roots、选中状态与手工微调不会串入目标模块；若目标模块此前已访问过，自动恢复其自身状态。

---

## 3.3 画布交互与居中放大

- **滚轮缩放**：以鼠标指针为中心缩放画布。系统根据画布实际宽高动态提升超宽/超高图的最大放大倍率上限（保证典型 `220px` 宽度的单元可放大至约 `440px`）。
- **拖拽平移**：在空白区域按住鼠标左键拖动；平移距离严格按 SVG 实际等比例换算。**拖拽平移不会取消当前已选中导线或单元的高亮**，方便沿长线网拖动追踪；单击空白处才清除选中。
- **低倍率细节隐藏（LOD）**：缩放倍率低于 `0.65` 时，自动暂时隐藏引脚名、线网标签、单元元信息与时序文字以保证帧率，放大后立即恢复。
- **`Fit view`**：将当前 Single 图或 Compare A/B 两侧图完整适配至可视窗口中央。
- **`Zoom to selection`（快捷键 `F`）**：
  - 对象已在当前画布绘制时，将其居中放大至稳定阅读尺寸（单元约 `320px` 视觉宽度），不改动 roots；线网定位至可见连接路径。
  - 单元不在当前局部图时，先以它建立 `Focused` 局部图再居中定位。
  - Compare 模式下同样支持定位可见端口（开启 `Center match on click` 时两侧同步居中匹配端口）。

---

## 3.4 Inspector 五页签与跨层连接追踪

单击画布中的 Cell、Port 或 Wire 后，右侧 Inspector 显示对象摘要（含完整名称、复制按钮与 Single / A / B 来源），并通过五个页签分层展示信息：

1. **`Connections`**：
   - **Cell**：列出各引脚方向、连接的线网及相邻驱动/负载端点。
   - **Port**：列出端口方向、内部连接线网及相邻单元。
   - **Net**：列出驱动源（driver）、所有负载（loads）、路径端点及 `Net routing` 布线开关（详见 [4.4 指定 Net 不布线](04-layout-routing-and-adjust.md#44-指定-net-不布线)）。
2. **`Attributes`**：展示 Verilog 结构化注释属性（`Instance attributes` / `Port attributes` / `Net attributes`，折叠 `assign` 别名链时自动合并别名属性）；选中 `hinst` 时并列展示所引用模块的 `Module attributes`；在 `Definition & inference` 列出单元类型、推断的 `gate kind`、`inference source` 及 Liberty 原始布尔 `function`。
3. **`Analysis`**：通过 `Traversal` 表格列出直接扇入/扇出目标、传递可达节点数与最大深度；对象参与当前可见子图的重收敛路径时展示 `Related reconvergence`。
4. **`Timing`**：展示对象引脚时序、徽标方位定制与缺时序漏配诊断（详见 [5. Timing 时序标注与 Compare 双模块对比](05-timing-and-compare.md)）。
5. **`Adjust`**：在开启 `Adjust` 模式时编辑单实例尺寸、显示属性与引脚方向覆盖（详见 [4.5 Adjust 手工校准](04-layout-routing-and-adjust.md#45-adjust-手工校准)）。

**长表分页与连续追踪**：

- 滚动详情时对象摘要与页签固定可见；连接/层次表超过 `100` 行、关联目标超过 `20` 项时分页显示，不减少模型数据。
- 所有可点击的 `Net`、`Driver/Load`、`Connected`、`Fanin`、`Fanout` 条目均支持**点击连续追踪**：目标已绘制则直接选中居中；目标在局部图外时自动扩展或建立 `Focused` 视图，不退回耗时的 `Whole` 整图。

### 本层连接与跨父层连接（Current module vs. Parent occurrence）

`Inspector → Connections` 将连接严格区分为两个区域：

1. **`Connections / Current module`**：仅展示当前模块定义内的引脚、线网、驱动与负载。欲进入子模块内部，直接双击该 `hinst`。
2. **`Hierarchy / Parent occurrence`**：带强调底色与 `Parent` 徽标，**仅当选中对象连接到当前模块边界端口，且当前模块处于明确的父层实例上下文（经由 `Hierarchy` 树或双击 `hinst` 进入）时显示**：
   - 顶层模块无父实例，不显示此区。
   - 点击带 `Parent` 标记的父层线网或单元时，系统自动切换回父层实例上下文，清空原层级 Focused roots，并以该父层对象建立新的 `Focused` 视图。

---

## 3.5 Whole、Focused 与大图 Search-first 视图

### Whole（整图视图）

渲染当前模块的全部端口、单元与线网。中小型模块（`≤ 500` 单元）默认打开 `Whole`；大型模块可在需要宏观浏览时显式点击上下文栏 `Whole`。

### Focused（多根节点双向局部聚焦视图）

以一个或多个选定对象（**Cell 或 Net，最多 32 个 roots**）为起点向前后扩展局部原理图：

- **`Fanin` / `Fanout` 深度**：取值 `0–99`；设为 `0` 即关闭该方向扩展（如 `Fanout = 0` 即纯扇入逻辑锥）。
- **`Focused output` 延续标记**：在 `AnchorLayered` 与 `ELK` 布局中，即使 `Fanout = 0`，若可见线网仍连接视图外负载，会在边界显示延续标记提示信号继续扇出（不展开外部单元；`Simple` 保留冻结行为）。
- **多根合并与预算**：多个 roots 的邻域自动合并去重；达到 32 个上限时拒绝继续追加并提示，不静默丢弃已有根。高扇出线网作为根时内置有界节点预算，确保直接连通路径完整保留且不撑爆局部图。

**管理 Focused roots**：

- Inspector 的 `Replace roots`：用当前选中的 Cell 或 Net **替换**全部已有根。
- Inspector 的 `Add to Focused`：保留已有根并**追加**当前选中对象。
- 画布上方 `Roots` 菜单：展示全部 root chips 并支持输入筛选；点击 chip 激活并居中对应根（不重新布局），点击 chip 右侧 `×` 或 `Remove selected` 移除单个根，`Clear roots` 清空全部根（大模块回 `Search-first`，中小模块回 `Whole`）。增删激活期间保持 `Fanin` / `Fanout` 深度不变。

### 大图 Search-first 工作流（> 500 单元）

打开超过 500 个单元的大型模块时，默认进入 `Search-first`：后台已完成解析、图提取与搜索索引构建，暂不执行全图几何布局与海量 DOM 渲染。

**推荐五步法**：

1. 在顶部搜索框输入目标实例、线网、端口或单元类型。
2. 点击或按 `Enter` 激活结果，瞬间生成围绕该对象的 `Focused` 局部图。
3. 在画布上方调节 `Fanin` / `Fanout` 增减上下文层数。
4. 在 `Inspector → Connections` 点击上下游驱动、负载或跨层连接逐步追踪。
5. 仅在需要审视宏观轮廓时，再显式点击 `Whole`。

---

## 3.6 分析当前子图的重收敛路径

打开 **`Navigator → Analysis`**，即可分析当前可见逻辑（Whole 或 Focused 范围）中的组合重收敛结构：

- **结果列表**：顶部显示模块、范围、可见节点数与结果数。每一行对应一个分叉点（多输出单元带输出引脚名）和一个汇合门——表示同一信号分叉后经两条内部单元互不重合的路径到达该汇合门。
- **详情与着色**：点击一行打开 `Inspector → Analysis`，列出两条见证路径、各自的门级数与连接数：
  - 路径 1 为**蓝色**，路径 2 为**橙色**，共用端点或线段为**紫色**。
  - `Connections between endpoints` 展开两点间可证明的连接并集；标有 `not routed` 的隐藏线网仍参与逻辑分析，其导线保持原隐藏设置。
  - 点击 `Locate` 将视口定位到两条见证路径；选中画布路径成员后，可在 `Inspector → Analysis` 的 `Related reconvergence` 快速打开关联结果。
- **范围与边界语义**：
  - `Focused` 裁掉一条支路后，对应结果自动移除；平移、缩放和移动单元保留已完成分析。
  - Compare 模式下可通过 `Side A` / `Side B` 分别切换分析两侧当前可见逻辑。
  - 寄存器、黑盒与未展开子模块在输入处终止组合路径，其输出可作为新路径起点。
- **部分结果与控制**：`Partial results` 表示因组合环、多驱动、引脚方向歧义或分析预算耗尽而保留了已证明结果。可用 `Cancel` 取消正在运行的分析、`Run again` 重算、`Retry detail` 单独重试详情，并在底部 `Log` 中查看模块、侧别、范围与错误详情。

---

> 下一章：[4. 布局引擎、显示选项、不布线 Net、Adjust 与导出恢复](04-layout-routing-and-adjust.md)
