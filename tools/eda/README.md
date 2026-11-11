# EDA Tcl 集成辅助脚本（`tools/eda/`）

在 **Tcl 8.5+** 环境中加载 `ngb.tcl`，即可通过 `::ngb::Start binary stateFile ?option value ...?` 拉起本地网表预览服务：

- **启动与就绪等待**：`::ngb::Start` 会在后台保持非阻塞管道，最多等待 10 秒直至读取到合法的 `ready` 消息后才返回 `http://127.0.0.1:<port>/...` 访问地址；默认自动启用 `--parent-death`、`--port 0` 与 `--no-open`。
- **状态查询与关闭**：使用 `::ngb::Status binary stateFile` 查询会话状态，使用 `::ngb::Stop binary stateFile` 安全停止服务；所有底层错误均会向宿主 EDA 解释器真实抛出，绝不静默吞错。
- **诊断分流**：启动器的日志转发到宿主 `stderr`，不混入 `ready` 或状态返回值。`Status` / `Stop` 依据子进程退出状态传播失败，避免 Tcl 将成功命令的诊断输出误判为失败；终端日志文件位置见 [用户指南](../../docs/USER_GUIDE.md)。
- **零外部依赖与安全边界**：无需安装第三方 `Tcllib`，不经过 Shell 字符串拼接，也不直接强杀 Tcl 管道 PID；完整支持包含空格或中文（Unicode）字符的文件路径，并显式拦截以 Tcl 管道/重定向字符（`<`、`>`、`|`、`&`）开头的非法参数值。
- **会话防冲突**：当目标 `stateFile` 对应会话已存在时，脚本会拒绝隐式覆盖；请通过 `::ngb::Status` / `::ngb::Stop` 或原生 CLI 显式检查并关闭旧会话。

关于安装路径定制、完整参数语义与远程端口转发说明，请参阅 [Linux 单文件启动器与 EDA/Tcl 集成指南](../../docs/LINUX_SINGLE_FILE_LAUNCHER.md)。
