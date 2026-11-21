# SSH 远程文件、EDA 工作台命令与多 AIG 开发计划

**状态**　2026-11-20，命令范围和多 AIG 交互已确认，首版运行时已完成，R01–R13 与 A1–A6 结果见[验收记录](remote_workbench_v1_results.md)。第 3 节是公开命令的唯一清单，共 180 条，包括原 179 条和新增的 `aig add`，另保留 5 个简写。本文的运行示例用于开发验收。首版开发前，npm 与 Linux 单文件启动器能在启动时读取指定网表、时序和 Cell Config，现有 Tcl 提供 `::ngb::Start`、`::ngb::Status`、`::ngb::Stop`。

开发任务 R01–R24、依赖、逐项通过条件和首版现场脚本见[开发需求与验收标准](remote_workbench_acceptance.md)。

## 1. 用户工作流

SSH 上启动一次，转发一个端口，在本地打开多个工作台。每个网页显示自己的短编号、可选名称及当前设计。直接运行 `npm start` 或 `ngb start` 时，终端即可接收交互命令，浏览器配对后可以浏览启动目录。需要扩大或更换目录范围时再传 `--browse-root`。两种输入方式可以同时使用。

1. 在启动服务的 SSH 终端直接输入命令，Tab 补全服务器路径。打开网表、追加网表模块、追加时序和追加 AIG 均可在同一个提示符完成。
2. 在网页 File 菜单选 **从服务器打开…**。可以选根目录、进出子目录、输入路径、按名称过滤和多选文件。选择“打开设计”“追加设计”“追加 AIG”或“追加时序”后显示目标页、当前设计与操作。Compare 的 A files / B files 也能从对应入口选服务器文件。已有本机文件选择、拖放、粘贴继续可用。
3. 在同一个 AIG 页面保留多份独立的 DOT/BLIF。用页内图选择器切换，脚本可用 `module list` 列图、`module open` 切图。不同文件可以各自含名为 `n0` 的节点。

以下是拟议用法。任选一种启动方式即可在 SSH 上打开服务。

```sh
npm start -- --no-open --port 4173 --browse-root /work/runs --state-file "$HOME/ngb-impl.state"
ngb start --no-open --port 4173 --browse-root /work/runs --state-file "$HOME/ngb-impl.state"
```

```text
ngb> pages
p1  impl    Single   top.v
p2  debug   Compare  top_orig / top_new
ngb> use p1
ngb[p1]> open /work/runs/impl/top.v
ngb[p1]> add /work/runs/impl/macros.v
ngb[p1]> add-timing /work/runs/impl/setup.rpt
ngb[p1]> --page p2 --side B timing open /work/runs/eco/setup.rpt
```

另一个 SSH shell 或已有的 EDA Tcl 进程也能操作同一服务。示例中的 p1、p2 来自 `page list`。

```sh
ngb cmd --state-file "$HOME/ngb-impl.state" --page p1 design add /work/runs/impl/macros.v
npm start -- cmd --state-file "$HOME/ngb-impl.state" --page p1 design add /work/runs/impl/macros.v
```

```tcl
source /opt/eda/share/netlist_graph_builder/ngb.tcl
set state [file join $::env(HOME) ngb-impl.state]
::ngb::Connect [list /opt/eda/bin/ngb] $state
set reply [::ngb::Cmd $state --page p1 design add {/work/runs/impl/macro cells.v}]
::ngb::Cmd $state --page p1 timing add /work/runs/impl/setup.rpt
::ngb::Cmd $state --page p2 --side B timing open /work/runs/eco/setup.rpt
```

上面各入口演示同一个动词。实际工作流中，一次追加只执行一次。Tcl 自行启动服务时，`::ngb::Start` 继续返回 URL，并记住该 state 对应的启动器。连接 npm 启动的服务也可使用同协议的 `ngb cmd`，或给 `Connect` 传入 `[list node /path/to/tools/serve.mjs]`。

EDA Tcl 的公共过程列在下表。一次性命令和交互终端使用第 3 节的同一份动词表。

| Tcl 过程 | 作用和返回 |
| --- | --- |
| `::ngb::Start $binary $state ?option value ...?` | 现有入口。启动并返回 URL。计划为目录选项增加支持，保留现有 Tcl 调用和父进程托管行为 |
| `::ngb::Status $binary $state` | 现有入口。沿用服务进程状态的返回格式 |
| `::ngb::Stop $binary $state` | 现有入口。校验并停止指定服务 |
| `::ngb::Connect $launcherArgv $state` | 新增。登记如何通过命令行客户端连接已启动的服务，返回服务身份及协议版本 |
| `::ngb::Cmd $state ?--page ID? ?--side A或B? group action ?arg ...?` | 新增。一次工作台操作，成功返回结果 dict，失败可用 `catch` 捕获。单词命令如 `pages` 同样可用 |

## 2. 命令规则

