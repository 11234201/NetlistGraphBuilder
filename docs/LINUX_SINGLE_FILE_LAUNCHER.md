# Linux 单文件启动器、CMake 构建与 EDA/Tcl 集成指南

本文档对应当前主干的 Linux 启动协议；可下载二进制的版本以对应 Release 附件为准。历史实测记录与后续规划见 [Linux 启动器维护计划](plans/linux_launcher_maintenance.md)。

启动后的界面操作见 [完整使用教程](USER_GUIDE.md)，其中 [左右面板隐藏与恢复](guide/01-getting-started.md#14-隐藏恢复与调整左右面板) 说明如何为中央画布腾出空间。Linux 单文件内嵌构建时的界面资源；采用新版工作台时需重新构建或换用新二进制，更新外部 HTML/CSS 不会改变已有可执行文件中的界面。

## 1. 各运行入口与职责对比

| 启动入口 | 运行时依赖 | 适用场景 |
| --- | --- | --- |
| `node tools/serve.mjs` | Node.js 18+ | 源码开发调试；在绑定端口前复用项目 parser 执行网表与目标语义预校验 |
| `python3 -u tools/serve.py` | Python 3 标准库 | 无法运行新版 Node.js 的 Linux 源码预览环境 |
| Windows `NetlistGraphBuilder.exe` | 包内 `app/` 和 `runtime/` | 解压运行，使用内置 CPython 执行与 Python 回退服务相同的工作台协议 |
| Linux `ngb` | Linux 基础系统 C/C++ 库 | 单个 ELF 可执行文件（已内嵌全部前端源码、ELK、Graphviz/WASM 与许可证），无需安装 Node.js、Python 或携带外部资源目录 |

**职责边界说明**：
- `ngb` 处理启动清单、服务器文件、页面注册与命令回执。Verilog 和 AIG 解析、布局、渲染及导出图像生成由目标工作台执行。
- 在绑定监听端口前，`ngb` 仅校验输入文件的存在性与可读性；网表语法、`Cell Config` 结构以及 `module` / `focus` 目标匹配均由浏览器前端完成校验。
- 标准输出打印 `ready` 仅代表本地 HTTP 服务与启动清单已就绪，不代表浏览器已完成网表解析或布局渲染。浏览器前端默认采用 `AnchorLayered` 布局引擎，若失败则按 `AnchorLayered → ELK → Simple` 顺序自动降级。

---

## 2. 从源码构建与测试

Linux 构建机需具备 **CMake 3.16+**、支持 **C++17** 的编译器以及 **POSIX threads**（无需联网下载任何第三方依赖）：

```bash
cmake -S . -B build/linux -DCMAKE_BUILD_TYPE=Release -DNGB_BUILD_TESTS=ON
cmake --build build/linux --target ngb -j2
ctest --test-dir build/linux --output-on-failure
./build/linux/native/ngb --help
./build/linux/native/ngb --licenses
```

- **独立子目录构建**：也支持直接以 `native/` 作为顶层构建：`cmake -S native -B build/ngb`，此时生成的可执行文件位于 `build/ngb/ngb`。
- **测试开关说明**：`NGB_BUILD_TESTS` 默认为 `OFF`。设为 `ON` 时，运行集成测试需要 **Python 3.6+**；若构建环境中可找到 `tclsh`，CMake 还会自动注册 Tcl 辅助脚本测试（缺少 `tclsh` 时不得将 Tcl 集成记为已验证）。`CTest` 套件完整覆盖 HTTP 服务、进程生命周期、Tcl 接口、CMake 增量重嵌入以及安装规则检查。
- **静态资源自动嵌入**：`index.html`、`styles.css`、`src/**/*.js`、本地化的 `vendor/elkjs`、`vendor/graphviz`（含 WASM）以及开源许可证均在构建阶段自动打包嵌入 C++ 产物；对任何前端 JS 文件的新增、删除或修改都会自动触发重新嵌入。生成的资源清单与 C++ 源文件位于 `build/` 目录内（请勿手动编辑生成代码，亦不要将 `build/` 或 `dist/` 提交至 Git）。

---

## 3. 安装部署与 EDA CMake 工程接入

可通过标准 CMake 安装命令将 `ngb` 部署至指定前缀目录：

```bash
cmake --install build/linux --prefix "$HOME/eda-tools"
```

默认安装路径为 `<prefix>/bin/ngb` 与 `<prefix>/share/netlist_graph_builder/ngb.tcl`。

若需将 `ngb` 直接作为子目录集成至大型 EDA 项目的 CMake 构建树中，可按如下方式引入：

```cmake
set(NGB_INSTALL_BINDIR "libexec/eda" CACHE STRING "ngb executable location")
add_subdirectory(third_party/netlistGraphBuilder/native ngb_build)
add_dependencies(eda_tool ngb)
```

`native` 子工程默认自带 `install` 规则，父工程无需重复调用 `install(TARGETS ngb)`。若父工程希望完全自主接管安装逻辑，可在调用 `add_subdirectory` 之前显式关闭子工程安装：

```cmake
set(NGB_INSTALL OFF CACHE BOOL "Parent owns ngb installation" FORCE)
```

关闭后由父工程自行安排 `ngb` 二进制与 `tools/eda/ngb.tcl` 的安装位置。可通过 `NGB_INSTALL_BINDIR` 与 `NGB_INSTALL_DATADIR` 单独定制安装子目录，不会污染父工程其他 target 的 `GNUInstallDirs` 设置。运行时 `ngb` 始终作为独立子进程启动，不静态链接进 EDA 主程序进程空间。

---

## 4. 启动协议与命令行参数

```bash
mkdir -p ./results
./build/linux/native/ngb start \
  --netlist ./results/top_mapped.v --timing ./results/top_timing.log \
  --cell-config ./results/cells.json --module top --focus u0 \
  --fanin-depth 1 --fanout-depth 2 --port 0 \
  --state-file ./results/ngb-session.json --parent-death --no-open
```

- **参数与默认值**：所有输入文件参数（`--netlist`、`--timing`、`--cell-config`）、目标定位参数（`--module`、`--focus`、`--fanin-depth`、`--fanout-depth`）以及服务器文件浏览根目录参数（`--browse-root <dir>`，可重复传入多个目录，默认当前工作目录）均可按需省略。原生启动器默认端口为 `0`（即由操作系统自动分配空闲端口），且始终仅监听本地回环地址 `127.0.0.1`。`--[no-]interactive` 控制是否在启动终端显示交互式命令提示符（默认在 TTY 下开启）。
- **浏览器唤起控制**：服务器或无头环境请传入 `--no-open`（兼容旧别名 `--no-browser`）；传入 `--open` 则尝试调用系统 `xdg-open` 打开浏览器。`start` 子命令可省略以保持向后兼容；若不带任何参数直接运行 `ngb`，则会打印用法说明并以非零状态退出。
- **标准输出 `ready` 消息**：交互终端分别显示工作台链接和状态文件路径。标准输出连接管道、重定向到文件或使用 `--no-interactive` 时，启动成功后输出一行 JSON 格式的 `ready` 事件（所有诊断与错误信息均输出至 `stderr`）。`ready` 行仅包含文件名与目标摘要，绝不包含网表、时序或配置原文：

```json
{"event":"ready","host":"127.0.0.1","port":43821,"url":"http://127.0.0.1:43821/?startup=1","startup":{"netlist":"top_mapped.v","timing":"top_timing.log","cellConfig":"cells.json","module":"top","focus":"u0","faninDepth":1,"fanoutDepth":2}}
```

终端诊断同时保存到 `${XDG_STATE_HOME:-$HOME/.local/state}/netlist_graph_builder/logs`，可通过 `NGB_LOG_DIR` 指定目录。每个进程独立保存运行与错误 JSONL，默认单文件约 2 MiB 滚动并保留一个备份；启动时自动清理已退出进程超过 14 天的整组日志，`NGB_LOG_RETENTION_DAYS` 可调整天数或设 `0` 关闭清理。日志目录不可写时回退 `stderr`，清理失败记录诊断并继续启动，`ready` 协议不变。完整字段、限额、Windows 路径与验证命令见 [用户指南](USER_GUIDE.md)。

- **边界与进程模型**：`--port` 合法范围为 `0–65535`，`--fanin-depth` / `--fanout-depth` 合法范围为 `0–99`。遇到未知参数、文件不可读、端口绑定失败或状态文件写入失败时，程序会立即以非零状态码退出。注意：原生 `ngb` 不会自动创建 `--state-file` 的父目录，调用方需预先执行 `mkdir -p`（若通过 `ngb.tcl` 调用，Tcl 辅助脚本会自动创建父目录）。由于 `ngb start` 是常驻前台服务进程，外部脚本应将其置于后台运行或保持异步管道，切勿使用同步阻塞的 `exec` 等待其退出。

---

## 5. 会话状态查询与安全关闭

可通过 `--state-file` 查询运行状态或安全停止指定会话：

```bash
ngb status --state-file ./results/ngb-session.json
ngb stop --state-file ./results/ngb-session.json
ngb stop --state-file ./results/ngb-session.json --force
```

- **`status` 与 `stop` 退出码约定**：
  - `status`：输出状态 JSON 并标明 `"status":"running"` 或 `"status":"stale"`；只要状态文件结构合法且成功读取，两者均返回退出码 `0`；若状态文件缺失或格式损坏，则返回非零退出码。
  - `stop`：若状态文件已不存在（幂等关闭）或目标进程已成功停止，均返回退出码 `0`；若状态文件损坏或进程所有权校验不匹配，则返回非零退出码。
- **原子状态文件与并发锁**：
  - 状态文件记录 `version`、`pid`、`port`、`url`、规范化后的 `stateFile` 路径、`owner` 以及进程启动时钟滴答数 `processStartTicks`，通过权限为 `0600` 的独占临时文件配合原子 `rename` 写入。
  - 每个活动会话持有 `<state-file>.lock` 独占文件锁；进程退出后 `.lock` 文件可留在磁盘上（它仅作为并发锁载体而非运行状态标记，服务运行期间切勿手动删除 `.lock` 文件）。
- **严格的进程所有权校验**：
  - 执行 `stop` 前，`ngb` 会严格核对目标 PID 的可执行文件身份（inode）、精确的命令行 `--state-file` 路径参数以及 `processStartTicks` 启动时间戳，**绝不根据进程名、端口号或命令行子串盲目猜测或强杀进程**。
  - 停止时默认先发送 `SIGTERM` 并有界等待进程退出；若传入 `--force`，会在超时后再次校验进程所有权，确认无误后才发送 `SIGKILL`。已处于僵尸状态（Zombie）的进程按已退出处理。清理阶段仅删除仍归属于当前实例的状态文件，不会误删并发新会话写入的记录。
- **平滑替换会话（`--replace`）**：

```bash
ngb start --state-file ./results/ngb-session.json --replace --port 0 --no-open
```

  - `--replace` 会先校验新启动参数与输入文件的可读性，通过后再安全停止旧会话并接管文件锁。注意：在升级或替换磁盘上的 `ngb` 二进制文件前，应先用旧二进制停止正在运行的服务（若新旧二进制 inode 不同，`stop` 会出于安全策略拒绝跨二进制终止进程）。`--parent-death` 用于在父进程意外崩溃时自动退出，不应替代正常流程中的显式 `stop`。
- **内置 HTTP 安全限制**：
  - 静态资源和启动清单使用 `GET`、`HEAD`。已配对页面在同源 `POST /__ngb/workbench` 上领取操作、读取浏览根目录和提交回执。终端和 Tcl 使用私有控制通道。
  - 严格拦截路径穿越（`..`）、空字节（`NUL`）与反斜杠，仅返回内嵌的已知前端资源，不提供主机任意文件下载。
  - 并发连接上限为 32 个，单个请求头上限 16 KiB，请求读取总时限 2 秒，响应发送超时 2 秒。该服务仅作为本机同用户回环工具，不可作为公网 Web 服务器使用。

---

## 6. 在 SSH 转发的页面中追加文件

在本机建立转发并登录服务器。以下示例将本机端口 8417 转发到服务器端口 4173。

```sh
ssh -L 8417:127.0.0.1:4173 user@server
```

在服务器项目目录运行下列任一启动命令。用实际输入目录替换 `/work/run`。

```sh
npm start -- --no-open --port 4173 --browse-root /work/run --state-file "$HOME/ngb.state"
./build/native/ngb start --no-open --port 4173 --browse-root /work/run --state-file "$HOME/ngb.state"
```

复制 ready 记录中的 `pairUrl`，将端口改为 `8417`，保留 `#ngb=…`，在本地浏览器打开两次。界面上的页编号对应终端 `pages` 的结果。从 **File → Open from server…** 默认自动识别所选文件（既可单选主文件，也可同时勾选 Verilog + Timing 或 AIG + Level 配对导入，或选 `level open` 为当前 AIG 补载 `.level` 报告）。AIG 页选 **aig add** 可保留多张图，并用页内图选择器切换（每张图独立保存各自的 Level 附件与视图状态）。TTY 中仍能输入命令。

```text
pages
use p1
add /work/run/extra.v
add-timing "/work/run/中文 timing/T2.rpt"
--page p2 files import /work/run/base.blif /work/run/base.level
--page p2 aig add /work/run/eco.blif
--page p2 module list
--page p2 module open g2
--page p2 level open /work/run/eco.level
--page p1 svg export --out /work/run/top.svg
```

示例中的页和图编号需替换为本轮的实际值。多页时可用 `--page` 明确目标，或在启动终端以 `use` 设置默认页。关闭默认页后，终端会报告 `PAGE_UNAVAILABLE`。服务端导出默认保留同名旧文件，显式替换可用 `--overwrite`。UI 的 SVG 导出及命令 `svg export --download` 会触发当前浏览器下载。

独立 shell 可以执行 `ngb cmd --state-file "$HOME/ngb.state" --page p1 module list`。源码入口可将 `ngb` 替换为 `node tools/serve.mjs` 或 `python3 tools/serve.py`。Windows 解包后可在 PowerShell 用 `.\NetlistGraphBuilder.exe start --state-file .\ngb.state` 启动服务，在另一个窗口运行 `.\NetlistGraphBuilder.exe cmd --state-file .\ngb.state pages`。EDA Tcl 可连接任一服务并读取结构化回执。

```tcl
source /opt/eda/share/netlist_graph_builder/ngb.tcl
set state [file join $::env(HOME) ngb.state]
::ngb::Connect [list /opt/eda/bin/ngb] $state
set reply [::ngb::Cmd $state --page p1 timing add {/work/run/中文 timing/T2.rpt}]
puts [dict get $reply status]
```

当 Tcl 自行启动服务时，`::ngb::Start` 仍返回原有预览 URL。可用 `::ngb::Cmd $state page new` 取得带配对信息的 `result href`，用本地转发地址打开这个相对链接。

脚本等待超时时，服务端任务仍可查询。Tcl 的 `catch` 会在选项字典的 `-errorcode` 中返回 `NGB WAIT_TIMEOUT`，在 `-ngbreceipt` 中保留原回执。用回执中的 `requestId` 查询同一任务。

```tcl
if {[catch {::ngb::Cmd $state --page p1 --timeout 1000 aig add /work/eco.blif} message options]} {
    if {[dict get $options -errorcode] ne {NGB WAIT_TIMEOUT}} {
        return -options $options $message
    }
    set request [dict get $options -ngbreceipt requestId]
    puts [::ngb::Cmd $state job status $request]
}
```

`commands` 列出完整目录（共 182 条命令与 5 个简写），`help aig add` 或 `help level open` 查询参数。`commands --available` 依据网页最近报告的模式和文件选择器状态列出可执行命令。尚未连接网页时只列启动器和服务命令，单页时自动选择，多页时使用 `--page <ID>` 或终端已选的页面。在 Compare 页加 `--side A` 或 `--side B` 可查询适用于该侧的命令，包括导出 SVG 和查看时序。

## 7. EDA Tcl 辅助脚本（`ngb.tcl`）

仓库 `tools/eda/ngb.tcl` 提供了兼容 **Tcl 8.5+**（无需安装第三方 `Tcllib`）的集成封装：

```tcl
source /opt/eda/share/netlist_graph_builder/ngb.tcl
set ngb_bin /opt/eda/bin/ngb
set ngb_state [file normalize ./results/ngb-session.json]
set url [::ngb::Start $ngb_bin $ngb_state \
    --netlist ./results/top_mapped.v --timing ./results/top_timing.log \
    --module top --focus u0 --fanin-depth 1 --fanout-depth 2]
puts "Netlist browser ready: $url"
puts [::ngb::Status $ngb_bin $ngb_state]
# 当 EDA 流程正常结束时显式关闭：
::ngb::Stop $ngb_bin $ngb_state
```

- **`::ngb::Start`**：在后台打开非阻塞管道并保持持有，最多等待 10 秒直至读取到合法的 `ready` JSON 后才向调用方返回 URL；若子进程提前退出、等待超时或目标 `stateFile` 已被占用，均会直接抛出 Tcl 错误。默认自动附加 `--port 0`、`--no-open` 与 `--parent-death`，并支持传入 `--netlist`、`--timing`、`--cell-config`、`--browse-root`、`--module`、`--focus`、`--fanin-depth`、`--fanout-depth` 键值对。
- **`::ngb::Connect` 与 `::ngb::Cmd`**：连接已运行的服务会话并发送 182 条工作台命令（返回值直接解析为 UTF-8 Tcl 字典回执，业务错误在 `-errorcode` 中携带 `NGB <CODE>` 并在 `-ngbreceipt` 中附带完整回执）。
- **`::ngb::Status` 与 `::ngb::Stop`**：不同 `stateFile` 路径可并行管理多个独立会话，不会隐式覆盖既有会话。`Stop` 委托给原生 `ngb stop` 进行安全校验终止，不会吞掉错误，也不会直接强杀 Tcl 管道 PID。
- **防注入与编码安全**：所有命令参数均通过 Tcl 列表（List）直接传递，不经过任何 Shell 字符串拼接，完整支持含空格或中文字符的文件路径。由于 Tcl `open "|..."` 原生语法会解析管道与重定向符号，脚本会显式拒绝以 `<`、`>`、`|`、`&` 开头的非路径参数值。若上层 EDA 脚本使用 `catch` 捕获异常，请务必将错误真实报告给用户，切勿将失败伪报为启动成功。

---

## 8. 远程端口转发、系统兼容性与开源许可证

- **远程服务器访问**：在远程 Linux 服务器上启动时，`ready.url` 中的端口为远程服务器回环端口。请通过 VS Code `Ports` 面板或 SSH 本地端口转发（例如将远端 `43821` 转发至本地 `43822`），随后在本地浏览器打开 `http://127.0.0.1:43822/?startup=1`。切勿混淆远端与本地端口号，亦不能将请求参数中的 `--port 0` 当作实际监听端口。
- **发行版与系统库兼容性**：单文件 ELF 仅代表“前端资源已内嵌、无外部脚本依赖”，并不等同于完全静态链接（static binary）或跨任意 Linux 发行版通用。建议在不高于目标生产环境 glibc 基线的构建机上编译，并在发布前使用 `file ngb` 与 `ldd ngb` 核查动态库依赖（必要时可附加 `-static-libgcc -static-libstdc++`，但仍受限于目标系统的 glibc 版本；musl libc 属于独立构建目标，未经验收前不宣称兼容）。
- **内嵌开源许可证**：vendored ELK `0.11.1`（`EPL-2.0`）、Viz.js（`MIT`）、Graphviz（`EPL-1.0`）、Expat（`MIT`）以及 `nlohmann/json`（`MIT`）许可证文本均已直接内嵌至 `ngb` 二进制中，随时可通过 `ngb --licenses` 打印查看，无需附带外部许可证文件。
