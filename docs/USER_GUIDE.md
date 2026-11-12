# Netlist Graph Builder 完整使用教程

本教程面向使用 **Netlist Graph Builder** 阅读、追踪与对比门级结构化 Verilog 网表的工程师，全面覆盖当前版本的各项用户功能：数据导入、全局搜索、大图局部聚焦浏览、时序标注、单元语义配置（Cell Config）、手工布局校准（Adjust）、双模块对比（Compare）、过程日志（Process Log）、离线导出以及 EDA 脚本集成。

- **默认布局与降级机制**：当前版本默认启用 `Native Layered AnchorLayered` 布局引擎；若布局失败，会按 `AnchorLayered → ELK → Simple` 顺序自动降级，且临时自动降级不会覆盖用户已保存的首选项。
- **版本说明**：当前版本为 `v1.3.0`，新增可选 Liberty（`.lib`）库导入与顶部库管理面板。下载对应版本的离线附件后，请核对随附的 SHA-256 校验值。
- **Linux 与 EDA 集成**：关于 Linux 单文件二进制、CMake 嵌入构建与 EDA/Tcl 辅助脚本的详细说明，请参阅 [Linux 启动指南](LINUX_SINGLE_FILE_LAUNCHER.md)。

## 近期核心功能速览

| 功能特性 | 使用入口 | 核心要点 |
| --- | --- | --- |
| **标准 STA 时序与 Metric 过滤** | 左侧 Timing 面板与 Selection 面板 | 全面支持工业级标准 STA 表格与 JSON 格式导入，驱动源自动沿 assign 链回溯；侧边栏提供 `Worst Slack`、`AT`、`RT`、`Delay`、`Slew`、`All` 及一键清爽纯净的 `None` 模式；支持自定义 Slack 判定阈值（Threshold，默认 0.0）；内置验证时序默认联动呈现负 Slack 违例关键路径。 |
| **Cell / Net 聚焦视图** | 顶部 Search、左侧 View 区 | 支持将 Cell 或 Net 设为聚焦根节点（root）；点击未在当前画布绘制的搜索结果默认追加为 root，点击 `+ Focus` / `Add selected` 显式追加，点击 `Set selected as Focused` 显式替换全部 roots。 |
| **Focused roots 管理** | 左侧 View 区 root chips | 点击 chip 可激活并居中对应 root，点击 `×` 或 `Remove selected` 移除单个 root，点击 `Clear` 清空全部 roots（最多同时保留 32 个 roots）。 |
| **分层连接展示** | 左侧 Selection 面板 | `Connections / Current module` 仅展示当前模块定义内的连接；`Hierarchy / Parent occurrence` 独立展示穿过当前模块端口边界延伸至父层实例的连接。 |
| **标准逻辑门符号切换** | 左侧 View 区 `Gate symbols` | 支持在 `Rectangles`（标准矩形）与 `Conventional`（约定逻辑门符号，含反相气泡）之间一键切换，不改变节点边界、引脚坐标或布线路径。 |
| **统一视图历史** | 顶部 `←` / `→`、`Ctrl+Z` / `Ctrl+Y` | 事务化记录并恢复模块切换、视图模式、Focused roots 与深度、当前选中项、视口缩放平移及手工布局微调。 |
| **Compare roots 同步** | 左侧 Module Compare | `Sync Focus roots` 控制对一侧聚焦根节点的追加、移除和清空操作是否自动同步至另一侧匹配的单元。 |
| **模块层次树导航** | 左侧 `Module hierarchy` | 按实例层次展开并点击切换模块（顶部显示 `module @ instance/path` 面包屑）；面板折叠时惰性不构建，遇到递归或超大层次时有界截断（最多 2000 节点、深度 64）。 |
| **间距数字输入与引脚转角** | 左侧 Layout 区与布线器 | `Wire spacing` 与 `Cell spacing` 除滑块外支持直接输入数字（提交后自动吸附至最近的 4 的倍数）；连接单元顶部/底部引脚的末段连线预留可见转角，近距离走线依然清晰可辨。 |
| **高可靠恢复与批量导入** | Golden、Session、快速输入 | Golden v3 校验网表内容指纹（fingerprint）并恢复聚焦深度；多文件拖放/粘贴严格按“Liberty（如有）→ 网表 → 时序 → Golden”依赖顺序串行完成。 |

## 目录