- **服务、页面、画布侧**。state 标识服务。一个服务容纳多个 page。一个 Netlist page 可处于 Single 或 Compare，A/B 属于同一个 page。一次性 CLI/Tcl 建议显式传 `--page ID`，只有一个已连接页面时允许省略。交互终端的 `use` 只影响该终端。多页且目标未选、目标已关闭、侧别有歧义时返回候选和错误。页面焦点变化不会改变命令目标。
- **页面身份**。编号由服务分配，当前进程生命周期内不复用。刷新后重新绑定原页，复制标签页分配新 ID。去掉窗口焦点不代表离线。命令绑定接收时的页面连接代次、文档版本及必要的模块/侧。刷新或换设计导致旧操作失效时，调用方可以按请求号查状态。
- **语法**。格式为 `[--page ID] [--side A或B] 命令组 动作 参数`。下表中的 `<…>` 为必填，`[…]` 为可选，竖线表示任选其一，省略号表示可重复。页码从 1 开始。布尔参数统一为 `on` / `off`。文件和对象名都是独立参数，支持空格、中文、方括号、反斜杠和层次化名称。CLI 以 argv、Tcl 以 list 传递。终端提供引号、补全和帮助。直接传递内容时优先用 Tcl 字符串或 stdin，交互历史和日志不保存原文。
- **对象引用**。搜索结果、层次实例、连接、路径端点及分析结果返回可复用的 ID，同时给出显示名、类型、模块和实例上下文。可使用唯一名称。有歧义则返回候选。层次路径按组件编码，名字中原有的斜杠保留。引用与文档/结果版本绑定，脚本不靠行号或 DOM 序号定位对象。
- **文件来源与去向**。命令中的路径在 SSH 服务器上解析，REPL 初始目录为调用者启动目录，独立 CLI/Tcl 使用各自的调用目录。网页保留“本机文件”和“服务器文件”两个明确入口。下表 `<输入>` 支持服务器路径。有粘贴入口的类型另支持 `--text <内容> [--name <来源名>]` 或 `--stdin [--name <来源名>]`（一次性 CLI）。`<输出>` 为 `--out <服务器路径>` 或 `--download`（当前浏览器下载）。交互 UI 的复制仍写本地剪贴板。命令的 copy 默认返回等价文本，可选 `--clipboard` 请求页面复制并如实返回浏览器权限结果。
- **完成语义**。页面命令默认等待对应变更提交。涉及布局/导出时等待目标视图完成或明确进入 Search-first。服务 `ready`、页面连接、操作完成分别报告。耗时命令可传 `--async` 返回 job ID。启动时没有网页也能工作。依赖网页的命令会给出页面链接和 `PAGE_NOT_CONNECTED`。脚本可显式等待指定页。空结果、部分完成、取消、过期与失败分别返回。超时不隐式重复执行。

## 3. 命令目录

以下为目标公开命令表。每个代码块右侧说明对应的 UI 入口或命令用途。同一动作的按钮、快捷键和手势共用一个动词，例如工具栏箭头、Ctrl+Z 和 Alt+Left 都走视图历史。

### 3.1 启动、页面和执行结果

```text
start [启动参数]                         启动，可交互的前台终端出现 ngb> 提示符
status --state-file <文件>              查询服务状态
stop --state-file <文件> [--force]      停止指定服务
cmd --state-file <文件> [选项] <命令…>  从独立进程调用一次，支持 --json
help [命令组 [动作]]                     查看语法、示例、适用域与作用范围
commands [--available] [--json]         全量目录。available 返回目标页当前可用动作及限制
page list                              页面 ID、名称、设计、模式和连接状态
page info <页>                         查看身份、当前模块、Compare 侧与版本
page new [--name <名>]                  预留独立页并返回链接，在本地浏览器打开后连接
page wait <页> [--timeout <毫秒>]       等到指定页面可执行命令
page use <页>                          设置当前交互终端的默认页
page rename <页> <名>                   给页面设置服务内唯一名称
job status <job或request的ID>          查看进度、目标与最终结果
job wait <ID> [--timeout <毫秒>]        等待同一次执行的回执
job cancel <ID>                        取消支持取消且仍在执行的任务
quit                                   退出当前交互提示符。前台服务终端结束该服务
```

保留已有 `--netlist`、`--timing`、`--cell-config`、`--module`、`--focus`、`--fanin-depth`、`--fanout-depth`、`--port`、`--no-open`、`--state-file` 等启动入口及各启动器原有选项。新增 `--browse-root <目录>`（可重复）、`--interactive`、`--no-interactive`。TTY 默认交互。重定向、Tcl、CI 默认机器模式，现有 stdout 单行 ready 协议继续可用，提示与日志使用 stderr。SSH 即使映射到不同本地端口，也可在当前网页通过“新工作区”打开同源相对链接。

交互模式省略 `--state-file` 时，在当前用户私有运行目录创建控制记录，终端显示其路径，其他 shell/Tcl 可连接这个服务。已有脚本显式传入的路径优先。首次通过 SSH 转发进入网页，可用终端给出的配对链接，或在网页录入终端给出的短期配对码。链接使用本地转发端口也有效。

### 3.2 服务器目录与文件导入导出

```text
fs roots                                     查看网页可浏览的服务器根目录
fs pwd                                       查看当前入口的服务器工作目录
fs cd <目录>                                 在终端或当前页的选择器中切换目录（含父目录）
fs ls [目录] [--filter <名称>] [--page-number <N>]   列目录、过滤、分页
fs complete <路径前缀>                       返回路径候选，也供交互终端 Tab 补全
files browse [--action <导入动作>] [--dir <目录>]    在目标页打开服务器文件选择器
files choose <路径…>                         在选择器里选择一个或多个文件
files submit                                 将当前选择提交给对应动作
files cancel                                 关闭选择器，放弃此次选择
files import <路径…>                         对齐混合文件拖放或多文件粘贴的分类及顺序
design open <输入…>                          File → Open design / Paste netlist，可自动识别 AIG
design add <输入…>                           File → Add design file(s)。在 Netlist 中追加 Verilog 模块，在 AIG 中追加独立图
timing open <输入…>                          Open timing / Paste timing，替换对应的时序输入
timing add <输入…>                           Add timing file(s)，向当前时序数据集追加
aig open <输入> [--view logic|standard|search-first]  Open / Paste AIG，DOT 或 BLIF
aig add <输入…>                              Add AIG file(s)，将独立的 DOT/BLIF 加入本页图列表
aig import-mode <normal|search-first>        File → Open AIG in Search-first 的后续导入偏好
aig cancel-import                            File → Cancel AIG import
liberty load <文件>                          Settings → Liberty → Load .lib
liberty status                               当前库、摘要与导入诊断
liberty cancel                               取消正在进行的库导入
liberty unload                               卸载当前库
golden save <输出>                           保存当前 Single 工作区
golden load <文件>                           校验指纹并恢复 Single，必要时退出 Compare
svg export <输出>                            导出当前 Netlist Single 或 AIG 视图
```

支持五个简写。`pages` = `page list`，`use` = `page use`，`open` = `design open`，`add` = `design add`，`add-timing` = `timing add`。三个入口都接受相同简写。网页的服务器文件选择器也支持 Liberty、Cell Config、Golden、AIG 和 Compare 侧所允许的文件类型。批量包含多个网表或时序时沿用现有批次次序和追加决策，逐文件返回成功、失败、跳过及原因。

### 3.3 浏览、搜索、聚焦与画布

