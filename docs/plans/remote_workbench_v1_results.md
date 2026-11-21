# SSH 工作台首版验收记录

2026-11-21，R01–R13 通过。两轮分别从 SSH TTY 运行 `npm start` 和独立部署的 Linux ELF，用本机 Chrome 经 SSH 本地转发操作服务器上创建的文件。同一套浏览器断言和 Tcl 脚本完成 A1–A5，A6 比较两轮业务结果。

## 测试环境

| 项目 | 实测值 |
| --- | --- |
| 源码 | 基于 `2d4baa5919e314fac7917d4c09f60d64b383b1e6` 的工作区首版改动 |
| SSH 环境 | `mfs-remote`，Linux 6.2.0-32-generic x86_64，Node 24.16.0，npm 12.0.2，Tcl 8.6.12，GCC 11.4.0 |
| 浏览器 | Windows 本机 Chrome 157.0.8103.51，另用服务器 Chrome 146.0.7680.164 跑工作台回归 |
| 现场转发端口 | npm 本机 38714 → 服务器 28262，ELF 本机 37885 → 服务器 22165 |
| ELF | `/home/wzh/my_code/netlistGraphBuilder/remote_workbench_RS1Mfm/build/native/ngb`，SHA-256 `ba8485646fc9a75624712b81163da738b5ae35d247333a41c06ba072865242d7` |
| 部署验证 | 现场用例将 ELF 单独复制到服务器临时部署目录。服务和独立 ELF 客户端均在 `PATH=/nonexistent` 下运行。浏览器和 Tcl 测试驱动在各自正常环境中运行。编译需要 C++17。 |

## A1–A6 现场结果

| 步骤 | npm | ELF | 独立核验 |
| --- | --- | --- | --- |
| A1　连接和选页 | 通过 | 通过 | 两个页面分别得到 p1、p2。复制会话得到 p3。多页未指定目标返回 `PAGE_REQUIRED`。启动终端执行 `pages` 后仍可输入，按 Tab 将目录补全为 `base/`。 |
| A2　网表与时序追加 | 通过 | 通过 | 网页选择 top 和 T1，REPL 追加 extra，Tcl 从带中文及空格的路径追加 T2。模块为 top、extra，top 的 a、y 两点 Slack 分别为 +0.10、−0.05。另一页的来源、选区和视口保持原值。 |
| A3　同名 AIG | 通过 | 通过 | 同页两张 `top.blif` 的指纹分别为 `fnv1a32:9762662d`、`fnv1a32:1d698e3e`。追加后 base 仍活动，后台 Graphviz 新调用为 0。同名切换返回两个候选；按 ID 切换后分别查到 n4 和 z_eco。首次切图布局失败可重试。 |
| A4　原子追加和重试 | 通过 | 通过 | 合法 DOT 和损坏 BLIF 同批提交时分别为 `uncommitted`、`failed`，仍有 2 图。单独提交 DOT，模拟输入传输和最终回执各丢失一次，随后重发相同 request ID，只得到一个新增图，最终共 3 图。相同 ID 异参返回 `REQUEST_CONFLICT`。 |
| A5　刷新与关闭 | 通过 | 通过 | 两图分别恢复 n1、n2 的选区及各自缩放和平移。关闭 AIG 页后继续追加返回 `PAGE_UNAVAILABLE`，网表页仍保留两模块和两条 Slack；显式重新打开 extra 后只剩 extra。 |
| A6　双启动器对照 | 通过 | 通过 | 同一比较程序按页和图的实际角色核对模块集、Slack、图来源、选区归属、最终图数和错误分类。 |

## R01–R13 需求证据

| 需求 | 通过依据 |
| --- | --- |
| R01 命令契约 | 逐组核对计划中的 180 个唯一命令、5 个简写和目标、参数、能力、完成点。首版目录标记 41 个启用项（含启动器入口）。不兼容协议和错误参数均在读文件前失败，无页面提交。 |
| R02、R06 启动与生命周期 | 两类 TTY 和独立 CLI 的现场流程均可用。显式和自动生成的 state 均能识别自己的进程；停止一个服务后，其端口、控制套接字和 state 已释放，旁边的服务仍可调用。 |
| R03 页面身份与隔离 | A1、A2、A5 实测新页、复制、刷新和关闭，终端默认页与独立客户端显式目标可交替使用。 |
| R04 请求队列与回执 | 受控读取、页面接收和提交许可三个阶段验证取消。取消后未执行；丢失终态回执且页面离线时查询为 `unknown`。跨页读取请求结果被拒绝。A4 另测网络丢包后仍只执行一次。 |
| R05 网表和时序 | A2、A5 校验打开、追加、重新打开及隔离；Tcl 制造不存在的时序文件，收到 `NGB ENOENT` 后原有模块和两条 Slack 仍可查询。 |
| R07 Tcl | 同一 Tcl 脚本分别调用 `Connect` 和 `Cmd`，断言目标页、提交状态、错误码。既有 `Start/Status/Stop` 测试通过。 |
| R08 AIG 原子追加 | A3、A4 断言活动图不变、后台布局增量为 0、坏批次零新增和幂等重试。 |
| R09 AIG 切图 | 同名查询、图选择器、稳定 ID、首次布局失败后重试均有断言。补验在 base 设置 Focused root n1，在 eco 设置 Show Path，两图经刷新、切换后各自恢复。 |
| R10 持久化与回收 | 两宿主的浏览器均能将旧 v1、v2 存档恢复为单图；提交缩放时未变源码重写 0 次。模拟配额不足后 4 张图在内存可操作，Process Log 记录 `aig.workspace.save.failed`，刷新未恢复已淘汰集合。 |
| R11 根目录与补全 | 两个浏览根验证进出目录、过滤和分页；Tab 只枚举当前层。根外、无权读取及其他页面的文件句柄均被拒绝，无源码泄漏。 |
| R12 文件选择器 | 页面按动作打开/追加服务器文件，取消后立即重开可以重新选择；混合批次得到 top 成功、broken 失败、T1 成功的逐文件回执；原有本机输入、拖放、粘贴和 Compare 回归通过。 |
| R13 SVG 导出 | 从同一网表生成的服务器 SVG 和浏览器下载均含 `u_buf`，两份均为 5,236 字节，SHA-256 均为 `8b45463940764b806611c351960118b33924b68931336c48c92e63f9ace0ab29`。默认拒绝同名覆盖。对两宿主用内核文件限额触发写到一半的 `EFBIG`，原文件逐字节相同，临时文件已回收。 |

