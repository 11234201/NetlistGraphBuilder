# SSH 工作台 R14–R24 验收记录

验收日期为 2026-11-22。实现提交为 `3e1de7f`，首版基线为 `ab0b215`。[首版验收](remote_workbench_v1_results.md) · [需求和验收标准](remote_workbench_acceptance.md) · [完整命令表](remote_workbench_commands.md)

## 代码检视后的 Windows 离线包复验

2026-11-22 01:26 至 01:36，在 Windows 上将 `NetlistGraphBuilder-v1.6.3-win-x64-r14-r24-reviewed-final.zip` 解压至新目录，以包内 EXE 和真实 Chrome 一次运行宿主、设计、导航、分析和容量五组用例。用时 10 分 22 秒，退出码为 0。将报告逐项与 ZIP 内的命令目录比对，180/180 个命令通过正例，180/180 个命令通过边界检查，缺项为 0。命令名和业务结果与同一轮检视后的 SSH npm、Linux ELF、Python 三份报告一致。

| 验收文件 | SHA-256 |
| --- | --- |
| Windows 离线 ZIP（10,666,217 字节） | `3063169e872db81dedfa7397d313c0b27505f7d8398c5a187cd88668ebcbbd69` |
| 逐命令报告 `dc_runs/r14_r24_windows_full/windows-full.json` | `70d6bfa314bf56bc4e863792c319d4ca8fe3cb8d10faf9ec3e73a26190dc80be` |

## 命令与业务结果

公共目录共 180 条命令，计划 §3.1 至 §3.8 各有 16、25、34、33、15、24、7、26 条。另有 5 个简写。完整矩阵启动实际服务和 Chromium，让独立客户端执行页面命令，验证回执、可见界面及导出文件。启停和交互退出使用各自的真实进程入口。每条命令也验证一个错误或边界；覆盖率按规范命令名去重。[机器可读目录](../../src/contracts/workbench_commands.json) · [共享矩阵](../../tests/e2e/workbench_full_acceptance.mjs)

| 真实入口 | 通过的规范命令 | 有边界断言的规范命令 | 缺项 |
| --- | ---: | ---: | ---: |
| SSH npm / Node | 180 | 180 | 0 |
| SSH Linux x86-64 ELF | 180 | 180 | 0 |
| SSH Python | 180 | 180 | 0 |
| Windows x64，解包 EXE | 180 | 180 | 0 |

四份完整矩阵均以退出码 0 结束。对照逐项结果，四种入口的导航、时序与 Cell Config、Compare、路径与结构分析、故障归属、资源计数、成功命令集和边界命令集一致。额外运行的 Windows Tcl、SSH TTY/Tcl 和浏览器回归见下文。