```text
design info                                  Navigator → Design 的统计、来源和模块属性
module list [--filter <文本>]                列举当前 Netlist 的模块或当前 AIG 页的图，返回 ID、名称和激活状态
module open <模块或图ID>                     在 Netlist 按模块导航，在 AIG 按图 ID 或唯一名称切换
hierarchy list [--filter <文本>]             层次树，支持按模块或实例筛选
hierarchy occurrences <模块>                 列出可选的实例上下文
hierarchy open <occurrence-id>               打开树中或选择器中的精确实例
hierarchy enter <实例对象>                   等价于在画布双击子模块实例
search find <文本>                           全局搜索，返回结果引用
search open <结果>                           激活结果，按现有规则定位或追加 Focused root
search clear                                 清空搜索
selection set <对象>                         选中 cell、port、net、AIG 节点、连线或槽位引用
selection get                                当前选择、完整名称、作用域、可用 Inspector 页
selection clear                              等价于单击画布空白处
selection zoom                               Zoom to selection / F
inspect show [对象] [--tab <页签>]           读取摘要、属性和推断、连接、时序、来源或分析
inspect connections [对象] [--group <组>] [--page-number <N>]   引脚、线网、driver/load、上下游及父层连接
inspect follow <连接目标>                    定位列表里的精确目标，支持跨层与 AIG 输入槽位
inspect tooltip <对象或引脚>                 读取悬停可见的名称、连接或时序内容
inspect copy <对象或字段引用>                完整规范名、AIG 来源 ID 或映射名称
view whole                                   Whole，Compare 作用于两侧
view focused                                 Focused，沿用当前选择和根集规则
focus list [--filter <文本>]                 Roots 菜单及筛选
focus add <对象…>                            Add to Focused，允许使用搜索结果
focus replace <对象…>                        Replace roots
focus activate <根>                          点击根标签，激活并定位
focus remove <根…>                           删除指定根或选中根
focus clear                                  清空根，按当前域与设计大小恢复视图
focus depth [--fanin <N>] [--fanout <N>]     空参数查询，0 独立关闭对应方向
viewport get                                 当前变换与可见区域
viewport pan <dx> <dy>                       等价于拖拽平移，以视口 CSS 像素计
viewport zoom <倍率因子> [--at <x> <y>]      等价于滚轮缩放，可指定视口锚点
viewport fit                                 Fit view，Compare 同时适配两侧
history back                                 回到上一次视图操作
history forward                              前进一次视图操作
```

`inspect` 按域和所选对象公开有效字段。父层有多个 occurrence 时先返回可选 ID。Search-first 状态、灰显的对象和超预算的截断信息一并返回。Netlist 大图的自动 Search-first 沿用现有入口。

### 3.4 Netlist 显示、手动校准、时序与类型定义

```text
display aliases <on|off>                     Show aliases
display hubs <on|off>                        Fanout hubs
display symbols <rectangle|conventional>     Gate symbols
layout providers                             返回已注册 provider 的稳定 ID 和展示名
layout provider <ID>                         设置 provider，包括现有 AnchorLayered / ELK / Simple
layout spacing [--wire <值>] [--cell <值>]   两类间距，滑条与数值框共用
layout reset-overrides                       Reset view overrides，Compare 同时清除两侧覆盖
adjust mode <on|off>                         Adjust 按钮
adjust move <节点> <x> <y>                   按图坐标提交一次拖动，沿用吸附、历史与局部重布线
adjust size <节点> <宽> <高>                 Inspector → Size
adjust reset-size <节点>                     Reset size
adjust property <节点> <字段> <值>           label、title、subtitle、gateKind、inferenceSource
adjust reset-properties <节点>                Reset properties
adjust pin <实例> <引脚> <input|output>      单实例的引脚方向覆盖
adjust reset-pins <实例>                      Reset pin directions
net route <net> <on|off>                     Route net，按现有别名及侧别规则生效
timing metric <slack|at|rt|delay|slew|all|none>   Settings → Timing，全页显示策略
timing threshold <数值>                      全页违例阈值
timing show <对象或引脚>                     匹配记录、最差引脚或缺失原因
timing log-details <cell>                    Inspector → Log cell timing details（该动作可用时）
timing badge <对象> <引脚> <指标> <on|off>   单独勾选 AT、RT、Slack、Delay 或 Slew
timing badge-position <对象> <方位>          top-left / top-right / bottom-left / bottom-right
timing reset-badges <对象>                   Default badges
cell-config import <文件> [--on-conflict abort|replace]  导入类型定义，冲突时可查清单
cell-config export <输出>                    导出保存的类型定义
cell-config show <类型>                      显示已保存定义和编辑器预填值
cell-config edit <类型>                      打开该类型的编辑草稿
cell-config gate <gate-kind>                 修改草稿的门类别
cell-config pin <引脚> <方向>                修改草稿，支持 input / output / inout / unknown
cell-config save                             保存草稿并对该 cell type 重新推断
cell-config cancel                           放弃草稿并关闭编辑器
cell-config delete <类型>                    Delete saved，移除指定类型的已存规则
cell-config reset [--confirm]                Reset all，支持现有确认流程
```

命令目录同时注明存储作用域。设计、选区、侧别、Liberty 和手动覆盖沿用各自工作区的边界。Cell Config 目前持久化到浏览器同源 localStorage，界面偏好也有跨页存储。对这类操作在帮助、页面与回执中标出影响范围。Cell Config 导入冲突默认保留原定义并返回冲突项，脚本可以显式选择覆盖。

### 3.5 Compare 双侧

```text
compare enter                                进入 Compare 并沿用 UI 推荐配对
compare exit                                 Return to Single
compare status                               已应用配对、选择器草稿、活动侧、两侧来源/时序
compare module <A|B> <模块>                  修改选择器草稿
compare apply                                应用草稿中的两个不同模块
compare side <A|B>                           页内切换活动画布侧
compare design <A|B> <输入>                  A/B files → Load / Paste Verilog，沿用实际归并与侧选择
compare clear-timing <A|B>                   清除该侧专用时序，恢复继承关系
compare split <horizontal|vertical>          左右 / 上下分屏
compare sync-viewport <on|off>               Sync pan / zoom
compare sync-roots <on|off>                  Sync Focus roots
compare outputs                              列举两侧共有输出
compare cone <输出|--whole> [--depth <N>]    选取或清除 Output cone
compare cone-depth <N>                       单独修改现有输出锥深度
compare summary                              结构提示、差异汇总和匹配状态
```

