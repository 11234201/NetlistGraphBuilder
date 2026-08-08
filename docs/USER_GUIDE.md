# Netlist Graph Builder 完整使用教程

本教程面向使用 Netlist Graph Builder 阅读、追踪和对比门级 structural Verilog 的工程师。内容覆盖当前版本的全部用户功能，包括数据导入、搜索、大图局部浏览、时序、Cell Config、布局调整、双 module 对比、过程日志、导出和 EDA 集成。

## 目录

1. [软件定位与运行方式](#1-软件定位与运行方式)
2. [界面总览](#2-界面总览)
3. [导入网表、时序和配置](#3-导入网表时序和配置)
4. [Module 与层次导航](#4-module-与层次导航)
5. [顶部搜索](#5-顶部搜索)
6. [画布、选择和连接追踪](#6-画布选择和连接追踪)
7. [Whole 和 Focused 视图](#7-whole-和-focused-视图)
8. [大图 Search-first 工作流](#8-大图-search-first-工作流)
9. [布局、间距和大图简化](#9-布局间距和大图简化)
10. [Adjust 手工校准](#10-adjust-手工校准)
11. [Timing 导入与显示](#11-timing-导入与显示)
12. [Cell Config](#12-cell-config)
13. [Compare 双 module 对比](#13-compare-双-module-对比)
14. [SVG、Golden 和状态恢复](#14-svg-golden-和状态恢复)
15. [Process Log](#15-process-log)
16. [快捷键](#16-快捷键)
17. [EDA/脚本启动接口](#17-eda脚本启动接口)
18. [推荐工作流](#18-推荐工作流)
19. [常见问题与限制](#19-常见问题与限制)

## 1. 软件定位与运行方式

Netlist Graph Builder 是离线 structural Verilog schematic browser。它不依赖 Liberty `.lib`，会依据 cell type 和 pin 名称推断常见门类型与输入输出方向，并用交互式 SVG 展示连接关系。

它适合以下任务：

- 快速确认综合后网表的 cell、net、port 和层次结构。
- 从某个 cell 或 output 向前、向后追踪有限深度的逻辑。
- 查看 Global/Local 或 LocResyn 时序标注。
- 对比两个结构相近的 module。
- 为工具无法自动识别的标准单元补充可复用定义。
- 从 EDA 脚本直接打开指定网表、module 和 instance。

它不是完整的 Verilog/SystemVerilog 编译器，也不提供形式等价验证。

### 1.1 Windows 离线版

1. 完整解压 `NetlistGraphBuilder-v<version>-win-x64.zip`。
2. 双击 `NetlistGraphBuilder.exe`。
3. 启动窗口会在本机 `127.0.0.1` 启动服务并打开浏览器。
4. 使用期间不要关闭启动窗口；需要退出时按 `Ctrl+C` 或关闭窗口。

不要只复制 exe。`NetlistGraphBuilder.exe` 需要同目录中的 `app` 文件夹。发布包还包含示例、README、CHANGELOG、本教程和 ELKJS 许可证。

### 1.2 Node.js 开发启动

需要 Node.js 18 或更高版本：

```powershell
npm start
```

默认地址为 `http://127.0.0.1:4173/`。指定端口或禁止自动打开浏览器：

```powershell
node tools/serve.mjs --port 4210 --no-open
```

### 1.3 Python 3 启动

不方便使用 Node.js 的 Linux 环境可使用无第三方依赖的 Python 服务：

```bash
python3 -u tools/serve.py
```

Node、Python 和 Windows 启动器使用相同的业务参数，详见 [EDA/脚本启动接口](#17-eda脚本启动接口)。

## 2. 界面总览

界面由四个区域组成：

- **顶部工具栏**：Import、Module、前进/后退、Search、Compare、Fit 和 More。
- **左侧面板**：视图模式、布局、Timing、Cell Config、Compare 设置、设计统计、Selection 和 Diagnostics。
- **中央画布**：当前 schematic 或左右/上下 Compare 画布。
- **底部区域**：可折叠 Process Log 和最新状态信息。

顶部 Import 与 More 是弹出菜单。再次点击菜单标题、点击菜单外空白处或按 `Esc` 都会关闭菜单。

左侧与画布之间的竖向分隔条可以拖动。键盘聚焦分隔条后，按左右方向键每次调整 16px。

## 3. 导入网表、时序和配置

### 3.1 Import 菜单

顶部 `Import` 提供四个入口：

- `Open netlist`：选择 `.v`、`.sv` 或文本格式的 structural Verilog。
- `Paste netlist`：粘贴一段 structural Verilog，点击 `Draw`；`Ctrl+Enter` 可直接提交。
- `Open timing`：选择 `.log` 或 `.txt` 时序文件。
- `Paste timing`：明确按 Timing 解析粘贴内容，避免短文本被误判为 Verilog。

导入新网表成功后会替换当前 design，并重建 module、搜索索引、诊断和视图状态。解析失败时保留原来已加载成功的 design。

### 3.2 拖放与全局粘贴

也可以把文件拖到页面任意位置，或在焦点不处于输入框时直接按 `Ctrl+V`。程序会识别：

- Structural Verilog。
- Timing 文本。
- Layout Golden JSON。

一次拖入多个文件时，程序会先加载网表，再应用与之配套的 Timing 或 Golden。Cell Config 使用左侧 `Cell Config > Import` 的专用入口，或通过启动参数加载。

### 3.3 支持的 Verilog 范围

当前重点支持综合后 structural Verilog：

- `module` / `endmodule`。
- ANSI 和非 ANSI port 声明。
- `input`、`output`、`inout`、`wire`。
- Packed range 和位选择，例如 `[31:0]`、`bus[7]`、`[0:0]`。
- `assign` alias。
- Named-pin cell instance。
- Escaped identifier 和层次名称。

行为级 `always`、复杂表达式、宏展开、完整参数化 elaboration 等不属于当前支持范围。建议输入已经综合、映射后的门级网表。

## 4. Module 与层次导航

### 4.1 Module 下拉框

顶部 `Module` 列出 design 中的全部 module。选择新 module 后会显示其结构；超过大图阈值的 module 会进入 Search-first，而不会立即布局整张图。

### 4.2 进入子 module

当某个 cell instance 引用了当前 design 中真实存在的 module definition 时，双击该实例会进入对应子 module。真实子 module 的 port direction 来自其定义，不会被 Cell Config 覆盖。

### 4.3 前进和后退

顶部 `←`、`→` 保存并恢复：

- Module。
- Whole/Focused/Fanin/Fanout 模式。
- Cone root 和深度。
- 当前 selection。
- Pan/zoom viewport。

快捷键为 `Alt+Left` 和 `Alt+Right`。从历史中后退后再打开新 module，会清除原 forward 分支。加载新 design 会重置旧历史。

## 5. 顶部搜索

搜索是大图的主要入口。输入框可查找：

- Module。
- Port。
- Net。
- Cell instance。
- Cell type。

每条结果显示对象类型、名称和所在 module。跨 module 结果被激活时会先切换 module。

键盘操作：

- `ArrowDown` / `ArrowUp`：切换当前结果。
- `Enter`：打开当前结果。
- `Esc`：收起结果列表。
- 输入框右侧 `×`：清除搜索。

激活 cell 结果后，程序会建立以该 cell 为中心的 Focused neighborhood，并把 cell 居中放大。激活 net 或 port 时会进入对象所在视图并显示连接信息。

## 6. 画布、选择和连接追踪

### 6.1 缩放、平移和 Fit

- 滚轮：以鼠标位置为中心缩放。
- 在画布空白处按住左键拖动：平移。
- 顶部 `Fit`：把当前 Single 图或 Compare 两侧图适配到可视区域。

超宽图会自动允许更高放大倍率。低缩放时，为保持性能和轮廓可读性，pin、net label、cell metadata 和 Timing 文本可能暂时隐藏；放大后会恢复。

### 6.2 选择对象

单击 cell、port 或 wire 后，左侧 `Selection` 显示详情：

- Cell：类型、gate kind、推断来源、pin direction、连接 net、相邻端点和 fanin/fanout。
- Port：方向、连接 net 和相邻对象。
- Net：driver、loads 和路径端点。

Selection 中以按钮显示的 net、driver/load、Connected、Fanin 和 Fanout 都可以继续点击追踪。如果目标不在当前局部图，程序会建立合适的局部视图；必要时会打开 Whole 以揭示目标。

单击空白处会清除选择。平移画布不会取消已选 wire 的高亮。

### 6.3 定位所选 cell

选中 cell 后，点击 View 区的 `Focus selected cell`，或在非输入框状态按 `F`：

- 如果 cell 已经可见，只调整 viewport。
- 如果 cell 不在当前局部图，先建立 Focused neighborhood，再定位。
- 目标 cell 会以稳定的阅读尺寸居中显示。

### 6.4 切换 Focused root

在 Whole 或当前 Focused 局部图中选中另一个 cell 后，点击 `Set selected as Focused`：

- 所选 cell 会成为新的 Focused root。
- 当前 fanin/fanout depth 会继续使用。
- 局部图重建完成后，新 root 会保持选中并居中放大。

当所选 cell 已经是当前 root 时按钮禁用。`Focus selected cell` 只调整 viewport，`Set selected as Focused` 才会改变局部图的 root。

## 7. Whole 和 Focused 视图

### 7.1 Whole

显示整个 module。小型 module 适合直接使用；大型 module 会产生更多布局和渲染工作，因此需要用户显式点击 Whole。

### 7.2 Focused

Focused 是以所选 cell 为 root 的双向局部图：

- `Fanin depth`：向输入/driver 方向扩展的层数。
- `Fanout depth`：向输出/load 方向扩展的层数。
- 深度 `0`：关闭对应方向。

两侧结果会合并并去重。修改一个深度只扩展对应方向。

Focused 同时覆盖 fanin 与 fanout，因此界面不再提供重复的单向模式。需要只看一个方向时，把另一个方向的深度设为 `0` 即可。

## 8. 大图 Search-first 工作流

Cell 数超过 500 的 module 默认进入 Search-first：

- 程序仍会构建完整、可搜索的 graph 数据。
- 不对完整 graph 执行布局和 SVG 渲染。
- 画布显示已索引节点数量和操作提示。

推荐步骤：

1. 在顶部搜索目标 instance、net 或 cell type。
2. 激活某个 cell 结果。
3. 用 `Fanin depth` 和 `Fanout depth` 控制上下文。
4. 在 Selection 中继续沿连接跳转。
5. 只有需要全局轮廓时才显式点击 `Whole`。

在大图中保存 Cell Config 时，程序保留当前 cell 的 Focused 视图并只重新布局局部图，避免整图刷新卡死。

## 9. 布局、间距和大图简化

### 9.1 Layout Provider

左侧 `Layout` 可选择：

- `Simple Layered`：默认、确定性、离线的项目布局器。
- `ELK Layered (Experimental)`：vendored ELK 布局，适合尝试不同的大图初始排布；失败时回退 Simple。

切换 provider 会重新布局当前视图。

### 9.2 Wire spacing 与 Cell spacing

- `Wire spacing`：调整平行 net 的 lane pitch。
- `Cell spacing`：调整同层 cell 间距和拥塞通道留白。

两个设置彼此独立，修改后立即重排当前图。大图中建议先使用局部视图，再调整间距。

### 9.3 Show aliases

默认会规范化 `assign` alias 链，减少中间节点。开启 `Show aliases` 后可查看显式 assign/alias 结构。实例化的 buffer cell 不会被当作 assign alias 删除。

### 9.4 Fanout hubs

开启后，高 fanout net 会使用共享 hub 表示，减少重复长线。关闭后显示原始分支连接。

### 9.5 Collapse large groups

大图可以把结构分组折叠成紫色虚线组：

- 单击折叠组：展开该组。
- `Collapse all groups`：重新折叠所有已展开组。
- 关闭 `Collapse large groups`：显示所有节点。

## 10. Adjust 手工校准

点击 Layout 区的 `Adjust layout` 进入校准模式。再次点击退出。

### 10.1 移动节点

在 Adjust 模式中拖动 cell 或 port。拖动时只更新轻量预览，释放鼠标后提交受影响 wire 的正交重布线。

### 10.2 修改 Size

选中节点后，Selection 会显示：

- Width：24–420。
- Height：12–260。
- `Reset size`：恢复自动尺寸。

### 10.3 修改显示属性

Properties 可调整当前 instance 的：

- `label`。
- `title`。
- `subtitle`。
- `gateKind`。
- `inferenceSource`。

`Reset properties` 恢复自动 graph 数据。这些是当前 instance 的显示 override，不等同于按 cell type 复用的 Cell Config。

### 10.4 修改单个 instance 的 pin direction

Pin directions 可把当前 cell 的 pin 临时设为 `input` 或 `output`。保存 Cell Config 前，如只想修复一个 instance，可使用该功能；如需让所有同类型 cell 复用，请使用 Cell Config。

`Reset pin directions` 清除当前 instance 的临时设置。

### 10.5 重置与保存

- `More > Reset layout`：清除当前手工布局 override。
- `More > Save Golden`：保存可复用的布局和显式 override。

## 11. Timing 导入与显示

### 11.1 支持的旧 LocResyn 格式

```text
inst <top/u0> pin <A>, at 1.0, rat 0.1, slack -0.2
```

`rat` 会规范化为内部 `rt`。

### 11.2 Global/Local 边界表格

可以使用带 Module、Apply 和 snapshot 分段的格式：

```text
Module: top
Apply: None
direction at rat slack object
[Global]
INPUT 0.10 0.20 -0.10 top/a
OUTPUT 0.40 0.30 -0.10 top/y
[Local]
INPUT 0.08 0.18 -0.10 top/a
OUTPUT 0.35 0.29 -0.06 top/y
```

也支持 scope 与 snapshot 写在表头相邻位置的格式：

```text
direction at rat slack [Global]ConeKernel_co_l_resyn2_u_gen_13823_000018_gen_14909
-------------------------------------------------------------------
0.311245 -0.017425 -0.328670 ModuleFull/ConeKernel_co_l_resyn2_u_gen_13823_000018_gen_14909/w_gen_14670
```

表头由列名驱动。以后在 `slack` 后增加 `slew` 等新列时，额外数值会保存在扩展 metrics 中，并可在对象详情或渲染中正确展示：

```text
direction at rat slack slew [Global]top
0.31 -0.01 -0.32 0.044 top/a
```

请保留表头、数据行之间的换行。横线分隔行可有可无。

### 11.3 全图 Timing 策略

左侧 `Timing` 有两个全图设置：

- Snapshot：`Auto`、`Global`、`Local`。
- Metric：`Slack`、`AT`、`RT`、`All`。

`Auto` 根据可用 snapshot 和 Apply 信息选择；无法识别的 Apply 值会保留并写入诊断，不会擅自猜测为 Local。

设置会统一应用到 Single、Compare 和 SVG 导出。匹配到时序的 cell/port 会显示 badge；负 slack 等关键值会获得 critical 样式。

### 11.4 单个对象 Timing 详情

选择带时序的 cell 后，Selection 会显示全部 pin 的 AT、RT、Slack、worst pin 和 worst slack。可以：

- 勾选某个 pin/metric 是否显示为 badge。
- 选择 badge 位于左上、右上、左下或右下。
- 点击 `Default badges` 恢复默认策略。

## 12. Cell Config

Cell Config 用于按 **cell type** 保存 gate kind 和 pin direction。它适合没有 Liberty 时无法识别、或内置规则不完整的 primitive cell。

### 12.1 创建或修改定义

1. 选择一个 primitive cell。
2. 点击 `Cell Config > Edit selected type`。
3. 编辑 Gate kind 和各 pin direction。
4. 点击 `Save`。

编辑器会从内置规则预填当前 gate kind 和 pin direction，而不是用 BLACKBOX/unknown 覆盖已有推断。因此只修改一项时，其他项会保留合理默认值。

支持的 Gate kind：

`AND`、`OR`、`MUX`、`INV`、`NAND`、`NOR`、`XOR`、`XNOR`、`BUF`、`REGISTER`、`BLACKBOX`。

支持的 pin direction：

`input`、`output`、`inout`、`unknown`。

保存后当前 design 中所有同类型 primitive instance 都会重新推断，来源显示为 `user-config`。真实 submodule definition 不会被替换。

### 12.2 删除和重置

- `Delete saved`：只删除当前 cell type 的保存定义，恢复内置规则。
- `Reset all`：删除浏览器本地保存的全部 Cell Config。

### 12.3 本地持久化

Cell Config 保存在浏览器本地存储中。刷新页面或加载其他网表后，同一浏览器环境仍会自动应用。

### 12.4 导入和导出

- `Export`：下载确定性排序的 `netlist-cell-config.json`。
- `Import`：载入 version 1 JSON；发生同名冲突时会要求确认替换。

基本结构：

```json
{
  "kind": "netlist-cell-config",
  "version": 1,
  "cells": {
    "MY_NAND2": {
      "displayName": "MY_NAND2",
      "gateKind": "NAND",
      "pins": {
        "A": "input",
        "B": "input",
        "ZN": "output"
      }
    }
  }
}
```

非法 schema、gate kind 或 direction 会被拒绝，已加载的有效配置不会被破坏。

## 13. Compare 双 module 对比

### 13.1 进入和退出

1. 加载至少包含两个 module 的 design。
2. 点击顶部 `Compare`。
3. 在 `Module Compare` 中选择 Left 和 Right。
4. 点击 `Apply`。

程序优先推荐带 `_Flex`、`_orig`、`_new` 等常见后缀的配对。Compare 激活后，顶部按钮显示 `Single`；点击它或面板中的 `Single` 返回单图。

### 13.2 视图布局与同步

- Layout：`Top / Bottom` 或 `Left / Right`。
- `Sync pan / zoom`：开启时一侧平移/缩放会同步另一侧；关闭后各自独立。
- 顶部 `Fit`：同时适配两侧。

### 13.3 选择和高亮

点击一侧 port、net 或 cell 时，程序尝试在另一侧高亮对应对象：

- Port：规范化名称相同且方向一致。
- Net：名称相同。
- Cell：当前按 gate kind 建立启发式对应。

绿色表示可建立基础结构对应，红色虚线表示 unmatched 或只有一侧存在。橙色表示当前选择。绿色不代表逻辑等价，红色也不代表电路一定不等价。

### 13.4 Output cone

`Output cone` 列出两侧共有的 output。选择某项后，同时显示两侧对应 output 的 fanin cone；选择 `Whole module` 返回整图。

Design 统计会显示 cell count、gate kind count、logic depth 粗估、max fanout、差值和 unmatched 数量。

## 14. SVG、Golden 和状态恢复

### 14.1 Export SVG

`More > Export SVG` 导出当前 Single 视图的 schematic SVG。导出包含完成后的 wire、label、badge 和样式，不依赖在线资源。Compare 模式用于交互对比；如需分别导出两侧，请返回 Single 后选择对应 module 再导出。

### 14.2 Layout Golden

- `More > Save Golden`：保存当前 module、视图、节点位置/尺寸和 route override。
- `More > Load Golden`：载入 JSON。应先加载与 Golden 对应的网表。
- `More > Reset layout`：清除手工 override 并恢复自动布局。

Golden 与 Cell Config 是不同格式：Golden 保存布局与显示 override；Cell Config 保存可复用的 cell type 语义。

### 14.3 浏览器会话恢复

同一标签页刷新后会恢复：

- 当前网表文本和 module。
- View mode、depth 和 search。
- Layout provider、间距和简化选项。
- Selection、pan/zoom 和部分 workspace 状态。

网表会话主要使用 `sessionStorage`，关闭标签页后由浏览器清理；Cell Config 使用更持久的本地存储。

## 15. Process Log

点击底部 `Process Log` 展开，再次点击即可收起。日志记录：

- Import。
- Parse。
- Timing。
- Graph。
- Layout。
- Render。
- Navigation。
- Export。
- Launcher。

控件说明：

- `Level`：过滤 Debug、Info、Warning、Error。
- `Phase`：过滤处理阶段。
- `Auto-scroll`：是否跟随最新日志。
- `Copy`：复制当前过滤结果。
- `Export`：导出日志文件。
- `Clear`：清空当前内存日志。

日志使用固定容量缓冲区，高频渲染进度会合并。默认不记录完整网表、完整时序或 Cell Config 原文。

遇到解析、匹配、布局或启动问题时，先查看状态栏，再打开 Process Log 并按 `Error` 或对应 Phase 过滤。

## 16. 快捷键

| 快捷键 | 作用 | 条件 |
| --- | --- | --- |
| `Ctrl+Enter` / `Cmd+Enter` | 提交 Paste netlist/timing | 文本导入对话框中 |
| `Alt+Left` | Module 历史后退 | 非文本输入状态 |
| `Alt+Right` | Module 历史前进 | 非文本输入状态 |
| `F` | 定位并放大所选 cell | 非文本输入状态 |
| `ArrowUp` / `ArrowDown` | 切换搜索结果 | 搜索框中 |
| `Enter` | 打开搜索结果 | 搜索框中 |
| `Esc` | 收起搜索结果或顶部菜单 | 对应控件打开时 |
| `Ctrl+V` / `Cmd+V` | 自动识别并加载剪贴板内容 | 焦点不在可编辑控件中 |
| `ArrowLeft` / `ArrowRight` | 调整侧栏宽度 | 侧栏分隔条获得焦点时 |

## 17. EDA/脚本启动接口

### 17.1 完整示例

```powershell
node tools/serve.mjs `
  --netlist "C:\EDA jobs\design one.v" `
  --timing "C:\EDA jobs\timing one.txt" `
  --cell-config "C:\EDA jobs\cells.json" `
  --module top `
  --focus u0 `
  --fanin-depth 1 `
  --fanout-depth 2 `
  --no-open
```

Python 将命令头换为：

```bash
python3 -u tools/serve.py
```

Windows 发布包使用：

```powershell
NetlistGraphBuilder.exe --netlist design.v --module top --focus u0
```

### 17.2 参数

| 参数 | 说明 |
| --- | --- |
| `--netlist <path>` | 启动时加载网表 |
| `--timing <path>` | 启动时加载时序 |
| `--cell-config <path>` | 启动时加载 version 1 Cell Config |
| `--module <name>` | 初始 module |
| `--focus <instance>` | 初始聚焦 instance |
| `--fanin-depth <0-99>` | 初始 Focused fanin 深度 |
| `--fanout-depth <0-99>` | 初始 Focused fanout 深度 |
| `--port <1-65535>` | 本地监听端口 |
| `--no-open` | 不自动打开浏览器 |
| `--no-browser` | `--no-open` 的兼容别名 |

路径包含空格时必须加引号。服务始终只监听 `127.0.0.1`。

### 17.3 Ready 输出

启动成功后 stdout 输出一行 JSON，EDA 父进程可解析最终 URL：

```json
{"event":"ready","host":"127.0.0.1","port":4173,"url":"http://127.0.0.1:4173/?startup=1","startup":{"netlist":"design.v","module":"top","focus":"u0","faninDepth":1,"fanoutDepth":2}}
```

Ready 行只包含文件名和目标摘要，不包含网表、时序或配置原文。文件不可读、参数越界、Cell Config 非法、module/focus 不匹配时会在监听端口前失败并返回非零状态。

## 18. 推荐工作流

### 18.1 快速追踪某个大图 cell

1. 导入网表。
2. 在顶部搜索 instance。
3. 激活结果，自动进入 Focused。
4. 调整 fanin/fanout depth。
5. 在 Selection 中继续点击相邻对象。
6. 按 `F` 随时重新居中。

### 18.2 检查负 slack 路径附近结构

1. 先导入网表，再导入 timing。
2. Timing Snapshot 选择 `Global` 或 `Local`。
3. Metric 选择 `Slack`。
4. 搜索 timing 中的 cell/port。
5. 用 Focused 或 Fanin 观察局部连接。
6. 在 Selection 中查看所有 pin 的 AT/RT/Slack。

### 18.3 修复未知标准单元

1. 搜索未知 cell type 或 instance。
2. 选择实例并打开 `Edit selected type`。
3. 检查规则预填值，只修改错误项。
4. 保存并确认所有同类型 cell 更新。
5. Export Cell Config，交给其他环境或 EDA 启动器复用。

### 18.4 保存人工布局

1. 进入 Adjust。
2. 移动/调整节点和必要属性。
3. 退出 Adjust，检查最终 route。
4. `More > Save Golden`。
5. 下次先导入相同网表，再 `Load Golden`。

### 18.5 对比 resyn 与 Flex module

1. 加载包含两个 module 的网表。
2. 点击 Compare，选择左右 module。
3. Apply 后查看统计和 unmatched 高亮。
4. 选择共有 output 观察同步 cone。
5. 点击关键对象进行跨侧高亮。

## 19. 常见问题与限制

### 19.1 导入后显示 Search-first，没有图

这是大图的预期行为。使用顶部搜索打开目标 cell，或显式点击 Whole 查看概览。

### 19.2 Cell Config 打开后显示不正确

未保存定义时编辑器应显示内置规则推断。若 cell type 不属于已知规则，它仍可能显示 BLACKBOX；请手工选择 gate kind 和 pin direction。保存后检查 Selection 中的 inference 是否为 `user-config`。

### 19.3 修改 Cell Config 后图发生变化

Pin direction 会改变 driver/load 关系，因此重新构图是必要行为。大 module 会保留局部 Focused 视图，避免整图布局。

### 19.4 Timing 没有匹配

检查：

- Timing scope/module 名是否与网表一致。
- Instance 或 object 的层次后缀是否能对应。
- `[Global]` / `[Local]` 和数据行之间是否有正确换行。
- 表头列数与数据数值是否一致。
- Process Log 的 Timing phase 和 Diagnostics。

### 19.5 Whole 大图很慢或很细

Whole 会布局和渲染全部可见结构。大图优先使用 Search-first、Focused 或有限深度 cone；必要时启用 fanout hubs 和 group collapse。

### 19.6 Compare 的红色是否表示逻辑不等价

不是。Compare 是名称、方向、gate kind 和图统计驱动的启发式结构对比，不是形式等价验证。

### 19.7 Golden 无法载入

先加载 Golden 对应的网表/module。Golden 会验证目标和可用布局数据；不相关或损坏的 JSON 会被拒绝。

### 19.8 页面刷新后的数据范围

同一标签页刷新会恢复工作状态；关闭标签页后 session 数据通常由浏览器清理。Cell Config 使用本地持久化，除非 Delete/Reset 或清理浏览器站点数据。

### 19.9 安全与离线边界

- 运行时无需联网。
- 服务只监听 localhost。
- 用户控制的名称在 HTML/SVG 中会转义。
- 日志和 ready 输出不包含完整输入原文。

如需确认某次操作是否成功，优先查看底部状态栏与 Process Log。
