# Linux 单文件启动器与 EDA/CMake 集成

本文说明如何构建和集成 Linux 单文件版 Netlist Graph Builder。该版本的目标是：

- 前端 HTML、CSS、ES modules 和 vendored ELK 在编译期嵌入一个 `ngb` 可执行文件；
- 运行时不依赖 Node.js、Python 或项目资源目录；
- 端口自动分配、会话记录和安全关闭由统一命令行完成；
- EDA Tcl 只负责启动和关闭，不直接管理 PID、端口或发送 `kill`；
- EDA 工程通过 CMake 编译和安装 `ngb`。

单文件启动器仍然提供本地 HTTP 服务，因此使用时仍需要浏览器或 VS Code Integrated Browser。它不是把浏览器本身编译进 EDA。

## 1. 运行模型

```text
EDA Tcl
  │
  ├─ ngb start --netlist ... --port 0 --state-file ...
  │
  └─ ngb stop --state-file ...

ngb
  ├─ 读取 EDA 生成的 netlist/timing/config
  ├─ 在二进制内部提供 index.html、styles.css、src/**/*.js 和 ELK
  └─ 监听 127.0.0.1 的动态端口

Browser / VS Code Integrated Browser
  └─ http://127.0.0.1:<forwarded-port>/?startup=1
```

`ngb` 不重复实现前端中的 Verilog parser、IR、inference、layout 或 renderer。它只负责读取启动输入并提供静态资源和启动清单，保持现有的数据流边界。

因此 native 启动器在监听前只检查输入文件是否可读；网表语法、Cell Config schema、module 和 focus 的语义校验仍由浏览器中的现有前端完成，并显示在 Process Log 中。这样可以避免为 Linux 二进制复制一套容易漂移的 parser/inference 逻辑。

### 1.1 Node、Python 与 ngb 的职责边界

项目保留三种入口，但它们不是互相依赖的启动链：

| 入口 | 适用场景 | 依赖 | 行为基准 |
| --- | --- | --- | --- |
| `node tools/serve.mjs` | git clone 后的开发、Windows、Linux | Node.js 18+ | Node 命令是启动协议的参考实现 |
| `python3 -u tools/serve.py` | 没有合适 Node.js 的 Linux/EDA 环境 | Python 3 标准库 | 兼容 Node 的参数、manifest 和 ready JSON |
| `ngb` | EDA 集成、目标机不希望安装 Node/Python | 无运行时依赖 | 兼容同一启动协议，资源编译进二进制 |

Windows 不需要也不能运行 Linux `ngb`：直接使用 Node，或使用 Python 回退；Linux 上也可以在 git clone 后直接使用 Node/Python，只有发布给 EDA 集成时才构建 `ngb`。`ngb` 不会反向成为 Node 或 Python 的依赖。

三种入口都支持：

```text
--port 4173   使用固定端口
--port 0      让操作系统选择空闲端口，并在 ready JSON 中报告真实端口
```

推荐普通开发和 EDA 集成都使用 `--port 0`，再从 stdout 的 `ready.port` 或 `ready.url` 取得地址。Python 的实现使用实际监听器端口生成 URL，不会把请求值 `0` 错误地输出成访问地址。

Node/Python 直接运行示例：

```bash
node tools/serve.mjs --netlist tests/fixtures/mapped/sop/sop_013_mapped.v --port 0 --no-open
python3 -u tools/serve.py --netlist tests/fixtures/mapped/sop/sop_013_mapped.v --port 0 --no-open
```

Node/Python 也支持和 `ngb` 相同的会话管理参数：

```bash
node tools/serve.mjs start --port 0 --state-file ./results/ngb-session.json --no-open
node tools/serve.mjs status --state-file ./results/ngb-session.json
node tools/serve.mjs stop --state-file ./results/ngb-session.json
```

Python 将命令头替换为 `python3 -u tools/serve.py` 即可。`start` 可省略以兼容原有直接启动命令；`stop` 和 `status` 依赖状态文件，不根据端口号猜测目标进程。Node/Python 的状态管理是跨平台实现，Linux `ngb` 另有 `--parent-death` 机制用于 EDA 父进程异常退出时清理。

## 2. 构建前提

构建机需要：

- CMake 3.16 或更高版本；
- 支持 C++11 的 Linux C++ 编译器；
- POSIX threads；
- 当前仓库中的前端资源和 `vendor/elkjs-0.11.1/lib/elk.bundled.js`。

运行机不需要 Node.js、Python、npm 或 `node_modules`。

当前仓库没有顶层 `CMakeLists.txt`，原生启动器入口位于 `native/`，因此可以直接从 EDA 工程使用 `add_subdirectory()` 引入，也可以单独配置构建。

## 3. 单独构建