两侧文件、选择与路径不能靠左右屏幕坐标区分。脚本以 `--side A` / `--side B` 定向执行 `timing open`、`selection set`、`focus add`、`path apply`、`analysis results` 等。侧别是同步操作的起点，是否联动由该页的 roots / viewport 同步设置决定。Whole、Fit、Reset、共享 Focused 深度和全页时序策略保持各自既有的双侧语义。侧专用时序覆盖与页面共用时序分开。单侧 SVG 走该侧的 Show Path 报告导出。

### 3.6 Show Path 与结构分析

```text
path open [--side A|B]                       打开 Navigator → Path，也可选报告侧
path find <文本> [--page-number <N>]         查可用端点，含 net、cell、pin、port、AIG 信号
path draft                                   返回尚未 Apply 的 Starts / Ends
path add <start|end> <端点…>                 搜索结果、Inspector 或路径面板加入端点
path remove <start|end> <端点…>              删除草稿端点
path apply                                   从当前草稿计算路径
path enable <on|off>                         Turn on / off，保留端点
path clear                                   清除查询及草稿
path cancel                                  取消在途 Apply
path report [starts|ends|levels|boundaries] [--page-number <N>]  切换报告页、读取自动边界与级数
path distances <起点|--all>                  Distances / All starts，查看距特定起点的距离
path locate <报告项>                         定位报告中的可见对象
path copy <报告项>                           取得报告项完整名称
path export <输出>                           导出带查询摘要的 SVG，可指定 Compare 侧
analysis status                              当前子图、进度、部分结果及预算原因
analysis run                                 Run again / Analyze again
analysis cancel                              仅取消该工作区的结构分析
analysis retry <scope|detail>                重试失败的范围构建或当前结果的路径并集
analysis results <reconvergence|blocks> [--type <类型>] [--page-number <N>]  切类别、筛根类型、翻页
analysis select <结果>                       从 Navigator 或 Inspector 选择并高亮结果
analysis detail <结果> [--section <分组>] [--page-number <N>]    读取指定详情与独立分页
analysis related <对象或结果> [--kind <类别>] [--page-number <N>]  查询界面可见的关联结果
analysis locate                              Locate，定位高亮范围
analysis clear                               Clear highlight
```

Netlist 的 Reconvergence 可按 Compare 侧查看。详情分组含独立的两条见证路径、路径并集与相关结果。AIG 另有 Blocks，类型为 XOR2、XNOR2、MUX2，详情含根函数、引脚映射、根输出用途和内部信号外部用途。AIG 的路径并集失败可重选结果重试。各域报告实际支持的重试、筛选、关联数量及分页能力。Show Path 草稿、已提交查询与报告里的距离观察点分别保留。

### 3.7 AIG 对象、名称与高亮

```text
aig view <logic|standard>                    Logic View / Standard，沿用当前 scope
aig objects [--type <类别>] [--query <文本>] [--filter <分析>] [--sort <排序>] [--page-number <N>]
                                             Navigator → Objects，类别 ports/all/pi/po/and/constant
                                             分析 all/critical/fanout，排序 name/depth/fanout
aig reveal-selection                         Show selection，恢复可见的筛选与对应页码
aig names [--query <文本>] [--page-number <N>]   BLIF Names 映射表、使用位置和候选
aig connections <off|all|N>                 Highlight connections，支持预设级数和自定义正整数
aig overlay <critical|fanout|block-labels|dim-outside> <on|off>
                                             关键路径、高扇出、块标签、淡化结果以外的逻辑
aig fanout-threshold <N>                     Settings → High fanout 的阈值
```

AIG 与 Netlist 共用 `search`、`selection`、`focus`、`viewport`、`path`、`analysis`、`history`、`svg export`。Connections 内选择输入槽位使用 `inspect follow`。Source 内原始 ID、别名、极性、BLIF 映射、源位置及复制使用 `inspect show/copy`。选择 Names 表里的 Canvas ID 使用 `search open` 或 `selection set`。每页公开其实际支持的动作，例如 Compare 和 Adjust 只在 Netlist 提供。

### 3.8 面板、编辑器、帮助和诊断

```text
ui status                                    状态栏、来源、provider、活动模式、选择摘要
ui panel <面板> <open|close>                 Navigator、Inspector、Diagnostics、Log
ui resize <navigator|inspector> <宽度>       等价于拖分隔条或键盘调宽
ui tab <navigator|inspector> <页签>          切页，返回该域当前可选页签
ui menu <菜单> <open|close>                  File、Settings 子菜单、Compare A/B files、Sync & cone、Roots、搜索行 Add…
ui disclosure <条目引用> <open|close>        层次区、规范名、Path information、日志 details 等折页
ui page <列表引用> <页码>                    翻连接/来源/对象/分析/报告中的独立列表页
ui focus <控件引用>                          聚焦搜索框等命名控件
ui dismiss                                   Escape 或关闭当前菜单、抽屉或对话框
ui help <open|close>                         帮助与快捷键对话框
ui controls                                  列出当前可用的逻辑控件、可选值、禁用原因与命令
text open <netlist|aig|timing> [--action open|add]  打开粘贴框，默认 open。AIG 支持显式 add，Compare 侧沿用已有粘贴入口
text set <文本>                              编辑当前草稿
text view <logic|standard|search-first>      AIG 粘贴框的绘图选项
text expand                                  大文本预览 → 展开编辑
text clear                                   清空草稿
text submit                                  Draw / Index / Ctrl+Enter
text cancel                                  放弃草稿或取消该输入框中的提交
diagnostics list                             查看 Diagnostics 的诊断项
log list [--level <级别>] [--phase <阶段>]    查询日志
log filter [--level <级别或all>] [--phase <阶段或all>]  设置 Log 面板过滤条件
log detail <条目>                            打开/读取该条脱敏结构化详情
log autoscroll <on|off>                      自动滚动
log copy                                     返回当前过滤范围内的 JSONL
log export <输出>                            导出相同范围的 JSONL
log clear                                    清空当前页 Process Log
```