- [近期核心功能速览](#近期核心功能速览)

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

---

## 1. 软件定位与运行方式

**Netlist Graph Builder** 是一款离线运行的门级结构化 Verilog 原理图浏览器。它无需依赖 Liberty（`.lib`）库文件，即可根据单元类型（cell type）与引脚（pin）命名规则自动推断常见逻辑门类型与端口方向，并通过交互式 SVG 清晰呈现电路拓扑连接。

**典型适用场景**：

- 快速检查综合（Synthesis）、重综合（Resyn）或 ECO 后网表的单元、线网、端口与层次结构。
- 从关键单元、线网或输出端口出发，向前（Fanin）、向后（Fanout）追踪指定层数的逻辑锥（Logic Cone）。
- 可视化查看标准列式时序报告（Tabular / CSV）或 JSON 时序文件中的 Arrival Time (`at`)、Required Time (`rt`)、Slack 及可选详细指标（`delay`、`slew`、`edge`）。
- 并排对比两个结构相近模块（如优化前后的模块）的拓扑与统计差异。
- 为缺乏内置规则的定制标准单元补充可复用的引脚与门类型定义（Cell Config）。
- 从外部 EDA 脚本一键拉起指定网表、目标模块与聚焦实例。

**能力边界说明**：本工具并非完整的 Verilog / SystemVerilog 编译器，亦不提供形式化逻辑等价验证（Formal Equivalence Checking）。当前产品界面仅开放 Netlist 工作流；代码库中的内存 AIG 样例仅用于验证多领域架构边界，尚未开放 `.aag` / `.aig` 文件导入或 AIG 浏览界面。

### 1.1 Windows 离线版

1. 完整解压 `NetlistGraphBuilder-v<version>-win-x64.zip`。
2. 双击运行 `NetlistGraphBuilder.exe`。
3. 启动窗口会在本机 `127.0.0.1` 启动本地服务并自动打开默认浏览器。
4. 使用期间请勿关闭启动控制台窗口；需要退出时在窗口内按 `Ctrl+C` 或直接关闭该窗口。

> **注意**：请勿单独复制 `NetlistGraphBuilder.exe` 到其他目录运行，它依赖同级目录中的 `app/` 前端资源文件夹。发布压缩包内同时包含 `examples/` 示例网表、`README.md`、`CHANGELOG.md`、本教程 `USER_GUIDE.md` 以及 `ELKJS-LICENSE.md`。

### 1.2 Node.js 开发启动

需要 Node.js 18 或更高版本（无任何第三方 npm 运行时依赖）：

```powershell
npm start
```

默认监听地址为 `http://127.0.0.1:4173/`。如需自定义端口或禁止自动打开浏览器，可执行：

```powershell
node tools/serve.mjs --port 4210 --no-open
```

### 1.3 Python 3 启动

在不便于安装新版 Node.js 的 Linux 环境中，可直接使用零第三方依赖的 Python 3 标准库服务：

```bash
python3 -u tools/serve.py
```

Node.js、Python、Windows 离线版与 Linux 单文件启动器共享相同的业务命令行参数，详见 [17. EDA/脚本启动接口](#17-eda脚本启动接口)。

---

## 2. 界面总览

工作台界面由四个核心区域组成：

- **顶部工具栏**：包含 `Import`（导入）、`Module`（模块选择与层次面包屑）、历史前进/后退（`←` / `→`）、`Search`（全局搜索）、`Compare`（双模块对比切换）、`Fit`（适配视口）与 `More`（保存/加载 Golden、重置布局、导出 SVG）。
- **左侧控制与检查面板**：包含视图模式（View）、布局与间距设置（Layout）、时序显示策略（Timing）、单元语义配置（Cell Config）、对比设置（Module Compare）、模块实例层次树（Module hierarchy）、设计统计（Design）、当前选中详情（Selection）与诊断信息（Diagnostics）。
- **中央主画布**：渲染当前模块的交互式 SVG 原理图，或在 Compare 模式下分屏展示两个模块的画布。
- **底部状态与日志区**：展示最新操作状态提示，以及可折叠的 `Process Log`（过程日志面板）。

**界面交互细节**：
- 顶部的 `Import` 与 `More` 为下拉弹出菜单；再次点击菜单按钮、点击页面空白区域或按下 `Esc` 键均可收起菜单。
- 左侧面板与中央画布之间的竖向分隔条支持鼠标拖拽调整宽度；当分隔条获得键盘焦点时，按左右方向键（`ArrowLeft` / `ArrowRight`）可按每次 `16px` 步进微调侧栏宽度。

---

## 3. 导入网表、时序和配置

### 3.1 Import 菜单

点击顶部工具栏的 `Import` 按钮，提供四个导入入口：

- `Open netlist`：从本地选择 `.v`、`.sv` 或文本格式的结构化 Verilog 网表文件。
- `Paste netlist`：在弹窗中直接粘贴结构化 Verilog 代码，点击 `Draw`（或按 `Ctrl+Enter` / `Cmd+Enter`）立即解析绘图。
- `Open timing`：从本地选择 `.log` 或 `.txt` 时序报告文件。
- `Paste timing`：在弹窗中粘贴时序文本并明确按 Timing 格式解析（避免短小的时序片段被自动识别逻辑误判为 Verilog）。

成功导入新网表后会替换当前 Design，并同步重建模块列表、搜索索引、诊断信息及视图状态；若新输入解析失败，系统会报错并安全保留此前已成功加载的 Design。

**超大文本粘贴优化**：当粘贴超过 256 KiB 字符的大网表或长时序文本时，输入框会在内存中完整保留原文，但界面仅渲染带提示的头部预览片段，从而避免浏览器因渲染和全选数万行文本而卡顿。预览状态下可直接粘贴新内容替换，按 `Ctrl+A` / `Cmd+A` 后复制仍会复制完整原文，点击 `Draw` 也会提交完整原文；点击“清空”可移除文本，若确实需要手动修改其中内容，可点击“展开编辑”切换回完整原生文本框。

### 3.2 拖放与全局粘贴

除使用顶部菜单外，还可直接将文件拖放到页面任意位置，或在焦点不处于任何文本输入框时直接按 `Ctrl+V` / `Cmd+V`。系统会自动识别以下内容：

- 结构化 Verilog 网表（`.v` / `.sv` / `.txt`）
- 时序报告文本（Timing log）
- 布局快照文件（Layout Golden `.json`）

当一次性拖入多个文件时，系统会严格按照**“先加载网表，待网表就绪后再依次应用配套的 Timing 或 Golden”**的依赖顺序串行执行。若前置步骤失败，状态栏会立即报告错误并终止后续依赖步骤，绝不会将未生效的文件伪装为导入成功。自定义单元配置（Cell Config）请通过左侧 `Cell Config > Import` 专用按钮或命令行启动参数载入。

### 3.3 支持的 Verilog 语法范围

本工具专注于综合映射后的门级结构化 Verilog（Gate-level Structural Verilog）：

- `module` / `endmodule` 模块定义
- ANSI 与非 ANSI 风格的端口声明（Port declarations）
- `input`、`output`、`inout`、`wire` 声明
- 向量位宽（Packed range）与位选择/切片（Bit-select / Part-select），如 `[31:0]`、`bus[7]`、`[0:0]`
- 拼接表达式（Concatenation，如 `{a, b[1:0]}`）与常量字面量（如 `1'b0`、`4'hF`）
- `assign` 连续赋值别名（Alias）
- 命名端口连接的单元实例化（Named-pin cell instances，如 `NAND2 u0 (.A(n1), .B(n2), .ZN(y));`）
- 转义标识符（Escaped identifiers，如 `\u_top/reg[0] `）与层次化名称

> **提示**：行为级 `always` 块、复杂算术/逻辑运算符表达式、宏定义展开（`` `define ``）及完整的参数化 `generate` 展开不属于结构化网表阅读器的目标范围。建议输入已经过综合器映射的标准门级网表。

---

### 3.5 Liberty 库

顶部工具栏的 `Liberty` 入口展开独立库管理面板，`Load .lib` 可加载标准单元库，面板中显示库摘要与告警，不占用左侧栏。再次点击入口、按 Escape 或点击面板外部可收起；收起不会卸载库或取消导入，取消扫描请使用 `Cancel import`。也可以将 `.lib` 拖入页面，或在非输入框位置直接粘贴 `library(...) { ... }` 文本。可以先加载库再加载网表；批量拖放按 Liberty、网表、时序、Golden 的顺序处理。

一次拖放或文件粘贴只接受一份 Liberty 文件；含多份库文件的批次会整体拒绝，不会按文件顺序选择工艺角。请选定一份库后再加载，或将库分别作为独立的替换操作导入。

每次成功导入替换当前库，并刷新 Single 或 Compare 两侧的连接方向与门类型；`Cancel import` 取消正在扫描的导入，`Unload` 恢复无库语义。语法错误、超限或同名 cell 冲突会保留原有效库。文件中允许多个名字不同的 library，但 cell 名必须全局唯一；多工艺角请每次选择一份库文件。当前附件只在页面内存中保留，刷新或重新打开后需重载，不写入 Cell Config、Session 或 Golden。

Selection 显示库名、源文件和原始 function；引脚来源 `library` 表示使用库方向。真实 Verilog 子模块仍保留模块身份；leaf 引脚优先级为实例方向覆盖、Cell Config、库声明、命名规则。显式 `unknown` 人工配置同样优先。缺失 cell/pin、用户与库冲突在 Diagnostics 中说明；电源和内部 pin 不作为数据连线。

首版支持标量接口、`pg_pin`、`ff`/`latch` 标记、三态标记，以及带显式 `type` 位范围的同方向 bus。常见 AND/NAND/OR/NOR/XOR/XNOR/BUF/INV/MUX 使用有界布尔识别；复杂逻辑、常量、多输出、latch 和三态保持保守展示。库面板列出前 20 条解析/语义告警，完整告警保留在库模型中。

文本上限 64 MiB（UTF-8），单 token 上限 1 MiB 字符；超限错误包含限制名和可用的行列位置。`include_file`、`.lib.gz`、二进制 `.db`、bundle 位映射和 bus 成员区间简写暂不支持。Liberty 导入不会计算延时、Slack 或替代 STA；启动器尚无 `--liberty` 参数。

---

## 4. Module 与层次导航

### 4.1 Module 下拉框

顶部工具栏的 `Module` 下拉框列出了当前网表中的所有模块定义。切换模块后画布将展示对应模块的结构；若目标模块的单元数量超过大图阈值（500 个单元），将自动进入 `Search-first`（搜索优先）模式，避免因一次性全图布局造成等待。

### 4.2 Module hierarchy 列表

左侧面板中的 `Module hierarchy` 是一个默认折叠的模块实例层次树。展开后可直观查看从顶层模块向下的实例层次路径，并点击任意节点切换当前查看的模块。为防止递归例化或超大规模芯片层次耗尽内存，层次树采用惰性构建与有界展开策略：**最多展开 2000 个节点、最大嵌套深度 64 层**；达到上限时会显示 `More instances omitted` 截断提示，遇到递归引用时会标记 `cycle`（这仅代表显示保护生效，并不表示网表解析出错）。

列表中普通项格式为 `instance : module`（表示某实例名及其引用的模块定义），顶层根节点仅显示模块名。当前激活的实例节点会高亮显示，同时顶部 `Module` 选择器会展示 `module @ instance/path` 形式的层次面包屑（Breadcrumb），清晰指示当前所在的实例上下文（Occurrence context）。

### 4.3 双击进入子模块（hinst 钻取）

当画布中的某个单元实例（Hierarchical instance，简称 `hinst`）引用了当前网表中真实存在的子模块定义时，在画布上**双击该实例**即可直接钻取进入对应的子模块occurrence上下文。真实子模块的端口方向严格取自其自身的 `module` 端口声明，不会被 `Cell Config` 覆盖。

### 4.4 视图历史前进与后退（View History）

顶部工具栏的 `←`（后退）与 `→`（前进）按钮基于统一的事务化视图历史（View History），完整记录并恢复以下状态：

- 当前打开的 Module 及层次实例路径（Occurrence breadcrumb）
- 视图模式（`Whole` / `Focused` / `Search-first`）
- `Focused` 根节点集合（roots）与前后向追踪深度（Fanin / Fanout depth）
- 当前选中的对象（Selection）
- 画布视口缩放倍率与平移位置（Pan / Zoom viewport）
- 已提交的节点位置/尺寸手工校准（Overrides），以及 Compare 模式下左右两侧各自的选中项、Focused roots、视口与 Output cone 状态

**快捷键**：在非文本输入状态下，可使用 `Ctrl+Z`（后退）、`Ctrl+Shift+Z` 或 `Ctrl+Y`（前进），同时兼容 `Alt+Left` 与 `Alt+Right`。当后退至历史节点并执行新的视图修改操作时，原有的前向（Forward）分支会被自动裁剪；导入新网表设计时会清空旧历史栈。当光标处于文本输入框内时，快捷键不会拦截浏览器原生的文本撤销功能。

### 4.5 逻辑门符号切换（Gate symbols）

左侧 View 区的 `Gate symbols` 可在两种渲染符号风格之间无缝切换：

- `Rectangles`：所有单元统一使用标准矩形框绘制。
- `Conventional`：将已识别的 `BUF` / `INV`、`AND` / `NAND`、`OR` / `NOR`、`XOR` / `XNOR` 绘制为标准数字电路逻辑门图形（反相输出自动绘制小圆圈 bubble），其余子模块、黑盒（Blackbox）、寄存器（Register）及未知单元继续使用矩形框。

切换符号风格仅更新渲染场景图元，**不会改变节点的几何外框尺寸、引脚连接点坐标、导线路径或当前视口位置**，且在 Single、Compare、历史回退及 SVG 导出中保持完全一致。

---

## 5. 顶部搜索

全局搜索是大图分析的核心入口。顶部搜索框支持跨模块检索以下五类设计对象：

- `Module`（模块名）
- `Port`（模块输入/输出端口）
- `Net`（内部连线网络）
- `Cell instance`（单元实例名）
- `Cell type`（标准单元类型名）

每条搜索结果均标注对象类别、名称及所属模块；激活跨模块结果时会自动切换至目标模块。

**键盘导航快捷键**：

- `ArrowDown` / `ArrowUp`：在下拉候选列表中上下移动焦点
- `Enter`：激活当前高亮的搜索结果
- `Esc`：收起搜索候选列表
- 点击输入框右侧 `×`：清空搜索关键词

**搜索结果的激活与聚焦行为**：

- **点击结果主体或按 `Enter`**：
  - 若目标对象已经存在于当前画布的已绘制图中，则**仅选中并将视口居中定位到该对象**，不会改写现有的聚焦根节点。
  - 若目标单元未在当前画布中绘制（例如处于 `Search-first` 空画布或当前 `Focused` 邻域之外），则自动进入 `Focused` 视图，并将该对象**追加**到现有的 Focused roots 集合中（保留此前已聚焦的根节点）。
- **点击结果右侧的 `+ Focus` 按钮**：无论目标对象当前是否已绘制，均显式将其追加至 Focused roots 并进入 `Focused` 视图（若已在 roots 集合中则不重复添加）。
- **跨模块结果隔离**：激活位于其他模块的搜索结果时，系统会先切换至目标模块的工作区；原模块的 Focused roots、选中状态和手工布局微调不会串入目标模块。若目标模块此前已访问过，会自动恢复其自身的独立工作区状态。

---

## 6. 画布、选择和连接追踪

### 6.1 缩放、平移与一键适配（Fit）

- **滚轮缩放**：以当前鼠标指针所在位置为中心放大或缩小画布。
- **拖拽平移**：在画布空白区域按住鼠标左键拖动即可平移视图；平移距离严格按 SVG 实际等比例尺度换算，即便在超大长宽比图放大至极限倍率时，画面依然严格跟随鼠标移动距离。
- **顶部 `Fit` 按钮**：将当前 Single 原理图或 Compare 左右两侧原理图完整适配至可视窗口中央。
- **动态最大倍率与低缩放细节隐藏（LOD）**：系统会根据画布实际宽高动态提升超宽或超高图的最大放大倍率上限（保证典型 `220px` 宽度的单元在屏幕上可放大至约 `440px` 的清晰阅读尺寸）。当缩放倍率低于 `0.65` 时，为保证交互帧率与主干结构可读性，引脚名、线网标签、单元元信息和时序文字会自动暂时隐藏，放大后立即恢复。

### 6.2 选择对象与跨层连接追踪

单击画布中的单元（Cell）、端口（Port）或导线（Wire）后，左侧 `Selection` 面板会展示该对象的完整属性与连接关系：

- **Cell**：显示单元类型、推断的逻辑门类别（gate kind）、推断来源（inference source）、各引脚方向、连接的线网、相邻驱动/负载端点以及直接扇入（Fanin）/ 扇出（Fanout）列表。
- **Port**：显示端口方向、内部连接线网及相邻单元。
- **Net**：显示驱动源（driver）、所有负载端（loads）及路径端点。

`Selection` 面板中所有以可点击按钮呈现的 `Net`、`Driver/Load`、`Connected`、`Fanin` 和 `Fanout` 条目均支持**点击连续追踪**：若点击的目标对象已绘制则直接选中并居中；若目标处于当前局部聚焦图之外，系统会在当前模块内自动扩展或建立包含目标的 `Focused` 局部视图，而不会退回耗时的 `Whole` 整图模式。

**本层连接与父层跨边界连接（Connections vs. Hierarchy）**：

`Selection` 面板将连接关系清晰划分为两个独立区域：

1. **`Connections / Current module`**：仅展示当前模块定义（Module definition）内部的引脚、线网、驱动与负载。例如在顶层 `hierarchy_demo_top` 中选中子模块实例 `u_compute_left` 时，其输入连接仅定位到本层线网；子模块内部的端口（如 `compute_cluster.a`）属于子实例内部接口，不会混入父层列表（欲进入子模块内部请直接双击该子模块实例）。
2. **`Hierarchy / Parent occurrence`**：采用独立强调底色与 `Parent` 徽标，**仅在当前选中对象连接到了当前模块的输入/输出端口边界（Boundary port），且当前模块处于明确的父层实例上下文（即通过 `Module hierarchy` 树或双击 `hinst` 进入）时显示**。
   - 顶层模块没有父实例，因此不显示 `Hierarchy` 区。
   - 当双击 `u_compute_left` 进入 `compute_cluster @ u_compute_left` 后，若选中与边界端口 `a` 相连的内部线网或单元，`Hierarchy` 区便会列出穿过边界延伸至父层的 `hierarchy_demo_top.a`。
   - 点击带 `Parent` 标记的父层线网或单元时，系统会自动切换回父层实例上下文，清空原层级的 Focused roots，并以目标父层对象建立新的 `Focused` 视图。
   - 若某个被多处例化的子模块仅通过顶部 `Module` 下拉框直接按定义名打开（未指定具体属于哪一个实例路径），系统不会盲目猜测父实例，而是展示显式实例选择器（Occurrence chooser）供用户指定要追踪的具体实例路径。

> **小贴士**：单击画布空白处可清除当前选中状态；按住画布拖拽平移**不会**取消已选中导线的高亮，方便沿着长线网一路拖动追踪到远端负载。

### 6.3 一键居中放大所选单元（Focus selected cell）

选中某个单元后，点击左侧 View 区的 `Focus selected cell` 按钮，或在非输入框状态下直接按下快捷键 `F`：

- 若该单元已在当前画布中绘制，视口会平滑居中并将其放大至稳定的阅读尺寸（约 `320px` 视觉宽度）。
- 若该单元不在当前局部图中，系统会先以它为中心建立 `Focused` 局部图，随即将视口居中定位到该单元。

### 6.4 管理聚焦根节点（Focused roots）

左侧 View 区提供四个显式的根节点集合管理按钮（支持以选中的 **Cell** 或 **Net** 作为聚焦根）：

- `Set selected as Focused`：用当前选中的 Cell 或 Net **替换**全部已有的聚焦根节点，适合开启一段全新的局部路径分析。
- `Add selected`：保留已有聚焦根节点，将当前选中对象**追加**为新的根节点。
- `Remove selected`：从聚焦根节点集合中仅移除当前选中的根节点。
- `Clear`：清空全部聚焦根节点（大型模块将返回 `Search-first` 提示页，中小型模块将返回 `Whole` 整图）。

按钮下方的 **root chips** 标签栏实时展示当前的根节点集合（最多容纳 **32 个 roots**）：
- 点击任意 chip 可将其设为当前激活根节点（active root）并将视口居中定位到该对象，无需重新计算布局。
- 点击 chip 右侧的 `×` 仅移除该根节点。
- 在执行追加、移除或激活操作期间，当前设置的 `Fanin depth` 与 `Fanout depth` 保持不变。

---

### 6.5 指定 net 不布线

点击导线，或在单元 `Connections` 中点击 net 名称，在 `Selection → Net routing` 取消勾选
`Route net / 布线`，即可跳过 clk、reset 或任意所选 net 的布线。默认所有 net 均布线；
net 之间的 assign 别名同步生效，赋为相同常量的独立 net 可分别设置；单元、引脚、连接详情与 Focused 追踪保持完整。

取消布线后仍可通过 Search 或 Connections 打开该 net，重新勾选恢复。Compare 左右侧独立设置。
设置支持 Back/Forward、模块切换和 Golden 保存/加载；刷新页面时恢复 Single 当前模块的设置。
SVG 导出遵循当前设置，`Reset` 清除布局覆盖时也会恢复布线。

## 7. Whole 和 Focused 视图

### 7.1 Whole（整图视图）

渲染当前模块的全部端口、单元与线网。中小型模块默认直接打开 `Whole` 视图；对于超过 500 个单元的大型模块，为保证响应速度默认进入 `Search-first`，用户可在需要观察全局拓扑轮廓时显式点击 `Whole`。

### 7.2 Focused（双向局部聚焦视图）

`Focused` 是以一个或多个选定对象（Cell 或 Net，最多 32 个）为根节点（root）向前后双向扩展的局部原理图：

- **`Fanin depth`**：向输入/驱动源（driver）方向追踪展开的逻辑层数（`0–99`）。
- **`Fanout depth`**：向输出/负载端（load）方向追踪展开的逻辑层数（`0–99`）。
- **深度设为 `0`**：关闭该方向的扩展（例如将 `Fanout depth` 设为 `0` 即可仅查看纯扇入逻辑锥 Fanin Cone）。

在 AnchorLayered/ELK 中，即使 `Fanout depth=0`，已有可见 net 的范围外负载仍会以 `Focused output`
标记显示；标记只表示连线继续到视图外，不会把外部 cell 展开进来。Simple 保留冻结的旧行为。

当存在多个聚焦根节点时，系统会分别计算每个根节点的扇入与扇出邻域并自动合并去重；当根节点数量达到 32 个上限时，新的追加请求会被明确拒绝并提示，绝不会静默丢弃或截断已有的根节点。对于高扇出线网作为根节点的情况，系统还内置了有界节点预算策略，确保根节点的直接连通路径完整保留且不会因超大多扇出一次性撑爆局部图。

---

## 8. 大图 Search-first 工作流

当打开单元数量超过 **500** 的大型模块时，工作台默认进入 `Search-first` 模式：

- 后台已完成完整模块的网表解析、图提取与搜索索引构建，所有对象均可立即检索。
- 暂不对全图执行耗时的几何布局与海量 SVG DOM 渲染。
- 画布中央展示已索引的节点规模统计与快速检索引导。

**推荐的大图分析五步法**：

1. 在顶部搜索框输入目标实例名（instance）、线网名（net）、端口名（port）或单元类型（cell type）。
2. 在下拉列表中点击或按 `Enter` 激活目标结果，瞬间生成围绕该对象的 `Focused` 局部图。
3. 通过左侧 `Fanin depth` 与 `Fanout depth` 按需增减上下文层数。
4. 在左侧 `Selection` 面板中点击上下游的驱动、负载或跨层次父/子连接，沿信号链路逐步推进追踪。
5. 仅在确实需要审视全模块宏观分布时，再点击左侧 `Whole` 按钮渲染整图。

> **性能保护**：在大型模块中修改并保存 `Cell Config` 时，系统会自动保持当前正在查看的 `Focused` 局部视图并仅重排该局部图，避免触发全图重布局导致界面等待。

---

## 9. 布局、间距和大图简化

### 9.1 布局引擎选择（Layout Provider）

左侧 `Layout` 面板提供三种完全离线运行的布局引擎：

- **`Native Layered AnchorLayered`（默认）**：项目内置的高性能物理锚点分层布局与正交布线引擎（原称 H08），Single 与 Compare 视图共用同一流水线。若遇到超出支持范围的拓扑，会输出明确诊断并自动依次尝试降级至 `ELK` 与 `Simple`。
- **`ELK Layered (Experimental)`**：本地化集成的 Eclipse Layout Kernel（vendored `elkjs 0.11.1`），适合对比或尝试不同的大图初始排布；若失败则自动回退至 `Simple`。
- **`Simple Layered`**：轻量级分层布局引擎，可手动选择，同时作为最终兜底回退方案。

**首选项与降级规则**：
- 新会话与命令行/EDA 启动默认选用 `AnchorLayered`；旧版未记录首选项版本号的 `Simple` 会话在首次升级打开时会一次性迁移为 `AnchorLayered`，此后用户手动选择的 `Simple` 或 `ELK` 会正常持久化保留。
- 自动降级仅影响当前这一次布局运行，**不会篡改用户保存的默认首选项**；若最终 `Simple` 也失败则停止重试，用户主动取消布局任务不会触发降级。
- `AnchorLayered` 专注于平面门级网表、固定左右侧引脚及已验收的拓扑语料；对于带分组的自环或合并秩列等不支持输入会直接给出诊断报错，而非静默生成残缺图形。

### 9.2 导线间距（Wire spacing）与单元间距（Cell spacing）

- **`Wire spacing`**：控制平行正交导线通道之间的间距（Lane pitch），默认 `24 px`，可调范围 `4–96 px`（主要作用于 `Simple` 布局与 `Adjust` 局部重布线通道）。
- **`Cell spacing`**：控制单元、输入端口、输出端口之间的垂直/水平间距及拥塞通道留白，可调范围 `4–320 px`（调大该值可显著拉开密集单元并扩展走线空间）。

两项间距均同时提供**滑块拖动**与**数字直接输入**：输入数字并回车或失焦提交后，会自动四舍五入吸附至最近的 **4 的倍数**并限制在合法区间内（例如输入 `29` 自动规整为 `28`，输入 `30` 规整为 `32`；输入空值或非法字符会自动恢复为上一次有效值）。修改后立即重排当前视图。

### 9.3 垂直引脚（Top / Bottom Pin）末段转角保护

当导线连接到位于单元顶部（top）或底部（bottom）的引脚（例如部分触发器的清零/置位端或测试引脚）时，即便起点与目标引脚在水平方向上非常接近，正交布线器也会强制为最后一次折弯保留一段清晰可见的垂直引导段。这一内置几何规则可有效避免末段水平短线与垂直进线贴合重叠，确保引脚接入方向一目了然（在 `Adjust` 手工拖拽节点释放后同样生效）。

### 9.4 显示赋值别名（Show aliases）

系统默认会自动折叠并规范化单纯的 `assign` 连续赋值别名链，以减少冗余中间节点。勾选 `Show aliases` 后，将在图中显式保留并展示 `assign` 别名结构（注：网表中显式例化的物理 `BUF` 缓冲器单元始终作为真实单元保留，绝不会被当作 `assign` 别名折叠消除）。

### 9.5 高扇出中继节点（Fanout hubs）

`Fanout hubs` 默认开启：对于扇出负载数不少于 8 的高扇出同源线网，系统会自动生成共享的分支中继节点（hub），避免从驱动引脚拉出数十条重复的长距离平行干线；取消勾选后则展示原始的逐一分支连接。

### 9.6 结构分组折叠说明與渐进式渲染

- **分组折叠已退役**：结构分组折叠（Group collapse/expand）已从产品路线中正式移除；大图统一通过完整图、`Search-first` 或 `Focused` 局部图进行浏览（旧版 Session 或 Golden 文件中遗留的折叠字段仅作兼容读取忽略）。
- **分批渐进渲染**：当当前视图的可见节点与连线总数达到渐进渲染阈值（400）时，渲染器会自动分批向 DOM 提交 SVG 图元，并通过底部状态栏报告进度。在拖拽或预览过渡帧中可临时省略装饰性跨线桥（wire bridge），一旦渲染或手势完成，画面与导出的 SVG 均会完整恢复所有导线、桥接弧、文本标签与点击热区。

---

## 10. Adjust 手工校准

点击左侧 Layout 区的 `Adjust layout` 按钮即可进入手工校准模式；再次点击该按钮退出校准模式。

### 10.1 拖拽移动节点

在 `Adjust` 模式下，可直接用鼠标拖拽画布中的任意单元或端口：
- **流畅拖拽预览**：拖动过程中仅实时更新被拖节点的轻量级位置预览并弱化关联导线，支持网格吸附与相邻引脚水平对齐吸附，不触发全图重布局。
- **释放后局部重布线**：松开鼠标按键后，系统仅对受影响的关联导线执行正交避障重布线，其余未改动节点与无关导线保持原样。
- **顶部编辑留白**：自动布局器会在画布顶部预留一段编辑缓冲区，方便将最顶排的单元或端口继续向上拖动调整；保存为 Golden 后均按画布绝对坐标精确还原。

### 10.2 调整节点尺寸（Size）

在 `Adjust` 模式下选中节点后，左侧面板可精确修改其外框尺寸：

- `Width`（宽度）：可调范围 `24–420 px`
- `Height`（高度）：可调范围 `12–260 px`
- `Reset size`：恢复该节点的自动计算尺寸

### 10.3 覆盖单个实例的显示属性（Properties）

在 `Properties` 区域可针对**当前选中的单个单元实例**临时覆盖以下展示字段：

- `label`（主标签）
- `title`（标题）
- `subtitle`（副标题）
- `gateKind`（逻辑门图形类别）
- `inferenceSource`（推断来源标记）

点击 `Reset properties` 可恢复该实例的自动图属性。请注意：此处的属性修改仅作为当前单个实例的显示覆盖（Display override），若希望按单元类型（cell type）批量修正并跨网表复用，请使用下文的 `Cell Config` 功能。

### 10.4 覆盖单个实例的引脚方向（Pin directions）

在 `Pin directions` 区域可将当前选中实例的某个引脚临时指定为 `input` 或 `output`（适合在保存全局 `Cell Config` 之前，快速针对单个特殊实例验证引脚方向对局部连接和布线的影响）。点击 `Reset pin directions` 可清除该实例的临时引脚方向覆盖。

### 10.5 重置与保存校准结果

- `More > Reset layout`：一键清除当前模块的所有手工位置、尺寸与属性覆盖，恢复当前布局引擎的自动输出。
- `More > Save Golden`：将当前视图模式、聚焦状态及所有手工校准覆盖导出保存为 Layout Golden JSON 文件。

---

## 11. Timing 导入与显示

系统采用统一的 **NGB Timing Format v1.0**（完整规范见 [`docs/design/timing_format_spec.md`](design/timing_format_spec.md)），支持 **列式文本（空格 / Tab / CSV）** 与 **结构化 JSON** 双模输入，覆盖映射前（`pre_map`）、映射后（`post_map`）与布局后（`post_layout`）全阶段。

### 11.1 标准列式文本格式（Tabular / CSV）

默认**简单模式**仅需 4 列（`point at rt slack`），支持 `@module`、`@stage`、`@unit` 指令头以及 `-` / `NA` / `null` 缺省值占位（若省略 `slack` 且提供了 `at` 与 `rt`，系统自动按 `slack = rt - at` 推导）：

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

**详细模式（Detailed Mode）**：在表头中按需追加 `delay`（或 `incr`）、`slew`（或 `trans`）、`edge`（`r`/`f`）、`kind`（`port`/`pin`/`net`）列：

```text
@module top
@stage post_layout
@unit ns
point        at      rt      slack    delay   slew    edge   kind
u0/A1        0.728   0.717   -0.011   0.098   0.065   f      pin
u0/ZN        0.825   0.814   -0.011   0.097   0.042   r      pin
```

> **Net 时序归属约定**：当 `point` 指向内部线网（`net`）时，其 `at`、`rt`、`slack` 严格表达该线网 **Source（驱动源根端）** 的时序，并会自动沿 `assign` 别名链回溯挂载至驱动端口或驱动单元的输出引脚；选中该导线时可在详情面板直接查看其 Source 时序。

### 11.2 结构化 JSON 格式支持

面向 EDA 工具程序化导出，支持紧凑数组 `[at, rt, slack]`、详细对象以及多模块 `"modules"` 字典：

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

### 11.3 全图时序显示策略（Timing Display Policy）

左侧 `Timing` 面板提供全图级别的 `Metric` 指标选择与 `Threshold` 阈值配置：
- **Metric 指标过滤**：可选 `Worst Slack`、`AT`、`RT`、`Delay`、`Slew`、`All` 与 `None`。
  - `Worst Slack`：默认模式，展示输出引脚最差 Slack 与输入引脚到达时间（AT）；
  - `AT` / `RT` / `Delay` / `Slew`：整图仅展示单一指定物理维度，避免海量文字密集遮挡；
  - `All`：展示所有基础时序维度；
  - `None`：**一键隐藏全图所有时序徽标**，使原理图立即回归纯净的拓扑结构与连线形态，同时完全保留引脚悬停 Tooltip 与 Inspector 详细时序查验能力。
- **Slack 违例阈值（Threshold）**：默认为 `0.0`。
  - 只有 Slack **严格小于**该阈值（`slack < threshold`）的单元外框、端口与引脚才会被判定为关键路径违例并渲染醒目的红色（`timing-critical` / `pin-critical`）；
  - 若将阈值设为正数（例如 `0.05`），可用于提前筛选 Establish/Setup 余量不足的边缘路径；
  - 若将阈值设为负数（例如 `-0.10`），可用于仅过滤并高亮严重超标的极端违例，忽略轻微违例；
  - 阈值对 Single 视图、Focused 视图、Compare 视图及 SVG 导出均实时保持全局同步生效。

### 11.4 单个对象的 Timing 详情与徽标定制

- **端口（Port）图元时序排版**：输入/输出端口图元采用上下双行垂直居中排版（上行显示端口名称，下行显示时序徽标并自动省略冗余前缀），确保窄端口外框内文字清晰无挤压溢出。
- **单元详情查验**：选中带有时序数据的单元后，左侧 `Selection` 面板会列出该单元所有引脚的 `AT`、`RT`、`Slack`、最差引脚（worst pin）、最差裕量（worst slack）以及当前是否达标违例。用户可在面板中针对该单元微调徽标展示：
  - 单独勾选或取消勾选某个引脚/指标是否显示为画布 badge；
  - 调整 badge 挂载在节点外框的方位（左上、右上、左下、右下）；
  - 点击 `Default badges` 一键恢复默认徽标显示策略。

---

## 12. Cell Config

`Cell Config` 用于按 **单元类型（cell type）** 定义并持久化逻辑门类别（gate kind）与引脚方向（pin direction），非常适合补充无 `.lib` 环境下内置规则尚未覆盖的工艺库原语单元（Primitive cells）。

### 12.1 创建或修改单元类型定义

1. 在画布或搜索结果中选中目标原语单元实例。
2. 点击左侧 `Cell Config > Edit selected type`。
3. 在弹出的编辑器中设置 `Gate kind` 以及各个引脚的 `direction`。
4. 点击 `Save` 保存。

**智能预填机制**：打开编辑器时，系统会自动填入内置推断规则对该单元已识别出的 `gate kind` 和 `pin direction`（而非粗暴重置为 `BLACKBOX` / `unknown`）。因此，若只需修正某一个引脚的方向，其余引脚会自动保留原有的正确推断值。

- **支持的 `Gate kind`**：`AND`、`OR`、`MUX`、`INV`、`NAND`、`NOR`、`XOR`、`XNOR`、`BUF`、`REGISTER`、`BLACKBOX`
- **支持的 `Pin direction`**：`input`、`output`、`inout`、`unknown`

点击 `Save` 后，当前网表中**所有属于该 `cell type` 的原语实例**都会立即重新推断并更新图形，其推断来源（inference source）会显示为 `user-config`（注：网表中存在真实 `module` 定义的层次化子模块始终遵循其模块端口声明，不会被 `Cell Config` 覆盖）。

### 12.2 删除与全部重置

- `Delete saved`：仅删除当前选中单元类型的自定义配置，使其恢复使用内置推断规则。
- `Reset all`：清空浏览器本地保存的全部自定义 `Cell Config`。

### 12.3 浏览器本地持久化

保存的 `Cell Config` 存储在浏览器的持久化本地存储（`localStorage`）中；刷新页面、关闭后重新打开标签页或导入其他网表文件时，同一浏览器环境下的配置依然会自动生效。

### 12.4 导入与导出 JSON

- `Export`：将当前保存的所有单元配置按确定性字母序导出为 `netlist-cell-config.json`。
- `Import`：载入符合 version 1 规范的 JSON 配置文件；若导入文件与本地已有配置存在同名 `cell type` 冲突，系统会弹窗提示用户确认是否覆盖。

**`netlist-cell-config.json` 示例结构**：

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

若导入的 JSON 存在结构错误、未知的 `gateKind` 或非法的引脚方向，系统会拒绝导入并报错，不会破坏当前已生效的配置。

---

## 13. Compare 双 module 对比

### 13.1 进入与退出对比模式

1. 加载一个至少包含两个 `module` 的网表设计。
2. 点击顶部工具栏的 `Compare` 按钮。
3. 在左侧 `Module Compare` 面板中分别选择 `Left`（左侧/上方）和 `Right`（右侧/下方）模块。
4. 点击 `Apply` 启动对比。

系统会自动优先推荐同名前缀且带有 `_Flex`、`_orig`、`_new` 等常见版本后缀的配对模块。进入对比模式后，顶部工具栏的原按钮文字变为 `Single`；点击顶部或左侧面板中的 `Single` 均可随时退回单模块视图。

### 13.2 分屏方向与视口同步

- **分屏方向（`Layout`）**：支持 `Top / Bottom`（上下并排）或 `Left / Right`（左右并排），切换后自动适配两侧视口。
- **同步缩放平移（`Sync pan / zoom`）**：默认开启，在任意一侧画布滚动缩放或拖拽平移时，另一侧画布实时同步执行相同变换；取消勾选后两侧可独立缩放和平移。
- **顶部 `Fit` 按钮**：同时将左右两侧画布重置适配至各自的可视区域。

### 13.3 跨侧联动选择与结构差异高亮

单击任一侧画布中的端口、线网或单元时，系统会自动尝试在另一侧查找并高亮对应对象：

- **Port（端口）**：按规范化名称相同且端口方向一致进行匹配。
- **Net（线网）**：按规范化线网名称相同进行匹配。
- **Cell（单元）**：按推断出的逻辑门类别（`gate kind`）建立基础分类对应。

**高亮颜色语义**：
- **绿色实线**：表示该对象在两侧能够建立上述基础结构对应关系。
- **红色虚线**：表示该对象未能在另一侧找到对应项（Unmatched），或该门类型仅在单侧出现。
- **橙色高亮**：表示当前鼠标点击选中的活动对象。

> **重要说明**：Compare 视图提供的是启发式结构差异提示，而非形式化逻辑等价证明——绿色实线不代表两侧电路逻辑完全等价，红色虚线也不代表电路功能一定不等价。

### 13.4 Compare 模式下的 Focused roots 管理

Compare 左右两侧画布各自独立维护其 `Focused roots` 集合、激活根节点、选中对象与视口状态。先在左侧或右侧画布中点击某个对象，再点击左侧 View 区的 `Set` / `Add` / `Remove` / `Clear` 按钮，操作即以当前选中侧为起点。

**`Sync Focus roots`（默认开启）联动规则**：

- **`Add` / `Set`**：若在另一侧模块中找到同名匹配的单元，则自动在另一侧同步追加或替换聚焦根；若另一侧不存在匹配单元，则仅更新当前操作侧并在状态栏给出提示。
- **`Remove`**：若另一侧存在对应的聚焦根，则同步将其移除。
- **`Clear`**：同时清空左右两侧的全部聚焦根。
- **关闭 `Sync Focus roots` 后**：左右两侧的聚焦根操作完全独立（此时 `Sync pan / zoom` 仍仅同步视口平移与缩放，绝不会隐式修改另一侧的聚焦根）。

在 Compare 模式下，View 区的 root chips 会自动冠以 `left:` 或 `right:` 前缀以区分所属侧；点击某个 chip 仅激活并居中对应侧的该根节点，点击 `×` 将其移除。

### 13.5 同名输出逻辑锥对比（Output cone）

`Module Compare` 面板中的 `Output cone` 下拉框列出了左右两侧模块共有的输出端口（例如内置示例中的 `sco_891`）。选择任一共有输出端口后，两侧画布将同步提取并展示该输出端口的扇入逻辑锥（Fanin cone），可通过 `Depth` 调整追踪层数；选择 `Whole module` 则返回完整模块对比。

为避免两种局部裁剪模式冲突，选择 `Output cone` 时会自动清空两侧的 `Focused roots`；反之，当重新设置或追加 `Focused root` 时会自动退出 `Output cone` 模式。左侧 `Design` 面板会实时汇总两侧的单元数、门类型数、估算逻辑深度、最大扇出及其差值与未匹配数量。

---

## 14. SVG、Golden 和状态恢复

### 14.1 导出独立 SVG（Export SVG）

在 Single 视图下点击 `More > Export SVG`，即可将当前画布（整图或 Focused 局部图）导出为自包含的 `.svg` 文件。导出的文件内嵌了完整的导线、跨线桥、文本标签、时序徽标与 CSS 样式，无需联网或外部字体即可在任意浏览器或矢量图工具中打开（Compare 模式专用于双屏交互对比；如需导出对比中的某个模块，请先切回 `Single` 选择对应模块后再执行导出）。

### 14.2 Layout Golden 的保存与恢复

- `More > Save Golden`：将当前模块名称、视图模式（`Whole` / `Focused` / `Search-first`）、Focused roots、扇入/扇出深度、所有节点的位置/尺寸手工覆盖以及导线路径保存为 Golden JSON 文件。
- `More > Load Golden`：加载本地 Golden JSON 文件（请先载入与之对应的网表设计）。
- `More > Reset layout`：清除所有手工校准覆盖，恢复自动布局。

**Golden v3 内容指纹校验**：当前版本生成的 Golden v3 文件会记录网表源码的内容指纹（Source fingerprint）。若网表内容发生实质变化，即使文件名与文件大小碰巧相同，系统也会拒绝错配旧布局；反之，若网表文件仅被重命名但内容未变，仍可正常匹配加载。系统同时向后兼容导入旧版 v1 / v2 Golden 文件。请注意：Layout Golden（保存单模块几何布局与实例显示覆盖）与 `Cell Config`（保存可跨网表复用的单元类型语义）是两种用途不同的独立 JSON 格式。

### 14.3 浏览器标签页会话恢复

在同一浏览器标签页内刷新页面后，系统会自动从 `sessionStorage` 恢复刷新前的工作台状态：

- 当前加载的网表文本与选中的模块
- 视图模式（`Whole` / `Focused` / `Search-first`）、Focused roots（含层次实例路径）、前后向深度与搜索词
- 当前选择的布局引擎（Layout provider）、间距参数、逻辑门符号风格与简化开关
- 当前选中对象、画布缩放平移视口（Pan / Zoom）及手工布局微调

网表会话数据保存在当前标签页的 `sessionStorage` 中，关闭标签页后由浏览器自动清理；而 `Cell Config` 则保存在持久化的 `localStorage` 中长期留存。

---

## 15. Process Log（过程日志）

点击页面底部状态栏左侧的 `Process Log` 按钮可展开或收起过程日志面板。日志按以下处理阶段（Phase）分类记录系统运行轨迹：

- `Import`（文件与文本导入）
- `Parse`（Verilog 词法与语法解析）
- `Timing`（时序日志解析与层级匹配）
- `Graph`（图模型提取与锥体裁剪）
- `Layout`（布局引擎执行与降级诊断）
- `Render`（SVG 场景构建与渐进式渲染）
- `Navigation`（模块切换、搜索定位与历史恢复）
- `Export`（SVG 与 Golden 导出）
- `Launcher`（启动清单加载与初始化）
- `Persistence`（会话与配置保存失败）
- `Runtime`（未捕获异常、未处理的 Promise rejection 和资源加载失败）

**日志面板控件说明**：

- `Level`：按日志级别过滤（`Debug`、`Info`、`Warning`、`Error`）
- `Phase`：按上述处理阶段过滤
- `Auto-scroll`：勾选后自动滚动跟随最新日志条目
- `Copy`：将当前过滤后的日志文本一键复制到剪贴板
- `Export`：将当前日志下载保存为本地文本文件
- `Clear`：清空当前内存中的日志记录

日志默认在当前页面内存中保留最近 500 条，刷新或关闭页面后清空；相邻同阶段、同任务的渐进渲染进度会自动合并。Copy 和 Export 均使用当前过滤结果，导出文件为 `netlist-process-log.jsonl`。

失败条目的 details 可包含错误名称、调用栈、cause、结构化诊断，以及操作、文件、模块、布局引擎或请求编号（以失败边界实际提供的字段为准）。日志对详情递归过滤源码、原始文本、口令和 token 等字段，并限制深度、条数和文本大小；截断及循环引用会显示标记。默认不记录完整的网表、时序或配置原文。主动取消和过期任务不作为当前操作错误报告；全局捕获保留浏览器原有控制台报错行为。应用日志初始化之前的模块加载失败仍需查看浏览器控制台。

当遇到解析报错、布局降级或启动异常时，可展开 `Process Log` 筛选 `Error` / `Warning` 或对应 `Phase`，查看 details 并导出后排查。

会话或 Cell Config 读取失败会记录为 `Persistence` 错误，并继续使用默认状态；自动保存失败会保留底层异常，连续失败只报告一次，恢复后记录 `Session saving recovered`。Cell Config 的保存、删除、重置与导入写入失败均归入 `Persistence`；已保存但刷新失败归入 `Render`。SVG、Golden 和 Cell Config 的生成或下载触发失败归入 `Export`，包含操作及文件名。关闭页面时的保存错误只能在页面仍存活时进入内存日志，不会形成跨会话日志文件。

### 终端与启动器日志

Bash 预览入口、Node/Python 服务、Linux 单文件启动器和 Windows 离线启动器会自动保存终端侧日志。这与页面内的 Process Log 分开：浏览器日志仍需从页面导出，启动器日志用于排查启动、文件读取、HTTP 请求、状态文件清理和退出问题。

- Linux 默认目录：`${XDG_STATE_HOME:-$HOME/.local/state}/netlist_graph_builder/logs`。
- Windows 默认目录：`%LOCALAPPDATA%\netlist_graph_builder\logs`。
- 设置环境变量 `NGB_LOG_DIR` 可指定目录；`log.ready` 诊断会给出当前文件位置。
- 每次启动使用独立的 `<运行时>-<时间>-<PID>.run.jsonl` 和 `.error.jsonl`。前者包含全部级别，后者仅包含 Error；普通 4xx 请求归为 Warning。
- 每个运行时日志文件默认在约 2 MiB 时滚动，保留一个 `.1` 备份；`NGB_LOG_MAX_BYTES` 可设置 1024～67108864 字节的阈值。单条诊断不拆行，文件可超出阈值至多一条有界记录。Bash 只记录交接前的少量事件，后续由接管进程的日志记录。
- 每次启动会清理超过 **14 天** 的旧日志。`NGB_LOG_RETENTION_DAYS` 可设置为 `1`～`3650` 天，`0` 关闭清理；非法值使用默认 14 天。保留期按文件最后修改时间计算，同一次启动的运行日志、错误日志和 `.1` 备份必须全部过期，且文件名中的 PID 已退出，才会清理。PID 被复用或无法确认退出时保守保留。
- 清理只检查指定日志目录的直接子文件，匹配上述五种运行时的日志命名；不递归、不清理其他文件或目录，含符号链接的日志组也会保留。Bash 历史日志由接管它的 Node/Python 服务一并清理；缺少运行时、无法完成交接时不执行清理。清理仅在启动时执行，持续运行期间仍按大小轮转。
- `log.cleanup` 记录保留天数、删除文件数和释放字节数；失败时用 `log.cleanup_failed` 记录失败数量和首个错误，服务与后续日志继续运行。清理不是整组原子操作：部分删除失败时，剩余文件留待下次启动重试。需要长期保留的日志请提前归档到其他目录，或关闭自动清理。

JSONL 每行包含 `time`、`level`、`runtime`、`pid`、`event`、`message`，并按事件附带状态码、操作、异常类型、错误码或调用栈。查询参数和请求正文不进入请求日志，启动输入原文也不附带到日志中。原生 C++ 错误记录系统错误码或异常消息，不承诺提供调用栈。正常请求主要写文件，启动/退出和失败诊断也写入 `stderr`；文件日志不可写时只报告一次故障，随后退回 `stderr`，不会伪装成启动失败。

启动成功时，`stdout` 保留原有单行 `ready` JSON；`status`、帮助和许可证命令的标准输出格式不变。Bash 使用 `exec` 交接，不引入 `tee` 管道或改变进程号、退出码及信号语义。正常退出会尽力记录退出原因/状态；强制结束进程或断电无法保证最后一条日志。

例如，在 Bash 中指定日志位置后启动：

```bash
NGB_LOG_DIR="$PWD/dc_runs/launcher_logs" bash tools/start-preview.sh --port 0 --no-open
```

开发验证可运行 `npm run test:launcher`、`python3 tests/e2e/terminal_logging_e2e.py --native build/native/ngb` 和 `python3 tests/e2e/log_retention_e2e.py --native build/native/ngb`；Windows 包使用对应脚本的 `--windows <exe路径>` 验证。

---

## 16. 快捷键一览

| 快捷键 | 功能说明 | 生效条件 |
| --- | --- | --- |
| `Ctrl+Enter` / `Cmd+Enter` | 提交 `Paste netlist` 或 `Paste timing` 文本 | 文本粘贴导入对话框打开时 |
| `Ctrl+Z` / `Alt+Left` | 视图历史后退（View History Back） | 焦点不在文本输入框内 |
| `Ctrl+Shift+Z` / `Ctrl+Y` / `Alt+Right` | 视图历史前进（View History Forward） | 焦点不在文本输入框内 |
| `F` | 将当前选中的单元居中并放大至阅读尺寸 | 焦点不在文本输入框内且已选中单元 |
| `ArrowUp` / `ArrowDown` | 在搜索下拉候选列表中上下切换 | 顶部搜索框获得焦点时 |
| `Enter` | 激活并定位当前选中的搜索结果 | 顶部搜索框获得焦点时 |
| `Esc` | 收起搜索候选列表或关闭 `Import` / `More` 菜单 | 对应浮层或菜单处于打开状态时 |
| `Ctrl+V` / `Cmd+V` | 全局粘贴并自动识别网表、时序或 Golden | 焦点不在任何可编辑输入控件内 |
| `ArrowLeft` / `ArrowRight` | 按 `16px` 步进调整左侧面板宽度 | 侧栏与画布之间的分隔条获得焦点时 |

---

## 17. EDA/脚本启动接口

关于 Linux 单文件二进制 `ngb` 的 CMake 编译安装、状态文件所有权校验及可复用 Tcl 辅助脚本（`ngb.tcl`），请结合阅读 [Linux 单文件指南](LINUX_SINGLE_FILE_LAUNCHER.md)。Linux 原生启动器 `ngb` 无需安装 Node.js 或 Python，它在绑定端口前仅检查输入文件可读性，具体的网表语法与 Cell Config 结构校验交由浏览器前端完成。

### 17.1 命令行调用示例

**Node.js 启动示例（PowerShell）**：

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

**Python 3 启动示例（Bash）**：

```bash
python3 -u tools/serve.py \
  --netlist "./results/design one.v" \
  --module top \
  --focus u0 \
  --no-open
```

**Windows 离线版启动示例**：

```powershell
NetlistGraphBuilder.exe --netlist design.v --module top --focus u0
```

### 17.2 启动参数说明

| 参数 | 取值说明 |
| --- | --- |
| `--netlist <path>` | 启动时自动加载的 Verilog 网表文件路径 |
| `--timing <path>` | 启动时自动加载的时序日志文件路径 |
| `--cell-config <path>` | 启动时自动加载的 version 1 `Cell Config` JSON 路径 |
| `--module <name>` | 启动后默认打开的模块名称 |
| `--focus <instance>` | 启动后初始聚焦的单元实例名称 |
| `--fanin-depth <0-99>` | 初始 `Focused` 视图的扇入（Fanin）扩展层数 |
| `--fanout-depth <0-99>` | 初始 `Focused` 视图的扇出（Fanout）扩展层数 |
| `--port <0-65535>` | 本地监听端口（传入 `0` 由操作系统自动分配空闲端口） |
| `--no-open` | 仅启动服务，不自动唤起系统浏览器 |
| `--no-browser` | `--no-open` 的向后兼容别名 |

> **安全约定**：当文件路径包含空格时，请按当前 Shell 规范加引号；所有启动器始终仅绑定本地回环地址 `127.0.0.1`，不向局域网或公网暴露端口。

### 17.3 标准输出 Ready JSON 协议

服务成功绑定端口并准备就绪后，会在标准输出（`stdout`）打印单行 JSON 消息，供外层 EDA 宿主进程读取最终访问 URL：

```json
{"event":"ready","host":"127.0.0.1","port":4173,"url":"http://127.0.0.1:4173/?startup=1","startup":{"netlist":"design.v","module":"top","focus":"u0","faninDepth":1,"fanoutDepth":2}}
```

`ready` 消息仅包含文件名摘要与启动目标参数，不包含网表、时序或配置原文。若遇到文件不存在/不可读、参数数值越界、Cell Config 格式非法或指定的 `module` / `focus` 不匹配（Node 预校验），启动器会在监听端口前向 `stderr` 输出明确错误并以非零退出码终止。

---

## 18. 推荐工作流

### 18.1 在大型网表中快速定位并追踪目标单元

1. 导入网表文件（大型模块自动进入 `Search-first` 模式）。
2. 在顶部搜索框输入目标实例名（instance）或线网名（net）。
3. 点击或按回车激活搜索结果，自动进入围绕该对象的 `Focused` 视图。
4. 在左侧调整 `Fanin depth` 与 `Fanout depth` 控制上下文范围。
5. 在左侧 `Selection` 面板中点击上下游关联对象顺藤摸瓜。
6. 浏览过程中随时按 `F` 键将当前选中单元重新居中放大。

### 18.2 排查负 Slack 关键路径周边的门级结构

1. 先导入 Verilog 网表，再导入配套的 Timing 时序报告。
2. 在左侧 `Timing` 面板将 `Snapshot` 设为 `Global` 或 `Local`（或保持 `Auto`），将 `Metric` 设为 `Slack`。
3. 在顶部搜索框检索时序报告中的关键违例单元或端口。
4. 使用 `Focused` 视图观察局部连接（若只需向驱动侧回溯，可将 `Fanout depth` 设为 `0`）。
5. 选中关键单元，在 `Selection` 面板核对各引脚的 `AT`、`RT`、`Slack` 与 `worst pin`。

### 18.3 补充未知标准单元的引脚定义并复用

1. 搜索或点击图中显示为黑盒（`BLACKBOX`）的未知单元实例。
2. 点击左侧 `Cell Config > Edit selected type`。
3. 检查编辑器自动预填的推断值，修正门类型（Gate kind）与各引脚方向（Pin direction）。
4. 点击 `Save`，确认图中所有同类型单元均已更新且来源显示为 `user-config`。
5. 点击 `Cell Config > Export` 导出 JSON 文件，供团队其他成员或 EDA 启动脚本（`--cell-config`）直接加载复用。

### 18.4 手工微调原理图并保存为 Golden

1. 点击左侧 `Adjust layout` 进入手工校准模式。
2. 拖拽调整节点位置、修改尺寸或单实例属性，释放鼠标后检查自动重布线效果。
3. 再次点击 `Adjust layout` 退出校准模式。
4. 点击顶部 `More > Save Golden` 导出保存 `.json` 布局快照。
5. 日后复盘时，先加载同一份网表，再点击 `More > Load Golden` 即可完整还原当时的视图与微调布局。

### 18.5 对比优化前后的两个模块（Resyn vs. Flex）

1. 加载同时包含优化前后两个模块的网表文件。
2. 点击顶部 `Compare` 按钮，在左侧确认系统自动推荐的 `Left` 与 `Right` 模块配对并点击 `Apply`。
3. 查看左侧 `Design` 统计面板的单元数量、逻辑深度差值及画布上的红/绿差异高亮。
4. 在 `Output cone` 下拉框中选择共有输出端口，同步比对两侧的扇入逻辑锥结构。
5. 点击两侧的关键单元或线网进行跨侧高亮定位。

---

## 19. 常见问题与限制

### 19.1 导入网表后显示 Search-first 提示页而没有直接画图？
这是针对超过 500 个单元的大模块的预期性能保护机制。请直接使用顶部搜索框检索目标单元/线网进入 `Focused` 局部视图，或显式点击左侧的 `Whole` 按钮渲染全图。

### 19.2 打开 Cell Config 编辑器时显示为 BLACKBOX？
当某单元类型尚未保存自定义配置时，编辑器会展示内置规则的推断结果；若该命名完全不在内置规则库中，则默认显示为 `BLACKBOX` 与 `unknown` 引脚。请手动指定正确的 `Gate kind` 与引脚方向并保存，保存后可在 `Selection` 面板确认其推断来源已变为 `user-config`。

### 19.3 修改并保存 Cell Config 后为什么图形布局发生了变化？
修改引脚的 `input` / `output` 方向会直接改变图中的驱动（driver）与负载（load）拓扑流向，因此必须重新提取图并计算布局。对于大型模块，系统会自动保持当前的 `Focused` 局部视图，避免触发全图重排。

### 19.4 导入 Timing 文件后画布上没有任何时序徽标？
请依次排查以下几项：
- 时序日志中的 `Module` / `scope` 名称是否与当前加载的网表模块名匹配。
- 日志中的实例或线网层次路径后缀是否能在当前模块中找到唯一对应项。
- 表头行、`[Global]` / `[Local]` 标记行与数据行之间是否保留了正常换行。
- 表头声明的列数是否与数据行的数值列数一致。
- 展开底部 `Process Log` 并按 `Timing` 阶段过滤，同时查看左侧 `Diagnostics` 面板的具体告警提示。

### 19.5 Whole 整图模式下画面显得非常细长或渲染较慢？
`Whole` 模式会完整布局并渲染模块内的所有单元与连线。遇到数千单元的大模块或上千级串行长链时，建议优先采用 `Search-first` 与有限深度的 `Focused` 视图，并保持 `Fanout hubs` 开启（产品已不再使用结构分组折叠作为大图路径）。

### 19.6 Compare 模式中的红色虚线是否代表电路逻辑不等价？
**不是**。Compare 模式仅根据端口/线网名称、方向、逻辑门类别及图统计量进行启发式结构对比，并非形式化等价验证（LEC）。红色仅提示“该结构对象在命名或门类型分布上存在差异”，绿色也不代表两侧逻辑功能完全等价。

### 19.7 为什么 Layout Golden 文件无法载入？
请确保已先加载了与该 Golden 对应的网表文件。Golden v3 会严格校验领域标识、模块名以及网表内容指纹（fingerprint）：一旦网表内容发生修改，即使文件名相同也会被安全拒绝，防止将旧坐标错配到新网表上。状态栏与 `Process Log` 会给出拒绝的具体原因。

### 19.8 刷新页面与关闭标签页后，哪些数据会保留？
在同一标签页内按 `F5` 刷新，会自动从 `sessionStorage` 恢复当前网表、模块、聚焦视图与视口状态；关闭标签页后，`sessionStorage` 中的网表会话会由浏览器自动清理。而在 `Cell Config` 中保存的单元类型定义存储在 `localStorage` 中，关闭浏览器后依然长期保留（除非手动点击 `Delete` / `Reset all` 或清除浏览器站点数据）。

### 19.9 运行时安全与离线边界是什么？
- **100% 离线运行**：浏览器端与启动器在运行期间均不发起任何外网请求。
- **仅限本机回环**：内置 HTTP 服务始终只绑定 `127.0.0.1`。
- **XSS 转义保护**：所有来自网表、时序日志、Golden 或用户输入的标识符文本在插入 HTML / SVG 前均经过严格的字符转义。
- **最小化日志输出**：`Process Log` 与命令行 `ready` JSON 均不输出完整的网表、时序或配置原文。

### 19.10 为什么点击搜索结果、`+ Focus`、`Add selected` 与 `Set selected as Focused` 的效果不同？
这是为了在“画布内定位”与“增删聚焦根节点”之间提供清晰、可预期的区分：
- **点击已在当前画布绘制的搜索结果**：仅选中并将视口居中定位到该对象，**不修改**当前的 Focused roots 集合。
- **点击未在当前画布绘制的单元搜索结果**：自动将其**追加**到现有 Focused roots 中并展示局部图。
- **点击搜索结果右侧的 `+ Focus` 或左侧 View 区的 `Add selected`**：显式将目标**追加**到现有 Focused roots。
- **点击左侧 View 区的 `Set selected as Focused`**：显式**清空旧集合**，仅以当前选中对象作为唯一的 Focused root。

若当前 Focused roots 已达 32 个上限，继续追加会被拒绝，请先移除不再需要的 root chip。跨模块搜索会自动切换至目标模块的独立工作区，不会将原模块的 roots 混入新模块。
