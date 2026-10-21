# Linux 单文件启动器、CMake 与 EDA/Tcl

对应 2026-10-21 覆盖更新的 v1.1.2 和当前 master。旧 v1.1.2 文件需重新下载并核对 SHA-256。
实际验证与剩余项见 [维护计划](plans/linux_launcher_maintenance.md)。

## 1. 入口与职责

| 入口 | 运行依赖 | 适用场景 |
| --- | --- | --- |
| `node tools/serve.mjs` | Node.js 18+ | 源码开发、共享 parser 的启动前语义校验 |
| `python3 -u tools/serve.py` | Python 3 标准库 | 没有合适 Node 的源码预览 |
| Windows `NetlistGraphBuilder.exe` | 同目录 app 资源 | Windows 离线发布，不是 Linux 程序 |
| Linux `ngb` | Linux 系统 C/C++ 库 | 单个 ELF 嵌入前端与 ELK，无需 Node/Python 或资源目录 |

ngb 只读取显式输入、生成 startup manifest 并提供 loopback HTTP，不复制 parser、IR、inference、layout 或 render。
监听前只检查文件可读性；网表、Cell Config、module/focus 语义由浏览器校验。
ready 表示服务就绪，不表示解析、布局成功。前端默认 H08，失败按 H08 → ELK → Simple 降级。

## 2. 构建与测试

Linux 构建机需要 CMake 3.16+、C++11 编译器、POSIX threads；无需下载第三方依赖。

```bash
cmake -S . -B build/linux -DCMAKE_BUILD_TYPE=Release -DNGB_BUILD_TESTS=ON
cmake --build build/linux --target ngb -j2
ctest --test-dir build/linux --output-on-failure
./build/linux/native/ngb --help
./build/linux/native/ngb --licenses
```

独立入口：`cmake -S native -B build/ngb`，生成 `build/ngb/ngb`。
NGB_BUILD_TESTS 默认 OFF；开启后测试需要 Python 3.6+，找到 tclsh 时额外注册 Tcl 测试。
缺少 tclsh 时不能将 Tcl 集成记为已验证。CTest 包含 HTTP/生命周期、Tcl、CMake 增量与安装检查。

HTML、CSS、src/**/*.js、vendored ELK 和许可证在构建时嵌入；JS 新增/删除/修改都会触发重新嵌入。
资源清单与生成 C++ 位于 build 目录，不编辑生成代码，不提交 build/dist。

## 3. 安装与 EDA CMake 接入

```bash
cmake --install build/linux --prefix "$HOME/eda-tools"
```

默认安装 `<prefix>/bin/ngb` 与 `<prefix>/share/netlist_graph_builder/ngb.tcl`。
EDA 工程可以直接引入 native 子目录：

```cmake
set(NGB_INSTALL_BINDIR "libexec/eda" CACHE STRING "ngb executable location")
add_subdirectory(third_party/netlistGraphBuilder/native ngb_build)
add_dependencies(eda_tool ngb)
```

子工程默认提供安装规则，不要重复 install(TARGETS ngb)。父工程需要完全接管安装时，在 add_subdirectory 前：

```cmake
set(NGB_INSTALL OFF CACHE BOOL "Parent owns ngb installation" FORCE)
```

此时父工程自行安装 ngb 和 tools/eda/ngb.tcl。可单独配置 NGB_INSTALL_BINDIR、NGB_INSTALL_DATADIR，
不改变 EDA 其他 target 的 GNUInstallDirs。服务保持独立进程，不静态链接进 EDA 主进程。

## 4. 启动协议

```bash
mkdir -p ./results
./build/linux/native/ngb start \
  --netlist ./results/top_mapped.v --timing ./results/top_timing.log \
  --cell-config ./results/cells.json --module top --focus u0 \
  --fanin-depth 1 --fanout-depth 2 --port 0 \
  --state-file ./results/ngb-session.json --parent-death --no-open
```

输入和 target 参数均可省略。原生默认 port 0；显式 port 0 由操作系统选择空闲端口，仅监听 127.0.0.1。
--no-open（兼容 --no-browser）适用于服务器；--open 尝试 xdg-open。省略 start 的旧参数形式仍有效；无参数打印用法并非零退出。

stdout 只有一行 ready JSON，诊断在 stderr；ready 只含文件名和目标摘要，不含原文：

```json
{"event":"ready","host":"127.0.0.1","port":43821,"url":"http://127.0.0.1:43821/?startup=1","startup":{"netlist":"top_mapped.v","timing":"top_timing.log","cellConfig":"cells.json","module":"top","focus":"u0","faninDepth":1,"fanoutDepth":2}}
```