Navigator 包括 Netlist 的 Hierarchy / Design / Analysis / Path，以及 AIG 的 Design / Objects / Names / Analysis / Path（由当前文件决定）。Inspector 包括 Connections / Attributes / Timing / Adjust / Analysis / Source 中当前可用的项。选择摘要按钮对应打开 Inspector。滚动、上下键挑选、Enter 激活、Home/End 切页、滑条预览及指针移动，均映射为“选择哪项、显示哪页、提交何值”等结果。脚本能用一次调用完成这些操作。UI 辅助命令用稳定控件引用，业务动作直接调用工作台用例。

## 4. 多 AIG 的行为和数据契约

**用户确认的行为**是同一页面保留多份独立 AIG，每次查看其中一张。每个文件独立解析，连线、PI/PO、AND 节点、常量、反相边与 BLIF 映射名均属于来源图。两张图即使有相同的端口名、节点编号或文件名也能独立使用。

以下为本计划采用的交互默认值。

| 场景 | 提交结果 |
| --- | --- |
| 页面正在看图 A，执行 `aig add B.dot C.blif` | 保留 A 为当前图，按参数顺序加入 B、C。回执列出新增的图 ID 和当前图 ID。A 的选区、缩放和分析任务继续有效。新增图在第一次查看时准备画布 |
| 页面处于初始示例或空态，执行 `aig add B.dot C.blif` | B 成为第一张活动图，C 加入列表。用户已打开实际 Netlist 时，显式跨域 Add 返回当前域和允许的动作。可通过 `aig open` 切到 AIG，也可在另一页保留 Netlist |
| 使用 `add`、文件菜单或 SSH 选择器追加 | `add` 继续展开为 `design add`。对 AIG 输入委派给与 `aig add` 完全相同的用例。AIG 页的本机文件入口显示 **Add AIG file(s)…**，支持多选。粘贴可用 `aig add --text` 或在追加入口选择粘贴文本。通用粘贴框复用 `text open aig --action add`，默认仍为打开 |
| `module list` 后 `module open <图ID>` | 图选择器和命令都以稳定 ID 激活图。唯一文件名可用作简写。同名返回候选 ID。切回 A 恢复 A 的选区、视口、roots、深度、Show Path、视图样式和面板状态。失效的结果引用按现有规则降级并给出原因 |
| `aig open D.blif` 或点击 Open AIG | 候选 D 准备成功后，以 D 建立新的单图集合。解析、布局、挂载失败或取消时，旧集合及其活动图仍可操作。单文件 Open、普通单文件拖放及粘贴沿用现有打开语义 |
| 一次显式 Add 的若干文件中有一个失败 | 先验证整批的格式、可读性和限额，再一次提交。任一文件失败或提交前取消，整批放弃。逐文件返回失败项和未提交项。通用 `files import` 保留逐文件回执语义，纯 AIG 多选打开以首个成功打开的 AIG 建集，后续成功项追加。混合域批次沿用既有顺序和切域规则 |
| 同一请求重试或再次选同名文件 | 相同 request ID 重试只追加一次。另一次显式 Add 是新的导入，即使内容相同也得到独立条目。文件名用于显示，来源指纹用于校验存档，条目 ID 用于寻址 |

下面的会话用于验收同名文件的切换。图 ID 为示意值，脚本读取实际回执。

```text
ngb[p3]> aig open /work/base/top.blif
ngb[p3]> add /work/eco/top.blif
ngb[p3]> aig add /work/debug/cone.dot
ngb[p3]> module list
g1  top.blif  BLIF  active
g2  top.blif  BLIF
g3  cone.dot  DOT
ngb[p3]> module open g2
ngb[p3]> search find n0
ngb[p3]> module open g1
```

**数据所有权与生命周期**

1. 页面拥有有序图目录、活动图 ID 和集合版本。每项保存图 ID、显示名、源格式、来源身份、不可变源数据和该图的可序列化视图状态。集合增删版本与单图内容版本分开，添加 B 不能使 A 的对象引用失效。服务端命令关联 page ID、图 ID、document ID 和 source revision。稳定图 ID 可在该标签页刷新后继续使用。
2. 复用现有 `DocumentEnvelope`、`ObjectRef`、`ViewSession` 和 `JobCoordinator`。每图独立 document，图内仍可用已有的 `whole` unit。`module list/open` 的 AIG 贡献把目录条目解释为可选图。公共命令层通过 domain feature 调用。候选加载和关闭活动画布的职责从“删除来源文档”分离，使切图时可回收旧场景、取消后台作业、保存旧图的轻量状态。
3. 候选图在独立的作用域内准备，最后核对 page、目标图和切换代次，一次提交活动 ID 与挂载结果。切图失败保留上一张可见图，已添加的条目可重新选取。旧图的延迟 Worker 回复不能改写当前报告。后台任务、历史或计算缓存按图隔离，有界回收。历史数据的有效期间在能力说明中明确，刷新只承诺恢复目前可序列化的状态。
4. 顶部来源和图选择器显示当前图，Navigator 可按名称过滤目录。对象搜索、Names、Focused、Show Path、结构分析、SVG 导出均以当前图为范围。图选择器与 `module open` 执行同一提交，`design info` 返回集合大小和活动图信息。切换到 Search-first 图按索引就绪回执。在图目录中追加非活动图时，Graphviz 调用增量应为零。
5. 持久化增加多图存档版本。读取现有 v1/v2 单图存档时构造一个活动条目，复用现有来源指纹和失配处理。分开保存不可变来源和频繁变化的视图状态，视口提交不重写全部源码。先写新来源和视图记录，再发布标记完整的集合索引。写入失败保留内存中的可用集合，清理本应用未提交记录，沿用已有的“刷新不能恢复过时设计”规则并报告可恢复警告。记录数、总源字节数和活跃计算产物设集中预算，逐文件复用现有 AIG 输入上限。根据 P3 的真实样本确定集合预算和超限提示。

## 5. 实现位置与协议约定

