# 8. SSH 远程工作台、命令行启动器与 EDA/Tcl 集成

> 返回 [完整使用教程目录](../USER_GUIDE.md) · 上一章：[7. AIG 工作区完整指南](07-aig-workspace.md)

本章介绍通过 SSH 端口转发操作服务器文件与多页面工作台、交互式终端 REPL、182 条跨平台工作台命令、命令行启动参数、状态文件生命周期以及 EDA Tcl 辅助接口（`ngb.tcl`）。关于 Linux 单文件 `ngb` 的 CMake 构建与安装细节，请结合参阅 [Linux 单文件启动器指南](../LINUX_SINGLE_FILE_LAUNCHER.md)。

---

## 8.1 SSH 端口转发与服务器文件选择器

1. 在远程 SSH 服务器上启动服务并指定可浏览的根目录（可重复传入多个 `--browse-root`，默认当前工作目录）：
   ```bash
   # 源码目录统一入口（自动探测 Node 18+ / Python 3.6+，无需 npm）：
   ./ngb --no-open --port 4173 --browse-root /work/run
   # 或使用 Linux 单文件二进制：
   /opt/eda/bin/ngb start --no-open --port 4173 --browse-root /work/run
   ```
2. 将监听端口转发到本地（如 `ssh -L 4173:127.0.0.1:4173 user@host`）。
3. 复制启动终端打印的配对链接（`pairUrl`），在本地浏览器打开（若映射到本地其他端口，替换端口并保留路径与片段）。
4. 每个配对成功的标签页都会在顶部显示自己的页号（如 `p1`、`p2`）。点击 **`File → Open from server…`** 即可浏览服务器目录、切换子目录、按名称过滤、多选文件并选择导入动作：
   - 默认自动识别所选文件（单选主文件，或同时勾选 Verilog + Timing、AIG + Level）。
   - 支持明确选择打开设计、追加设计、追加 AIG、追加时序或为当前 AIG 补载 Level（`level open`）。
   - Compare 模式的 `A files` / `B files` 同样支持从服务器选取文件。

---

## 8.2 交互式终端 REPL 与多页控制

在 TTY 终端直接启动服务时（默认开启 `--interactive`），终端会逐行打印工作台链接与状态文件路径并进入 `ngb>` 提示符：

- 输入 `pages` 查看所有已连接页面（ID、名称、当前设计、模式与状态），用 `use p1` 切换当前终端的默认目标页。
- 支持服务器路径 **Tab 补全**、引号包裹含空格路径、以及按 `↑` / `↓` 浏览最近 **100 条**命令历史（`text set` 与带 `--text` 的内联文本命令不写入历史）。
- 输入 `commands --available` 查看当前页适用的命令，`commands` 列出全部 182 条命令与 5 个简写，`help <命令>`（如 `help fs`、`help timing show`）查看详细参数与示例。

以下示例演示在两个浏览器标签页中分别操作网表与多份 AIG + Level（请将页号与路径替换为现场值）：

```text
pages
use p1
design open /work/run/top.v
timing add /work/run/top.rpt
module list
use p2
files import /work/run/base.blif /work/run/base.level
aig add /work/run/eco.blif
module list
module open g2
level open /work/run/eco.level
```

---

## 8.3 独立进程 `cmd` 子命令与异步任务

Node.js、Python、Linux 单文件 `ngb` 与 Windows 离线版共用同一套跨进程协议，可在另一个终端或脚本中向运行中的服务发送任意工作台命令：

```bash
ngb cmd --state-file "$HOME/ngb.state" pages
ngb cmd --state-file "$HOME/ngb.state" --page p1 design add /work/run/macros.v
ngb cmd --state-file "$HOME/ngb.state" --page p1 --side B timing show a
```

- **结果格式**：在终端直接运行时默认分行输出人类可读结果（错误首行给出错误码与原因）；传入 `--json` 或将标准输出重定向/接入管道时自动输出完整 JSON 回执。
- **异步长任务**：耗时分析或布局可加 `--async` 立即返回 `requestId`，随后在其他终端用 `job status <ID>`、`job wait <ID>` 或 `job cancel <ID>` 查询、等待或取消。
- **多页与侧别**：单页连接时可省略 `--page`，多页时建议显式传 `--page <ID>`；Compare 模式下用 `--side A` 或 `--side B` 指定目标侧。
- **182 条公开命令与 5 个简写**覆盖全部工作台操作：服务与页面管理（`page` / `job`）、服务器目录与导入导出（`fs` / `files` / `design` / `timing` / `aig` / `level` / `export` / `golden`）、模块与导航（`module` / `search` / `history` / `viewport` / `panel`）、视图与布局（`view` / `focused` / `layout` / `display` / `adjust` / `net`）、时序/库/配置（`liberty` / `cell-config`）、对比与分析（`compare` / `path` / `analysis` / `log` / `diagnostics`）。完整命令清单见 [`docs/plans/remote_workbench_commands.md`](../plans/remote_workbench_commands.md)。

---

## 8.4 命令行启动参数与会话生命周期

### 常用启动示例

**通用源码单入口（Linux/macOS `./ngb` 与 Windows `.\ngb.cmd`，自动探测 Node 18+ / Python 3.6+，相对路径相对于调用目录）**：

```bash
./ngb start --netlist "./results/design one.v" --module top --focus u0 --no-open
# 自动化脚本可固定运行时（auto / node / python）：
NGB_RUNTIME=python ./ngb start --state-file ./results/ngb.state --no-open
```

