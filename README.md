# Netlist Graph Builder

Linux 单文件启动器、CMake 构建及 EDA/Tcl 集成说明见 [LINUX_SINGLE_FILE_LAUNCHER.md](docs/LINUX_SINGLE_FILE_LAUNCHER.md)。

**Netlist Graph Builder** 是一个离线可用的门级结构化 Verilog 原理图浏览器（Gate-level Structural Verilog Schematic Browser）。在缺乏 Liberty（`.lib`）时序库与大型商业 EDA 工具的环境中，它能够直接解析网表、自动推断常见标准单元（cell）与引脚（pin）语义，并生成支持搜索、路径追踪与双模块对比的交互式 SVG 结构图。此外，内置独立的 AIG 工作区，支持离线浏览与分析 ABC AIG DOT 和平坦两输入组合 BLIF。

- **v1.7.1** 修复 Verilog 与时序导入、Compare 历史恢复、画布定位和启动器断连处理，并改善大图内存与交互响应。支持通过 SSH 转发在本地浏览器打开服务器文件，在启动终端继续输入命令，并用一个后端控制多个页面。用 `aig add` 可在同一页追加和切换多份 AIG；同时支持为 AIG 关联 `.level` 层级与裕量报告（主输入初始到达层级传播与逐点 AT / RT / Slack 报告），并在 `File` 菜单中按 `Netlist + Timing` 与 `AIG + Level` 配对分组。[下载 Windows / Linux 版](https://github.com/11234201/NetlistGraphBuilder/releases/tag/v1.7.1) · [SSH 工作台](#ssh-工作台) · [AIG Level 规范](docs/design/aig_level_format_spec.md) · [更新日志](CHANGELOG.md)
- **v1.6.3** 修复同一实例的 STA 记录因层级路径写法不同而漏配的问题。选中缺时序的 cell，可在 Inspector 的 Timing 页查看具体原因和报告位置。
- **v1.6.2** 修复多文件 Global/Local 与多层 occurrence 上下文的时序隔离及多实例歧义保护，支持父模块视图子模块 `hinst` 展示 `kind: "port"` 引脚时序与整线总线最差位高亮，并兼容 `LocalDesign`、`a_q\[33\]`、`\/` 与含 `:` 的转义实例名，同时索引化 cell 查找以保证顺序无关与大模块性能。
- **v1.6.1** 新增 Verilog 注释属性解析与 Inspector 分页，支持多文件网表/时序合并及 Compare A/B 独立导入，默认左右对比与副本自动配对，并将 Show Path 整合至左侧 Navigator。
- **默认布局引擎**：网表默认使用 `AnchorLayered`（物理锚点分层布局）；若布局失败，会依次自动降级至 `ELK`、`Simple`，若 `Simple` 仍失败则停止重试。自动降级不会覆盖用户保存的首选项；缺少首选项版本号的旧 `Simple` 会话会一次性迁移回 `AnchorLayered`，此后用户主动选择的 `Simple` 或 `ELK` 仍会正常保留。
- **AIG 浏览**：从 `File → AIG + Level → Open AIG…`（或 `Open design…`）打开 ABC AIG DOT 或平坦两输入组合 BLIF，支持 `Add AIG file(s)…` 同页保留多份 AIG 并从顶栏切换；可同时或后续加载 `.level` 文件（`Open levels…` / `Paste levels…`）设定主输入初始层级并查看各点 AT / RT / Slack 层级报告。支持按映射名查找输入、输出和内部点，查看 XOR/XNOR 分解来源，并用多根 Focused 抽取局部逻辑。Standard、Logic View 和 SVG 导出共用当前展示范围。[AIG 使用说明](docs/guide/07-aig-workspace.md)
- **零构建离线调用**：`AnchorLayered` 布局引擎可在克隆仓库后直接离线 `import` 调用，无需构建或安装步骤，详见 [AnchorLayered 静态包契约](docs/design/elk_anchor_package.md)。关于开发历程、失败试验、验收结论与已知限制，请参阅 [AnchorLayered 开发总结](docs/reports/anchor_development_summary.md)。
- **验证记录说明**：验证结论需严格区分代码版本与运行环境：`v1.1.1` 在 Linux 环境下全图回归曾为 46/47（`DP020` 超过 45 秒门限）；2026-10-16 修复后的源码在 Linux（Node 24.16.0）下达到 47/47 通过、硬违规数为 0；`v1.5.0` 发布验收通过 1294 项单元测试、28 项 AIG 浏览器回归、9 项通用工作台回归及 47/47 映射网表严格门禁，历史记录见 [AIG 集成验收报告](docs/reports/aig_integration_acceptance.md)。`v1.5.2` 结构分析验收通过 1301 项单元测试，浏览器验证、映射回归首轮超时与复测、基准波动见 [结构分析验收记录](docs/plans/aig_structure_analysis.md)。后续通过记录不撤销历史超时记录，亦不承诺跨机器环境的性能绝对恒定。视觉验收仅限于已评审语料，不代表任意拓扑均与 ELK 视觉等价。已退役的早期 Native 算法已从工作树移除（历史追溯见 [retired_native_layered 说明](tests/reference/retired_native_layered/README.md)），不进入离线运行时。

完整功能介绍、操作流程、数据格式示例与故障排查请阅读 [完整使用教程](docs/USER_GUIDE.md)（Windows 发布包根目录亦随附 `USER_GUIDE.md`）。

**工作台入口**　`File` 顶部提供 `Open design…`（及服务器配对时的 `Open from server…`），下方按 `Netlist + Timing`、`AIG + Level` 与 `Export & snapshots` 分组。`Settings` 集中管理显示、布局、时序和库配置。上下文栏可切换 Whole / Focused、打开 Show Path；左侧 Navigator 查找模块/对象、重收敛分析与路径级数，右侧 Inspector 查看连接、属性、分析、时序/层级或来源。

**让画布占满宽度**：点击左右面板标题旁的 `Hide`，或点击顶部 `Navigator` / `Inspector` 开关即可收起面板；两侧均隐藏后，中央画布占满工作区宽度。顶部开关始终保留，可随时分别恢复面板（高亮表示已展开）。收起和恢复面板均保持当前图中心与缩放倍率，不触发重新布局。

首次使用时，1366/1440px 窗口默认停靠 Inspector、按需打开 Navigator 抽屉，1920px 窗口默认停靠两侧面板。停靠面板开关、宽度与最近页签会自动记忆；窄屏抽屉在刷新后默认关闭。详细步骤见 [面板隐藏与恢复](docs/guide/01-getting-started.md#14-隐藏恢复与调整左右面板)，旧入口对照见 [新版入口速查](docs/USER_GUIDE.md#新版入口速查)。

## AIG 快速上手

1. 选择 `File → Open AIG…` 打开 DOT 或 BLIF（或在 `Open design…` 中同时勾选 AIG 与配套 `.level` 文件；也可通过 `Add AIG file(s)…` / `Append pasted AIG…` 在同一页追加多份 AIG 并由顶栏图选择器切换）。大型 AIG 可先勾选 `Open AIG in Search-first`，导入完成后先搜索，选定 Focused 邻域或应用 Show Path 时才布局。
2. 在 `Navigator → Objects` 按名称或来源 ID 找到节点（若有 BLIF 名称映射可在 `Names` 页查询），点击后在 `Inspector → Connections` 追踪连接，在 `Analysis` 查看逻辑深度（或带输入偏移的拓扑层级及 AT / RT / Slack 报告）、扇出与相关结构。
3. 如需为主输入设置非零初始层级或加载层级裕量报告，可在 AIG 打开后点击 `File → AIG + Level → Open levels…` 或 `Paste levels…`（支持 `a 3` 两列输入偏移简写，或带 `point at_level rt_level slack_level` 表头的完整报告，例如同时打开 [aig_mapped_names.blif](examples/aig_mapped_names.blif) 与 [aig_mapped_names.level](examples/aig_mapped_names.level)）。
4. 打开左侧 `Navigator → Analysis`，在 `Reconvergence` 查看重汇聚路径，在 `Blocks` 按 XOR2 / XNOR2 / MUX2 筛选逻辑块。点选结果高亮，右侧 `Locate` 才调整视口；`Partial results` 表示结果尚不完整。
5. 在上下文栏用 `View` 切换 Standard / Logic View，用 `Highlight connections` 设置追踪深度。在 `Settings → AIG overlays` 设置逻辑块标签、关键路径和高扇出标记。
6. 打开随包的 `examples/aig_structure_demo.blif`，在 `Show Path` 搜索 `y`，选 `po` 行的 `End +`，点 `Apply`。`Path information → Auto starts` 显示到 `y` 的级数为 `a = 4、b = 4、c = 4、s = 2`。用 `File → Export SVG` 保存当前图和端点报告。

没有现成输入时，可直接打开 [结构分析示例](examples/aig_structure_demo.blif)，照着 [结构分析练习](docs/guide/07-aig-workspace.md#78-动手练习与最小示例) 查看 6 对重汇聚与 3 个逻辑块；想体验 BLIF 名称映射与 `.level` 报告可打开 [aig_mapped_names.blif](examples/aig_mapped_names.blif) 与 [aig_mapped_names.level](examples/aig_mapped_names.level)；只想熟悉反相边时可使用 [最小 BLIF 示例](docs/guide/07-aig-workspace.md#最小可运行-blif-示例)。[点相关查询](docs/guide/07-aig-workspace.md#从节点查找相关结构点相关查询) 已提供基础关联，尚不支持按节点周围 N 跳查询；完整操作与边界见 [AIG 教程](docs/guide/07-aig-workspace.md)。

## 近期核心功能演进

| 能力领域 | 入口位置 | 当前行为说明 |
| --- | --- | --- |
| **SSH 工作台与多页/多 AIG** | `File → Open from server…`、启动终端、`cmd`、`ngb.tcl`、顶栏图选择器 | 四种启动器共用 182 条命令与 5 个简写；单个后端可配对多个浏览器页（`pages` / `use`），单页可通过 `aig add` / `Add AIG file(s)…` 保留并切换多份 AIG。 |
| **AIG Level 层级与裕量报告** | `File → AIG + Level → Open levels…` / `Paste levels…`、`level open` | 支持主输入初始 `at_level` 偏移向下游传播拓扑层级与关键路径，以及逐点 AT / RT / Slack 报告（`Inspector → Analysis`）；Level 附件按所属 AIG 绑定并在切图与刷新后恢复。[格式规范](docs/design/aig_level_format_spec.md) |
| **多文件合并、注释属性与 Compare 侧文件** | `File → Netlist + Timing`、Compare `A files` / `B files`、`Inspector → Attributes` | 支持 `Add design/timing file(s)…` 叠加导入（同名模块按 `[filename]` 消歧）、Compare 两侧独立加载网表与时序，以及结构化 Verilog 注释属性（`module`/`port`/`net`/`instance`）解析。 |
| **Show Path 路径级数** | 上下文栏 `Show Path` / `Navigator → Path → Apply → Path information` | 在 Starts 查看每个输入到所选 Ends 的最短和最长级数。仅指定起点时，使用报告中的 Auto ends。在 Ends 查看从查询起点到指定终点的级数（From start）。[教程与 BLIF 示例](docs/guide/06-show-path.md) |
| **离线 AIG 工作区** | `File → AIG + Level`、Navigator → `Analysis` | 在 Whole 或 Focused 中查看 Standard / Logic View 曲线图、当前子图重收敛与 XOR / XNOR / MUX，支持多图切换、Level 层级报告、对象追踪、刷新恢复和 SVG 导出。 |
| **网表重收敛** | Navigator → `Analysis` | 列出当前可见逻辑内的分叉、汇合及两条独立路径，支持高亮、定位和详情。Compare 两侧各自计算。 |
| **可隐藏的左右面板** | 面板标题 `Hide`、上下文栏 `Navigator` / `Inspector` | 两侧可分别隐藏或恢复，中央画布使用腾出的空间；Single、Focused 与 Compare 共用，保留当前阅读位置与缩放倍率。 |
| **指定 Net 不布线** | `Inspector → Connections → Net routing` | 支持为 `clk`、`reset` 或任意选定线网单独关闭/恢复几何布线，同时完整保留引脚连接详情与 Focused 锥体追踪；Single 与 Compare 两侧独立生效。 |
| **Liberty 标准单元库** | `Settings → Liberty`、拖放与全局粘贴 | 加载、替换、取消和卸载文本 `.lib`，使用库方向和布尔 `function` 辅助单元推断；Single/Compare 共用，不占用左侧栏，无库时仍可直接浏览网表。 |
| **标准 STA 时序、层级隔离与漏配诊断** | `Settings → Timing`、`Inspector → Timing` 与全局输入 | 支持工业级标准 STA 表格与 JSON 格式、驱动源沿 `assign` 链回溯、多级 occurrence 与 `LocalDesign` 严格作用域隔离、父视图 `hinst` 引脚时序及转义名兼容；`Timing` 菜单提供 `Worst Slack`、`AT`、`RT`、`Delay`、`Slew`、`All` 与 `None` 及 `Threshold`；选中缺时序的 cell 可查看未匹配原因并一键写入 `Log`。 |
| **Cell / Net 多根节点聚焦** | 顶部 `Search`、Inspector 操作区与 `Roots` 菜单 | 支持以 Cell 或 Net 作为聚焦根节点（最多保留 32 个）。点击未在当前画布绘制的搜索结果会追加为新 root 而不替换既有 roots；`Add to Focused` 为显式追加，`Replace roots` 为显式替换。 |
| **跨层次连接与模块树** | `Navigator → Hierarchy` 与 `Inspector → Connections` | 可筛选模块/实例并点击切换，遇到递归或超大层次时有界截断。Inspector 将连接明确划分为 `Current module`（本层连接）与 `Parent occurrence`（跨边界父层连接），长表分页显示，完整名称可查看与复制。 |
| **可切换逻辑门符号** | `Settings → Display → Gate symbols` | 支持在 `Rectangles`（矩形框）与 `Conventional`（标准逻辑门符号，含反相气泡）之间即时切换，不影响节点尺寸、引脚端点或布线几何。 |
| **统一视图历史（View History）** | 顶部 `←` / `→`、`Ctrl+Z` / `Ctrl+Y`、`Alt+方向键` | 事务化记录并恢复模块切换、视图模式、Focused roots 与深度、选中项、视口缩放平移及手动布局调整。 |
| **间距精确输入与垂直引脚转角** | `Settings → Layout` 与自动/手动布线 | `Wire spacing` 与 `Cell spacing` 支持滑块调节与数字直接输入（提交后自动吸附至最近的 4 的倍数）。连接顶部/底部引脚（top/bottom pin）的末段连线会预留可见转角，避免近距离折线重叠难辨。 |
| **恢复校验、大图渐进渲染与日志** | Session、Layout Golden、渐进渲染与 `Log` | Golden v3/v4 采用内容指纹（fingerprint）校验网表一致性并恢复聚焦深度；批量导入支持网表依赖序列（Liberty → 网表 → 时序 → Golden）与 AIG + Level 智能配对。大图渐进渲染完成后完整恢复线桥（wire bridge）、标签与点击热区；浏览器与终端启动器分别提供结构化 JSONL 日志与 14 天自动清理。 |

## 主要功能

### 浏览与逻辑追踪

- **结构化 Verilog 解析**：支持 `module`、`port`、`wire`、`assign`、单元实例（cell instance）、转义标识符（escaped identifier）、向量切片、拼接表达式（concatenation）以及结构化注释属性（`module`、`port`/`bus port`、`net`/`bus net`、`instance`）。
- **可选 Liberty 库读取**：`Settings → Liberty`支持加载、替换、取消和卸载文本 `.lib`，使用库声明改善引脚方向及常见门识别；Single/Compare 共用，保留用户配置优先级。使用说明见 [Liberty 导入](docs/guide/02-import-and-libraries.md#25-liberty-标准单元库lib)。
- **无 `.lib` 智能推断**：在缺乏 Liberty 库文件时，根据单元与引脚命名自动推断逻辑门类型（gate kind）与引脚方向（pin direction）；未识别单元安全显示为黑盒（blackbox）。
- **全局搜索与定位**：支持按 module、port、net、instance 及 cell type（AIG 模式下按对象名称或来源 ID）搜索并高亮定位目标对象；非编辑状态下按 `/` 聚焦搜索。
- **层次化浏览**：在 `Navigator > Hierarchy` 查看和筛选实例层次路径，点击节点或双击画布中的子模块实例进入对应模块上下文。
- **连接详情、属性与锥体追踪**：在 Inspector 的 `Connections`、`Attributes`、`Analysis`、`Timing`、`Adjust` 五页签（AIG 模式下为 `Connections`、`Analysis`、`Source`）查看驱动（driver）、负载（load）、跨边界父层连接、对象注释属性与推断来源、扇入/扇出（fanin/fanout）统计及关联重收敛；点击面板中的关联项即可连续跳转并自动居中目标。
- **Whole 与 Focused 视图切换**：`Focused` 支持多根节点与独立的前向/后向追踪深度；大型模块默认采用 `Search-first`（搜索优先）模式按需加载局部图。
- **一键居中放大**：支持将当前选中单元或线网按稳定阅读比例居中放大（快捷键 `F`），或将其设为新的聚焦根节点。

### 布局、微调与导出

- **正交原理图渲染**：网表采用从左到右的分层布局与正交（Manhattan）布线渲染交互式 SVG（AIG 采用自下向上的 Graphviz 曲线布局），支持滚轮缩放、拖拽平移与一键适配窗口（`Fit view`）。
- **多布局引擎离线切换**：网表内置 `AnchorLayered`、`ELK` 与 `Simple` 三种布局引擎，完全离线运行；支持灵活调整导线间距（Wire spacing）与单元间距（Cell spacing）。
- **指定 Net 不布线（Net routing）**：在 `Inspector > Connections > Net routing` 取消勾选 `Route net`，可单独隐藏 `clk`、`reset` 等高扇出全局网络或指定线网的几何连线，同时完整保留引脚连接关系与 Focused 追踪能力。
- **Adjust 手工校准模式**：支持拖拽微调节点位置，在 `Inspector > Adjust` 修改尺寸、实例显示属性与单实例引脚方向；释放鼠标后仅对受影响导线做局部正交重布线。`Layout > Reset view overrides` 清除位置、尺寸、实例属性、引脚方向及不布线 net 覆盖，Compare 中同时作用于两侧。
- **大图渲染优化**：支持渐进式分批渲染、高扇出中继节点（Fanout Hub）及低倍率缩放自动隐藏细节文字；后续性能演进均面向完整图与局部聚焦视图，不再使用结构分组折叠。
- **Golden 快照与离线 SVG 导出**：通过 `File` 保存、校验并重载布局 Golden JSON，或导出带内嵌样式的独立 SVG。Single 使用 File 菜单导出。Compare 可从 A/B 侧的 Show Path 报告导出该侧 SVG。Golden 保存 Single 工作区，含路径查询时使用 v4。

### 模块对比、时序标注与工具链集成

- **双模块对比（Compare View）**：默认左右分屏（`Left / Right`，可切换为上下 `Top / Bottom`），A/B 身份在任意分屏中保持不变；支持 `A files` / `B files` 独立导入网表与侧别专属时序，支持视口同步与 roots 同步、同名输出锥联动和启发式结构差异高亮。两侧维护独立选择、历史与 roots，Fanin/Fanout 深度共享，Whole 与 Reset 同时作用于两侧。
- **时序报告导入与标注**：支持符合 EDA 工具习惯的标准列式时序文本（空格/Tab/CSV）与 JSON 双模格式（默认极简 `point at rt slack`，可选详细模式 `delay`、`slew`、`edge`、`kind`），完整覆盖映射前（Pre-map）、映射后（Post-map）与布局后（Post-layout）阶段，驱动源自动沿 `assign` 别名链回溯，并支持多文件叠加导入、多级 occurrence 与 `LocalDesign` 作用域隔离、父视图 `hinst` 引脚时序及 cell 漏配原因诊断；Timing 菜单提供 `Worst Slack`、`AT`、`RT`、`Delay`、`Slew`、`All` 与 `None` 指标过滤，支持自定义 Slack 判定阈值（Threshold，默认 0.0）与默认内置验证时序启动联动。
- **AIG Level 层级与裕量标注**：支持为 AIG 载入 `.level` 文件或粘贴层级文本（`File → AIG + Level → Open levels…` / `Paste levels…`），既可用两列简写指定主输入初始到达层级并向下游传播拓扑层级，也可按 `point at_level rt_level slack_level` 记录各点层级裕量报告；每份 AIG 独立保存其 Level 附件并在切图与刷新后恢复。
- **便捷多格式输入**：`File` 菜单顶部提供 `Open design…`（可单选主文件，也可将 Verilog + Timing 或 AIG + Level 一同选中导入），下方按 `Netlist + Timing` 与 `AIG + Level` 分组提供追加文件（`Add design/timing/AIG file(s)…`）与专用粘贴对话框（`Paste netlist / timing / AIG / levels…`）。页面同时支持任意位置拖放与非输入框 `Ctrl+V` 全局粘贴，自动识别 Liberty 库、Verilog 网表、ABC AIG DOT / 两输入组合 BLIF、AIG `.level`、Layout Golden 与时序日志。
- **自定义单元配置（Cell Config）**：支持在界面内编辑、浏览器本地持久化及 JSON 导入/导出未知单元类型的逻辑门种类与引脚方向。
- **过程日志与终端日志（Process & Terminal Log）**：底部可折叠 `Log` 面板支持按阶段（Phase）和级别（Level）过滤、一键复制与脱敏导出 JSONL；各平台终端启动器自动按约 2 MiB 轮转运行/错误 JSONL 日志，并在启动时清理超过 14 天的已退出进程旧日志。
- **跨平台 EDA 启动与远程命令接口**：Node.js、Python、Windows 离线版与 Linux 单文件启动器共享统一的启动参数、状态文件生命周期与 182 条远程工作台命令（含 `cmd` 子命令与交互式终端 REPL）；配套 `ngb.tcl` 同时提供 `Start/Status/Stop` 与 `Connect/Cmd` 接口。

## 运行方式

### Windows 离线正式版（无需安装 Node.js）

Windows 当前离线发布包为 `NetlistGraphBuilder-v1.7.1-win-x64.zip`，完整解压后双击运行 `NetlistGraphBuilder.exe`。程序在本机回环地址 `127.0.0.1` 启动服务并自动打开默认浏览器。使用期间请保留控制台启动窗口，按 `Ctrl+C` 或关闭窗口即可退出服务。

完整解压后保留 `app/`、`runtime/` 与 EXE 同级。EXE 在自己的进程中加载包内 CPython 和工作台资源，使用当前 Windows 用户的命名管道处理 `cmd`、`status` 和 `stop`。包内提供示例、使用指南、`ngb.tcl` 及 Python、ELK 和 Graphviz 的许可证。若默认端口 `4173` 已被占用，启动器会自动顺延寻找空闲端口。

维护者在安装了 x64 CPython 3.10+、Node 和 .NET Framework 编译器的 Windows 构建机上执行下列命令。可用 `NGB_BUILD_PYTHON` 指定构建解释器。产物与 SHA-256 校验文件输出至 `dist/`。

```powershell
npm run release:windows
```

### Linux 单文件启动器与 CMake 构建

Release 提供 `NetlistGraphBuilder-v<version>-linux-x64` 单文件 ELF 可执行程序及 `.sha256` 校验文件；下载后执行 `chmod +x` 即可直接运行。该二进制在 Linux x86-64（glibc 2.35）环境下构建与验证，不承诺在 CentOS 7 或任意旧发行版上直接兼容。配套 Tcl 辅助脚本可从发布附件 `ngb.tcl` 下载，或直接取自仓库 `tools/eda/ngb.tcl`。

从源码构建 Linux 单文件启动器需要 CMake 3.16+、支持 C++17 的编译器与 POSIX threads；生成的二进制已内嵌全部前端源码、vendored ELK、Graphviz/Viz.js（含 WASM）与开源许可证，运行机器无需安装 Node.js、Python 或携带项目资源目录（仅依赖目标平台基础系统库与浏览器）：

```bash
cmake -S . -B build/linux -DCMAKE_BUILD_TYPE=Release -DNGB_BUILD_TESTS=ON
cmake --build build/linux --target ngb -j2
ctest --test-dir build/linux --output-on-failure
./build/linux/native/ngb start --netlist ./examples/two_equivalent_style_modules.v --port 0 --no-open
```

其中 `-DNGB_BUILD_TESTS=ON` 仅在运行构建测试时需要 Python 3.6+（运行 Tcl 集成测试另需 `tclsh`）。也支持以 `cmake -S native -B build/ngb` 方式独立构建，此时可执行文件生成于 `build/ngb/ngb`。关于安装目录定制、Tcl `Start/Status/Stop` 接口、父进程退出自动清理及跨发行版 ABI 说明，详见 [Linux 单文件启动器指南](docs/LINUX_SINGLE_FILE_LAUNCHER.md)。

### VS Code 一键启动（源码开发预览）

仓库内置了 VS Code 任务与调试启动配置。在本地工作区或 Remote-SSH 远程工作区中打开仓库后：

1. 打开 `Run and Debug` 面板（`Ctrl+Shift+D`）。
2. 选择 `Netlist Graph Builder: Open View`。
3. 按下 `F5`。

VS Code 会自动在后台拉起预览服务，并在编辑器右侧的 Integrated Browser 标签页中打开网表工作台。预览服务仅监听 `127.0.0.1:4173`；工作区配置会自动启用 VS Code 远程端口转发代理，无需开放服务器防火墙端口。

源码预览脚本 `tools/start-preview.sh` 会按以下优先级选择运行时（与单文件二进制 `ngb` 无关）：

1. 若 `node` 可正常执行，优先运行 `tools/serve.mjs`；
2. 否则，若存在 `python3`，自动回退至零第三方依赖的 `tools/serve.py`；
3. 若两者均不可用，则在终端输出明确的诊断提示。

因此，即便在无法运行新版 Node.js 官方二进制的旧版 Linux（如 CentOS 7）环境中，只要具备 Python 3 即可正常启动源码预览：

```bash
python3 --version
```

若当前 VS Code 版本不支持 `editor-browser` 调试类型，可依次执行 `Terminal > Run Task > Netlist Graph Builder: Serve`，在 `Ports` 面板确认转发 `4173` 端口，随后通过命令面板调用 `Browser: Open Integrated Browser` 访问 `http://127.0.0.1:4173/`。

> **CentOS 7 远程连接提示**：[VS Code Remote Development 官方系统基线](https://code.visualstudio.com/docs/remote/linux)要求远程主机具备 glibc 2.28、libstdc++ 3.4.25 与 kernel 4.18，CentOS 7 已不在官方支持范围内。若 Remote-SSH 自身无法建立连接，建议优先升级至 Rocky Linux、AlmaLinux 或 RHEL 8+，或参考 [VS Code Remote FAQ](https://code.visualstudio.com/docs/remote/faq) 配置自定义 sysroot。本项目提供的 Python 回退仅解决预览 Web 服务的运行时依赖，无法替代 VS Code Server 自身的底层系统库。

### 命令行直接启动

源码目录使用统一入口，自动选择可用的 Node.js 18+ 或 Python 3.6+，不需要 npm：

```bash
./ngb --no-open
```

Windows 使用 `.\ngb.cmd --no-open`。已有的启动参数与 `start/status/stop/cmd` 子命令均可原样传入，相对路径保持相对于调用目录。运行时选择、会话控制与示例见 [通用源码启动入口](docs/UNIVERSAL_LAUNCHER.md)。

也可直接指定已有后端：

```bash
node tools/serve.mjs
python3 -u tools/serve.py
```

所有启动器均仅绑定本地回环地址 `127.0.0.1`，默认自动唤起浏览器；传入 `--no-open` 可仅启动后台服务，传入 `--port`（或设置环境变量 `PORT`）可指定监听端口。交互终端逐行显示工作台链接与状态文件路径。脚本、EDA 管道或 `--no-interactive` 启动仍从标准输出读取单行 `ready` JSON。

### EDA 命令行与脚本接口

Node.js、Python、Windows 离线版与 Linux 单文件 `ngb` 共享一致的业务命令行参数。以下命令示例会加载指定的网表、时序与单元配置，默认打开 `top` 模块，并以实例 `u0` 为中心展示扇入深度 1、扇出深度 2 的局部聚焦图：

```powershell
node tools/serve.mjs --netlist "C:\EDA jobs\design one.v" --timing "C:\EDA jobs\timing one.txt" --cell-config "C:\EDA jobs\cells.json" --module top --focus u0 --fanin-depth 1 --fanout-depth 2 --no-open
```

使用 Python 时只需将命令前缀替换为 `python3 -u tools/serve.py`；使用 Windows 发布包时替换为 `NetlistGraphBuilder.exe`。常用参数说明如下：

- `--netlist <path>`、`--timing <path>`、`--cell-config <path>`：指定启动时自动加载的输入文件路径（含空格路径请加引号）。
- `--module <name>`、`--focus <instance>`：指定初始打开的模块名称与聚焦单元实例。
- `--fanin-depth <0-99>`、`--fanout-depth <0-99>`：分别设置 Focused 视图向输入侧（fanin）和输出侧（fanout）扩展的层数，`0` 表示关闭该方向。
- `--browse-root <dir>`：指定远程工作台服务器文件选择器允许访问的根目录（可重复传入多个目录，默认当前工作目录）；`--[no-]interactive` 控制是否在启动终端开启交互式命令提示符（默认在 TTY 下开启）。
- `--port <0-65535>`：指定本地监听端口，传入 `0` 由操作系统自动分配空闲端口；`--no-open`（兼容旧别名 `--no-browser`）禁止自动打开浏览器。

此外，Node.js、Python、Windows 离线版与 Linux `ngb` 均支持面向自动化脚本的会话生命周期管理与跨进程工作台命令子命令：

```bash
node tools/serve.mjs start --netlist ./results/top.v --port 0 \
  --browse-root ./results --state-file ./results/ngb-session.json --no-open
node tools/serve.mjs status --state-file ./results/ngb-session.json
node tools/serve.mjs cmd --state-file ./results/ngb-session.json pages
node tools/serve.mjs stop --state-file ./results/ngb-session.json
```

其中 `start` 子命令可省略以兼容传统直接传参写法；`stop` 严格依据状态文件校验目标进程身份后安全终止服务，绝不按端口号盲目搜索或强杀无关进程。

服务启动成功后输出的 `ready` JSON 仅包含文件名与目标摘要，绝不泄露网表、时序或配置原文：

```json
{"event":"ready","host":"127.0.0.1","port":4173,"url":"http://127.0.0.1:4173/?startup=1","startup":{"netlist":"design one.v","timing":"timing one.txt","cellConfig":"cells.json","module":"top","focus":"u0","faninDepth":1,"fanoutDepth":2}}
```

当输入文件不可读、Cell Config JSON 结构非法、指定的 `module`/`focus` 在网表中不存在（Node 启动预校验）或数值参数越界时，启动器会在绑定端口前输出清晰报错并以非零状态码退出。可执行 `npm run test:launcher` 运行端到端启动协议测试。

若启动时未指定任何输入文件，页面将默认加载内置示例网表。用户可随时通过顶部 `File` 菜单打开网表、时序或 AIG（`.dot` / `.blif`）及配套 `.level` 层级文件，也可向页面任意位置拖放 `.lib` Liberty 库、`.v` / `.sv` / `.txt` 网表、`.dot` / `.blif` AIG、`.level` 层级报告、`.json` Layout Golden 及 `.log` 时序文件；当输入焦点不在文本框内时，直接按 `Ctrl+V` 即可粘贴剪贴板中的文件或文本。若只需临时查看一小段代码或报告，可分别点击 `File` 中的 `Paste netlist…`、`Paste timing…`、`Paste AIG…` 或 `Paste levels…`。

## SSH 工作台

通过 SSH 转发打开 `ready.pairUrl`，本地网页的 **File → Open from server…** 可选择服务器文件（既可单选主文件，也可同时勾选 Verilog + Timing 或 AIG + Level 配对导入，或选 `level open` 为当前 AIG 补载 Level）。一个后端可配对多个页面。在启动终端输入 `pages` 查看页号，`use p1` 指定页面，随后用 `add`、`timing add`、`aig add`、`level open` 或 `files import` 增量加载。页内图选择器和 `module open` 均可切换该页保留的 AIG（每张图各自保留其 Level 附件、选区与视口）。npm、Linux ELF、Python 和 Windows 离线包共用 182 条命令与 5 个简写。`commands --available` 列出当前页适用的命令，`help <命令>` 显示参数。[启动、转发和 Tcl 示例](docs/LINUX_SINGLE_FILE_LAUNCHER.md#6-在-ssh-转发的页面中追加文件) · [完整命令表](docs/plans/remote_workbench_commands.md)

## 快速上手指南

### 先调整画布空间

1. 初次打开可直接浏览内置示例；按需点击顶部 `Navigator` 选择模块。
2. 完成模块选择后，点击 Navigator 标题旁的 `Hide`；暂时不看对象详情时，也收起 Inspector。
3. 用滚轮缩放、拖动空白处平移；需要重新展示整幅当前图时点击 `Fit view`。
4. 选中对象后，点击顶部 `Inspector` 或对象名称摘要打开详情，再在 `Connections` / `Attributes` / `Analysis` / `Timing` / `Adjust`（AIG 模式下为 `Connections` / `Analysis` / `Source`）间切换。主动关闭的 Inspector 不会因再次选择对象而自动弹出。

Compare 模式同样支持收起左右面板，腾出的空间由 A/B 画布共用。需要对比统计时打开 `Navigator > Design`，需要对象详情时打开 Inspector，并核对其 A/B 来源。完整练习见 [放大画布并按需恢复详情](docs/guide/09-logging-workflows-and-faq.md#6-放大画布并按需恢复详情)。

### 快速输入与层次浏览

1. **载入设计与配套报告**：点击顶部 `File > Open design…`（可单选 Verilog / AIG 主文件，也可将 Verilog + Timing 或 AIG + Level 一同选中）、将文件直接拖入页面，或在页面空白处按 `Ctrl+V` 粘贴文本，均可快速加载；在 `File > Netlist + Timing` 与 `AIG + Level` 分组中还可通过 `Add design/timing/AIG file(s)…` 追加合并文件，或通过 `Open levels…` 为当前 AIG 附加 `.level` 报告。
2. **代码片段直绘**：`File > Paste netlist…`、`Paste timing…`、`Paste AIG…`、`Paste levels…` 适合直接复制文本片段并立即应用，无需先保存为本地文件。
3. **多文件智能识别与配对**：拖放与全局粘贴会自动区分 Liberty、Verilog 网表、AIG DOT/BLIF、AIG `.level`、Layout Golden 与时序日志；网表批次严格按“Liberty（如有）→ 网表 → Timing → Golden”的依赖顺序执行，AIG + Level 批次自动将 Level 绑定至对应 AIG（多份 AIG 时按同名文件主干配对）。
4. **Golden 布局存取**：通过 `File > Save Golden` 保存当前模块的布局与手动微调结果；下次先载入相同网表，再点击 `File > Load Golden…` 即可恢复布局（Golden v3/v4 会自动校验目标模块名与网表内容指纹）。
5. **层次化跳转**：双击画布中的子模块实例进入其模块上下文；也可通过 `Navigator > Hierarchy` 或全局 Search 选择模块。
6. **模块实例树**：在 `Navigator > Hierarchy` 按模块/实例名筛选，查看实例路径并点击切换上下文；上下文栏显示当前模块和路径。

### 示例文件说明

仓库和 Windows 离线包的 `examples/` 目录提供了可直接打开的示例：

- [examples/aig_structure_demo.blif](examples/aig_structure_demo.blif)：组合 XOR / XNOR / MUX 结构，默认分析得到 6 对重汇聚、3 个块候选；操作步骤见 [AIG 结构分析练习](docs/guide/07-aig-workspace.md#78-动手练习与最小示例)。
- [examples/aig_mapped_names.blif](examples/aig_mapped_names.blif) 与 [examples/aig_mapped_names.level](examples/aig_mapped_names.level)：带 `# <BLIF信号ID> <设计名称>` 注释映射的两输入组合 BLIF 及配套 AIG Level 层级与裕量报告示例。
- `examples/two_equivalent_style_modules.v`：基础重综合（resyn / Flex）双模块对比示例。
- `examples/hierarchical_escaped_compare.v`：包含转义层次化标识符（escaped hierarchical identifiers）与 Flex 配对模块的真实结构示例。
- `examples/hierarchical_escaped_timing.txt`：与 `hierarchical_escaped_compare.v` 配套的标准多模块时序报告示例。
- `examples/module_hierarchy_demo.v`：多级子模块例化（occurrence）与跨层次边界追踪示例。
- `examples/large_buffer_chain_1024.v`：1024 级缓冲器长链大图与有界锥体（bounded cone）测试示例，可通过以下命令确定性生成：

```powershell
node tools/generate-large-example.mjs
```

> **提示**：`large_buffer_chain_1024.v` 为 1024 级严格串行链路，在 `Whole` 整图适配（Fit）时会呈现为一条细长的全局概览。滚轮缩放会根据画布实际宽度动态提升最大放大倍率；建议直接在顶部搜索框搜索 `u_buf_512` 等实例名称，视图会自动居中并放大至清晰可读的尺寸，或从输出端口开启有限深度的 `Focused` 视图进行分析。

### Single View（单模块视图）操作流程

1. 载入结构化 Verilog 网表，从 `Navigator > Hierarchy` 或 Search 选择目标模块。
2. 单击画布中的单元（node）、端口（port）或导线（wire），在 Inspector 的 `Connections` 页签查看详细连接，在 `Attributes` 查看注释属性与推断来源，在 `Analysis` 查看扇入/扇出统计与关联重收敛；若面板已隐藏，先点击顶部 `Inspector` 或对象名称摘要打开。点击面板内的关联 net、`Connected`、`Fanin` 或 `Fanout` 按钮可快速跳转并居中目标对象。选中长导线后可按住画布拖动追踪至远端（平移操作不会清除当前高亮，单击空白区域才会取消选择）。
3. 双击子模块实例可直接进入对应的子模块定义视图。
4. 点击上下文栏 `Whole` 查看完整模块图；对于大型模块，搜索未绘制的单元会进入或追加至 `Focused` 局部视图。画布上方的 `Fanin` / `Fanout` 控制展开层数，`Roots` 管理根集合；搜索或 Inspector 中的 `Add to Focused` 追加根，Inspector 的 `Replace roots` 替换全部根。
5. 在 `Settings → Display` 切换 `Show aliases` 控制 `assign` 别名连线；`Gate symbols` 在矩形框与标准逻辑门符号之间切换。
6. 开启 `Adjust` 后可自由拖拽节点位置或修改尺寸；通过 `File > Save Golden` 保存校准结果，通过 `File > Load Golden…` 恢复。
7. 点击 `File > Export SVG` 可将当前完整模块或局部聚焦原理图导出为独立 SVG 文件。

### Compare View（双模块对比视图）操作流程

1. 载入至少包含两个模块的网表（或通过 `File > Add design file(s)…` 及 Compare 配置行的 `A files` / `B files` 分别载入/粘贴两侧网表与侧别专属时序），可先在 Single View 中选中作为 A 侧基准的模块。
2. 点击顶部工具栏的 `Compare` 按钮进入对比模式。系统会自动识别并优先推荐同名前缀及带有 `_Flex`、`_orig`、`_new`、`_cpy`、`_cpy_loc`、`_copy`、`_loc` 等常见后缀或来自不同合并文件（`[filename]`）的配对模块。
3. 在画布上方的 Compare 配置行分别指定 `A` 与 `B`，点击 `Apply` 应用草稿组合。A 始终对应左侧/上方，B 对应右侧/下方。
4. 点击顶部 `Single` 或 `Sync & cone > Return to Single` 返回单图模式（保持各自视口，不强制 Fit）。
5. 分屏方向（`Split`）默认为 `Left / Right`（左右分屏），可切换为 `Top / Bottom`（上下分屏），切换后两侧视图自动适配窗口。
6. 在 `Sync & cone` 中，`Sync pan / zoom` 联动拖动和滚轮，`Center match on click` 在单击端口、cell 或 net 时居中另一侧的同名对象。两项默认开启，可分别切换。上下文栏 `Fit view` 始终适配两侧。
7. 单击任一侧的同名端口、线网或匹配单元，两侧画布会同步高亮对应对象，且端口与单元会自动居中聚焦。
8. `Sync & cone > Sync Focus roots` 默认开启：根操作会同步另一侧匹配单元；关闭后根操作独立，但 Fanin/Fanout 深度仍共享。Inspector 明确显示活动对象来自 A 或 B；`Whole` 清除两侧 roots 与 Output cone。
9. 在 `Sync & cone > Output cone` 中选择共有输出端口（如 `sco_891`），同步对比扇入逻辑锥；调整 `Output depth` 控制层数，选择 `Whole module` 返回整图对比。
10. `Navigator > Design` 并列展示两侧的单元总数、门类型分布、估算逻辑深度、最大扇出、数量差值、未匹配对象统计及两侧模块注释属性。

### 大图渲染与布局策略

1. **布局引擎与降级**：`Layout` 默认选用 `AnchorLayered`；若遇到不支持的复杂拓扑导致失败，会依次尝试 `ELK Layered (Experimental)` 与 `Simple Layered`。ELK 引擎已完整本地化（vendored），运行时无需联网；主动取消任务不会触发降级。
2. **高扇出中继（Fanout hubs）**：默认开启，扇出数不少于 8 的同源线网会自动插入共享 hub 节点，显著减少长距离平行干线。
3. **全图与聚焦策略**：结构分组折叠（Group-collapse）已退出产品路线；映射网表回归、性能优化与大图交互均围绕完整图、`Search-first` 与 `Focused` 局部图构建（旧存档中的折叠字段仅作向后兼容忽略）。
4. **渐进式渲染**：当可见节点与连线总数达到 400 时，自动启用可取消的分批 SVG 渲染，底部状态栏实时显示渲染进度；渲染完成后会完整恢复所有跨线桥接弧（wire bridge）、线网标签与点击热区。
5. **LOD 细节自适应**：当画布缩放倍率低于 `0.65` 时，自动隐藏引脚名、线网标签、单元元信息与时序徽标文字以保证流畅度，放大后自动恢复。
6. **标签页会话保持**：当前网表与工作台状态自动保存在浏览器 `sessionStorage` 中；刷新同一标签页可无缝恢复网表、模块、聚焦状态与视口位置，关闭标签页后自动释放。
7. **混合手工微调**：在 `AnchorLayered`、`ELK` 或 `Simple` 模式下均可开启 `Adjust` 手工拖拽节点；未改动节点保持自动布局坐标，改动节点的关联导线自动执行正交避障重布线。`Layout > Reset view overrides` 清除当前视图覆盖（含不布线 net），Compare 中作用于两侧。
8. **间距吸附与引脚可读性**：`Wire spacing` 与 `Cell spacing` 支持滑块和数字输入（自动吸附至 4 的倍数）；连接单元上下边缘引脚的导线会自动保留末段可见转角。

### 结构差异高亮说明

Compare View 采用**基于名称、方向与门类型的启发式结构对比**，不等同于形式化逻辑等价性证明（Formal Equivalence Checking）：

- **绿色实线**：表示两侧对象建立了基础结构对应关系——包括规范化名称相同且方向一致的端口（port）、同名线网（net），或两侧均存在的逻辑门类型（gate kind）。
- **红色虚线**：表示仅在单侧存在或无法建立上述对应关系的对象——包括未匹配的端口/线网，以及门类型仅在其中一侧出现的单元。
- **橙色高亮**：表示用户当前点击选中的对象，与绿/红结构分类正交叠加。
- **对比粒度说明**：端口对齐依据规范化名称与方向；线网对比依据名称；单元对比目前依据推断出的 `gate kind`，不会自动对内部匿名实例名或异构子图做拓扑同构匹配。
- **统计指标说明**：`logic depth` 根据当前图中最长单元路径做启发式估算；`max fanout` 按单个图节点的最大出边数计算。因此，红色虚线代表“值得关注的潜在结构差异点”，并不代表两侧电路功能不等价；绿色实线也不代表两侧在逻辑或拓扑上完全等价。

## 测试与验证

日常开发可通过以下命令运行验证套件：

```powershell
npm test
npm run test:aig
npm run test:liberty
npm run test:architecture
npm run test:docs
npm run test:launcher
npm run test:remote-protocol
npm run test:mapped-cases
```

- `npm test`：运行完整单元测试，覆盖语法解析（含注释属性）、Liberty 与无库推断、图模型提取、多文件合并、布局与正交布线、AIG 解析/Level 层级传播/分析/Graphviz 几何、时序标注与漏配诊断、远程工作台协议与命令目录、搜索、锥体分析、别名折叠、模块对比、会话持久化及 SVG 渲染。
- `npm run test:aig` / `npm run test:liberty`：专项运行 AIG（DOT/BLIF 解析、Level 层级与裕量、多图集合、分析面板与 Graphviz 适配器）或 Liberty 库语义单元测试。
- `npm run test:aig-browser` / `npm run test:aig-structure` / `npm run test:aig-views`：在已配置浏览器驱动的测试环境中运行 AIG 工作台与 Level 导入、结构分析、Standard / Logic View 切换的真实浏览器回归；测试依赖不属于离线运行时。
- `npm run test:remote-protocol` / `npm run test:remote-workbench` / `npm run test:remote-full`：验证 SSH 远程工作台控制协议、多页/多 AIG 会话与 182 条远程命令的端到端行为。
- `npm run benchmark:aig-structure`：测量深链、高扇出、重汇聚、奇偶链和 MUX 链的分析耗时及截断状态，不包含 Graphviz 布局时间。
- `npm run test:architecture`：基于离线 Acorn AST 校验全仓模块依赖方向、跨层边界与无环约束。
- `npm run test:docs`：校验核心文档与教程中的所有相对路径链接有效性。
- `npm run test:launcher`：验证 Node.js 与 Python 启动器的 CLI 参数、状态文件及 HTTP 协议。
- `npm run test:mapped-cases`：在 47 个真实综合映射网表（`tests/fixtures/mapped/`）上回归，默认跟随产品引擎（当前为 AnchorLayered / `native-layered`），可通过 `MAPPED_CASE_PROVIDER` 显式选择对照引擎。发布验收设置 `MAPPED_CASE_NO_COLLAPSE=1` 并执行 `npm run test:mapped-hard`，保留 45 秒与零硬违规门禁。
- 正式 `benchmark` 入口也默认跟随产品引擎，并等待异步布局完成后计时；`BENCHMARK_PROVIDER` 可显式覆盖，mapped benchmark 优先采用其专用 `MAPPED_BENCHMARK_PROVIDER`。Simple 已永久冻结，只读比较结果不授权修改其实现，详见 [当前冻结约束](AGENTS.md#simple-freeze-2026-11-10)。
- Linux 单文件启动器的 CMake、HTTP 生命周期、远程工作台任务与 Tcl 集成测试通过 `ctest --test-dir build/linux --output-on-failure` 独立运行。

## 项目目录结构

现行模块边界详见 [架构设计说明](docs/ARCHITECTURE.md)，多领域工作台演进设计见 [可扩展工作台架构](docs/architecture_evolution.md)，迁移与审计记录见 [阶段 7 计划](docs/STAGE_7_PLAN.md)，跨层追踪、Cell/Net 聚焦、标准门符号与大图交互优化见 [阶段 8 计划](docs/STAGE_8_PLAN.md)；AIG 已在 v1.5.0 接入主界面，使用范围见 [AIG 图浏览](docs/guide/07-aig-workspace.md)。

```text
docs/                 项目路线图、阶段计划、架构说明、设计规范与使用教程
examples/             示例 Verilog 网表、时序报告、BLIF 与 AIG Level 文件
native/               Linux C++17 单文件启动器、远程工作台 Broker、资源嵌入与 CMake 配置
src/analysis/         逻辑锥（cone）、别名规范化、对象连接查询、重收敛与模块对比分析
src/app/              浏览器入口组装、领域工作台桥接、多 AIG 集合与远程命令执行器
src/application/      Document/ViewSession 状态存储、命令总线、任务协调与领域会话
src/bootstrap/        静态领域注册（Netlist / AIG）与工作台依赖组装
src/contracts/        ObjectRef、领域接口、查询、视图与 182 条工作台命令契约定义
src/diagram/          领域中性的显示图模型、共享视图流水线与几何测量契约
src/domains/aig/      AIG 领域特性：DOT / BLIF 导入、Level 层级传播与报告、重汇聚/逻辑块分析与场景投影
src/domains/netlist/  Netlist 领域特性、多文件合并、图投影、时序/单元配置/Golden 业务用例
src/foundation/       无业务含义的标识符编码、不可变结构值与基础图/几何工具
src/infer/            Liberty 语义模型、共享字段优先级与无库推断规则
src/layout/           AnchorLayered / ELK / Simple 布局、Graphviz 几何适配、正交布线与网格吸附
src/netlist/          Netlist IR 数据模型与结构图提取
src/parser/           结构化 Verilog 词法、语法与注释属性解析器
src/persistence/      会话、领域工作区与多 AIG 集合存档、启动清单与源码指纹编解码器（codec）
src/platform/         文件下载、剪贴板、本地存储与 Graphviz WASM Worker 等平台副作用适配
src/render/           SVG 场景渲染器、渐进式分批渲染与独立 SVG 导出
src/search/           设计对象索引构建与搜索匹配
src/timing/           标准 Tabular/CSV/JSON 时序解析、作用域消歧标注与漏配诊断
src/ui/               工作台外壳、服务器文件选择器、画布手势、视口变换、Netlist / AIG 面板与页签控件
tests/fixtures/       单元测试与 47 个综合映射网表回归用例
tests/unit/           全量单元测试套件
tools/                本地开发服务、架构门禁、性能基准与大图生成脚本
tools/eda/            面向 EDA 工具的 Tcl 启动、状态查询与安全关闭辅助脚本
vendor/               本地化的第三方离线运行时资源（elkjs 与 Graphviz/Viz.js WASM）
```

## 当前已知限制

- **Verilog 语法子集**：仅支持综合后常见的结构化门级 Verilog 子集，并非完整的 Verilog / SystemVerilog 编译前端（不支持行为级 `always`、宏展开或复杂参数化展开）。
- **Liberty 支持边界**：可读取文本 `.lib` 的接口与有限布尔语义，不执行 STA 或解析 `.db` / `.lib.gz`。未知扩展、复杂 bus/bundle 与复杂 function 不承诺完整解释；缺库时仍可通过命名规则、`Cell Config` 或 `Adjust` 指定方向。
- **超大图浏览策略**：深层 DAG 的 Balanced/Folded 折叠排布仍属暂缓的实验方向；当前针对大型模块优先通过 `AnchorLayered` / `ELK`、`Search-first` 与有限深度的 `Focused` 局部视图进行浏览，不再扩展结构分组折叠（group collapse）。
- **启发式模块对比**：`Compare` 模式基于端口/线网名称、逻辑门类型及图统计特征提供启发式结构对比，不提供形式化等价性证明。
- **AIG 支持范围**：ABC AIG DOT 与平坦零至两输入组合 BLIF 支持 Single 工作区的 Whole / Focused。AIGER、AIG Compare 和 Netlist 转 AIG 属于后续范围。

长期路线图详见 [docs/PLAN.md](docs/PLAN.md)；大图性能基线见 [阶段 4 计划](docs/STAGE_4_PLAN.md)，工作台架构重构与审计证据见 [阶段 7 计划](docs/STAGE_7_PLAN.md)，当前阶段功能规划见 [阶段 8 计划](docs/STAGE_8_PLAN.md)。
