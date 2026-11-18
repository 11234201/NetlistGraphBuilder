# Netlist Graph Builder 完整使用教程

本教程面向使用 **Netlist Graph Builder** 阅读、追踪与对比门级结构化 Verilog 网表的工程师，全面覆盖当前版本的各项用户功能：数据导入、全局搜索、大图局部聚焦浏览、时序标注、单元语义配置（Cell Config）、手工布局校准（Adjust）、双模块对比（Compare）、过程日志（Process Log）、离线导出以及 EDA 脚本集成，并介绍独立的 AIG 导入、浏览与逻辑分析流程。

- **网表默认布局与降级机制**：当前版本默认启用 `AnchorLayered` 布局引擎；若布局失败，会按 `AnchorLayered → ELK → Simple` 顺序自动降级，且临时自动降级不会覆盖用户已保存的首选项。
- 本教程对应 `v1.6.0`。大型 AIG 可先索引再布局；Show Path 可比较各输入到指定终点的级数。升级时请完整解压同一版本的程序包，并核对随附的 SHA-256 校验值。
- **Linux 与 EDA 集成**：关于 Linux 单文件二进制、CMake 嵌入构建与 EDA/Tcl 辅助脚本的详细说明，请参阅 [Linux 启动指南](LINUX_SINGLE_FILE_LAUNCHER.md)。

## 近期核心功能速览

| 功能特性 | 使用入口 | 核心要点 |
| --- | --- | --- |
| **Show Path** | 工具栏 `Show Path → Apply → Path information` | 设置单个或多个终点，查看各输入和内部节点到终点的逻辑级数。Focused 视图仍可识别画面外端点。 |
| **AIG 导入与分析** | `File → Open AIG…`、Navigator → `Analysis` | 支持 ABC AIG DOT 与平坦两输入组合 BLIF；提供 Standard / Logic View 视图、结构重汇聚、XOR / XNOR / MUX 识别、对象筛选与来源追踪，支持高亮、SVG 导出与刷新恢复。 |
| **左右面板隐藏与恢复** | 面板标题 `Hide`、顶部 `Navigator` / `Inspector` | 可分别收起两侧面板，为画布让出空间；顶部开关可随时恢复面板，保留当前阅读位置，停靠状态、宽度与页签自动记忆。 |
| **Liberty 标准单元库** | `Settings → Liberty`、拖放与全局粘贴 | 离线加载、替换、取消与卸载文本 `.lib`，利用库方向和有界布尔 `function` 增强单元识别，保留人工配置优先级。 |
| **指定 Net 不布线** | `Inspector → Connections → Net routing` | 支持为 `clk`、`reset` 或任意选定线网单独关闭/恢复布线，保留完整连接详情与 Focused 追踪；Single 与 Compare 两侧独立。 |
| **标准 STA 时序与 Metric 过滤** | `Settings → Timing`、Inspector 的 `Timing` 页签 | 全面支持工业级标准 STA 表格与 JSON 格式导入，驱动源自动沿 `assign` 链回溯；全局菜单提供 `Worst Slack`、`AT`、`RT`、`Delay`、`Slew`、`All` 与 `None` 模式，支持自定义 Slack 判定阈值（默认 0.0）；对象页签提供详情及徽标覆盖。 |
| **Cell / Net 聚焦视图** | 顶部 Search、Inspector 操作区 | 支持将 Cell 或 Net 设为聚焦根节点（root）；点击未绘制的搜索结果默认追加为 root，`Add to Focused` 显式追加，`Replace roots` 显式替换全部 roots。 |
| **Focused roots 管理** | 画布上方 `Roots` 菜单 | 可筛选 root chips；点击 chip 激活并居中对应 root，点击 `×` 或 `Remove selected` 移除单个 root，`Clear roots` 清空全部 roots（最多 32 个）。 |
| **分层连接展示** | Inspector 的 `Connections` 页签 | `Connections / Current module` 仅展示当前模块定义内的连接；`Hierarchy / Parent occurrence` 独立展示穿过当前模块端口边界延伸至父层实例的连接，长表分页显示。 |
| **标准逻辑门符号切换** | `Settings → Display > Gate symbols` | 支持在 `Rectangles`（标准矩形）与 `Conventional`（约定逻辑门符号，含反相气泡）之间一键切换，不改变节点边界、引脚坐标或布线路径。 |
| **UNIT 门标题** | 画布门中心、Inspector | `UNIT_ADFFR_PN_GATE` 的画布标题为 `ADFFR_PN`；内部下划线与数字保留。实例的显式标题优先，详情保留完整 cell type。 |
| **统一视图历史** | 顶部 `←` / `→`、`Ctrl+Z` / `Ctrl+Y` | 事务化记录并恢复模块切换、视图模式、Focused roots 与深度、当前选中项、视口缩放平移及手工布局微调。 |
| **Compare roots 同步** | Compare 配置行 `Sync & cone` | `Sync Focus roots` 控制对一侧聚焦根节点的追加、移除和清空操作是否自动同步至另一侧匹配的单元，与视口同步独立。 |
| **模块层次树导航** | `Navigator > Hierarchy` | 按模块或实例筛选，按实例层次展开并点击切换模块；上下文栏显示模块与实例路径。遇到递归或超大层次时有界截断（最多 2000 节点、深度 64）。 |
| **间距数字输入与引脚转角** | `Settings → Layout` 与布线器 | `Wire spacing` 与 `Cell spacing` 除滑块外支持直接输入数字（提交后自动吸附至最近的 4 的倍数）；连接单元顶部/底部引脚的末段连线预留可见转角，近距离走线依然清晰可辨。 |
| **高可靠恢复与批量导入** | Golden、Session、快速输入 | Golden v3/v4 校验网表内容指纹（fingerprint）并恢复聚焦深度；多文件拖放/粘贴严格按“Liberty（如有）→ 网表 → 时序 → Golden”依赖顺序串行完成。 |

## 目录