| 需求 | 现场观察 | 可复验的脚本 |
| --- | --- | --- |
| R14 层次与聚焦 | 同一模块的两个实例分别定位到 `u_compute_left`、`u_compute_right`。选择、父网跳转、根、侧和视口历史保留各自作用域；另一实例的旧引用被拒绝。 | [导航与画布](../../tests/e2e/remote_navigation_acceptance.mjs) |
| R15 调整与 Golden | 改动实例位置、尺寸、属性、引脚与网线路由，保存、重置并恢复。Golden 恢复相应 occurrence，指纹不匹配返回错误。 | [调整、路由与恢复](../../tests/e2e/remote_navigation_acceptance.mjs) |
| R16 时序与库 | `u_first/Y` 的 `slew 0.120` 徽标在 Inspector、画布、导出 SVG 一致。Liberty 改变 Y 的方向来源，卸载后恢复。类型定义作用于两个实例，单例覆盖只影响目标；类型实例数变为零后保存仍有 A/Y 两个引脚。 | [时序与定义](../../tests/e2e/workbench_timing_acceptance.mjs) · [冲突导入和阈值](../../tests/e2e/remote_design_acceptance.mjs) |
| R17 Compare | 修改 B 模块草稿时已显示的配对保持原值，Apply 后切换。A 的 Slack 为 +0.10，B 单独加载 −0.05，清除 B 时序覆盖后使用继承来源。可分别选择活动侧、设置同步和切换锥视图。 | [双侧工作区](../../tests/e2e/remote_design_acceptance.mjs) · [对象与视口隔离](../../tests/e2e/remote_navigation_acceptance.mjs) |
| R18 Show Path | BLIF 的 `n0 → n4` 有 2 级。Compare 两侧草稿独立，B 侧导出含该侧查询摘要；不可达终点、取消和重试得到相应状态。 | [路径和分析](../../tests/e2e/remote_analysis_acceptance.mjs) |
| R19 结构分析与 AIG | 示例有 6 对重收敛、3 个逻辑块。命令与侧栏列出相同的关联 ID。预算耗尽时可读部分结果，取消在途 Worker 后可继续分析。 | [结构、AIG 对象与面板](../../tests/e2e/remote_analysis_acceptance.mjs) |
| R20 面板、粘贴与日志 | 菜单、分页、宽度与界面一致；30 万字符草稿能展开、取消和提交。日志筛选、复制及 JSONL 导出对照同一组条目。 | [面板与草稿](../../tests/e2e/remote_analysis_acceptance.mjs) |
| R21 跨入口诊断 | Compare B 缺文件报 `ENOENT`，覆盖已有 SVG 报 `EEXIST` 且旧文件不变。损坏 BLIF 定位到第 6 行第 1 列；实际结构 Worker 的原始堆栈可读。四个异常各有一条所属日志，通过 requestId 对应页面、文档、图或侧；正文及模拟凭据未出现在诊断内。 | [失败回执与两类 JSONL](../../tests/e2e/workbench_diagnostics_acceptance.mjs) |
| R22 Python | Linux x86-64 的 Python 3.10.12 使用标准库启动。双标签等待期间可读文件、收回执、取消及停止服务，与 npm 和 ELF 对照。 | [SSH 双页现场](../../tests/e2e/remote_workbench_acceptance.mjs) · [宿主协议](../../tests/e2e/remote_workbench_protocol.mjs) |
| R23 Windows | 实际 ZIP 解压后以 EXE 启动，使用包内私有 CPython。空 PATH 下打开两个页面、导入含中文和空格的路径、切换 AIG、写出 SVG 并退出，检查浏览器请求、端口与控制通道释放。 | [离线包冒烟](../../tests/e2e/windows_remote_workbench.mjs) |
| R24 容量与交付 | 满 64 个待处理任务后，第 65 个返回 `QUEUE_FULL`。取消后可再次查询。12 次切图期间 Graphviz 活跃 Worker 峰值为 1；完整矩阵中 AIG 几何缓存峰值 4 条/47 个节点，上限 4 条/20,000 个节点。 | [容量与资源回收](../../tests/e2e/workbench_resource_acceptance.mjs) |

## 平台与离线产物

SSH 主机为 Linux 6.2.0-32-generic x86-64，使用 Node 24.16.0、npm 12.0.2、Python 3.10.12 和 Tcl 8.6。全命令矩阵使用主机上的 Chrome 146。另从 Windows 本机 Chrome 通过 SSH 端口转发，分别配对 npm、Linux ELF 和 Python 的两个标签页。A1–A6 比较模块列表、时序、同名 AIG、原子追加、切图与刷新、断开页、SVG 和 Tcl。终端与独立 CLI 还复核了 Tcl 设置的选区、Compare、Liberty、路径草稿和分析状态。实际转发端口为 npm 37440→26981、ELF 33207→21476、Python 39835→26502。三者均得到 `top/extra`、Slack +0.10 与 −0.05，后台追加触发的 Graphviz 调用为 0。

| 分发文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `NetlistGraphBuilder-v1.6.3-linux-x86_64-r14-r24.tar.gz` | 2,042,069 | `62a86855b23e5d77f76f3472ff395bfe9aca4c0620ffa0e6cbe26150e838859b` |
| `NetlistGraphBuilder-v1.6.3-win-x64-r14-r24-release.zip` | 10,657,517 | `6b74425387687b512160fca9e8795083bf4cc98ee462cecb15d0ee5dc068e68f` |

Linux 包采用项目 CMake 安装布局。包内 `bin/ngb` 与验收 ELF 的 SHA-256 均为 `11c39a31a9631f3142bdbd129bbb4339c06f56ec004f429770baced5941f6b54`；脚本安装在 `share/netlist_graph_builder/ngb.tcl`。运行 `ngb --licenses` 可查看内嵌 ELK、Graphviz、Viz.js 和 Expat 许可证。