| 边界 | 当前实现和拟做改动 |
| --- | --- |
| 命令声明 | 第 3 节为产品基线。在首批实现中建立一份机器可读目录，包含稳定动词、参数、简写、适用域、页/侧/图作用域、完成条件和返回类型。由其生成或校验各启动器可读的目录和 help。Linux 二进制嵌入所需资源，运行机器无需 Node、Tcllib 或安装 npm 包 |
| 服务控制 | [Node 服务](../../tools/serve.mjs)、[Linux 服务](../../native/launcher/main.cpp)、[Python 回退](../../tools/serve.py) 和 [Windows 服务](../../tools/windows-launcher/Program.cs) 实现同一协议。每个服务持有自己的页面表、有限命令队列、执行状态和文件访问上下文。SSH 转发只需要浏览器的一个 HTTP 端口 |
| CLI 与 Tcl | 前台 TTY、一次性 `cmd` 和 [Tcl 辅助脚本](../../tools/eda/ngb.tcl) 向同一服务传参。Tcl 8.5 使用 list 和字典结果，保留已有 `Start/Status/Stop` 的调用方式、进程所有权校验与父进程托管。避免把 Tcl 源码、浏览器源码或文件路径拼为待执行的命令 |
| 工作台 | [命令总线](../../src/application/command_bus.js) 负责分派，域注册表提供能力。以窄端口接入已有导入、导航、Compare、Show Path、导出和诊断用例。每个公开动作有一个拥有者。UI 与远程命令共享该用例，UI 展开、焦点和浏览器下载等动作走平台或 UI 控制器 |
| AIG 与会话 | [AIG 领域入口](../../src/domains/aig/aig_feature.js) 目前每文档列一个 unit，[域工作区](../../src/application/domain_workspace.js) 在切换成功后会关闭前一活动文档。扩展文档集合及每图视图生命周期，保持单图 parser、规范化和分析行为。更新[存档编解码](../../src/persistence/domain_workspace_storage.js)及[工作台适配](../../src/app/domain_workbench.js) |
| 文件输入与发布 | [快速导入](../../src/ui/quick_input_controller.js)目前只为 netlist/timing 计算追加语义。提取显式的打开/追加意图，本机文件、服务器文件和文本共用。同源页面通过有界文件句柄获得选中内容。新资源纳入 Linux CMake 嵌入与 Windows 离线包并验证许可证 |

**运行边界。** 启动器负责页面连接、文件 I/O、消息及回执。前端复用现有导入、分析、布局与导出用例。建议浏览器通过同源 HTTP 长轮询收命令并回送结果，Node 与 C++ 都能离线实现。EDA 侧通过同用户本机控制通道调用（Linux 可用 Unix socket），与转发到浏览器的文件和页面接口分开。Tcl 封装采用参数列表和结构化回执，成功返回 dict，失败用稳定 errorCode 供 catch 捕获。能力表及协议一致性测试由各启动器共用。

**文件边界。** 认证后的网页默认以启动目录为浏览根，`--browse-root` 可改为一个或多个项目目录。目录枚举、补全与读取均按真实路径检查边界，状态文件、控制凭据和服务日志排除在可列举、读取的文件之外。终端可显式传入该用户可读的其他文件，只把本次输入交给指定页面。服务继续监听回环地址。新增文件/页面接口要求本次服务的连接凭据，校验来源和页身份。凭据、源文件正文及粘贴内容不写入日志。服务端导出由命令调用者显式指定路径并完成写入，默认拒绝覆盖，可用 `--overwrite` 选择覆盖。网页普通导出仍下载至浏览器。

**回执与并发。** 结构化回执包含协议版本、request ID、page ID、适用时的 side、文档版本、状态、结果或错误。CLI/Tcl 可显式传 `--request-id <ID>` 关联重试。页面写入按目标有序，取消和状态查询可绕过等待中的长操作。相同 request ID 和参数返回已有执行状态或结果，同 ID 异参报冲突。服务只在约定的有界保留期内去重，过期请求返回明确状态。断线期间的未决操作不得重放到新页面。服务读取失败、页面解析失败、布局失败以及导出落盘失败分别由拥有该操作的边界记录。保留原异常和 Worker 上下文，并验证 Process Log 详情与 JSONL。

### 5.1 一次调用如何完成

1. 客户端以相同的参数表解析命令和简写，确定服务与页。服务级 `page list` 和 `fs roots` 可直接返回。对页面命令，服务解析目标并将 request ID 与当时连接代次绑定。需要读文件时，先按调用入口解析工作目录和权限，创建短期、限目标、可回收的文件引用。
2. 浏览器在配对后注册页 ID，声明协议版本和当前能力，通过同源长轮询取命令。控制消息与大文件内容分别传输。浏览器以稳定的页面、侧和图引用分派命令，在应用前核验文档版本。过期引用返回错误和当前上下文。多条有依赖的同步命令（如 open → add → export）逐条在前一步实际完成后解析目标，脚本可以直接顺序书写。
3. 服务返回已接收、进行中、已提交、部分结果、取消、被替代、失败或连接中断后的结果未知。等待超时单独标识，已有任务仍可查询。实现时固定状态对应的 CLI 退出码、JSON 结果及 Tcl dict/errorCode。服务重启或结果保留期结束后返回未知/过期，避免把旧请求视为新操作自动执行。浏览器重新绑定时上报已确认序号，仅对原代次的请求对账。
4. 各动作在自己的完成点返回回执。向已有集合追加 AIG 在新图解析和目录提交后完成，切图在索引就绪或画布挂载后完成。服务器导出额外等待目标文件写入成功，采用同目录临时文件及适当的原子提交，保留原有输出直至成功。浏览器下载回执报告已触发下载，系统最终存放位置由用户浏览器决定。对照用例分别断言每类完成条件。

**消息示例。** CLI 的 `ngb cmd … --page p3 aig add /work/eco/top.blif` 提交成功后，Tcl 可从等价 dict 的 `result added` 项中取新图 ID。以下 JSON 为协议字段示意，文件正文单独传输。

```json
{
  "protocolVersion": 1,
  "requestId": "r42",
  "pageId": "p3",
  "status": "committed",
  "result": {
    "added": [{"id": "g2", "name": "top.blif", "format": "blif"}],
    "activeGraphId": "g1",
    "graphCount": 2
  }
}
```

