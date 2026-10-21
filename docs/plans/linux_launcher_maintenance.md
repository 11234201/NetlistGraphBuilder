# Linux 单文件 / CMake / EDA-Tcl 维护

日期：2026-10-21。范围：当前文档与 Linux 启动/安装集成，不修改布局算法，不恢复暂停的性能工作。
版本状态：基于 master 98ed600 开发；用户已授权提交、推送并覆盖最新发布，沿用 v1.1.2 标签和版本号，更新发布说明、Windows附件并增加Linux单文件及Tcl helper。

## 问题与解决方案

| 问题 | 处理 |
| --- | --- |
| README 中 Simple 默认、旧测试数、Linux 尚无启动器等信息过期 | 统一当前入口，历史实验保留原结论；区分 master 与发布包 |
| 原生 stop 只按命令行子串和状态 basename 认 PID | 校验 executable inode、精确路径参数、processStartTicks；拒绝伪造或复用 PID |
| 状态文件可并发覆盖、临时文件权限不明确 | 0600 独占临时文件、原子 rename、持久 inode 的独占锁 |
| 无效状态被残留 errno 误判为缺失 | 无效状态明确非零；仅实际缺失的 stop 为幂等成功 |
| JSON 只处理少数转义、格式化空白不兼容 | 支持 Unicode/代理对和键值空白，拒绝非法转义/基本类型 |
| recv 一次假设完整头、连接线程无限增长、accept 退出不可靠 | 完整头有界读取、最多32连接、超时、poll取消循环 |
| 资源清单重复、删除源文件可能不触发重新嵌入 | CMake生成单一manifest依赖，UTF-8清单支持中文/空格路径 |
| EDA父工程安装策略不易控制 | 顶层/独立入口、NGB_INSTALL及专用安装目录变量 |
| Tcl后台exec立即报告成功、stop吞错 | 可复用helper等ready、超时/提前退出报错、保留pipeline并安全stop |

## 验证门禁

- [x] Linux C++11 Release，GCC 11.4，CMake 4.2，-Wall/-Wextra/-Wpedantic 无警告构建。
- [x] CTest：help、licenses、native-integration、cmake、tcl，共5/5通过（后续最终复验结果见执行记录）。
- [x] 无项目资源目录、PATH中无Node/Python的单文件副本正常返回资源与manifest。
- [x] 原生HTTP、ready/status/stop/replace、无效输入、伪造PID、启动时间、并发锁、Unicode状态与父进程死亡清理。
- [x] CMake standalone/EDA add_subdirectory、no-op、资源增删改、中文空格路径、安装与禁用安装。
- [x] Tcl真实解释器 ready/status/stop、异常传播、中文/空格路径、拒绝管道注入。
- [x] 最终 npm test 815/815；Node/Python launcher协议通过；严格-std=c++11最终CTest 5/5。
- [x] 当前文档42个、全部项目Markdown（除vendor）114个相对链接均无缺失；8个历史绝对产物链接跳过，外部URL/锚点不在本轮校验范围。Windows启动器编译、离线smoke与许可证检查通过（本地隔离目录）。

执行环境：mfs-remote `/home/wzh/my_code/netlistGraphBuilder-linux-maintenance-20261021`。
构建、下载依赖（本轮无下载）、临时副本和测试日志留在该目录；本地仅取回小型日志。
本轮不改 parser/IR/布局/renderer 算法，因此不重复 mapped/benchmark 作为新的算法验收证据。

## 仍不宣称完成的范围

- 没有把单机通过写成完整 Linux/浏览器/发行版/架构 CI 矩阵通过。
- CMake最低3.16、C++11与Tcl8.5是实现目标；本轮实际工具版本单独记录，不能冒充老版本实测。
- 单文件仍有系统库ABI依赖；CentOS7、musl、真实商业EDA宿主与图形浏览器矩阵待目标环境验收。
- 安全边界为同用户localhost工具，不是公网或恶意同用户隔离服务；不根据端口任意kill进程。
- 本轮按用户明确授权更新现有 v1.1.2，覆盖前备份旧附件及标签；不把版本号相同解释为字节相同。

## 执行记录

2026-10-21：Linux x86-64，GCC11.4/CMake4.2/Python3.10.12/Tcl8.6.12/Node24.16.0/glibc2.35。
实际编译flags包含-std=c++11与-Wall/-Wextra/-Wpedantic，构建无警告；最终CTest总计40.64秒。
单文件副本以空PATH执行，逐字节核对全部src JS、index/styles及vendored ELK；不依赖项目资源目录。
新增原生套件包含9个生命周期/安全/HTTP测试；Tcl真实解释器和CMake安装/资源变化另设独立门禁。
现有launcher E2E最初因Linux硬编码python出现EACCES，修复为python3（NGB_PYTHON可覆盖）后通过。
Windows验证输出在dc_runs/linux_maintenance_windows_validation，正式dist/v1.1.2包未改动。
本地日志镜像在dc_runs/linux_maintenance；大型构建、中间文件和测试副本仅留在上述远端目录。