```powershell
.\ngb.cmd --netlist "C:\EDA jobs\design one.v" --timing "C:\EDA jobs\timing one.txt" --module top --focus u0 --no-open
```

详细运行时选择与诊断说明见 [通用源码启动入口](../UNIVERSAL_LAUNCHER.md)。

**直接调用 Node.js / Python 3 / Windows 离线版**：

```powershell
node tools/serve.mjs `
  --netlist "C:\EDA jobs\design one.v" `
  --timing "C:\EDA jobs\timing one.txt" `
  --cell-config "C:\EDA jobs\cells.json" `
  --module top --focus u0 --fanin-depth 1 --fanout-depth 2 --no-open

NetlistGraphBuilder.exe --netlist design.v --module top --focus u0
```

```bash
python3 -u tools/serve.py --netlist "./results/design one.v" --module top --focus u0 --no-open
```

### 完整启动参数表

| 参数 | 说明 |
| --- | --- |
| `--netlist <path>` | 启动时自动加载的 Verilog 网表路径 |
| `--timing <path>` | 启动时自动加载的时序报告路径 |
| `--cell-config <path>` | 启动时自动加载的 version 1 `Cell Config` JSON 路径 |
| `--module <name>` | 启动后默认打开的模块名 |
| `--focus <instance>` | 启动后初始聚焦的单元实例名 |
| `--fanin-depth <0-99>` | 初始 `Focused` 视图的扇入扩展层数 |
| `--fanout-depth <0-99>` | 初始 `Focused` 视图的扇出扩展层数 |
| `--browse-root <dir>` | 服务器文件选择器允许浏览的根目录（可重复指定，默认当前工作目录） |
| `--[no-]interactive` | 是否在启动终端开启交互式 `ngb>` 提示符（默认在 TTY 下开启） |
| `--state-file <path>` | 会话状态文件路径（供 `status`、`stop`、`cmd` 与 `--replace` 使用） |
| `--replace` | 先安全停止 `--state-file` 中经身份校验的既有会话，再启动新会话 |
| `--parent-death` | 父进程退出时自动终止服务 |
| `--port <0-65535>` | 本地监听端口（`0` 由操作系统自动分配空闲端口） |
| `--no-open` / `--no-browser` | 仅启动服务，不自动打开浏览器 |

### 会话生命周期子命令（`start` / `status` / `stop`）

```bash
node tools/serve.mjs start --netlist ./results/top.v --port 0 \
  --browse-root ./results --state-file ./results/ngb-session.json --no-open
node tools/serve.mjs status --state-file ./results/ngb-session.json
node tools/serve.mjs stop --state-file ./results/ngb-session.json
```

- `start` 可省略以兼容传统直接传参；`stop` 严格依据状态文件校验目标进程身份后安全终止服务，绝不按端口盲目强杀无关进程（Node 新会话另支持经内核身份核验的 `--force` 强制停止）。
- **安全与凭据约定**：所有启动器仅绑定 `127.0.0.1`；含空格路径按 Shell 规范加引号。Windows 上请用启动当前会话的同一版启动器执行 `cmd` / `status` / `stop`，控制凭据保存在仅当前用户可读的私有会话目录中，正常 `stop` 时自动清理。

### 标准输出 `ready` JSON 协议

当标准输出被重定向、由脚本/EDA 管道读取或传入 `--no-interactive` 时，服务就绪后向 `stdout` 输出单行 JSON（仅含文件名与目标摘要，绝不泄露网表或时序原文）：

```json
{"event":"ready","host":"127.0.0.1","port":4173,"url":"http://127.0.0.1:4173/?startup=1","startup":{"netlist":"design.v","module":"top","focus":"u0","faninDepth":1,"fanoutDepth":2}}
```

若文件不可读、参数越界、Cell Config 非法或 `module`/`focus` 不存在（Node 预校验），启动器在绑定端口前向 `stderr` 报错并以非零状态码退出。

---

## 8.5 EDA Tcl 辅助接口（`ngb.tcl`）

仓库 `tools/eda/ngb.tcl` 及发布包根目录附带可复用 Tcl 封装，提供五个公共过程：

| Tcl 过程 | 作用 |
| --- | --- |
| `::ngb::Start $binary $state ?option value ...?` | 启动服务并返回 URL，支持父进程退出自动清理 |
| `::ngb::Status $binary $state` | 查询服务进程状态 |
| `::ngb::Stop $binary $state` | 校验身份并安全停止指定服务 |
| `::ngb::Connect $launcherArgv $state` | 登记连接已有服务的命令行客户端，返回服务身份与协议版本 |
| `::ngb::Cmd $state ?--page ID? ?--side A/B? <group> <action> ?arg ...?` | 执行一次工作台命令并返回结果 dict，失败可用 `catch` 捕获 |

```tcl
source /opt/eda/share/netlist_graph_builder/ngb.tcl
set state [file join $::env(HOME) ngb-impl.state]
::ngb::Connect [list /opt/eda/bin/ngb] $state
set reply [::ngb::Cmd $state --page p1 design add {/work/run/macro cells.v}]
::ngb::Cmd $state --page p1 timing add /work/run/setup.rpt
::ngb::Cmd $state --page p2 --side B timing open /work/run/eco.rpt
```

---

> 下一章：[9. Process Log、终端日志、推荐工作流与常见问题](09-logging-workflows-and-faq.md)
