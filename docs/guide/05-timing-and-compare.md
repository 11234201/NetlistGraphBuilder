# 5. Timing 时序标注与 Compare 双模块对比

> 返回 [完整使用教程目录](../USER_GUIDE.md) · 上一章：[4. 布局引擎、显示选项、不布线 Net、Adjust 与导出恢复](04-layout-routing-and-adjust.md)

本章详细介绍 NGB Timing Format v1.0 时序报告导入、全局显示策略、层级隔离与漏配诊断，以及 Compare 双模块并排对比的全部功能。

---

## 5.1 Timing 时序格式（NGB Timing Format v1.0）

完整格式规范见 [`docs/design/timing_format_spec.md`](../design/timing_format_spec.md)。系统支持 **列式文本（空格 / Tab / CSV）** 与 **结构化 JSON** 双模输入，覆盖 `pre_map`、`post_map`、`post_layout` 全阶段，支持多文件追加合并（`File → Netlist + Timing → Add timing file(s)…`）。

### 标准列式文本格式（Tabular / CSV）

默认**简单模式**仅需 4 列（`point at rt slack`），支持 `@module`、`@stage`、`@unit`、`@scenario` 指令头、`#` / `//` 注释及 `-` / `NA` / `null` 缺省占位；省略 `slack` 且给出 `at` 与 `rt` 时自动按 `slack = rt - at` 推导：

```text
@module top
@stage post_map
@unit ns

point        at      rt      slack
in_a[0]      0.120   0.100   -0.020
out_sum[0]   0.850   0.800   -0.050
u0/A1        0.728   0.717   -0.011
u0/ZN        0.825   0.814   -0.011
```

**详细模式**：在表头按需追加 `delay`（或 `incr`）、`slew`（或 `trans`）、`edge`（`r`/`f`）、`kind`（`port`/`pin`/`net`）：

```text
@module top
@stage post_layout
@unit ns
point        at      rt      slack    delay   slew    edge   kind
u0/A1        0.728   0.717   -0.011   0.098   0.065   f      pin
u0/ZN        0.825   0.814   -0.011   0.097   0.042   r      pin
```

> **Net 时序归属约定**：当 `point` 指向内部线网（`net`）时，其 `at`、`rt`、`slack` 表示该线网 **Source（驱动源根端）** 的时序，并会自动沿 `assign` 别名链回溯挂载至驱动端口或驱动单元输出引脚；选中导线时可直接查看其 Source 时序。

### 结构化 JSON 格式

适合 EDA 工具程序化导出，支持紧凑数组 `[at, rt, slack]`、详细对象及多模块 `"modules"` 字典：

```json
{
  "version": "1.0",
  "module": "top",
  "stage": "post_layout",
  "unit": "ns",
  "points": {
    "in_a[0]": [0.120, 0.100, -0.020],
    "u0/A1": { "at": 0.728, "rt": 0.717, "slack": -0.011, "delay": 0.098, "slew": 0.065, "edge": "f" }
  }
}
```

---

## 5.2 全局时序显示策略

`Settings → Timing` 提供全局 `Metric` 指标过滤与 `Threshold` 违例阈值（对 Single、Focused、Compare 两侧及 SVG 导出同步生效）：

- **`Metric`**：
  - `Worst Slack`（默认）：展示输出引脚最差 Slack 与输入引脚到达时间（AT）。
  - `AT` / `RT` / `Delay` / `Slew`：整图仅展示单一物理维度，避免文字拥挤。
  - `All`：展示所有基础时序维度。
  - `None`：一键隐藏全图画布时序徽标，使原理图回归纯净拓扑，同时完整保留引脚悬停 Tooltip 与 `Inspector → Timing` 查验能力。
- **`Threshold`（Slack 违例阈值，默认 `0.0`）**：
  - 仅当 `slack < threshold`（严格小于）时判定为关键路径违例并渲染醒目红色（`timing-critical` / `pin-critical`）。
  - 设为正数（如 `0.05`）可提前筛选余量紧张的边缘路径；设为负数（如 `-0.10`）可仅突出严重超标违例。

---

## 5.3 层级隔离、图元排版与漏配诊断

- **端口与 `hinst` 图元排版**：端口图元采用上下双行垂直居中排版（上行名称、下行徽标），避免窄框文字溢出；父模块视图中的子模块实例（`hinst`）支持展示 `kind: "port"` 引脚时序徽标及整线总线引脚的最差位（worst-bit）高亮。
- **跨层级作用域隔离与转义名兼容**：
  - 支持多文件（Global/Local）、`LocalDesign` 顶层包装及显式 `occurrencePath` 下的严格层级时序隔离（多实例化子模块未指定具体 occurrence 时拒绝混合拼合不同实例引脚）。
  - 允许顶层完整路径、中间模块相对路径与本模块短路径为同一实例的不同引脚补充时序；完整兼容 `a_q\[33\]` 方括号转义、未展开多比特总线回退、`\/` 转义斜杠及含 `:` 的转义实例名。