## 回归与复现

- SSH 上 `npm test` 通过 1,423 项，`npm run test:remote-protocol` 通过 12 项，Linux CTest 通过 6 项。
- 架构检查覆盖 374 个模块、913 条依赖，未解析依赖、层级违规、循环依赖均为 0。全图 mapped 回归使用 `native-layered`，47/47 通过，违规为 0。
- 另跑了启动器、工作台、AIG、结构分析、Show Path、Liberty 和 Process Log 浏览器回归。Show Path 的旧脚本在原始基线上也会等待隐藏的导航面板而超时。此次修正了测试顺序：刷新后先断言查询已恢复，再打开对应页签核对可见面板。完整 Show Path 用例通过。
- Windows 离线包已在本机构建并校验资源，本轮命令兼容性验收覆盖 npm 与 Linux ELF。原计划的 Windows EXE 和 Python 命令兼容性分别属于 R23 和 R22。
- 服务器端在构建目录开启 `NGB_BUILD_TESTS=ON`，运行 `npm run test:remote-protocol` 和 `ctest --test-dir build --output-on-failure`。现场脚本从装有浏览器的机器运行，设置 `NGB_SSH_HOST`、`NGB_REMOTE_ROOT`、`NGB_PLAYWRIGHT_MODULE`、`NGB_CHROME_BINARY` 和 `NGB_ACCEPTANCE_REPORT` 后执行 `npm run test:remote-workbench`。设置 `NGB_CHECK_ARCHIVE=only` 可单独重复每图状态和存档补验。

本轮现场 JSON 和回归日志保存在本地 `dc_runs/ssh_workbench_r13_acceptance/`；服务器构建与完整日志保存在上表 ELF 所在 checkout。验收脚本和输入生成器位于仓库内。[现场验收脚本](../../tests/e2e/remote_workbench_acceptance.mjs) · [协议测试](../../tests/e2e/remote_workbench_protocol.mjs) · [存档补验](../../tests/e2e/remote_workbench_views.mjs)

## 代码复查后的复验

2026-11-21，在 `mfs-remote:/home/wzh/my_code/netlistGraphBuilder/workbench_review_0xOhJl` 独立构建并复验。最终 ELF 为该目录下的 `build/native/ngb`，SHA-256 为 `d452510e30a86bf34bb40945d19b73588752fc8fc00bd8953b3b810d91a3e06b`。

| 检查 | 结果 |
| --- | --- |
| 本机 Chrome 经 SSH 转发访问 npm 和独立 ELF | 两轮 A1–A5 和 A6 对照通过。两页独立，网表均得到 top、extra 和 Slack +0.10、−0.05。两份同名 AIG 的 ID 不同，后台追加新图的 Graphviz 调用数为 0。有效追加即使丢失首次回执也只增加一张图 |
| 刷新、切图与历史存档 | 两种启动器均恢复各图选区、视口、Focused roots 和 Show Path。选择器中选好文件后切图，提交被拒绝，日志可查到原图。缩放引起的源码重写数为 0 |
| 命令与宿主 | 单元测试 1,429/1,429，双宿主协议 26/26，Linux CTest 7/7。覆盖原页离线后取回执、CLI 等待超时后查询同一任务、读取途中截短或等长重写、慢盘取消、导出失败和重复 ACK |
| 工程回归 | 全图 mapped 用例 47/47，`native-layered` 报告 0 个违规。架构检查 374 个模块、913 条依赖，违规与循环均为 0。Windows 启动器回归和离线包启动冒烟通过 |

本地 `dc_runs/ssh_workbench_code_review/acceptance_final.json` 保存两轮现场回执。同目录有协议、CTest 和 mapped 日志，完整单元测试输出位于上述 SSH 目录的 `unit.log`。