在 Linux 构建机上：

```bash
cmake -S native -B build/ngb \
  -DCMAKE_BUILD_TYPE=Release

cmake --build build/ngb --target ngb -j
```

生成文件：

```text
build/ngb/ngb
```

安装到 EDA 工具目录：

```bash
cmake --install build/ngb --prefix /opt/eda
```

安装后通常为：

```text
/opt/eda/bin/ngb
```

构建过程由 `native/cmake/embed_assets.cmake` 枚举并嵌入以下资源：

```text
index.html
styles.css
src/**/*.js
vendor/elkjs-0.11.1/lib/elk.bundled.js
```

中间文件 `embedded_assets.cpp` 位于 CMake 的构建目录，不应提交到 Git。

## 4. 命令行接口

### 4.1 启动

推荐在 EDA 集成时显式使用 `--port 0`：

```bash
ngb start \
  --netlist ./results/top_mapped.v \
  --timing ./results/top_timing.log \
  --module top \
  --focus u0 \
  --fanin-depth 1 \
  --fanout-depth 2 \
  --port 0 \
  --state-file ./results/ngb-session.json \
  --parent-death \
  --no-open
```

`--port 0` 让操作系统选择空闲端口。固定端口也可以使用，例如 `--port 4173`，但多次并行运行时更容易冲突。

启动成功后 stdout 输出一行 ready JSON：

```json
{"event":"ready","host":"127.0.0.1","port":43821,"url":"http://127.0.0.1:43821/?startup=1","startup":{"netlist":"top_mapped.v","timing":"top_timing.log","cellConfig":null,"module":"top","focus":"u0","faninDepth":1,"fanoutDepth":2}}
```

如果指定了 `--state-file`，同一会话还会生成状态文件：

```json
{
  "version": 1,
  "pid": 12345,
  "port": 43821,
  "url": "http://127.0.0.1:43821/?startup=1",
  "stateFile": "/work/results/ngb-session.json",
  "owner": "12345-..."
}
```

状态文件只有在 HTTP listener 成功绑定后才写入，并通过临时文件加 `rename` 的方式安装，避免 Tcl 读到半个 JSON。

### 4.2 关闭

```bash
ngb stop --state-file ./results/ngb-session.json
```

关闭过程：

1. 读取状态文件中的 PID；
2. 确认该 PID 仍然是带有 `start` 和对应状态文件参数的 `ngb` 进程；
3. 发送 `SIGTERM`；
4. 在有限等待时间内等待进程退出；
5. 删除状态文件。

不会根据端口号任意杀掉其他进程。这样可以避免误伤 EDA 主进程、License Server 或其他用户的 Python 服务。

如果进程确认属于当前会话但没有在正常等待时间内退出，可以显式使用：

```bash
ngb stop --state-file ./results/ngb-session.json --force
```

`--force` 只会在所有权验证成功后使用 `SIGKILL`。

### 4.3 查询状态

```bash
ngb status --state-file ./results/ngb-session.json
```

输出状态 JSON 和以下状态之一：

```text
status=running
```

或：

```text
status=stale
```

### 4.4 替换旧会话

同一个 EDA run 目录可以使用：

```bash
ngb start \
  --netlist ./results/top_mapped.v \
  --state-file ./results/ngb-session.json \
  --replace \
  --port 0 \
  --no-open
```

`--replace` 只尝试关闭状态文件验证过的旧会话。如果状态文件中的 PID 已经被其他程序复用，启动器会拒绝关闭它。

## 5. EDA Tcl 集成

建议在 EDA Tcl 中只封装两个过程：`ngb_start` 和 `ngb_stop`。

### 5.1 启动过程

下面的示例使用 Tcl 的后台 `exec`。Tcl 不选择端口，也不解析或管理 PID，只保存状态文件路径。

```tcl
set ::ngb_bin   "/opt/eda/bin/ngb"
set ::ngb_state [file normalize "./results/ngb-session.json"]
set ::ngb_log   [file normalize "./results/ngb.log"]

proc ngb_start {netlist {timing ""} {module ""} {focus ""}} {
    global ngb_bin ngb_state ngb_log ngb_pid

    set command [list \
        $ngb_bin start \
        --netlist [file normalize $netlist] \
        --port 0 \
        --state-file $ngb_state \
        --parent-death \
        --no-open \
    ]

    if {$timing ne ""} {
        lappend command --timing [file normalize $timing]
    }
    if {$module ne ""} {
        lappend command --module $module
    }
    if {$focus ne ""} {
        lappend command --focus $focus
    }

    file mkdir [file dirname $ngb_state]
    set ngb_pid [exec {*}$command > $ngb_log 2>&1 &]
    puts "Netlist Graph Builder started: PID=$ngb_pid"
    puts "Netlist Graph Builder state: $ngb_state"
}
```