### 5.2 启动器差异需要在哪里处理

- **连接与服务寿命。** Native 现有服务仅接受 GET/HEAD，设有连接数和读写超时。控制路由单独校验有限请求体、等待时间、并发页数及待发队列。长轮询在无数据时能超时重连，服务预留静态资源、回执和停止请求所需的容量。Python 现用同步 HTTPServer，接入长轮询前需实现有界并发或等价的可唤醒等待。保留 native 的 state 文件锁、父进程退出清理及 CTest 生命周期覆盖。
- **信任与文件。** 浏览器配对与本机 CLI 控制使用不同权限。浏览器只通过服务端授予的根和文件句柄取内容。Linux 用当前用户私有 IPC 和状态记录，Windows 用具有当前用户权限的等价通道。验证实际打开的文件仍在允许范围或已由本机调用者明确授权。过期文件句柄、刷新代次、跨页领取、目录中途变化及写出失败均有独立测试。目录结果分页，补全只列当前层。
- **启动兼容。** 旧 URL、startup manifest、stdout 的 launcher ready JSON、显式 state 文件、stop/status 和单文件启动继续回归。npm 自身可能输出脚本横幅，机器调用文档给出直接执行启动器或 `npm --silent start -- …` 的示例。控制能力不就绪时仍可打开普通静态工作台，帮助和界面显示真实可用能力。

## 6. 开发分批、依赖与退出条件

每批应可单独审查，有实现、专项测试及失败结果。P0–P2 优先打通 SSH 现场，P3 和 P4 分别完成 AIG 追加、网页服务器选文件。两者均接入同一条命令执行路径后，才验收第一套完整远程工作流。表中的阶段均待实施。

| 批次 | 依赖 | 开发内容 | 可观察的退出条件 |
| --- | --- | --- | --- |
| P0　固定命令契约 | 第 3–4 节 | 为 180 个动词建立目录和按动作分组的 UI 映射。为每个动词登记拥有者、参数、目标、能力门控、返回类型和完成条件。固定别名、结构化错误、版本协商、限额配置位置及公共请求/回执样例 | 自动对照目录恰好 180 条、5 个简写。命令无重名，无效参数和协议版本在读文件或改状态前报错。UI 新增动作时可定位其对应的命令和用例 |
| P1　Node、页面路由与 Netlist 最短流程 | P0 | 实现服务注册、配对、每页队列、连接代次、TTY 提示与路径补全、跨进程 cmd 和 job 回执。首先接入 design open/add、timing open/add、必要的查询与日志，浏览器直接调用原导入用例 | 真实两页分别打开不同设计。终端向 p1 追加模块和时序后从 p1 查到新对象，p2 的模块、选区与视口保持原值。独立 CLI 能读取相同结果。无页/多页/目标页关闭均收到准确回执 |
| P2　Linux ELF 与 EDA Tcl 对等 | P0、P1 | 在 native 实现同一控制协议、TTY 和 cmd。使 Tcl 的 Connect/Cmd 连接两种服务，参数以 list 传递，支持含空格文件名和稳定失败分类。扩展 CMake 内嵌及集成测试 | 同一份 Tcl 脚本分别驱动 Node 服务和 ELF，执行相同查询、追加、错误和取消，并比较规范化结果。单独部署 ELF 和现有 Tcl 脚本即可运行 |
| P3　同页多 AIG | P0，可先做领域工作，远程验收依赖 P1/P2 | 按第 4 节实现集合、稳定图 ID、原子追加、切图、每图状态、v1/v2 迁移。本机文件、粘贴、Add 菜单与通用 add 路由接入。检查 Graphviz 缓存及结构分析任务释放 | DOT 与 BLIF 在同一页并存。重复文件名和节点名可消歧。追加非活动图 Graphviz 零新增调用。切图、回切、刷新、取消、故障后旧图正确。相同 request ID 不重复追加 |
| P4　服务器选择器与文件交付 | P1、P2，AIG 追加入口依赖 P3 | 实现 roots/pwd/cd/ls/complete、选择器与多选提交、当前动作及目标提示。接入所有允许的文件入口、Compare 两侧、批量导入、输出至服务器及浏览器下载 | 同一次 SSH 转发中，网页可从指定服务器目录打开/追加 Netlist、时序、AIG，命令行能读取指定路径。路径受限、无权限、文件消失、多个根、已有输出冲突、未映射同号端口均有可判定结果 |
| P5　Netlist 浏览、校准与 Compare | P1，文件类动作承接 P4 | 完成 §3.3–3.5 全部动作。按导航、显示、实例覆盖、类型定义、侧设置拆分提交。保留 Compare 草稿/Apply、同步策略、历史和共享时序策略，复用对象和实例引用 | 通过 UI 与命令分别完成跨父层定位、Focused、拖动等价提交、独立侧时序、双侧 Fit/Reset、Golden 往返等流程，关键状态和导出结果一致。两个真实同名层次实例可准确区分 |
| P6　路径、结构分析、AIG 与工作台外壳 | P3、P5 | 完成 §3.6–3.8。以草稿和报告对象接入 Show Path，网表及 AIG 域分别贡献可用分析。接入 AIG 名称/高亮、面板、分页、文本编辑器、详情、Diagnostics 和 Log。补齐 §3.1/3.2 其余查询和导出 | UI、REPL、cmd、Tcl 均可得到同样的指定起点距离、结构结果、当前图及 SVG。只在某域或某状态可用的动作返回实际限制。命令驱动路径能读到和浏览器相同的结构化失败详情 |
| P7　Python 与 Windows 离线适配 | P0、P2，整体验收依赖 P6 | Python 回退及 Windows 离线启动器实现相同服务、文件与控制协议。接入 tty/非 tty、自包含资源和关闭清理。复用公共请求样例及前端 | 同版目录、帮助、JSON 回执及错误分类通过四启动器对照。Windows 离线包实际启动完成多页和多 AIG 用例，资源与许可证齐全。Python 回退可在无 Node 的服务环境运行 |
| P8　全链路回归与交付 | P4–P7 | 合并每批 UI 映射和测试证据，执行第 7 节的端到端、性能与发布验收。更新使用指南、Linux/Tcl 集成说明、Windows 说明和已变更的架构契约 | 180 条均能定位到实现和用例，所有适用入口均覆盖。有界、部分、取消、失败和失效目标的回执可查。交付记录列明版本、平台、实际运行的测试和产物 |

