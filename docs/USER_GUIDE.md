# Netlist Graph Builder 完整使用教程

本教程面向使用 **Netlist Graph Builder**（对应 `v1.7.1`）阅读、追踪与对比门级结构化 Verilog 网表，以及离线浏览和分析 AIG 图的工程师。为便于按主题查阅与维护，完整教程拆分为 **9 份分册**，覆盖当前版本的全部用户功能。

- **网表默认布局与降级**：默认使用 `AnchorLayered` 布局引擎；失败时按 `AnchorLayered → ELK → Simple` 顺序自动降级，临时降级不会覆盖已保存的用户首选项。
- **独立 AIG 工作区**：使用本地离线 Graphviz（Viz.js / WASM）曲线布局，支持 ABC AIG DOT 与平坦两输入组合 BLIF、同页多份 AIG 切换、`.level` 层级与裕量报告、结构重汇聚与 XOR / XNOR / MUX 识别。
- **通用源码单入口**：在仓库根目录直接执行 `./ngb`（Linux/macOS）或 `.\ngb.cmd`（Windows），无需 npm 自动探测 Node.js 18+ 或 Python 3.6+ 并原样透传参数，详见 [通用源码启动入口](UNIVERSAL_LAUNCHER.md)。
- **Linux 单文件与构建**：关于 Linux 单文件二进制 `ngb`、CMake 嵌入构建与详细 Tcl 脚本说明，另见 [Linux 单文件启动器指南](LINUX_SINGLE_FILE_LAUNCHER.md)。

---

## 教程分册目录

| 分册 | 主题与涵盖功能 |
| --- | --- |
| [1. 安装、运行与界面总览](guide/01-getting-started.md) | 软件定位与能力边界、通用单入口 `./ngb` / `.\ngb.cmd` 与四端运行方式、工作台界面分区、左右面板隐藏/恢复与调宽、窗口宽度偏好、快捷键一览 |
| [2. 导入设计、多文件合并、Liberty 库与 Cell Config](guide/02-import-and-libraries.md) | `File` 菜单（`Netlist + Timing` / `AIG + Level`）、多文件追加与 `[filename]` 消歧、拖放与全局粘贴、批量导入顺序与失败保护、Verilog 语法与结构化注释属性、Liberty（`.lib`）标准单元库、Cell Config 单元类型配置 |
| [3. 网表浏览、搜索、层次导航、Focused 与重收敛分析](guide/03-netlist-navigation-and-views.md) | 模块选择与层次树（`Hierarchy`）、双击 `hinst` 钻取、统一视图历史、顶部全局搜索、画布缩放平移与 `F` 居中、Inspector 五页签与跨父层连接、`Whole` / `Focused`（32 根）/ `Search-first` 大图流程、网表重收敛路径分析 |
| [4. 布局引擎、显示选项、不布线 Net、Adjust 与导出恢复](guide/04-layout-routing-and-adjust.md) | `AnchorLayered` / `ELK` / `Simple` 布局与降级、Wire/Cell 间距与垂直引脚转角、`Show aliases` / `Fanout hubs` / `Gate symbols` / 渐进渲染、指定 Net 不布线（`Route net`）、`Adjust` 手工校准、SVG 导出、Layout Golden v3/v4、会话恢复与持久化范围 |
| [5. Timing 时序标注与 Compare 双模块对比](guide/05-timing-and-compare.md) | NGB Timing Format v1.0（列式/CSV/JSON、Net 驱动源回溯）、全局 `Metric` 与 `Threshold`、层级作用域隔离与漏配诊断、Compare 双模块对比（`A files` / `B files` 独立导入、分屏与视口/点击/roots 同步、差异高亮、同名 Output cone、对比统计） |
| [6. Show Path 路径追踪与逻辑级数](guide/06-show-path.md) | 跨 Netlist（Single/Compare）与 AIG 的多起点/多终点路径抽取、最短/最长逻辑级数报告（`Auto starts` / `Auto ends` / `Distances` / `Object levels`）、与 `Focused` 联动裁剪、Golden v4 保存、带摘要与 Compare 单侧导出 SVG、实战复现示例 |
| [7. AIG 工作区完整指南](guide/07-aig-workspace.md) | DOT/BLIF 导入与同页多份 AIG 切换、Search-first 预筛选、`.level` 层级与裕量报告、图元与 BLIF 名称映射（`Names`）、`Logic View` / `Standard` 与连接/叠加层高亮、AIG `Focused`、重收敛与 XOR/XNOR/MUX 逻辑块识别、点相关查询、容量边界与动手练习 |
| [8. SSH 远程工作台、命令行启动器与 EDA/Tcl 集成](guide/08-remote-workbench-and-eda.md) | SSH 端口转发与 `Open from server…`、终端 REPL（`ngb>` / `pages` / `use`）、182 条命令与 5 个简写、跨进程 `cmd` 与 `--async` / `job`、命令行启动参数与 `start`/`status`/`stop`、`ready` JSON 协议、`ngb.tcl` 接口 |
| [9. Process Log、终端日志、推荐工作流与常见问题](guide/09-logging-workflows-and-faq.md) | 浏览器 `Process Log` 与 `Diagnostics`（11 Phase、脱敏、JSONL 导出）、终端磁盘日志（轮转与 14 天清理）、六套典型工程推荐工作流、网表/Timing/Compare/Golden/界面/AIG 完整常见问题排查 |