- **`Inspector → Timing` 详情与徽标定制**：
  - 选中已匹配单元后，列出所有引脚的 `AT`、`RT`、`Slack`、最差引脚（`worst pin`）、最差裕量与违例状态；支持逐引脚/指标勾选画布 badge、调整挂载方位（左上/右上/左下/右下），点击 `Default badges` 一键恢复。
  - **缺时序漏配诊断**：若某颗单元未能匹配到时序，面板会展示与该实例相关的候选路径、因作用域或顶层歧义被过滤的记录及解析告警；点击 `Log cell timing details` 可将详情写入底部 `Process Log`（`Timing` 阶段）并导出 JSONL。

---

## 5.4 Compare 双模块对比

### 进入、独立侧文件与退出

1. 加载包含至少两个 `module` 的网表（或通过 `File → Add design file(s)…` 追加合并）。
2. 点击顶部 `Compare` 按钮进入对比模式。
3. 在画布上方的 Compare 配置行中分别指定 `A` 与 `B` 模块，点击 `Apply` 应用草稿组合。
   - 系统自动优先推荐同名前缀且带 `_Flex`、`_orig`、`_new`、`_cpy`、`_cpy_loc`、`_copy`、`_loc` 后缀或来自不同合并文件（`<模块名> [<文件名>]`）的配对模块。
   - **`A files` / `B files`**：支持分别为 A 侧或 B 侧独立加载/粘贴 Verilog 网表与**侧别专属 Timing**（点击 `Clear A/B timing override` 可清除单侧时序覆盖并回退至全局共享时序）。
4. 点击顶部 `Single` 或 `Sync & cone → Return to Single` 返回单图模式（保持各自视口，不强制 Fit）。

A/B 身份始终稳定：A 位于左侧（或上方），B 位于右侧（或下方）；`Inspector` 顶部明确标注 `A · Compare · <module>` 或 `B · Compare · <module>`。

### 分屏方向与视口/点击同步

- **`Split`**：默认 `Left / Right`（左右分屏），可切换为 `Top / Bottom`（上下分屏），切换后自动适配两侧视口。
- **`Sync & cone → Sync pan / zoom`**（默认开启）：在一侧画布缩放或平移时，另一侧同步变换；取消勾选后两侧独立操作。
- **`Sync & cone → Center match on click`**（默认开启）：在一侧单击端口、cell 或 net 时，另一侧自动将当前图中的同名对象居中；关闭后仅高亮对侧同名对象而不移动对侧视口。
- **`Fit view`**：同时将 A/B 两侧画布适配至各自可视窗口。

### 跨侧联动与启发式结构差异高亮

单击一侧对象时，另一侧按端口名、线网名或 cell 实例名查找并高亮对应对象；画布着色综合考虑端口方向与推断的逻辑门类别（`gate kind`）：

- **绿色实线**：两侧建立了基础结构对应关系（规范化名称与方向一致的端口、同名线网，或两侧均存在的门类型）。
- **红色虚线**：仅单侧存在或无法建立对应关系的潜在差异对象。
- **橙色高亮**：当前点击选中的活动对象，与绿/红分类正交叠加。

> **重要说明**：Compare 视图提供的是**启发式结构差异提示**，而非形式化逻辑等价性验证（LEC）——红色虚线不代表功能不等价，绿色实线也不代表逻辑完全等价。

### Compare 下的 Focused roots 与 Output cone

- **独立根与 `Sync Focus roots`（默认开启）**：
  - 开启时，`Add to Focused` / `Replace roots` 若在对侧找到同名匹配单元则自动同步；`Remove selected` 同步移除对侧对应根；`Clear roots` 清空两侧全部根。
  - 关闭后两侧根操作完全独立，但 `Fanin` / `Fanout` 深度始终为两侧共享设置。
  - `Roots` 菜单中的 chips 带 `A:` / `B:` 前缀。上下文栏 `Focused` 以活动侧为起点；`Whole` 清除两侧 roots 与 Output cone 并返回两侧整图；`Layout → Reset view overrides` 同时清除两侧覆盖。
- **同名输出逻辑锥（`Sync & cone → Output cone`）**：
  - 列出 A/B 两侧共有的输出端口，选择后两侧同步提取该输出端口的扇入逻辑锥，并用 `Output depth` 控制层数；选 `Whole module` 返回整图对比。
  - `Output cone` 与 `Focused roots` 互斥切换，避免局部裁剪冲突。
- **对比统计与单侧导出**：
  - `Navigator → Design` 并列展示两侧单元总数、门类型分布、估算逻辑深度、最大扇出、数量差值、未匹配统计及两侧模块注释属性。
  - Compare 模式下可在 `Show Path → Path information → Export SVG` 导出所选 A 侧或 B 侧的独立 SVG（`Save Golden` 仅用于 Single 工作区）。

---

> 下一章：[6. Show Path 路径追踪与逻辑级数](06-show-path.md)