典型调用：

```tcl
ngb_start \
    ./results/top_mapped.v \
    ./results/top_timing.log \
    top \
    u0
```

### 5.2 关闭过程

```tcl
proc ngb_stop {} {
    global ngb_bin ngb_state

    if {[file exists $ngb_state]} {
        catch {
            exec $ngb_bin stop --state-file $ngb_state
        } message
        if {$message ne ""} {
            puts "Netlist Graph Builder stop: $message"
        }
    }
}
```

EDA 流程结束时调用：

```tcl
ngb_stop
```

如果 Tcl shell 或 EDA 进程异常退出，Linux 启动器可以通过父进程死亡信号自动结束，作为额外的端口清理保护。正常流程仍应显式调用 `ngb_stop`。

### 5.3 远程 EDA / VS Code Remote-SSH

远程服务器上建议始终使用 `--no-open`。启动器输出的端口属于远程服务器：

```text
远程服务器: 127.0.0.1:43821
```

在 VS Code Ports 面板中转发该远程端口，例如：

```text
远端 43821 -> 本地 43822
```

然后在 VS Code Integrated Browser 中打开本地转发地址：

```text
http://127.0.0.1:43822/?startup=1
```

不能把远程端口号和本地转发端口号混用。

## 6. EDA 工程 CMake 接入

在 EDA 工程中将本项目放到 `third_party/netlistGraphBuilder`，然后：

```cmake
add_subdirectory(
    third_party/netlistGraphBuilder/native
    ${CMAKE_CURRENT_BINARY_DIR}/netlist_graph_builder)

add_dependencies(eda_tool ngb)

install(TARGETS ngb
    RUNTIME DESTINATION libexec/eda)
```

如果 EDA 工程已有统一安装目录，也可以将 `ngb` 安装到和 EDA 主程序同一个 `bin` 目录：

```cmake
install(TARGETS ngb
    RUNTIME DESTINATION bin)
```

推荐将 `ngb` 作为独立可执行文件，而不是把 HTTP server 静态链接进 EDA 主程序。这样：

- EDA 主程序和浏览器服务的生命周期隔离；
- `SIGTERM`、端口和线程不会污染 EDA 主进程；
- Tcl 只需通过 CLI 控制；
- 出现浏览器服务问题时不会拖垮 EDA。

## 7. 构建兼容性

如果需要兼容老 EDA Linux 环境，建议在目标环境或不高于目标环境的发行版上构建。常见选择：

```bash
cmake -S native -B build/ngb \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS="-O2 -static-libgcc -static-libstdc++"
```

`glibc` 不建议直接做完全静态链接。若要求二进制跨多个老发行版运行，可以使用 musl 工具链：

```bash
cmake -S native -B build/ngb \
  -DCMAKE_CXX_COMPILER=musl-g++ \
  -DCMAKE_BUILD_TYPE=Release
```

发布前检查：

```bash
ldd build/ngb/ngb
file build/ngb/ngb
```

如果出现 `GLIBCXX_x.y.z not found`，说明构建机的 libstdc++ 版本高于目标机，应改用目标机工具链或静态链接 libstdc++。

## 8. 验证清单

构建后至少验证：

```bash
./ngb --help

./ngb start \
  --netlist tests/fixtures/mapped/sop/sop_013_mapped.v \
  --port 0 \
  --state-file /tmp/ngb-smoke.json \
  --no-open
```

在另一个终端检查：

```bash
cat /tmp/ngb-smoke.json
curl --fail http://127.0.0.1:<port>/
curl --fail http://127.0.0.1:<port>/src/app/main.js
curl --fail http://127.0.0.1:<port>/vendor/elkjs-0.11.1/lib/elk.bundled.js
curl --fail http://127.0.0.1:<port>/__ngb_startup__.json
```

路径安全检查：

```bash
curl -i http://127.0.0.1:<port>/../CMakeLists.txt
curl -i http://127.0.0.1:<port>/%2e%2e/CMakeLists.txt
```

最后关闭：

```bash
./ngb stop --state-file /tmp/ngb-smoke.json
```

确认状态文件被删除，并确认端口不再监听。

## 9. 许可证和发布内容

ELK.js 已经 vendored 到仓库。单文件发布时，ELK 的许可证文本不能因为资源嵌入而丢失。建议为启动器增加 `--licenses` 输出，至少包含：

- Netlist Graph Builder 自身许可证信息；
- ELK.js 版本、来源和 EPL-2.0 文本；
- 其他未来嵌入资源的许可证。

如果发布包必须严格只有一个文件，则许可证文本应编译进二进制，并由 `ngb --licenses` 输出。