---

## 新版入口速查

| 要找的功能 | 界面入口 | 详细章节 |
| --- | --- | --- |
| 打开设计或配对导入附件 | 全局栏 `File → Open design…`（配对服务器时含 `Open from server…`） | [2.1](guide/02-import-and-libraries.md#21-从-file-菜单打开与追加文件) · [8.1](guide/08-remote-workbench-and-eda.md#81-ssh-端口转发与服务器文件选择器) |
| 追加合并网表、时序或多份 AIG | `File → Netlist + Timing → Add design/timing file(s)…`；`File → AIG + Level → Add AIG file(s)…` | [2.1](guide/02-import-and-libraries.md#21-从-file-菜单打开与追加文件) · [7.1](guide/07-aig-workspace.md#71-导入同页多份-aig-与-search-first-筛选) |
| 打开/取消 AIG 及导入 `.level` | `File → AIG + Level → Open AIG…` / `Cancel AIG import` / `Open levels…` / `Paste levels…` | [7.1](guide/07-aig-workspace.md#71-导入同页多份-aig-与-search-first-筛选) · [7.2](guide/07-aig-workspace.md#72-aig-level-层级与裕量报告) |
| 导出 SVG、保存/加载 Golden | `File → Export & snapshots`（Compare 单侧导出见 `Show Path → Path information`） | [4.6](guide/04-layout-routing-and-adjust.md#46-导出-svglayout-golden-与状态恢复) · [6.3](guide/06-show-path.md#63-与-focused-联动状态栏控制保存与导出) |
| 隐藏/恢复左右面板 | 面板标题 `‹ Hide` / `Hide ›`、上下文栏 `Navigator` / `Inspector` | [1.4](guide/01-getting-started.md#14-隐藏恢复与调整左右面板) |
| 模块层次、统计、重收敛与路径 | 左侧 `Navigator` → `Hierarchy` / `Design` / `Analysis` / `Path`（AIG 含 `Objects` / `Names`） | [3.1](guide/03-netlist-navigation-and-views.md#31-模块选择与层次树导航) · [3.6](guide/03-netlist-navigation-and-views.md#36-分析当前子图的重收敛路径) · [6.1](guide/06-show-path.md#61-打开入口与指定端点) |
| 对象连接、属性、分析、时序与调整 | 右侧 `Inspector` → `Connections` / `Attributes` / `Analysis` / `Timing` / `Adjust`（AIG 为 `Connections` / `Analysis` / `Source`） | [3.4](guide/03-netlist-navigation-and-views.md#34-inspector-五页签与跨层连接追踪) · [7.3](guide/07-aig-workspace.md#73-图元约定对象浏览与-blif-名称映射) |
| 指定某条 net 不布线 | 选中线网后 `Inspector → Connections → Net routing` 取消勾选 `Route net` | [4.4](guide/04-layout-routing-and-adjust.md#44-指定-net-不布线net-routing) |
| 显示、布局、时序、Liberty 与 Cell Config | 全局栏 `Settings` → `Display` / `Layout` / `Timing` / `Liberty` / `Cell Config`（AIG 为 `AIG overlays`） | [2.5](guide/02-import-and-libraries.md#25-liberty-标准单元库lib) · [2.6](guide/02-import-and-libraries.md#26-cell-config自定义单元类型配置) · [4.1](guide/04-layout-routing-and-adjust.md#41-布局引擎选择与自动降级) · [5.2](guide/05-timing-and-compare.md#52-全局时序显示策略) |
| 聚焦根与扇入/扇出深度 | Focused 画布上方 `Roots`、`Fanin`、`Fanout` | [3.5](guide/03-netlist-navigation-and-views.md#35-wholefocused-与大图-search-first-视图) · [7.5](guide/07-aig-workspace.md#75-aig-focused-局部逻辑) |
| Compare 配对、独立文件与同步 | Compare 画布上方 A/B 选择器、`A files` / `B files`、`Apply`、`Split`、`Sync & cone` | [5.4](guide/05-timing-and-compare.md#54-compare-双模块对比) |
| 诊断与过程日志 | 底部状态栏 `Diagnostics` / `Log` | [9.1](guide/09-logging-workflows-and-faq.md#91-浏览器-process-log-与-diagnostics) |

---

## 随包示例文件导览

仓库及 Windows 离线包的 `examples/` 目录内置以下可直接打开的示例：

- [`examples/two_equivalent_style_modules.v`](../examples/two_equivalent_style_modules.v)：基础重综合（Resyn / Flex）双模块对比示例。
- [`examples/hierarchical_escaped_compare.v`](../examples/hierarchical_escaped_compare.v) 与 [`examples/hierarchical_escaped_timing.txt`](../examples/hierarchical_escaped_timing.txt)：含转义层次化标识符的对比网表及配套标准多模块时序报告。
- [`examples/module_hierarchy_demo.v`](../examples/module_hierarchy_demo.v)：多级子模块例化与跨层次父/子边界追踪示例。
- [`examples/large_buffer_chain_1024.v`](../examples/large_buffer_chain_1024.v)：1024 级缓冲器长链大图与有界锥体示例（可通过 `node tools/generate-large-example.mjs` 确定性生成）。
- [`examples/aig_structure_demo.blif`](../examples/aig_structure_demo.blif)：组合 XOR / XNOR / MUX 结构，默认分析得到 6 对重汇聚、3 个逻辑块候选，练习步骤见 [7.8 动手练习](guide/07-aig-workspace.md#78-动手练习与最小示例)。
- [`examples/aig_mapped_names.blif`](../examples/aig_mapped_names.blif) 与 [`examples/aig_mapped_names.level`](../examples/aig_mapped_names.level)：带 `# <ID> <设计名>` 注释映射的两输入组合 BLIF 及配套 AIG Level 报告示例。

---

## 相关规范文档

- [NGB Timing Format v1.0 规范](design/timing_format_spec.md)
- [AIG Level 格式规范](design/aig_level_format_spec.md)
- [通用源码启动入口（`./ngb` / `.\ngb.cmd`）](UNIVERSAL_LAUNCHER.md)
- [Linux 单文件启动器与 Tcl 指南](LINUX_SINGLE_FILE_LAUNCHER.md)
