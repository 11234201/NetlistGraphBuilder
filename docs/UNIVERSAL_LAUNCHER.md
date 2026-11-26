# 通用源码启动入口

在仓库根目录启动，不需要 npm，也不需要安装第三方包：

```bash
./ngb --no-open --port 4173
```

Windows PowerShell 或命令提示符使用：

```powershell
.\ngb.cmd --no-open --port 4173
```

Linux 入口使用系统 Bash。入口先实际执行探测 Node.js 18+；不可用时寻找 Python 3.6+ 并验证所需标准库可加载。Linux 顺序为 `node`、`python3`、`python`；Windows 顺序为 `node.exe`、`py.exe -3`、`python3.exe`、`python.exe`。它不会安装运行时、调用 npm，或自动运行仓库里的旧原生构建。

已有 `tools/start-preview.sh` 转发到新入口；直接调用 `node tools/serve.mjs`、`python3 -u tools/serve.py` 仍然有效。Linux 单文件二进制 `ngb` 与 Windows 离线包 `NetlistGraphBuilder.exe` 继续使用各自的内置运行时与资源，详情见 [Linux 启动器指南](LINUX_SINGLE_FILE_LAUNCHER.md) 和 [使用教程](USER_GUIDE.md)。

## 参数与工作目录

统一入口原样传递 `start`（默认）、`status`、`stop`、`cmd` 及既有参数；不需要 npm 的 `--` 分隔符。网表、时序、配置、状态文件和 `--browse-root` 等相对路径都相对于**调用时的工作目录**。即使通过绝对路径或符号链接调用入口，也不会切换到仓库目录。

```bash
/path/to/checkout/ngb start --netlist ./results/top.v --port 0 \
  --state-file ./results/ngb.state --no-open --no-interactive
/path/to/checkout/ngb status --state-file ./results/ngb.state
/path/to/checkout/ngb cmd --state-file ./results/ngb.state pages --json
/path/to/checkout/ngb stop --state-file ./results/ngb.state
```

标准输入、交互终端、ready JSON、命令回执和后端退出码保持不变。POSIX 使用 `exec`，状态文件中的 PID 即入口 PID；Windows 保留命令提示符的原生子进程调用。`--parent-death` 在 Windows 额外识别临时 `cmd /c` 和 `py -3` 包装，监控真正调用者；识别失败会在监听端口或替换旧会话之前退出，并记录 `parent.watch_failed`。

## 固定运行时与诊断

默认 `NGB_RUNTIME=auto`。自动化脚本可为一组会话命令固定运行时：

```bash
export NGB_RUNTIME=python
./ngb start --state-file ./ngb.state --no-open
```

```powershell
$env:NGB_RUNTIME = 'python'
.\ngb.cmd start --state-file .\ngb.state --no-open
```

可选值为 `auto`、`node`、`python`（不区分大小写）。显式指定的运行时不可用时会失败，不会改选其他类型。探测选定运行时后，任何参数错误、端口冲突或命令失败均直接返回原错误；不会再次启动另一套服务。无兼容运行时退出 `1`，非法 `NGB_RUNTIME` 退出 `2`。

运行时选择和 bootstrap 失败只写标准错误与已有 `NGB_LOG_DIR` 日志目录中的 JSONL，不污染标准输出，不记录用户参数或源文件。日志目录不可写时仍输出标准错误并保留原退出码。

在运行中的会话生命周期内保持同一运行时；若后来安装、卸载或更改 PATH，请为 `status`、`cmd`、`stop`、`--replace` 指定原来的 `NGB_RUNTIME`。不同后端在 Windows 的控制通道、强制停止认证及启动语义预校验有所不同。入口不会根据状态文件猜测后端、绕过所有权检查或跨后端重试失败命令。

## 验证入口

`npm run test:launcher:universal` 验证运行时探测、参数/标准输入/工作目录、失败不回退、JSONL、真实 Node/Python 会话和父进程退出。Windows 还验证 PowerShell、`cmd /c`、Tcl 三类调用者；Tcl 场景使用测试 Python 安装附带的 `tkinter`，不是产品运行时依赖。`npm run test:launcher` 保留原后端契约测试。