- [近期核心功能速览](#近期核心功能速览)
- [隐藏、恢复与调整左右面板](#21-隐藏恢复与调整左右面板)
- [新版入口速查](#23-新版入口速查)
- [在布局前筛选 AIG](#在布局前筛选-aig)
- [Show Path 路径与逻辑级数](#show-path-路径与逻辑级数)
- [AIG 图浏览](#aig-图浏览)（含 [结构分析](#aig-重收敛与逻辑块)、[点相关查询](#aig-从节点查找相关结构)、[结构分析练习](#aig-结构分析练习)、[最小示例](#aig-最小示例) 与 [常见问题](#aig-常见问题)）

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
14. [SVG、Golden 和状态恢复](#14-svggolden-和状态恢复)
15. [Process Log](#15-process-log过程日志)
16. [快捷键](#16-快捷键一览)
17. [EDA/脚本启动接口](#17-eda脚本启动接口)
18. [推荐工作流](#18-推荐工作流)
19. [常见问题与限制](#19-常见问题与限制)
- [附：AIG 图浏览专章](#aig-图浏览)

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

**能力边界说明**：本工具并非完整的 Verilog / SystemVerilog 编译器，亦不提供形式化逻辑等价验证（Formal Equivalence Checking）。当前同时提供 Netlist 与 AIG 工作区：AIG 支持 ABC AIG DOT 和平坦两输入组合 BLIF，尚不支持 AIGER（`.aag` / `.aig`）。下文第 3–18 节的网表功能不全部适用于 AIG，具体操作与边界见 [AIG 图浏览](#aig-图浏览)。

### 1.1 Windows 离线版

1. 完整解压 `NetlistGraphBuilder-v<version>-win-x64.zip`。
2. 双击运行 `NetlistGraphBuilder.exe`。
3. 启动窗口会在本机 `127.0.0.1` 启动本地服务并自动打开默认浏览器。
4. 使用期间请勿关闭启动控制台窗口；需要退出时在窗口内按 `Ctrl+C` 或直接关闭该窗口。

> **注意**：请勿单独复制 `NetlistGraphBuilder.exe` 到其他目录运行，它依赖同级目录中的 `app/` 前端资源文件夹。发布压缩包内同时包含 `examples/` 示例网表、`README.md`、`CHANGELOG.md`、本教程 `USER_GUIDE.md` 以及 `ELKJS-LICENSE.md`、`VIZ-LICENSE.txt`、`GRAPHVIZ-LICENSE.txt` 和 `EXPAT-LICENSE.txt`。

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

网表工作台按全局操作、当前视图与对象详情分区；打开 AIG 后会切换为专用工具栏和面板：

- **全局栏**：`File` 汇集导入、导出 SVG 与 Golden 存取；`Settings` 集中管理显示、布局、时序、Liberty 库和单元类型定义；Search、Compare/Single 和 `?` 帮助入口保持可见。
- **上下文工具栏**：显示模块/实例路径和视图模式，提供历史 `←` / `→`、Whole/Focused、Show Path、Fit view、Adjust、对象摘要及 Navigator/Inspector 开关。
- **Navigator**：左侧的 `Hierarchy` 页签用于筛选和浏览模块实例树，`Design` 页签显示当前设计或 A/B 对比统计。
- **Inspector**：右侧显示所选对象的名称、类型和 Single/A/B 来源。`Connections`、`Timing`、`Adjust` 页签分别显示连接、对象时序和实例覆盖；`Edit cell type…` 打开类型级定义编辑器。
- **中央主画布**：渲染当前模块的交互式 SVG 原理图，或在 Compare 模式下分屏展示两个模块的画布。
- **底部状态栏**：展示最新操作状态与布局 provider，`Diagnostics` 和 `Log` 带计数，可分别展开诊断和过程日志抽屉。

Compare 模式会在画布上方显示 A/B 配置行；Focused 模式会显示 `Roots`、`Fanin` 和 `Fanout` 控件，不必在长侧栏中寻找。

**界面交互细节**：

- 菜单可再次点击、点击外部或按 `Esc` 收起。`?` 打开操作帮助；非编辑状态下按 `/` 可直接搜索。
- 长名称可完整查看和复制，宽时序表仅在表内横向滚动。

### 2.1 隐藏、恢复与调整左右面板

| 需要做什么 | 操作 | 结果 |
| --- | --- | --- |
| 隐藏左侧导航 | 点击 Navigator 标题旁的 `‹ Hide`，或顶部 `Navigator` | 导航收起，停靠时占用的宽度交还画布 |
| 隐藏右侧详情 | 点击 Inspector 标题旁的 `Hide ›`，或顶部 `Inspector` | 详情收起，停靠时占用的宽度交还画布 |
| 两侧都隐藏 | 分别收起仍展开的两侧面板 | 画布占满工作区宽度，顶部工具栏仍可使用 |
| 恢复某侧面板 | 点击顶部 `Navigator` 或 `Inspector` | 打开对应面板；开关高亮表示展开 |
| 查看当前选择详情 | 点击顶部对象名称摘要，或 `Inspector` | 打开 Inspector，显示当前选中对象 |
| 调整停靠面板宽度 | 拖拽面板与画布之间的分隔条 | Navigator 可调至 220–360px，Inspector 可调至 320–560px |

隐藏面板后，顶部开关仍可见。停靠面板可独立恢复；窄屏下两侧均为抽屉时，打开一侧会收起另一侧。主动隐藏 Inspector 后，再次点击图中对象只更新选择和顶部摘要，不强制弹出详情。页面宽度小于 `1024px` 时，顶部对象摘要会收起，请使用 `Inspector` 开关查看选择详情。

这些操作适用于 Single、Focused 与 Compare。开合或调宽保持当前图中心和阅读比例，不重新计算布局、不修改网表或 Focused roots。若想让整幅当前图重新适配更大的画布，显式点击 `Fit view`；Compare 中该按钮适配 A/B 两侧。

键盘操作：用 `Tab` 移到面板开关或 `Hide`，按 `Enter` / `Space` 激活。停靠分隔条获得焦点后，左右方向键按每次 `16px` 调宽；面板内页签可用方向键和 `Home` / `End` 切换。

### 2.2 窗口宽度与界面偏好

未保存面板偏好时，按浏览器页面可用宽度采用以下默认布局（不是显示器物理分辨率）：

| 页面宽度 | Navigator | Inspector |
| --- | --- | --- |
| ≥ 1600px（如 1920px） | 默认停靠并展开，宽 240px | 默认停靠并展开，宽 336px |
| 1280–1599px（如 1366/1440px） | 默认关闭，点击后以抽屉覆盖画布 | 默认停靠并展开，宽 320px |
| < 1280px | 默认关闭，按需打开抽屉 | 默认关闭，按需打开抽屉；两侧同时只开一个 |

抽屉打开时覆盖部分画布，不压缩画布宽度；点抽屉外部或按 `Esc` 可关闭（若有浮层，`Esc` 先关闭顶层浮层）。抽屉模式不显示拖宽分隔条。

面板开关、宽度与最近页签单独保存在当前浏览器、当前站点地址的界面偏好中；已保存的开关优先于停靠默认值。刷新时抽屉不会自动弹出，需手动打开。更换浏览器、主机名或端口会使用另一份站点存储；清除站点数据也会清除这些偏好。网表会话与 Golden 的保存范围见 [14. SVG、Golden 和状态恢复](#14-svggolden-和状态恢复)。

### 2.3 新版入口速查

| 要找的功能 | 当前入口 |
| --- | --- |
| 原 Import 菜单的文件和文本导入 | 全局栏 `File` 的 `Import` 分组 |
| 打开或取消 AIG 图导入 | 全局栏 `File` → `Open AIG…` / `Cancel AIG import` |
| 导出 SVG、保存/加载 Golden | 全局栏 `File` 的 `Export & snapshots` 分组；Compare 可从已启用的 Show Path 报告导出所选侧 |
| Liberty 标准单元库管理 | 全局栏 `Settings → Liberty` → `Load .lib` / `Cancel import` / `Unload` |
| 模块层次、设计统计 | 顶部 `Navigator` → `Hierarchy` / `Design`（AIG 模式下为 `Design` / `Objects`） |
| 原 Selection 对象详情、对象时序与实例调整 | 顶部 `Inspector` → `Connections` / `Timing` / `Adjust`（AIG 模式下为 `Connections` / `Analysis` / `Source`）；实例调整需开启上下文栏 `Adjust` |
| 指定某条 net 不布线 | 选中线网后在 `Inspector` → `Connections` → `Net routing` 取消勾选 `Route net` |
| 布局引擎、间距、恢复手工覆盖 | `Settings → Layout` |
| 别名与门符号显示 | `Settings → Display` |
| 全局时序指标与违例阈值 | `Settings → Timing` |
| 聚焦根与扇入/扇出深度 | Focused 画布上方的 `Roots`、`Fanin`、`Fanout` |
| Cell Config 类型定义 | 全局栏 `Settings → Cell Config`；选中单元后也可点 Inspector 的 `Edit cell type…` |
| 诊断与过程日志 | 底部状态栏 `Diagnostics` / `Log` |
| Compare 配对与同步 | Compare 画布上方的 A/B 选择器、`Apply`、`Split`、`Sync & cone` |

---

## 3. 导入网表、时序和配置

### 3.1 File 菜单中的 Import 分组

点击全局栏的 `File`，其 `Import` 分组提供以下导入入口：

- `Open AIG…`：选择 ABC AIG DOT 或平坦两输入组合 BLIF，进入独立 AIG 工作区，详见 [AIG 图浏览](#aig-图浏览)。
- `Open design`：从本地选择 `.v`、`.sv`、`.dot`、`.blif` 或 `.txt` 文件，自动识别 Verilog / AIG。Windows 文件选择器包含 `.blif`；保存为 `.txt` 的 AIG 也可按内容识别。
- `Paste netlist`：在弹窗中直接粘贴结构化 Verilog 代码，点击 `Draw`（或按 `Ctrl+Enter` / `Cmd+Enter`）立即解析绘图。
- `Paste AIG…`：粘贴 ABC AIG DOT 或 `.model` / `.names` 格式的两输入组合 BLIF，点击 `Draw` 或按 `Ctrl+Enter` 绘图；失败时保留输入与上一张图。
- `Open timing`：从本地选择 `.log`、`.txt`、`.rpt`、`.timing`、`.csv`、`.tsv` 或 `.json` 时序报告文件。
- `Paste timing`：在弹窗中粘贴时序文本并明确按 Timing 格式解析（避免短小的时序片段被自动识别逻辑误判为 Verilog）。

成功导入新网表后会替换当前 Design，并同步重建模块列表、搜索索引、诊断信息及视图状态；若新输入解析失败，系统会报错并安全保留此前已成功加载的 Design。

**超大文本粘贴优化**：当粘贴超过 256 KiB 字符的大网表或长时序文本时，输入框会在内存中完整保留原文，但界面仅渲染带提示的头部预览片段，从而避免浏览器因渲染和全选数万行文本而卡顿。预览状态下可直接粘贴新内容替换，按 `Ctrl+A` / `Cmd+A` 后复制仍会复制完整原文，点击 `Draw` 也会提交完整原文；点击“清空”可移除文本，若确实需要手动修改其中内容，可点击“展开编辑”切换回完整原生文本框。

### 3.2 拖放与全局粘贴

除使用顶部菜单外，还可直接将文件拖放到页面任意位置，或在焦点不处于任何文本输入框时直接按 `Ctrl+V` / `Cmd+V`。系统会自动识别以下内容：

- 结构化 Verilog 网表（`.v` / `.sv` / `.txt`）
- 时序报告文本（Timing log）
- 布局快照文件（Layout Golden `.json`）
- Liberty 文本库（`.lib`）

自定义单元配置（Cell Config）请通过全局栏 `Settings → Cell Config > Import definitions…` 或命令行启动参数载入；AIG 文件（`.dot` / `.blif`）及文本也支持拖放和全局粘贴，或使用 `File → Open AIG…` / `Paste AIG…`。

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

### 3.4 批量导入顺序与失败保护

当一次性拖入或粘贴多个文件时，系统会严格按照 **“Liberty（如有）→ 网表 → Timing → Golden”** 的依赖顺序串行执行：

- **前置失败即中止**：若前置步骤（例如 Liberty 或网表解析）失败，状态栏会立即报告错误并终止后续依赖步骤，绝不会将未生效的后续文件伪装为导入成功。
- **单份库文件约束**：单次批量操作至多接受一份 `.lib` 文件；若同一批次包含多份 Liberty 文件，系统会整体拒绝并提示，避免按文件排列顺序隐式挑出某一个工艺角（Corner）。
- **活动视图保护**：无论是导入新网表、替换 Liberty 还是切换到 AIG 工作区，均在后台完成新输入的解析与校验后再切换视图；失败或中途取消不会破坏当前正在浏览的画面。

### 3.5 Liberty 库

`Settings → Liberty`展开独立库管理面板（不占用左侧导航栏），用于加载、替换、取消和卸载标准单元库（`.lib`）：

- **导入与生命周期**：
  - 点击 `Load .lib` 选择文件，或直接将 `.lib` 拖入页面、在非输入框位置粘贴 `library(...) { ... }` 文本；支持先加载库再加载网表。
  - 再次点击 `Liberty` 按钮、按 `Esc` 或点击面板外部仅收起下拉面板，不会卸载库或中断后台扫描；如需中止正在扫描的大库，请点击面板内的 `Cancel import`。
  - 每次成功导入会替换当前库，并立即刷新 Single 或 Compare 两侧的连接方向与门类型；点击 `Unload` 可卸载当前库并恢复无库推断语义。
  - 若遇到语法错误、超限或同名 `cell` 冲突，系统会拒绝新库并安全保留此前已生效的库。单个文件中允许包含多个名称不同的 `library` 块，但 `cell` 名称必须全局唯一。
  - 当前加载的 Liberty 库仅保存在页面内存中，刷新或重新打开标签页后需重新加载，不会写入 `Cell Config`、`sessionStorage` 或 Golden 文件。
- **语义推断优先级与诊断**：
  - 选中单元后，Inspector 会显示库名、源文件名及原始布尔 `function`；当引脚方向取自库声明时，来源标记为 `library`。
  - 网表中存在真实 `module` 定义的层次化子模块始终遵循其自身的模块端口声明；对于原语（leaf）单元引脚，方向优先级从高到低依次为：**单实例 `Adjust` 覆盖 > `Cell Config`（含显式 `unknown`）> Liberty 库声明 > 内置命名规则**。
  - 缺失 `cell` / `pin` 或人工配置与库声明冲突时，底部 `Diagnostics` 会给出明确说明；电源/地引脚（`pg_pin`）与内部引脚不作为信号连线绘制。
- **支持子集与容量边界**：
  - 支持标量接口、`pg_pin`、`ff` / `latch` 标记、三态标记，以及带显式 `type` 位范围的同方向 `bus`。常见 `AND` / `NAND` / `OR` / `NOR` / `XOR` / `XNOR` / `BUF` / `INV` / `MUX` 采用有界布尔识别；复杂逻辑、常量、多输出、锁存器与三态单元保持保守展示。库管理面板展示前 20 条解析/语义告警（完整告警保留在库模型中）。
  - 文本大小上限为 **64 MiB**（UTF-8），单个 token 上限为 **1 MiB** 字符；超限报错会指明限制项及可用的行列位置。暂不支持 `include_file`、`.lib.gz`、二进制 `.db`、`bundle` 位映射及 `bus` 成员区间简写。Liberty 导入仅服务于连接方向与门类型识别，不执行 STA 延时/Slack 计算；命令行启动器暂不设 `--liberty` 参数。

---

## 4. Module 与层次导航

### 4.1 选择模块

点击上下文栏的 `Navigator`，在 `Hierarchy` 页签按模块名或实例名筛选并选择目标；也可通过全局 Search 搜索模块。切换模块后画布将展示对应模块的结构；若目标模块的单元数量超过大图阈值（500 个单元），将自动进入 `Search-first`（搜索优先）模式，避免因一次性全图布局造成等待。Compare 中通过画布上方的 A/B 选择器配对，返回 Single 后继续层次导航。

### 4.2 Module hierarchy 列表

`Navigator > Hierarchy` 展示模块实例层次树，可查看从顶层模块向下的实例路径并点击切换当前模块。为防止递归例化或超大规模芯片层次耗尽内存，层次树采用有界展开策略：**最多展开 2000 个节点、最大嵌套深度 64 层**；达到上限时会显示 `More instances omitted` 截断提示，遇到递归引用时会标记 `cycle`（这仅代表显示保护生效，并不表示网表解析出错）。

列表中普通项格式为 `instance : module`（表示某实例名及其引用的模块定义），顶层根节点仅显示模块名。当前激活的实例节点会高亮显示，上下文栏与层次树标题展示 `module @ instance/path`，指示当前所在的实例上下文（Occurrence context）。

### 4.3 双击进入子模块（hinst 钻取）

当画布中的某个单元实例（Hierarchical instance，简称 `hinst`）引用了当前网表中真实存在的子模块定义时，在画布上**双击该实例**即可直接钻取进入对应的子模块实例（occurrence）上下文。真实子模块的端口方向严格取自其自身的 `module` 端口声明，不会被 `Cell Config` 覆盖。

### 4.4 视图历史前进与后退（View History）

上下文工具栏的 `←`（后退）与 `→`（前进）按钮基于统一的事务化视图历史（View History），完整记录并恢复以下状态：

- 当前打开的 Module 及层次实例路径（Occurrence breadcrumb）
- 视图模式（`Whole` / `Focused` / `Search-first`）
- `Focused` 根节点集合（roots）与前后向追踪深度（Fanin / Fanout depth）
- 当前选中的对象（Selection）
- 画布视口缩放倍率与平移位置（Pan / Zoom viewport）
- 已提交的节点位置/尺寸手工校准（Overrides），以及 Compare 模式下左右两侧各自的选中项、Focused roots、视口与 Output cone 状态

**快捷键**：在非文本输入状态下，可使用 `Ctrl+Z`（后退）、`Ctrl+Shift+Z` 或 `Ctrl+Y`（前进），同时兼容 `Alt+Left` 与 `Alt+Right`。当后退至历史节点并执行新的视图修改操作时，原有的前向（Forward）分支会被自动裁剪；导入新网表设计时会清空旧历史栈。当光标处于文本输入框内时，快捷键不会拦截浏览器原生的文本撤销功能。

### 4.5 逻辑门符号切换（Gate symbols）

`Settings → Display > Gate symbols` 可在两种渲染符号风格之间无缝切换：

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

- `/`：在非编辑状态下聚焦全局搜索；输入法组合或模态对话框打开时不触发
- `ArrowDown` / `ArrowUp`：在下拉候选列表中上下移动焦点
- `Enter`：激活当前高亮的搜索结果
- `Esc`：收起搜索候选列表
- 点击输入框右侧 `×`：清空搜索关键词

**搜索结果的激活与聚焦行为**：

- **点击结果主体或按 `Enter`**：
  - 若目标对象已经存在于当前画布的已绘制图中，则**仅选中并将视口居中定位到该对象**，不会改写现有的聚焦根节点。
  - 若目标单元未在当前画布中绘制（例如处于 `Search-first` 空画布或当前 `Focused` 邻域之外），则自动进入 `Focused` 视图，并将该对象**追加**到现有的 Focused roots 集合中（保留此前已聚焦的根节点）。
- **点击结果右侧的 `Add…` → `Add to Focused`**：无论目标对象当前是否已绘制，均显式将其追加至 Focused roots 并进入 `Focused` 视图（若已在 roots 集合中则不重复添加）。
- **跨模块结果隔离**：激活位于其他模块的搜索结果时，系统会先切换至目标模块的工作区；原模块的 Focused roots、选中状态和手工布局微调不会串入目标模块。若目标模块此前已访问过，会自动恢复其自身的独立工作区状态。

---

## 6. 画布、选择和连接追踪

### 6.1 缩放、平移与一键适配（Fit）

- **滚轮缩放**：以当前鼠标指针所在位置为中心放大或缩小画布。
- **拖拽平移**：在画布空白区域按住鼠标左键拖动即可平移视图；平移距离严格按 SVG 实际等比例尺度换算，即便在超大长宽比图放大至极限倍率时，画面依然严格跟随鼠标移动距离。
- **上下文栏 `Fit view` 按钮**：将当前 Single 原理图或 Compare A/B 两侧原理图完整适配至各自的可视窗口中央。
- **动态最大倍率与低缩放细节隐藏（LOD）**：系统会根据画布实际宽高动态提升超宽或超高图的最大放大倍率上限（保证典型 `220px` 宽度的单元在屏幕上可放大至约 `440px` 的清晰阅读尺寸）。当缩放倍率低于 `0.65` 时，为保证交互帧率与主干结构可读性，引脚名、线网标签、单元元信息和时序文字会自动暂时隐藏，放大后立即恢复。

### 6.2 选择对象与跨层连接追踪

单击画布中的单元（Cell）、端口（Port）或导线（Wire）后，右侧 Inspector 会展示该对象摘要和来源（Single，或 Compare A/B），并在 `Connections` 页签展示属性与连接关系：

- **Cell**：显示单元类型、推断的逻辑门类别（gate kind）、推断来源（inference source）、各引脚方向、连接的线网、相邻驱动/负载端点以及直接扇入（Fanin）/ 扇出（Fanout）列表。
- **Port**：显示端口方向、内部连接线网及相邻单元。
- **Net**：显示驱动源（driver）、所有负载端（loads）及路径端点。

Inspector 中所有以可点击按钮呈现的 `Net`、`Driver/Load`、`Connected`、`Fanin` 和 `Fanout` 条目均支持**点击连续追踪**：若点击的目标对象已绘制则直接选中并居中；若目标处于当前局部聚焦图之外，系统会在当前模块内自动扩展或建立包含目标的 `Focused` 局部视图，而不会退回耗时的 `Whole` 整图模式。

对象摘要提供完整名称与复制入口；滚动详情时摘要与页签固定可见，超长摘要在自身区域内滚动，避免占满 Inspector。连接/层次表超过 100 行、关联目标列表超过 20 项时分页显示，可用页码继续查看全部数据；分页仅限制当前 DOM 数量，不减少模型中的连接。切换 Connections/Timing/Adjust 时对象摘要保留；Timing 宽表在自身区域内横向滚动。

**本层连接与父层跨边界连接（Connections vs. Hierarchy）**：

Inspector 的 `Connections` 页签将连接关系清晰划分为两个独立区域：

1. **`Connections / Current module`**：仅展示当前模块定义（Module definition）内部的引脚、线网、驱动与负载。例如在顶层 `hierarchy_demo_top` 中选中子模块实例 `u_compute_left` 时，其输入连接仅定位到本层线网；子模块内部的端口（如 `compute_cluster.a`）属于子实例内部接口，不会混入父层列表（欲进入子模块内部请直接双击该子模块实例）。
2. **`Hierarchy / Parent occurrence`**：采用独立强调底色与 `Parent` 徽标，**仅在当前选中对象连接到了当前模块的输入/输出端口边界（Boundary port），且当前模块处于明确的父层实例上下文（即通过 `Module hierarchy` 树或双击 `hinst` 进入）时显示**。
   - 顶层模块没有父实例，因此不显示 `Hierarchy` 区。
   - 当双击 `u_compute_left` 进入 `compute_cluster @ u_compute_left` 后，若选中与边界端口 `a` 相连的内部线网或单元，`Hierarchy` 区便会列出穿过边界延伸至父层的 `hierarchy_demo_top.a`。
   - 点击带 `Parent` 标记的父层线网或单元时，系统会自动切换回父层实例上下文，清空原层级的 Focused roots，并以目标父层对象建立新的 `Focused` 视图。
   - 若某个被多处例化的子模块仅按定义名打开（未指定具体属于哪一个实例路径），系统不会盲目猜测父实例，而是在 Navigator 中展示显式实例选择器（Occurrence chooser），供用户指定要追踪的具体实例路径。

> **小贴士**：单击画布空白处可清除当前选中状态；按住画布拖拽平移**不会**取消已选中导线的高亮，方便沿着长线网一路拖动追踪到远端负载。

### 6.3 居中放大所选对象（Zoom to selection）

选中单元或线网后，点击 Inspector 的 `Zoom to selection`，或在非输入框状态下直接按下快捷键 `F`：

- 若对象已在当前画布中绘制，仅调整视口并将其放大至稳定的阅读尺寸（单元约 `320px` 视觉宽度），不改变 roots；线网定位至可见连接路径。
- 若该单元不在当前局部图中，系统会先以它为中心建立 `Focused` 局部图，随即将视口居中定位到该单元。

### 6.4 管理聚焦根节点（Focused roots）

Inspector 与画布上方的 `Roots` 菜单提供显式的根节点集合管理操作（支持以选中的 **Cell** 或 **Net** 作为聚焦根）：

- Inspector 的 `Replace roots`：用当前选中的 Cell 或 Net **替换**全部已有的聚焦根节点，适合开启一段全新的局部路径分析。
- Inspector 的 `Add to Focused`：保留已有聚焦根节点，将当前选中对象**追加**为新的根节点。
- `Roots > Remove selected`：从聚焦根节点集合中仅移除当前选中的根节点。
- `Roots > Clear roots`：清空全部聚焦根节点（大型模块将返回 `Search-first` 提示页，中小型模块将返回 `Whole` 整图）。

`Roots` 菜单中的 **root chips** 实时展示当前的根节点集合（最多容纳 **32 个 roots**），可输入名称筛选；画布上方同时显示数量和摘要：
- 点击任意 chip 可将其设为当前激活根节点（active root）并将视口居中定位到该对象，无需重新计算布局。
- 点击 chip 右侧的 `×` 仅移除该根节点。
- 在执行追加、移除或激活操作期间，当前设置的 `Fanin depth` 与 `Fanout depth` 保持不变。

### 6.5 指定 net 不布线

点击画布中的导线，或在单元的 `Connections` 页签中点击目标 net 名称，随后在 `Inspector > Connections > Net routing` 区域取消勾选 `Route net / 布线`，即可跳过 `clk`、`reset` 或任意选定 net 的几何连线绘制：

- **默认与别名联动**：默认所有 net 均参与布线；同一信号链上的 `assign` 别名会同步隐藏或恢复，而赋为相同常量的独立 net 则互不影响、可分别设置。隐藏几何导线后，单元引脚标记、Inspector 连接详情与 Focused 锥体追踪仍保持完整。
- **重新找回与双侧独立**：取消布线后，仍可通过顶部 Search 或相邻单元的 `Connections` 列表选中该 net，重新勾选 `Route net` 即可恢复连线。Compare 模式下 A/B 两侧独立维护各自的隐藏 net 集合。
- **状态保存与重置**：该设置支持视图历史 `Back` / `Forward`、模块切换、Single 当前模块的标签页刷新恢复、Golden 保存/加载及 SVG 导出；执行 `Layout > Reset view overrides` 清除覆盖时会一并恢复所有被隐藏 net 的布线。

---

## 7. Whole 和 Focused 视图

### 7.1 Whole（整图视图）

渲染当前模块的全部端口、单元与线网。中小型模块默认直接打开 `Whole` 视图；对于超过 500 个单元的大型模块，为保证响应速度默认进入 `Search-first`，用户可在需要观察全局拓扑轮廓时显式点击 `Whole`。

### 7.2 Focused（双向局部聚焦视图）

`Focused` 是以一个或多个选定对象（Cell 或 Net，最多 32 个）为根节点（root）向前后双向扩展的局部原理图：

- **`Fanin depth`**：向输入/驱动源（driver）方向追踪展开的逻辑层数（`0–99`）。
- **`Fanout depth`**：向输出/负载端（load）方向追踪展开的逻辑层数（`0–99`）。
- **深度设为 `0`**：关闭该方向的扩展（例如将 `Fanout depth` 设为 `0` 即可仅查看纯扇入逻辑锥 Fanin Cone）。

在 `AnchorLayered` 与 `ELK` 布局中，即便将 `Fanout depth` 设为 `0`，当前已可见线网若仍连接着局部视图范围之外的负载，也会在边界处显示 `Focused output` 延续标记（仅提示该信号还会继续扇出至视图外，不会将外部单元展开进当前局部图；`Simple` 引擎则保留冻结的原有行为）。

当存在多个聚焦根节点时，系统会分别计算每个根节点的扇入与扇出邻域并自动合并去重；当根节点数量达到 32 个上限时，新的追加请求会被明确拒绝并提示，绝不会静默丢弃或截断已有的根节点。对于高扇出线网作为根节点的情况，系统还内置了有界节点预算策略，确保根节点的直接连通路径完整保留且不会因超大多扇出一次性撑爆局部图。

---

### 7.3 分析当前子图的重收敛路径

打开 **Navigator → Analysis**。列表顶部显示模块、Whole 或 Focused 范围、可见节点数和结果数。每一行对应一个分叉点和一个汇合门。同一信号在分叉后经过两条内部单元互不重合的路径到达汇合门时，列表显示这一对端点。多输出单元的分叉点带输出引脚名。

点击一行，Inspector 列出两条见证路径、各自的门级数和连接数。画布分别用蓝色和橙色高亮路径，共用的端点或线段用紫色标出。**Connections between endpoints** 展开这两个端点之间可证明的连接并集。标有 **not routed** 的连接参与逻辑分析，其导线仍按原设置隐藏。点击 **Locate** 可将视口定位到两条见证路径。选中画布上的路径成员，还能通过 Inspector 的 **Related reconvergence** 打开关联结果。

Focused 裁掉一条支路后，对应结果会从列表中移除。平移、缩放和移动单元保留已完成的分析。Compare 中通过 **Side A** 和 **Side B** 切换，两侧分别使用各自模块当前展示的逻辑。寄存器、黑盒和未展开的子模块在输入处终止组合路径，各输出可作为新路径的起点。

**Partial results** 表示列表保留了已证明的结果。原因可包括组合环、多驱动、引脚方向歧义或分析预算耗尽。无环且不受影响的区域仍可产生结果。**Cancel** 可停止正在运行的分析，**Run again** 重新计算当前范围。详情失败时可单独点击 **Retry detail**。打开 **Log** 可查看该次工作的模块、侧别、范围和错误原因，并导出 JSONL。

## 8. 大图 Search-first 工作流

当打开单元数量超过 **500** 的大型模块时，工作台默认进入 `Search-first` 模式：

- 后台已完成完整模块的网表解析、图提取与搜索索引构建，所有对象均可立即检索。
- 暂不对全图执行耗时的几何布局与海量 SVG DOM 渲染。
- 画布中央展示已索引的节点规模统计与快速检索引导。

**推荐的大图分析五步法**：

1. 在顶部搜索框输入目标实例名（instance）、线网名（net）、端口名（port）或单元类型（cell type）。
2. 在下拉列表中点击或按 `Enter` 激活目标结果，瞬间生成围绕该对象的 `Focused` 局部图。
3. 通过画布上方的 `Fanin` 与 `Fanout` 按需增减上下文层数。
4. 在 Inspector 的 `Connections` 页签中点击上下游的驱动、负载或跨层次父/子连接，沿信号链路逐步推进追踪。
5. 仅在确实需要审视全模块宏观分布时，再点击上下文栏的 `Whole` 按钮渲染整图。

> **性能保护**：在大型模块中修改并保存 `Cell Config` 时，系统会自动保持当前正在查看的 `Focused` 局部视图并仅重排该局部图，避免触发全图重布局导致界面等待。

---

## 9. 布局、间距和大图简化

### 9.1 布局引擎选择（Layout Provider）

`Settings → Layout`提供三种完全离线运行的布局引擎：

- **`AnchorLayered`（默认）**：项目内置的高性能物理锚点分层布局与正交布线引擎（原称 H08），Single 与 Compare 视图共用同一流水线。若遇到超出支持范围的拓扑，会输出明确诊断并自动依次尝试降级至 `ELK` 与 `Simple`。
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

### 9.6 结构分组折叠说明与渐进式渲染

- **分组折叠已退役**：结构分组折叠（Group collapse/expand）已从产品路线中正式移除；大图统一通过完整图、`Search-first` 或 `Focused` 局部图进行浏览（旧版 Session 或 Golden 文件中遗留的折叠字段仅作兼容读取忽略）。
- **分批渐进渲染**：当当前视图的可见节点与连线总数达到渐进渲染阈值（400）时，渲染器会自动分批向 DOM 提交 SVG 图元，并通过底部状态栏报告进度。在拖拽或预览过渡帧中可临时省略装饰性跨线桥（wire bridge），一旦渲染或手势完成，画面与导出的 SVG 均会完整恢复所有导线、桥接弧、文本标签与点击热区。

---

## 10. Adjust 手工校准

点击上下文栏的 `Adjust` 按钮即可进入手工校准模式；再次点击该按钮退出校准模式。

### 10.1 拖拽移动节点

在 `Adjust` 模式下，可直接用鼠标拖拽画布中的任意单元或端口：
- **流畅拖拽预览**：拖动过程中仅实时更新被拖节点的轻量级位置预览并弱化关联导线，支持网格吸附与相邻引脚水平对齐吸附，不触发全图重布局。
- **释放后局部重布线**：松开鼠标按键后，系统仅对受影响的关联导线执行正交避障重布线，其余未改动节点与无关导线保持原样。
- **顶部编辑留白**：自动布局器会在画布顶部预留一段编辑缓冲区，方便将最顶排的单元或端口继续向上拖动调整；保存为 Golden 后均按画布绝对坐标精确还原。

### 10.2 调整节点尺寸（Size）

在 `Adjust` 模式下选中节点后，Inspector 的 `Adjust` 页签可精确修改其外框尺寸：

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

- `Layout > Reset view overrides`：清除当前 Single 模块的位置、尺寸、实例属性、引脚方向及不布线 net 覆盖；Compare 中清除 A/B 两侧的覆盖。
- `File > Save Golden`：将当前 Single 视图模式、聚焦状态及所有手工校准覆盖导出保存为 Layout Golden JSON 文件；Compare 中不可用。

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

`Settings → Timing`提供全图级别的 `Metric` 指标选择与 `Threshold` 阈值配置：
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
- **单元详情查验**：选中带有时序数据的单元后，Inspector 的 `Timing` 页签会列出该单元所有引脚的 `AT`、`RT`、`Slack`、最差引脚（worst pin）、最差裕量（worst slack）以及当前是否达标违例。用户可在面板中针对该单元微调徽标展示：
  - 单独勾选或取消勾选某个引脚/指标是否显示为画布 badge；
  - 调整 badge 挂载在节点外框的方位（左上、右上、左下、右下）；
  - 点击 `Default badges` 一键恢复默认徽标显示策略。

---

## 12. Cell Config

`Cell Config` 用于按 **单元类型（cell type）** 定义并持久化逻辑门类别（gate kind）与引脚方向（pin direction），非常适合补充无 `.lib` 环境下内置规则尚未覆盖的工艺库原语单元（Primitive cells）。

### 12.1 创建或修改单元类型定义

1. 在画布或搜索结果中选中目标原语单元实例。
2. 点击 Inspector 底部的 `Edit cell type…`。
3. 在弹出的编辑器中设置 `Gate kind` 以及各个引脚的 `direction`。
4. 点击 `Save` 保存。

**智能预填机制**：打开编辑器时，系统会自动填入内置推断规则对该单元已识别出的 `gate kind` 和 `pin direction`（而非粗暴重置为 `BLACKBOX` / `unknown`）。因此，若只需修正某一个引脚的方向，其余引脚会自动保留原有的正确推断值。

- **支持的 `Gate kind`**：`AND`、`OR`、`MUX`、`INV`、`NAND`、`NOR`、`XOR`、`XNOR`、`BUF`、`REGISTER`、`BLACKBOX`
- **支持的 `Pin direction`**：`input`、`output`、`inout`、`unknown`

点击 `Save` 后，当前网表中**所有属于该 `cell type` 的原语实例**都会立即重新推断并更新图形，其推断来源（inference source）会显示为 `user-config`（注：网表中存在真实 `module` 定义的层次化子模块始终遵循其模块端口声明，不会被 `Cell Config` 覆盖）。

### 12.2 删除与全部重置

- `Delete saved`：仅删除当前选中单元类型的自定义配置，使其恢复使用内置推断规则。
- 全局栏 `Settings → Cell Config > Reset all definitions`：清空浏览器本地保存的全部自定义 `Cell Config`。

### 12.3 浏览器本地持久化

保存的 `Cell Config` 存储在浏览器的持久化本地存储（`localStorage`）中；刷新页面、关闭后重新打开标签页或导入其他网表文件时，同一浏览器环境下的配置依然会自动生效。

### 12.4 导入与导出 JSON

- `Cell Config > Export definitions`：将当前保存的所有单元配置按确定性字母序导出为 `netlist-cell-config.json`。
- `Cell Config > Import definitions…`：载入符合 version 1 规范的 JSON 配置文件；若导入文件与本地已有配置存在同名 `cell type` 冲突，系统会弹窗提示用户确认是否覆盖。

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
3. 在画布上方的 Compare 配置行分别选择 `A` 和 `B` 模块。
4. 点击 `Apply` 启动对比。

系统会自动优先推荐同名前缀且带有 `_Flex`、`_orig`、`_new` 等常见版本后缀的配对模块。选择器中的修改为待应用草稿，点击 `Apply` 后更新画布。进入对比模式后，顶部原按钮变为 `Single`；点击它或 `Sync & cone > Return to Single` 可退回单模块视图。A/B 身份不随分屏方向改变：A 位于上方或左侧，B 位于下方或右侧。

### 13.2 分屏方向与视口同步

- **分屏方向（`Split`）**：默认 `Top / Bottom`（上下分屏），可切换为 `Left / Right`（左右分屏），切换后自动适配两侧视口。
- **同步缩放平移（`Sync & cone > Sync pan / zoom`）**：默认开启，在任意一侧画布滚动缩放或拖拽平移时，另一侧画布实时同步执行相同变换；取消勾选后两侧可独立缩放和平移。
- **上下文栏 `Fit view`**：同时将 A/B 两侧画布重置适配至各自的可视区域。

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

Compare A/B 两侧各自维护 `Focused roots`、激活根、选中对象与视口状态。先在一侧点击对象，再使用 Inspector 的 `Replace roots` / `Add to Focused` 或 `Roots` 菜单中的 `Remove selected` / `Clear roots`，操作以当前活动侧为起点；Inspector 摘要明确显示 `A · Compare · module` 或 `B · Compare · module`。

**`Sync & cone > Sync Focus roots`（默认开启）联动规则**：

- **`Add to Focused` / `Replace roots`**：若在另一侧模块中找到同名匹配的单元，则自动在另一侧同步追加或替换聚焦根；若另一侧不存在匹配单元，则仅更新当前操作侧并在状态栏给出提示。
- **`Remove selected`**：若另一侧存在对应的聚焦根，则同步将其移除。
- **`Clear roots`**：同时清空 A/B 两侧的全部聚焦根。
- **关闭 `Sync Focus roots` 后**：左右两侧的聚焦根操作完全独立（此时 `Sync pan / zoom` 仍仅同步视口平移与缩放，绝不会隐式修改另一侧的聚焦根）。

在 Compare 模式下，`Roots` 菜单的 root chips 带有 `A:` 或 `B:` 前缀；点击 chip 激活并居中对应侧的该根节点，点击 `×` 将其移除。`Fanin` / `Fanout` 深度是两侧共享设置，不因关闭 roots 同步而变成单侧设置。

上下文栏的 `Focused` 以活动侧为起点；`Whole` 则清除两侧 roots 和 Output cone 并返回两侧整图，与单侧根操作的范围不同。`Layout > Reset view overrides` 同时清除两侧实例覆盖。Compare 可在 `Show Path → Path information → Export SVG` 导出所选侧。Save Golden 保存 Single 工作区。

### 13.5 同名输出逻辑锥对比（Output cone）

Compare 配置行 `Sync & cone > Output cone` 列出了 A/B 两侧模块共有的输出端口（例如内置示例中的 `sco_891`）。选择任一共有输出端口后，两侧画布将同步提取并展示该输出端口的扇入逻辑锥（Fanin cone），通过 `Output depth` 调整追踪层数；选择 `Whole module` 则返回完整模块对比。

为避免两种局部裁剪模式冲突，选择 `Output cone` 时会自动清空两侧的 `Focused roots`；反之，当重新设置或追加 `Focused root` 时会自动退出 `Output cone` 模式。`Navigator > Design` 汇总两侧的单元数、门类型数、估算逻辑深度、最大扇出及其差值与未匹配数量。

---

## 14. SVG、Golden 和状态恢复

### 14.1 导出独立 SVG（Export SVG）

在 Single 视图下点击 `File > Export SVG`，即可将当前画布（整图或 Focused 局部图）导出为自包含的 `.svg` 文件。导出的文件内嵌了完整的导线、跨线桥、文本标签、时序徽标与 CSS 样式，无需联网或外部字体即可在任意浏览器或矢量图工具中打开。Compare 中打开 Show Path，选 A 或 B，应用端点后在 Path information 点 Export SVG 导出该侧。

### 14.2 Layout Golden 的保存与恢复

- `File > Save Golden`：将当前 Single 模块名称、视图模式（`Whole` / `Focused` / `Search-first`）、Focused roots、扇入/扇出深度、所有节点的位置/尺寸与实例覆盖以及导线路径保存为 Golden JSON 文件；Compare 中不可用。
- `File > Load Golden`：加载本地 Golden JSON 文件（请先载入与之对应的网表设计）；在 Compare 中加载会退出对比，恢复对应的 Single 工作区。
- `Layout > Reset view overrides`：清除位置、尺寸、实例属性、引脚方向及不布线 net 覆盖，恢复自动输出；Compare 中作用于两侧。

**Golden 版本与内容指纹**　含 Show Path 端点的查询保存为 v4，其他布局保存为 v3。两种格式都记录网表源码的内容指纹。若网表内容发生实质变化，即使文件名与文件大小碰巧相同，系统也会拒绝错配旧布局；反之，若网表文件仅被重命名但内容未变，仍可正常匹配加载。系统同时向后兼容导入旧版 v1 / v2 Golden 文件。请注意：Layout Golden（保存单模块几何布局与实例显示覆盖）与 `Cell Config`（保存可跨网表复用的单元类型语义）是两种用途不同的独立 JSON 格式。

### 14.3 浏览器标签页会话恢复

在同一浏览器标签页内刷新页面后，系统会自动从 `sessionStorage` 恢复刷新前的工作台状态：

- 当前加载的网表文本与选中的模块
- 视图模式（`Whole` / `Focused` / `Search-first`）、Focused roots（含层次实例路径）、前后向深度与搜索词
- 当前选择的布局引擎（Layout provider）、间距参数、逻辑门符号风格与简化开关
- 当前选中对象、画布缩放平移视口（Pan / Zoom）及手工布局微调

网表会话数据保存在当前标签页的 `sessionStorage` 中，关闭标签页后由浏览器自动清理；而 `Cell Config` 则保存在持久化的 `localStorage` 中长期留存。

### 14.4 工作台界面偏好

Navigator/Inspector 的停靠开关、宽度与最近页签单独保存在 `localStorage` 的版本化界面偏好中，不写入网表会话或 Golden，也不占用视图历史。未保存过偏好时按窗口宽度采用默认布局；抽屉不在启动时自动弹出。偏好内容损坏、版本不兼容或浏览器禁止存储时回退至默认值，不影响网表浏览。

---

## 15. Process Log（过程日志）

点击底部状态栏带计数的 `Log` 按钮展开或收起 Process Log 抽屉；`Diagnostics` 则打开当前设计/导入诊断，两者为独立入口。日志按以下处理阶段（Phase）分类记录系统运行轨迹：

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

**日志容量、脱敏与失败归类**：

- **内存容量与过滤导出**：日志默认在当前页面内存中保留最近 **500 条**，刷新或关闭页面后清空；相邻同阶段、同任务的渐进渲染进度会自动合并。`Copy` 和 `Export` 均输出当前过滤结果，导出文件名为 `netlist-process-log.jsonl`。
- **结构化详情与源码脱敏**：失败条目的 `details` 可包含错误名称、调用栈、`cause`、结构化诊断以及操作、文件、模块、布局引擎或请求编号（以失败边界实际提供的字段为准）。日志会对详情递归过滤源码、原始文本、口令和 token 等敏感字段，并限制嵌套深度、条数和文本大小（截断或循环引用会显示显式标记），默认绝不记录完整的网表、时序或配置原文。
- **取消与全局异常捕获**：用户主动取消或已过期的异步任务不作为当前操作错误报告；全局捕获机制保留浏览器原有的控制台报错行为（应用日志初始化之前的早期模块加载失败仍请查看浏览器控制台）。遇到解析报错、布局降级或启动异常时，可展开 `Process Log` 筛选 `Error` / `Warning` 或对应 `Phase` 查看 `details` 并导出排查。
- **持久化与导出失败归类**：
  - 会话或 `Cell Config` 读取失败会记录为 `Persistence` 错误并安全回退至默认状态；自动保存失败会保留底层异常，连续失败仅报告一次，恢复正常后记录 `Session saving recovered`。
  - `Cell Config` 的保存、删除、重置与导入写入失败均归入 `Persistence`；配置已保存但触发视图刷新失败归入 `Render`。
  - SVG、Golden 和 `Cell Config` 的生成或下载触发失败归入 `Export`（含具体操作及文件名）。关闭页面瞬间的保存错误仅能在页面存活期内进入内存日志，不会跨会话落盘。

### 终端与启动器日志

Bash 预览入口、Node/Python 服务、Linux 单文件启动器和 Windows 离线启动器会自动在磁盘保存终端侧 JSONL 日志。这与页面内的 `Process Log` 相互独立：浏览器内运行轨迹从页面导出，终端启动器日志则专门用于排查进程启动、文件读取、HTTP 请求、状态文件清理与退出问题。

- **默认目录与自定义路径**：
  - Linux 默认目录：`${XDG_STATE_HOME:-$HOME/.local/state}/netlist_graph_builder/logs`
  - Windows 默认目录：`%LOCALAPPDATA%\netlist_graph_builder\logs`
  - 可通过环境变量 `NGB_LOG_DIR` 指定日志目录；启动时的 `log.ready` 诊断会指明当前日志文件路径。
- **文件命名与大小轮转**：
  - 每次启动生成独立的 `<运行时>-<时间>-<PID>.run.jsonl`（包含全部级别，普通 4xx 请求记为 `Warning`）与 `.error.jsonl`（仅包含 `Error`）。
  - 单个日志文件默认在约 **2 MiB** 时自动轮转并保留一个 `.1` 备份；可通过 `NGB_LOG_MAX_BYTES` 在 `1024`～`67108864` 字节范围内调整阈值（单条诊断不拆行，文件可超出阈值至多一条有界记录）。Bash 入口仅记录 `exec` 交接前的少量事件，交接后由 Node 或 Python 进程的日志接管。
- **自动过期清理（默认 14 天）**：
  - 每次启动时自动清理超过 **14 天** 的历史日志；可通过 `NGB_LOG_RETENTION_DAYS` 设置为 `1`～`3650` 天，设为 `0` 则关闭自动清理（非法值回退至默认 14 天）。
  - **进程与安全保护**：保留期按文件最后修改时间计算；仅当同一次启动的 `.run.jsonl`、`.error.jsonl` 及 `.1` 备份全部过期，且文件名对应的 PID 确已退出时才执行删除（PID 被复用或无法确认退出时保守保留）。清理仅扫描日志目录的直接子文件并严格匹配五种运行时的日志命名，不递归子目录、不触碰无关文件，含符号链接的日志组也会跳过。
  - `log.cleanup` 事件记录保留天数、删除文件数与释放字节数；若部分删除失败，则通过 `log.cleanup_failed` 记录失败数量与首个错误，剩余文件留待下次启动重试，不影响当前服务运行。如需长期留存日志，请提前归档至其他目录或设 `NGB_LOG_RETENTION_DAYS=0`。
- **字段规范与标准流隔离**：
  - JSONL 每行包含 `time`、`level`、`runtime`、`pid`、`event`、`message`，并按事件附带状态码、操作、异常类型、错误码或调用栈（原生 C++ 错误记录系统错误码或异常消息）。查询参数、请求正文与启动输入原文均不写入日志。
  - 正常 HTTP 请求仅写入日志文件，启动/退出与失败诊断同步输出至 `stderr`；若日志目录不可写，仅报告一次告警并自动回退至 `stderr`，绝不伪装成服务启动失败。
  - 启动成功时，`stdout` 严格保持原有的单行 `ready` JSON 协议；`status`、`--help` 与 `--licenses` 的标准输出格式不变。

例如，在 Bash 中指定自定义日志目录启动预览服务：

```bash
NGB_LOG_DIR="$PWD/dc_runs/launcher_logs" bash tools/start-preview.sh --port 0 --no-open
```

开发验证可执行 `npm run test:launcher`、`python3 tests/e2e/terminal_logging_e2e.py --native build/native/ngb` 与 `python3 tests/e2e/log_retention_e2e.py --native build/native/ngb`（Windows 离线包可将参数替换为 `--windows <exe路径>`）。

---

## 16. 快捷键一览

| 快捷键 | 功能说明 | 生效条件 |
| --- | --- | --- |
| `/` | 聚焦全局 Search | 非编辑状态、无模态对话框、未处于输入法组合中 |
| `Ctrl+Enter` / `Cmd+Enter` | 提交 `Paste netlist`、`Paste AIG` 或 `Paste timing` 文本 | 文本粘贴导入对话框打开时 |
| `Ctrl+Z` / `Alt+Left` | 视图历史后退（View History Back） | 焦点不在文本输入框内 |
| `Ctrl+Shift+Z` / `Ctrl+Y` / `Alt+Right` | 视图历史前进（View History Forward） | 焦点不在文本输入框内 |
| `F` | Zoom to selection，定位当前选中单元或线网 | 焦点不在文本输入框内且存在可定位对象 |
| `ArrowUp` / `ArrowDown` | 在搜索下拉候选列表中上下切换 | 顶部搜索框获得焦点时 |
| `Enter` | 激活并定位当前选中的搜索结果 | 顶部搜索框获得焦点时 |
| `Esc` | 收起搜索候选、活动菜单、抽屉或对话框 | 对应界面处于打开状态时；菜单/抽屉关闭后归还触发按钮焦点 |
| `Ctrl+V` / `Cmd+V` | 全局粘贴并自动识别网表、AIG、时序、Golden 或 Liberty | 焦点不在任何可编辑输入控件内 |
| `ArrowLeft` / `ArrowRight` | 按 `16px` 步进调整 Navigator 或 Inspector 宽度 | 停靠面板分隔条获得焦点时 |
| `ArrowLeft` / `ArrowRight`、`Home` / `End` | 切换页签，或跳至首个/末个页签 | Navigator 或 Inspector 页签获得焦点时 |

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
4. 在画布上方调整 `Fanin` 与 `Fanout` 控制上下文范围。
5. 在 Inspector 的 `Connections` 页签中点击上下游关联对象顺藤摸瓜。
6. 浏览过程中随时按 `F` 键将当前选中单元重新居中放大。

### 18.2 排查负 Slack 关键路径周边的门级结构

1. 先导入 Verilog 网表，再导入配套的 Timing 时序报告。
2. 在`Settings → Timing`将 `Metric` 设为 `Worst Slack`，按需设置 `Threshold`（默认 0.0）。
3. 在顶部搜索框检索时序报告中的关键违例单元或端口。
4. 使用 `Focused` 视图观察局部连接（若只需向驱动侧回溯，可将 `Fanout depth` 设为 `0`）。
5. 选中关键单元，在 Inspector 的 `Timing` 页签核对各引脚的 `AT`、`RT`、`Slack` 与 `worst pin`。

### 18.3 补充未知标准单元的引脚定义并复用

1. 搜索或点击图中显示为黑盒（`BLACKBOX`）的未知单元实例。
2. 点击 Inspector 底部的 `Edit cell type…`。
3. 检查编辑器自动预填的推断值，修正门类型（Gate kind）与各引脚方向（Pin direction）。
4. 点击 `Save`，确认图中所有同类型单元均已更新且来源显示为 `user-config`。
5. 点击 `Cell Config > Export definitions` 导出 JSON 文件，供团队其他成员或 EDA 启动脚本（`--cell-config`）直接加载复用。

### 18.4 手工微调原理图并保存为 Golden

1. 点击上下文栏的 `Adjust` 进入手工校准模式。
2. 拖拽调整节点位置、修改尺寸或单实例属性，释放鼠标后检查自动重布线效果。
3. 再次点击 `Adjust` 退出校准模式。
4. 点击顶部 `File > Save Golden` 导出保存 `.json` 布局快照。
5. 日后复盘时，先加载同一份网表，再点击 `File > Load Golden` 即可完整还原当时的视图与微调布局。

### 18.5 对比优化前后的两个模块（Resyn vs. Flex）

1. 加载同时包含优化前后两个模块的网表文件。
2. 点击顶部 `Compare`，在画布上方确认 A/B 模块配对并点击 `Apply`。
3. 查看 `Navigator > Design` 的单元数量、逻辑深度差值及画布上的红/绿差异高亮。
4. 在 `Sync & cone > Output cone` 中选择共有输出端口，同步比对两侧的扇入逻辑锥结构。
5. 点击两侧的关键单元或线网进行跨侧高亮定位。

### 18.6 放大画布并按需恢复详情

1. 打开示例或自己的网表，通过 Search 或 `Navigator > Hierarchy` 找到要看的模块或对象。
2. 先收起 Navigator，再收起 Inspector，确认两侧均已隐藏；画布使用整个工作区宽度。
3. 继续按当前缩放阅读，或点击 `Fit view` 查看整幅当前图。大图仍可搜索目标进入 Focused，再调整 `Fanin` / `Fanout`。
4. 点击图中的单元或线网，顶部对象摘要随选择更新。需要查连接时点击该摘要打开 Inspector，在 `Connections` 中连续追踪；看完点 `Hide` 继续读图。
5. 需要切换模块时点击顶部 `Navigator`；完成后再次收起。无需重新导入网表，也无需重置手工布局。
6. 在 Compare 中可重复上述操作。查看 Inspector 时先核对 A/B 来源；恢复 `Navigator > Design` 可查看对比统计。

在同一浏览器、同一地址刷新后，已隐藏的停靠面板仍保持隐藏；顶部开关始终可用于恢复。窗口缩窄导致的抽屉规则见 [2.2 窗口宽度与界面偏好](#22-窗口宽度与界面偏好)。

---

## 19. 常见问题与限制

### 19.1 导入网表后显示 Search-first 提示页而没有直接画图？
这是针对超过 500 个单元的大模块的预期性能保护机制。请直接使用顶部搜索框检索目标单元/线网进入 `Focused` 局部视图，或显式点击上下文栏的 `Whole` 按钮渲染全图。

### 19.2 打开 Cell Config 编辑器时显示为 BLACKBOX？
当某单元类型尚未保存自定义配置时，编辑器会展示内置规则的推断结果；若该命名完全不在内置规则库中，则默认显示为 `BLACKBOX` 与 `unknown` 引脚。请手动指定正确的 `Gate kind` 与引脚方向并保存，保存后可在 Inspector 中确认其推断来源已变为 `user-config`。

### 19.3 修改并保存 Cell Config 后为什么图形布局发生了变化？
修改引脚的 `input` / `output` 方向会直接改变图中的驱动（driver）与负载（load）拓扑流向，因此必须重新提取图并计算布局。对于大型模块，系统会自动保持当前的 `Focused` 局部视图，避免触发全图重排。

### 19.4 导入 Timing 文件后画布上没有任何时序徽标？
请依次排查以下几项：
- 检查`Settings → Timing` 菜单中的 `Metric` 是否被设为了 `None`（`None` 模式会隐藏全图所有画布时序徽标），或当前画布缩放倍率是否低于 `0.65`（触发了低倍率 LOD 文字隐藏）。
- 检查时序文件中的 `@module` 指令（或 JSON 中的 `"module"` / `"modules"` 键名）是否与当前打开的网表模块名一致。
- 检查时序数据行中的 `point`（端口、单元引脚 `inst/pin` 或线网名）是否能在当前模块中找到对应项。
- 列式文本格式下，确认表头行（如 `point at rt slack`）与数据行的列数对齐，且至少提供了可展示的时序数值。
- 展开底部 `Log` 抽屉并按 `Timing` 阶段过滤，同时查看底部 `Diagnostics` 抽屉中的具体未匹配或解析告警提示。

### 19.5 Whole 整图模式下画面显得非常细长或渲染较慢？
`Whole` 模式会完整布局并渲染模块内的所有单元与连线。遇到数千单元的大模块或上千级串行长链时，建议优先采用 `Search-first` 与有限深度的 `Focused` 视图，并保持 `Fanout hubs` 开启（产品已不再使用结构分组折叠作为大图路径）。

### 19.6 Compare 模式中的红色虚线是否代表电路逻辑不等价？
**不是**。Compare 模式仅根据端口/线网名称、方向、逻辑门类别及图统计量进行启发式结构对比，并非形式化等价验证（LEC）。红色仅提示“该结构对象在命名或门类型分布上存在差异”，绿色也不代表两侧逻辑功能完全等价。

### 19.7 为什么 Layout Golden 文件无法载入？
请确保已先加载了与该 Golden 对应的网表文件。Golden v3/v4 会严格校验领域标识、模块名以及网表内容指纹（fingerprint）：一旦网表内容发生修改，即使文件名相同也会被安全拒绝，防止将旧坐标错配到新网表上。状态栏与 `Process Log` 会给出拒绝的具体原因。

### 19.8 刷新页面与关闭标签页后，哪些数据会保留？
在同一标签页内按 `F5` 刷新，会自动从 `sessionStorage` 恢复当前网表、模块、聚焦视图与视口状态；关闭标签页后，`sessionStorage` 中的网表会话会由浏览器自动清理。`Cell Config` 类型定义与工作台面板偏好分别保存在 `localStorage`，关闭浏览器后仍保留；清除站点数据会移除二者。`Delete saved` / `Reset all definitions` 仅管理 Cell Config。Liberty 只保存在页面内存，刷新后需重新加载。

### 19.9 运行时安全与离线边界是什么？
- **100% 离线运行**：浏览器端与启动器在运行期间均不发起任何外网请求。
- **仅限本机回环**：内置 HTTP 服务始终只绑定 `127.0.0.1`。
- **XSS 转义保护**：所有来自网表、时序日志、Golden 或用户输入的标识符文本在插入 HTML / SVG 前均经过严格的字符转义。
- **最小化日志输出**：`Process Log` 与命令行 `ready` JSON 均不输出完整的网表、时序或配置原文。

### 19.10 为什么点击搜索结果、`Add to Focused` 与 `Replace roots` 的效果不同？
这是为了在“画布内定位”与“增删聚焦根节点”之间提供清晰、可预期的区分：
- **点击已在当前画布绘制的搜索结果**：仅选中并将视口居中定位到该对象，**不修改**当前的 Focused roots 集合。
- **点击未在当前画布绘制的单元搜索结果**：自动将其**追加**到现有 Focused roots 中并展示局部图。
- **点击搜索结果或 Inspector 中的 `Add to Focused`**：显式将目标**追加**到现有 Focused roots。
- **点击 Inspector 中的 `Replace roots`**：显式**清空旧集合**，仅以当前选中对象作为唯一的 Focused root。

若当前 Focused roots 已达 32 个上限，继续追加会被拒绝，请先移除不再需要的 root chip。跨模块搜索会自动切换至目标模块的独立工作区，不会将原模块的 roots 混入新模块。

### 19.11 左右面板不见了，或点击对象后没有出现详情？

先点击顶部 `Navigator` / `Inspector` 恢复对应面板；已有选择时也可点击顶部对象名称摘要。面板主动隐藏后不会被选择操作自动打开。窄屏默认使用抽屉，点击画布或刷新会收起抽屉；两侧均为抽屉时不能同时展开。无需清空浏览器数据或重新导入网表。

### 19.12 更新后还是旧界面，或面板偏好没有沿用？

- 确认启动器来自 `v1.6.0` 程序包，并在浏览器中打开启动器输出的实际 URL。
- 源码预览在更新后刷新页面；Windows 离线版需完整替换程序包并重新启动；Linux 单文件版已内嵌界面资源，需重新构建或使用新二进制，再启动服务。仅替换外部文档不会更新界面。
- 服务更新后刷新当前标签页；若仍加载缓存，可用浏览器的强制刷新。新版工作台应能看到顶部 `Navigator` / `Inspector`，面板标题旁有带方向箭头的 `Hide`。
- 面板偏好按浏览器及站点地址保存；例如 `127.0.0.1:4173` 与 `127.0.0.1:7724` 不共享偏好。换端口后重新设置一次即可。

## AIG 图浏览

本节介绍当前 AIG 工作区。基础浏览自 `v1.5.0` 引入，结构重汇聚、XOR / XNOR / MUX 识别和双视图在 `v1.5.2` 汇总交付。从 `v1.5.3` 起，原 ABC 视图改名为 Logic View，作为新打开 AIG 的默认视图。“重收敛”和“重汇聚”在本教程中指同一结构，界面名称为 `Reconvergence`。从旧版升级时请完整替换离线包并重新启动。AIG 工作区采用本地离线 Graphviz（Viz.js / WASM）曲线布局，与门级网表的 `AnchorLayered → ELK → Simple` 正交布局流水线相互独立。

### AIG 导入与阅读流程

1. **打开 AIG 文件**：点击全局栏 `File → Open AIG…`，选择 ABC `write_dot` 生成的 AIG `.dot` 文件，或平坦两输入组合 `.blif` 文件；也可在 `File → Paste AIG…` 中粘贴文本。导入期间查看状态栏进度，完成前可用 `File → Cancel AIG import` 取消。菜单已标明受支持格式范围，不接受任意通用 DOT 逻辑图。
2. **图元与极性约定**：主输入（PI）与主输出（PO）保留原始信号名，内部与门（AND）采用稳定编号。信号整体**自下向上**流动：**正三角形**代表输入（PI），**倒三角形**代表输出（PO），**椭圆**代表二输入 AND 节点；**虚线边**表示逻辑反相（含输出端反相），实线边表示正相传输。
3. **浏览与筛选对象**：左侧 `Navigator` 的 `Design` 页签汇总节点规模、最大逻辑深度与分析统计；`Objects` 页签默认列出输入/输出，支持按类型（PI / PO / AND）、名称或来源 ID、关键路径属性及扇出数筛选，并支持按名称、深度或扇出排序（每页最多显示 100 项）。注意：**列表筛选仅过滤左侧对象列表，不会裁剪中央画布**。
4. **连接与来源追踪**：点击 `Objects` 列表项、全局 `Search` 候选或画布图元即可选中目标。右侧 `Inspector` 提供三个专用页签：
   - `Connections`：展示独立的输入槽位（Input slots）、边极性及上下游邻接节点，点击具体输入槽位可单独选中对应连线；
   - `Analysis`：展示当前节点的单位 AND 逻辑深度、扇出引用统计及已发现的相关块/重汇聚；左侧 Navigator 的同名页签用于浏览当前展示子图的结构结果，两者作用不同；
   - `Source`：展示原始来源 ID、归一化折叠的 BUF/NOT 别名链、极性及可用的源文件行列位置（支持一键复制完整名称）。
5. **关键路径与高扇出高亮**：使用`Settings → AIG overlays` 中的 `Logical critical path` 开关高亮所有最长单位 AND 深度路径（注：逻辑深度按单位 AND 级数计算，不代表真实工艺器件的 STA 延时）；使用 `High fanout` 开关及数值阈值高亮高扇出节点：
   - **红色节点填充 / 红色边描边**：位于逻辑关键路径上；
   - **橙色节点外框**：节点扇出引用数达到设定阈值（默认 `≥ 2`，统计每个输入槽位及 PO 引用）；
   - **紫色外框**：当前选中的对象；蓝色 / 绿色外框分别表示上游 / 下游关联逻辑。
   两个分析高亮开关默认关闭，显式开启后随工作区恢复。切换高亮开关或修改扇出阈值均即时生效，**不会触发重新布局**。
6. **视口操作与键盘导航**：支持滚轮缩放、空白处拖拽平移、`Fit view` 整图适配以及 `Zoom to selection`（快捷键 `F`）居中定位。左右面板的显隐和宽度沿用工作台界面偏好；AIG 页签同样支持左右方向键与 `Home` / `End` 键盘切换。
7. **SVG 导出与会话恢复**：点击 `File → Export SVG` 可导出包含当前高亮状态的独立 SVG 文件。在同一标签页刷新页面时，系统会自动从 `sessionStorage` 恢复源文件内容、当前选中项、视口变换与分析高亮开关（若浏览器禁用存储或超出配额，当前会话仍可正常浏览，同时自动清除旧 AIG 存档，防止刷新后误恢复上一份旧图）。

### AIG Focused 局部逻辑

BLIF 与 ABC DOT 都可从输入、输出、AND 或常量开始抽取局部逻辑。选中一个节点后点击 `Focused` 或 Inspector 中的 `Replace roots`。在搜索结果或 Inspector 点击 `Add to Focused` 可追加 root。根列表支持定位、移除和清空，最多同时保留 32 个 root。点击 `Whole` 清除 Focused 裁剪。若正在使用 Show Path，画布显示该查询覆盖的逻辑。

`Fanin` 与 `Fanout` 分别控制沿输入和输出连接扩展的步数。两项均设为 0 时只保留 roots 及它们之间的连接。带 `In` 或 `Out` 的方框标出跨越当前范围的输入或输出，虚线表示反相。相同信号和极性的下游边界会列出负载数量。单次抽取最多显示 512 个真实节点，达到预算时状态栏和 Log 会提示截断。

搜索覆盖完整源图。直接打开标记为 `Outside Focused` 的搜索结果或 Inspector 连接，会将相应节点追加为 root 后定位。切换 Logic View 或 Standard 会保留范围，SVG 导出当前子图和高亮。使用工具栏的后退、前进或 Ctrl+Z、Ctrl+Shift+Z 撤销和重做范围操作。同一标签页刷新可恢复最近一次提交的 roots、深度、选中项及视口。

### AIG 视图与高亮

新导入的 AIG 默认使用 `Logic View`。刷新已有会话时沿用保存的画法。上下文栏的 `View` 提供两种画法：`Standard` 按逻辑深度安排层次，输入集中在底部；`Logic View`（原 ABC）允许输入和输出靠近各自关联的逻辑，输出不再统一排在顶层。两者都采用自下向上的信号方向、相同图元与反相虚线。切换画法会重新布局，但复用同一文档已有的结构分析结果；不需要本机安装 ABC。

| 控件 | 用途 |
| --- | --- |
| `Highlight connections` | 默认 `All`。点击输入端口，以绿色向输出追踪；点击输出端口，以蓝色向输入或常量追踪。在同一下拉框选 `1 level`、`2 levels` 等可限制范围，每条连线算一级。选择 `Custom…` 输入正整数时，画布即时预览。按 Enter 或移开焦点后保存有效级数，按 Esc 或输入无效级数会恢复之前的设置。范围外的节点与连线显示为浅灰色。选 `All` 恢复完整追踪，选 `Off` 清除连接高亮与灰显。选中 AND 时，上游显示蓝色，下游显示绿色，两侧从该 AND 各自计算级数。例如选 `2 levels`，会同时看到上游两级与下游两级。选中连线时标记两个端点。 |
| `Block labels` | 在已识别的逻辑块根附近显示类型标签，保留原始 AND 节点。 |
| `Dim outside selected result` | 在 Analysis 中选中一个逻辑块或一对重收敛路径后，淡化结果之外的节点和边。关闭后，外围逻辑恢复原亮度，选中结果的彩色标记仍可见。 |
| `Logical critical path` | 默认关闭；标记最长单位 AND 深度路径，红色不表示真实时序违例。 |
| `High fanout` / `≥` | 默认关闭；标记扇出引用达到阈值的节点，默认阈值为 2。 |

这些高亮和标签开关即时更新，不重新布局。选择结构分析结果时，以结构路径/成员高亮为主，暂停连接高亮；节点角色、路径 A/B 和反相虚线仍可区分。要回到某个节点的普通详情，可直接点击该节点，或先使用 `Clear highlight`。

### AIG 重收敛与逻辑块

导入后打开 `Navigator → Analysis`，后台分析完成后可以查看：

- **Reconvergence**：列出 `Stem`（分叉点）到 `Merge`（汇合点）的结构重收敛。点击一行高亮两条仅共享起点和终点的见证路径 A/B（蓝色 / 橙色），详情显示端点、AND 深度与沿途节点。列表中的 `edges` 是边数，不是时间延迟；按需计算完成后，`Path union` 给出通往同一汇合点的路径并集，额外路径以青色显示。嵌套和重叠结果分别保留，不判断输入条件能否同时激活这些路径。
- **Blocks** 识别 XOR2、XNOR2 和二选一 MUX。用 `Root type` 按正相根函数筛选，点击结果可高亮块成员和边界输入。`Function at the positive root` 显示根节点在出边取反前的函数，引脚映射中的符号与该公式一致。`Root output uses` 逐条列出输出端口或下游门的输入槽、边极性以及接收端得到的函数。如果同一个 XNOR 根同时驱动实线和反相虚线，实线送出 XNOR，虚线送出 XOR。块内中间节点引出的支路另列在 `External uses of internal signals`。

  MUX 的公式把反相写在对应数据项上。例如正相根为 `s ? ¬b : ¬a` 时，反相出边传递 `s ? b : a`。D0、D1 表示从块边界到观察点的等效数据值，画布上的虚线表示某一条具体 AIG 边取反。公式和引脚映射为容易混淆的输入名加双引号，例如 `"¬b"` 表示原名为 `¬b` 的输入，`¬"¬b"` 表示该输入取反。

`candidates` 统计合法边界对应的候选，`distinct roots overall` 统计全部类型中的不同根。一个根可能有多个边界候选，多个块也可能共享节点；这些数量不表示互不重叠的电路分区。根节点的正相和反相用途不重复计作两个物理块。

点击详情中的 `Locate` 可定位所选结果，`Clear highlight` 清除分析高亮并恢复外围亮度。`Settings` 中的 `Block labels` 显示正相根的块类型。Standard、Logic View 与 SVG 导出使用相同标注。

### AIG 从节点查找相关结构

1. 在画布、`Navigator → Objects` 或顶部 `Search` 选中目标节点。
2. 打开右侧 `Inspector → Analysis`，查看 `Related blocks` 与 `Related reconvergence`；有相关结果时才显示对应列表。
3. 点击关联结果，查看高亮和详情；左侧 Navigator 会跳转到对应分析类别及结果所在页。需要调整视口时再点 `Locate`。

关联含义与范围如下：

| 查询对象 | 当前关联范围 |
| --- | --- |
| 节点的逻辑块 | 节点是块内部 AND 成员或边界输入时关联；仅作为块外负载不自动关联。 |
| 节点的重汇聚 | 按保存的两条见证路径索引，包含分叉点、汇合点和沿途节点。仅出现在其它路径并集中的节点可能漏关联。 |
| 一条边 | 合并该边两个端点的关联结果；不表示该边本身一定属于每个结果。 |
| 节点附近 | 结构结果列表尚不支持按跳数筛选。画布上的 `Highlight connections` 控制端口与 AND 节点的高亮深度。 |

若选中输出端口 PO 后没有相关块，先在 `Connections` 点击它的驱动 AND 节点，再查看 `Analysis`。关联查询覆盖当前展示子图内已发现的结果；每个关联列表最多展开前 20 项，数量包含其余关联，更多结果可到 `Navigator → Analysis` 的当前结果列表继续查找。即使当前范围分析已完成，见证路径索引的限制仍然存在。

### AIG 分析状态与重试

| 面板状态 | 含义与操作 |
| --- | --- |
| `Waiting to analyze` / `Analyzing…` | 工作区已可浏览，后台结构分析等待启动或正在执行；分析中的 `Cancel` 只取消结构分析。 |
| `Analysis complete` | 当前配置的候选搜索完成；典型局部函数变体可识别，但不承诺任意大、冗余的等价子图都能发现。 |
| `Partial results` | 达到工作量、候选 cut、搜索大小或结果数量等预算；查看 `Reached` 原因，“未列出”不代表不存在。 |
| `Analysis cancelled` / `Analysis unavailable` | 分析已取消或失败；通过 `Analyze again` 显式重试，原图仍可浏览。 |

结构分析和路径详情的单次任务超时为 15 秒，与 Graphviz 布局的 20 秒超时分别计时。取消或失败后，在同一文档内切换 Standard / Logic View 不会自动重启分析。相同图与预算下反复点击 `Analyze again` 不会扩大候选范围；大型图可在外部先提取目标逻辑锥再导入。

当前展示子图的结果与 `Path union` 的完整性分别显示。单个路径并集计算失败时，仍可查看两条见证路径。切换画法会保留错误提示；再次点击该结果可重试路径并集。刷新后会保留筛选和选区并重新计算结构分析，已失效的结果选区会自动清除。

### AIG 取消、恢复与功能边界

- **原子替换与超时取消**：导入新文件时，系统会先在后台完成独立解析与首帧场景构建，成功后再替换当前视图；若格式错误、布局超时或中途点击 `File → Cancel AIG import` 取消，均安全保留上一个可用视图。Graphviz 在独立 Web Worker 中运行，单次布局超过 **20 秒**会自动终止并报错；预计全图会超时时，可在 File 中勾选 Open AIG in Search-first，导入后用 Focused 或 Show Path 选择局部逻辑，系统不会将 AIG 回退至网表正交布局器。
- **工作区能力**：AIG 提供 Single 工作区的 Whole 和 Focused 浏览。加载 Verilog 后可使用网表工作台的 Compare、Adjust、Timing、Liberty、Cell Config 和 Golden。二进制/ASCII AIGER（`.aig` / `.aag`）直接导入、网表转 AIG 及 AIG 双图对比属于后续规划范围。
- **BLIF 与 DOT 语法及配额边界**：
  - BLIF 支持 `.model`、`.inputs`、`.outputs`、`.names`、`.end`、注释、`\` 续行，以及所有零、一、两输入组合函数的同相 ON 或 OFF 积项表（cover）。`-` 表示该输入任意，XOR/XNOR 按三个 AND 与反相边表示。遇到一般多输入逻辑、`.gate` / `.subckt` / `.latch` / `.exdc`、无驱动信号、多驱动冲突或组合逻辑环路时，系统会拒绝导入并给出明确诊断。
  - 结构中独立的重复 AND 节点会完整保留各自的身份与扇出引用；纯 `BUF` / `NOT` 链则规范化折叠为带极性的来源别名（记录在 `Inspector > Source` 中）。
  - 源文件文本上限为 **16 MiB**，AIG 对象总数上限为 **100,000**，规范化阶段设有独立工作步数预算（上述上限用于拦截不受支持的超大输入，不代表对任意十万级节点图提供 20 秒内完成 Graphviz 布局的速度承诺）。
- **离线运行时与字体说明**：Graphviz / Viz.js / WASM 已完整随 Windows 与 Linux 离线包分发，无需联网、Python 或本地安装 ABC / Graphviz。布局阶段按标准 Arial 字体度量计算文本框尺寸；不同操作系统或浏览器的实际回退字体可能存在细微字宽差异，不承诺跨平台像素级完全一致。

### AIG 结构分析练习

打开仓库或 `v1.6.0` Windows 离线包中的 `examples/aig_structure_demo.blif`。这个示例由 AND 节点和反相边构成，可以直接打开。

| 输出 | 函数 |
| --- | --- |
| `x` | `a XOR b` |
| `q` | `a XNOR c` |
| `y` | `s ? x : q`，`s = 1` 选 `x`，`s = 0` 选 `q` |

1. 通过 `File → Open AIG…` 导入，进入 `Navigator → Analysis`。默认预算下应显示 `Analysis complete`、`Reconvergence (6)` 和 `Blocks (3)`。
2. 点击一条重汇聚结果，观察 Stem / Merge、蓝色路径 A 与橙色路径 B；等待 `Path union` 完成，再点 `Locate` 查看整个高亮范围。
3. 切到 `Blocks`，依次用 `Root type` 选择 XOR2、XNOR2、MUX2，每种应有 1 个候选。选中 MUX，在正相根公式中可看到 D0、D1 都带反相。再看 `Root output uses` 中的输出端口 `y`，通往它的虚线使两个数据项恢复正相。
4. 点击输入节点 `a`，打开右侧 `Inspector → Analysis`，查看相关块和重汇聚；点击关联结果验证列表跳转与高亮。选中 PO `x` 后，可用 `Connections` 找到其驱动根。
5. 切换 Standard / Logic View，检查类型、数量与极性一致。开关 `Block labels`、`Dim outside selected result`，最后通过 `File → Export SVG` 导出当前标注。

该练习用于核对操作和固定小图结果，不代表任意大图都能完成全部搜索。下面的最小示例只有一个 AND，不会产生上述 6 对 / 3 块。

### 在布局前筛选 AIG

在 `File` 中勾选 **Open AIG in Search-first**，再打开或拖入 DOT / BLIF。粘贴文本时也可在 `Paste AIG` 的 View 下拉框中选择 **Search-first**。导入后即可按原始 ID 或设计名搜索，此时 Graphviz 调用次数为零。

- 要看局部邻域，点选搜索结果进入 **Focused**，再调整 Fanin / Fanout 深度。
- 要看两点之间的逻辑，在 **Show Path** 中添加起点与终点并点 **Apply**。Graphviz 只布局筛选出来的子图。
- 从 Search-first 打开的文件清空 roots 或关闭最后一个路径筛选后会回到索引视图。要布局完整源图，先清除 Show Path，再点击 **Whole**。局部布局失败时仍可修改筛选并重试。

### BLIF 设计名称和两输入逻辑

打开[带名称映射的 BLIF 示例](../examples/aig_mapped_names.blif)。`n0`、`n1` 是输入，`n2` 是 OR 的输出，`n3` 是它的反相输出，`n4` 是 XOR 的输出。

1. 在顶部 Search 输入 `in_96`，选择显示 `dp_add_2_cp_temp3_combined/in_96` 的 PI。搜索结果同时列出 BLIF 原始 ID 和画布节点 ID。输入、输出在画布和导出 SVG 上使用 BLIF 声明的原始信号名。本例的端口标签为 `n0`、`n1`、`n3`、`n4`。
2. 在 Navigator 的 **Names** 页输入 `n3`。映射表分别列出驱动节点和输出端口。点击 Canvas ID 定位对应点，在 Inspector 的 **Source** 页查看原始 ID、设计名、极性及注释行号。**Objects** 页的类型筛选可单独浏览内部 AND。
3. 查询 XOR 输出的上游连接。输入不同值的两行 cover `01 1`、`10 1` 会产生三个 AND，其中两个辅助点的来源注明 `Generated for .names n4`。短数字标签、搜索与 SVG 使用同一个画布节点 ID。

使用独立注释行 `# <BLIF信号ID> <设计名称>` 写映射，保留名称中的层次分隔符和方括号。映射名重复时根据原始 ID、节点 ID 和用途选择。一个信号存在多个不同映射名时，Names 列出全部候选。Log 中可查看冲突和未声明编号信号的汇总。

### AIG 最小示例

将以下文本保存为 `aig_demo.blif`，通过 `File → Open AIG…` 导入，或直接粘贴到 `File → Paste AIG…` 即可体验（源码预览与离线发布包均可直接使用，无需安装额外综合工具）：

```blif
.model aig_demo
.inputs a b
.outputs y yn
.names a b n
11 1
.names n y
1 1
.names n yn
0 1
.end
```

该电路表示 `n = a AND b`、`y = n`、`yn = NOT n`。导入后可按以下步骤核对：

1. 在 `Navigator → Objects` 默认的输入/输出列表中找到 `a`、`b`、`y`、`yn`；将筛选条件 `Type` 切换为 `AND` 可查看内部 AND 节点。
2. 选中输出 `yn`，在 `Inspector → Connections` 查看其输入槽位的 `Inverted`（反相）极性标记；画布上连接至 `yn` 的边呈现为虚线。原文件中的单输入缓冲/反相规则（`.names n y` 与 `.names n yn`）已被规范化折叠为带极性的输出引用，不会额外绘制冗余的独立 BUF / INV 门节点。
3. 选中内部 AND 节点，在 `Inspector → Analysis` 核对 `AND depth = 1` 与 `Fanout references = 2`。默认高扇出阈值为 `2`，勾选 `Settings → AIG overlays → High fanout` 后，该 AND 节点会呈现橙色高扇出外框；此开关初始关闭。
4. 切换至 `Inspector → Source` 查看原始信号名称与别名链，点击 `Copy` 可复制完整名称；也可在顶部全局 `Search` 中按名称或来源 ID 检索并按 `F` 键居中放大。
5. 点击 `File → Export SVG` 将当前视图及高亮导出为 SVG 文件（注：导出的 SVG 仅供图像查阅与文档归档，不可作为 AIG 源文件重新导入，请妥善保留原始 `.dot` / `.blif` 文件）。

### Show Path 路径与逻辑级数

打开工具栏的 **Show Path**，搜索对象，逐项加入 **Starts** 或 **Ends**，再点 **Apply**。全局搜索结果右侧的 `Add…` 和 Inspector 均提供 `Add as start` 与 `Add as end`。Netlist 支持当前模块的端口、net、cell 和明确的 pin。AIG 支持节点、原始信号和 BLIF 映射名。遇到同名项时按对象类型、规范化 ID 和极性选择。每端最多指定 32 项。Compare 用面板中的 A/B 选择器指定操作侧。

- 两端都指定时，画布显示从任一起点能到达任一终点的路径并集。只指定起点可追踪扇出，只指定终点可回溯扇入。报告分别列出自动边界、不可达端点和截断情况。
- 要比较各输入到某个输出的距离，把该输出加到 **Ends**，留空 **Starts**，点 **Apply**。在 **Path information → Auto starts** 看每个输入的 **To selected end**。对于多个终点或长短不同的路径，报告显示到本次终点集合的最短…最长级数。只指定起点时，**To auto end** 或 **To auto ends** 使用报告列出的 **Auto ends**，包括组合逻辑追踪停下的边界。找不到连接时显示 `unreachable`，组合环或歧义使距离无法确定时显示 `unknown`。
- 要看某个输入到指定输出的距离，把该输出加到 **Ends**，点 **Apply**，在该输入行点 **Distances**。终点行的 **From start** 给出从该输入到这个终点的最短及最长级数。**Object levels** 可查看中间对象。两种距离均从当前起算点之后计数。AIG 每经过一个 AND 加 1，反相边为 0；网表每经过一个组合单元加 1，含显式 BUF/INV。
- **Focused** 可进一步裁剪已经提取的结果。端点和级数仍可在报告中查看。**Display boundaries** 列出当前画布的截断点和旁路输入。**Turn off** 保留端点，**Clear** 清除查询。两种操作都可撤销。**Export SVG** 在图下方附上当前查询摘要。Compare 可分别导出两侧。

**复现 XOR 深度。** 打开 [examples/aig_mapped_names.blif](../examples/aig_mapped_names.blif)，搜索 `in_96` 并将 PI 加为起点，再搜索 `n4` 并将 PO 加为终点。点击 **Apply**。在 **Starts** 中，该输入显示 `To selected end 2 · From start 0`。同时把 `n3` 加入 **Ends** 并重新应用后，级数变为 `1…2`。切到 **Ends**，`n4` 显示距起点 2 级。将 PO 设为 Focused 根、前后深度都设为 0，仍能在报告中读到相同的级数。

**核对单个输出。** 打开 [aig_structure_demo.blif](../examples/aig_structure_demo.blif)，只把输出 `y` 加入 **Ends**。报告列出 `a = 4`、`b = 4`、`c = 4`、`s = 2`。Focused 可只显示一个输入，其余端点仍保留在报告里，标为 `outside Focused`。

### AIG 常见问题

- **为什么点选节点后看不到相关结构，或只看到部分关联？**
  先确认右侧打开的是 `Inspector → Analysis`，再查看左侧当前范围分析是否完成。PO 需要转到驱动根查询；重汇聚索引只含两条见证路径，且列表最多展开前 20 项。详见 [点相关查询](#aig-从节点查找相关结构)。
- **块标签与输出名称的 XOR / XNOR 含义不同？**
  块标签以正相根的函数为准。查看 `Root output uses` 中相应输出端口的公式即可确认该端口实际得到 XOR 还是 XNOR。
- **分析显示完成，为什么 Path union 还在计算或显示 partial？**
  当前子图的结构识别与按需路径并集各自运行，使用各自预算和状态。见证路径已证明该结构存在，并集受限不影响这两条路径的有效性。
- **文件后缀正确但导入失败？**
  `.dot` 文件须符合 ABC `write_dot` 的 AIG 结构约定。`.blif` 文件须为平坦组合逻辑，且每个 `.names` 至多声明两个输入。遇到时序锁存器（`.latch`）、层次化子电路（`.subckt`）、工艺映射门（`.gate`）或超过两个输入的真值表，导入时会报出相应声明的位置。
- **红色高亮是否代表 STA 时序违例？**
  **不是**。AIG 模式下的红色高亮仅表示按单位 AND 级数计算的**最长逻辑深度路径（Logical critical path）**，不读取 Liberty 单元延迟、Arrival Time、Required Time 或 Slack。
- **在 `Navigator → Objects` 中筛选后，为什么中央画布没有变小？**
  `Objects` 筛选器控制左侧列表。若要抽取局部逻辑，在画布或搜索结果选中节点后点击 `Focused`。点击列表上方的 `Show selection` 会展开当前选中对象所在页。
- **遇到 Graphviz 布局超时怎么办？**
  正在布局时可点击 `File → Cancel AIG import`。勾选 `File → Open AIG in Search-first` 后重新打开文件，或在粘贴对话框选择 `Search-first`，即可直接搜索并用 Focused 或 Show Path 布局局部逻辑。若子图仍然超时，可缩小邻域深度或补充路径另一端，再试一次。
- **为什么 Timing、Golden、Compare、Liberty 或 Cell Config 按钮不可用？**
  这些能力专属于门级 Verilog 网表工作区。通过 `File → Open design…` 重新载入 Verilog 网表后即可恢复全部网表功能；网表时序报告与 Layout Golden 不能跨领域套用到 AIG 图上。
- **标签页刷新恢复是否等同于保存了文件？**
  **不是**。AIG 会话仅保存在当前浏览器、当前站点地址与当前标签页的 `sessionStorage` 中，关闭标签页、清除站点数据或超出浏览器存储配额后将无法恢复（存储受限时会在日志与状态栏给出警告）。需要长期保存时，请保留原始 `.dot` / `.blif` 文件并按需执行 `File → Export SVG`。