## 7. 验证计划

| 场景 | 验证方法与通过标准 |
| --- | --- |
| 目录与调用一致 | 每个规范动词已有适用模式的成功断言与至少一项边界断言。源于 UI 的动作关联到具体控件或手势，并验证对同一用例的分派。公共协议样例覆盖 Tcl list、中文/空格、反斜杠、方括号、空字符串和多行文本。按进程检查退出码、stdout 和 stderr |
| SSH 多页和目标失效 | 本地转发端口与服务端口取不同值。用真实浏览器新建、复制、刷新、关闭页面，并在传输期间换设计。核对页面编号、重连、两页独立性、错误归属、重复请求、背压及忙服务能执行 stop。关闭/刷新时若结果无法确认，回执明确标记 |
| 文件与分批提交 | 遍历本机/服务器/文本入口、单个/多个文件、Common/Compare A/B、路径越界、不可读、大目录、导出失败等组合。混合批次核对逐文件结果，显式 AIG Add 核对整批提交。目录分页、终端补全均不递归扫描整棵目录 |
| 多 AIG、重名与图状态 | 使用 [shared_cone.dot](../../tests/fixtures/aig/shared_cone.dot)、[shared_cone.blif](../../tests/fixtures/aig/shared_cone.blif) 和 [带名称映射的 BLIF](../../examples/aig_mapped_names.blif)，补充同 basename 两个来源。保留相同节点 ID，在 A 设置 Show Path/Focused，在 B 设置其他选区、缩放及高亮。往返和刷新后分别断言两图查询、路径、SVG 来源与图 ID。验证 `module open top.blif` 歧义与按 ID 的正确结果 |
| AIG 失败与兼容 | 覆盖追加第二项损坏、超限、取消、快速 Add/Open、切图时 Graphviz 超时、旧 Worker 晚到、v1/v2 存档迁移、存储拒绝与配额耗尽。检查集合、活动图、旧图身份、旧会话是否可恢复、缓存及日志条数。保留原有单图和混合域批次测试 |
| 操作完成与错误诊断 | CLI/Tcl 可区分服务 ready、浏览器已接收和操作实际完成。所有新增异步边界按项目日志规范记录 operation、code、原始异常、page、适用的图/侧、request/job 及版本。验证 Process Log 详情和 JSONL 脱敏，失败只在拥有边界记一次，旧任务的错误不挂到新图 |
| 性能与发布 | 在同一输入上记录基线与改动后的服务器队列、多个标签页、追加/首切/回切耗时、Graphviz 调用数、内存峰值及存档写入量。反复切图后活跃 Worker 与缓存回到约定上限。保留原有指针/滚轮预览与渐进渲染。检查卡住、断开与正常退出都能释放文件和进程资源 |

**执行位置与现有入口。** 开发阶段将构建、一般单测、浏览器 E2E、CTest、Tcl 和基准放在 `mfs-remote`，临时构建、浏览器报告与日志留在服务器。Windows 打包与实际 exe 冒烟安排在可运行该产物的 Windows 环境。本轮交付是计划，下列验证在对应实现批次执行。

- 基础回归运行 `npm test`、`npm run test:architecture`、`npm run test:launcher`。在现有 launcher E2E、native CTest/Tcl 之上增加公共协议及双页对照，CTest 启用 `NGB_BUILD_TESTS=ON` 并核实 Tcl 用例实际被注册。
- 前端按改动运行 `npm run test:workbench`、`npm run test:ui-workbench`、`npm run test:process-log`、`npm run test:aig`、`npm run test:aig-browser`、`npm run test:aig-views`、`npm run test:aig-structure`、`npm run test:show-path-browser`、`npm run test:scoped-logic-browser` 及 Liberty 相关用例。将多图用例纳入现有测试入口。
- 影响合成设计展示的改动运行 `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases`，记录默认 provider。触及布局/排序时另跑确定性与 fixture 不变量。复杂度敏感改动运行 `npm run benchmark` 及对应 AIG/工作区基准。Simple 沿用仓库冻结基线。
- 发布候选运行 `npm run release:windows`、Linux 单文件离线冒烟、`npm run test:docs`，检查实际包内的前端模块、协议目录、Graphviz/ELK 与许可证。验收记录区分真实运行、跳过及其原因。

## 8. 首个可用版本和最终交付

**首个可用版本验收 P0–P4。** 用 npm 启动 SSH 服务，页面 1 打开网表并追加模块和时序，页面 2 从服务器打开 AIG，再追加另一张包含同名节点的图。终端和已有 EDA Tcl 均可列页、选页、列图、切图并查询结果。刷新后两页各自恢复。在同一台服务器把启动入口换成 Linux ELF，重复这份脚本得到相同业务结果。

**完整版本验收 P5–P8。** 交付可运行的启动器、兼容的 Tcl 辅助脚本、远程文件选择器、多 AIG 工作区、180 条命令的在线帮助和完整 UI 覆盖清单。随版本提供 SSH 转发与 Tcl 示例、协议版本和错误码说明、平台测试报告及离线包核验结果。按批次合入时只在界面和 `commands --available` 中启用已实现且适用于该页的能力。功能失败时保留原有本机文件入口和可用工作区。

核对入口见 [前端工作台](../../index.html)、[通用事件绑定](../../src/app/workbench_event_bindings.js)、[导入与粘贴](../../src/ui/quick_input_controller.js)、[Show Path](../../src/ui/show_path_controller.js)、[Netlist 重收敛](../../src/ui/netlist_reconvergence_panel.js)、[AIG 面板](../../src/ui/aig_panels.js)、[AIG 结构详情](../../src/ui/aig_structure_panels.js)、[用户指南](../USER_GUIDE.md)、[Node 启动器](../../tools/serve.mjs)、[Linux 单文件启动器说明](../LINUX_SINGLE_FILE_LAUNCHER.md)和 [EDA Tcl 接口](../../tools/eda/ngb.tcl)。