port 范围 0–65535，fanin/fanout depth 0–99。未知参数、不可读文件、绑定或状态写入失败会非零退出。
原生入口不创建状态父目录，调用方先 mkdir；Tcl helper 会创建目录。
服务是前台进程，脚本应后台运行或保留 Tcl pipeline，不能同步 exec start 等待其退出。

## 5. 状态与关闭

```bash
ngb status --state-file ./results/ngb-session.json
ngb stop --state-file ./results/ngb-session.json
ngb stop --state-file ./results/ngb-session.json --force
```

status 输出状态 JSON 和 status=running/stale；正常读取两者均返回 0，无效/缺失状态返回非零。
stop 对不存在的状态返回 0，无效状态或所有权不匹配返回非零。

状态包含 version、pid、port、url、规范化 stateFile、owner、processStartTicks；以独占临时文件（0600）加 rename 写入。
每个会话持有 `<state-file>.lock` 独占锁；锁文件退出后可保留，它不是运行标记，服务运行时不能删除锁文件。
停止前验证可执行文件身份、精确状态路径参数和启动时间，不按 basename、端口或命令行子串猜 PID。
先 SIGTERM 并有限等待；--force 在再次验证所有权后才尝试 SIGKILL。僵尸进程按已退出处理。
只删除仍属于当前 owner 的状态，不删除新会话的记录。

```bash
ngb start --state-file ./results/ngb-session.json --replace --port 0 --no-open
```

--replace 先验证新输入可读性，再停止旧会话并获取锁。替换 ngb 二进制前应先停止旧服务；新 inode 不匹配时保守拒绝 stop。
旧记录缺少启动时间时仍要求可执行文件与精确路径匹配。--parent-death 作为异常退出清理，不替代正常 stop。

HTTP 只支持 GET/HEAD；manifest 为 no-store。拒绝路径穿越、NUL 和反斜杠，不提供任意文件下载。
最多 32 个处理连接，请求头 16 KiB、读取总期限 2 秒、发送超时 2 秒。不是公网服务器，不开放防火墙端口。

## 6. Tcl helper

Tcl 8.5+，无需 Tcllib；源码文件为 tools/eda/ngb.tcl：

```tcl
source /opt/eda/share/netlist_graph_builder/ngb.tcl
set ngb_bin /opt/eda/bin/ngb
set ngb_state [file normalize ./results/ngb-session.json]
set url [::ngb::Start $ngb_bin $ngb_state \
    --netlist ./results/top_mapped.v --timing ./results/top_timing.log \
    --module top --focus u0 --fanin-depth 1 --fanout-depth 2]
puts "Netlist browser ready: $url"
puts [::ngb::Status $ngb_bin $ngb_state]
# EDA run 正常结束时：
::ngb::Stop $ngb_bin $ngb_state
```

Start 保留非阻塞 pipeline，最多等 10 秒 ready 才返回 URL；提前退出、超时、既有状态均报错。
默认 port 0、no-open、parent-death。支持 netlist/timing/cell-config/module/focus/fanin-depth/fanout-depth 的 option/value 对。
不同 state 路径可并行管理；不隐式替换已有会话。Stop 不吞错，不直接 kill Tcl 的 pipeline PID。
参数用 list 传递，无 shell 拼接，路径支持空格/中文。Tcl 自身解析重定向，所以拒绝以 `< > | &` 开头的非路径值。
保留当前 Tcl interpreter；调用方如选择 catch，须自行报告错误，不能伪报成功。

## 7. 远程访问、兼容性与许可证

远程 ready.url 是服务器地址。通过 VS Code Ports 或 SSH 转发实际端口，例如远端 43821 → 本地 43822，
打开 http://127.0.0.1:43822/?startup=1；不要混用远端、本地端口，也不能将请求值 0 当作实际监听端口。

单文件不等于完全静态或任意发行版通用。在不高于目标环境的工具链上构建，发布前检查 file ngb、ldd ngb。
需要时可用 -static-libgcc -static-libstdc++，仍有 glibc 基线；musl 是单独构建目标，未验证前不宣称兼容。
CentOS 7、多架构、浏览器矩阵和 VS Code Server 系统依赖不因单文件构建成功就自动通过。

ELK 0.11.1 的 EPL-2.0 已嵌入，可用 ngb --licenses 输出，不依赖旁边的许可证文件。