Windows 包内 EXE 的 SHA-256 为 `c0859b1ae9fc7c3cd6eb653932ae1368e77632c6bf171279f32682e656eec9b3`。随包 CPython 为 3.14.0。空 PATH 下仍能运行 EXE，真实 Windows Tcl 8.6 使用 CP936 系统编码，逐字核对了 UTF-8 中文文件名、−0.05 Slack 和 `NGB ENOENT`。专项导出的 SVG 为 5,042 B；浏览器外部资源请求为 0，服务退出码为 0。包内源码与随包 Tcl 已逐文件核对。归档含 ELK、Graphviz、Viz.js、Expat 和 CPython 许可证。

## 同输入性能对照

在同一 SSH 主机使用 Node 24.16.0 和 Chrome 146.0.7680.164，对首版和本版交错执行各三轮冷启动。每轮两页加载相同的 BLIF 与层次网表。耗时为客户端发命令到收到业务回执的中位数，包括排队和进程调用。RSS 峰值以 50 ms 采样，Chrome 进程组 RSS 总和含共享页重复计数。[双工作区测量脚本](../../tests/e2e/workbench_resource_comparison.mjs)

| 指标 | 首版 `ab0b215` | R14–R24 |
| --- | ---: | ---: |
| 追加 AIG | 224.5 ms | 228.3 ms |
| 首次切图 / 回切 | 228.4 / 224.0 ms | 224.2 / 222.2 ms |
| 12 次往返切图的单次耗时 | 227.3 ms | 226.2 ms |
| 页 A 挂起 8 个请求时，页 B 查询 | 229.0 ms | 222.3 ms |
| 放行至全部完成 | 1242.9 ms | 1244.3 ms |
| 打开 / 追加 / 首切 / 回切的 Graphviz 调用 | 1 / 0 / 1 / 1 | 1 / 0 / 1 / 1 |
| 切图重写未变源码 | 0 次，0 B | 0 次，0 B |
| 服务 RSS 峰值 | 92,896 KiB | 93,696 KiB |
| Chrome 进程组 RSS 峰值 | 927,984 KiB | 935,488 KiB |
| 两个页面的 JS 堆峰值 | 17,946,256 B | 17,633,388 B |

## 复验入口

服务器目录使用 `/home/wzh/my_code/netlistGraphBuilder/workbench_p5_p8_Md7YMT`。在构建目录启用 `NGB_BUILD_TESTS=ON`。浏览器用例可通过 `NGB_PLAYWRIGHT_MODULE` 指向已安装的 Playwright，`NGB_CHROME_BINARY` 指向 Chrome。Windows 用 `NGB_WINDOWS_EXE` 指向解压后的 EXE。设置 `NGB_FULL_REPORT` 保存逐命令结果。Linux 的 Tcl 现场使用 `NGB_SSH_HOST`、`NGB_REMOTE_ROOT` 和 `NGB_ADAPTERS=npm,elf,python`；同时设置 `NGB_CHECK_ARCHIVE=1` 检查 v1/v2 存档、Focus、Show Path 和配额失败恢复。

```sh
npm run test:remote-full -- npm
npm run test:remote-full -- elf
npm run test:remote-full -- python
npm run test:remote-full -- windows
npm run test:remote-protocol
npm run test:remote-workbench
```

最终机器结果保存在本次工作区的 `dc_runs/ssh_workbench_r14_r24/`（三个 Linux 入口、真实转发、性能对照）和 `dc_runs/r23_windows_matrix/windows_release.json`。发行包与校验文件位于 `dist/`。这些产物使用仓库的忽略目录。

构建与核心回归包括 `npm test`（1442/1442）、架构（390 个模块，未解析依赖、分层违规、循环依赖均为 0）、文档链接、7 项 CTest（含 Tcl）、41 项公共协议测试，以及默认 `native-layered` 的 47 个完整 mapped 网表。后者 47/47 通过，违规数为 0。浏览器回归覆盖工作台、Process Log、AIG Views/Structure、Show Path、Scoped Logic 和 Liberty；另已运行大图、AIG 与工作区缓存基准。
