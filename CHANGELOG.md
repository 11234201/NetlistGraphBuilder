# Changelog

本项目使用语义化版本号。

## [0.7.2] - 2026-08-16

跨平台启动协议和 Linux EDA 集成版本。

### Added

- Node、Python 和 Windows 启动器支持 `--port 0`，并在 ready JSON 中报告操作系统实际分配的端口。
- Node/Python 支持 `start`、`status`、`stop`、状态文件和 `--replace`，可由脚本管理对应预览进程。
- 增加 Linux CMake 单文件 `ngb` 启动器，将前端资源和 vendored ELK 嵌入二进制，支持 EDA/Tcl 启动、关闭和父进程退出清理。
- 增加 [Linux 单文件启动器与 EDA/CMake 集成文档](docs/LINUX_SINGLE_FILE_LAUNCHER.md)。

### Changed

- Node 启动命令作为跨入口启动协议的参考实现；Python 和 Linux `ngb` 保持独立运行并兼容同一端口、manifest、ready 和状态文件约定。

## [0.7.1] - 2026-08-08

大图 viewport 交互修复版本。

### Fixed

- 修复超宽或超高图受固定缩放上限影响，无法把目标 cell 放大到可读尺寸的问题。
- `Focus selected cell` 现在将目标 cell 稳定居中并放大到约 320px。
- 最大缩放按画布尺寸动态计算，并限制为典型 cell 在屏幕中约两倍布局尺寸。
- 自动布局增加顶部编辑留白，最上层 cell 和 port 可以继续向上调整。
- 修复最大缩放下拖动画布只轻微移动的问题，Single 和 Compare 均按 SVG 实际等比例尺度平移。

## [0.7.0] - 2026-08-08

Focused 浏览与布局可读性改进版本。

### Added

- 增加 `Set selected as Focused`，可将图中选中的 cell 切换为新的 Focused root。
- 扩大 Wire spacing 至 `4–96 px`、Cell spacing 至 `4–320 px`，让最小值与最大值具有明显差异。

### Changed

- 将旧 Fanin/Fanout 视图收敛到 Focused，并让 fanin/fanout depth 独立控制实际局部图深度。
- Cell spacing 同时作用于 cell、输入端口和输出端口。
- MUX 的 `S`、`S0/S1`、`SEL/SELECT` 选择端改为左侧输入，减少顶部绕线。

## [0.6.0] - 2026-08-07

阶段 6 时序、搜索优先大图分析和 EDA 集成版本。

### Added

- 支持 Global/Local module boundary timing 表格、`rat` 别名、Apply 信息和表头驱动的未来扩展列，同时兼容旧 LocResyn 格式。
- 增加全图 Timing snapshot/metric 策略，统一 Single、Compare、module boundary port 和 SVG 的时序展示。
- 增加 Focused 双向局部视图、独立 fanin/fanout depth、大图 Search-first 入口和所选 cell 一键定位。
- 增加 module 前进/后退历史，恢复 module、局部视图、selection 和 viewport。
- 增加可持久化、可导入导出的 Cell Config，并支持 EDA 启动时载入。
- 增加可过滤、复制和导出的 Process Log，以及 Node、Python、Windows 共用的 EDA 启动参数和 JSON ready 协议。
- 增加 679 行完整用户教程，覆盖全部界面功能、输入格式、推荐工作流和故障排查，并随 Windows 发布包提供。

### Changed

- 搜索移动到顶部工具栏；窄窗口使用顶栏第二行整宽搜索，结果以浮层显示。
- 顶部操作收敛为 Import、Module/history、Search、Compare、Fit 和 More；Layout/Timing 设置进入侧栏。
- 新增 Cell spacing，并将 cell 间距与 wire lane spacing 分开控制。
- Cell Config 编辑器优先显示内置规则已经推断出的 gate kind 和 pin direction，修改一项不再把其他项重置为 BLACKBOX/unknown。
- 大 module 保存 Cell Config 后保留所选 cell 的 Focused 局部图，避免重新布局整张图。

### Fixed

- 修复 Process Log 打开后无法收起的问题。
- 修复 Import/More 菜单必须再次点击标题才能关闭的问题；现在点击空白处或按 Escape 即可关闭。
- 修复无回车或 scope 紧邻 snapshot 的 timing 表头解析，并保留以后新增的 metric 列。
- 修复大图修改 cell 定义后可能长时间卡死的问题。

## [0.5.0] - 2026-07-20

轻量输入、层次浏览和布局稳定性版本。

### Added

- 支持 Paste 文本输入、文件拖放和页面全局粘贴，自动识别 Verilog、layout Golden 与 LocResyn timing。
- 支持载入 layout Golden，并保存/恢复节点、pin 和 edge route 调整结果。
- 支持双击子 module 实例跳转到对应 module 定义，并推断层次 module pin 的输入输出方向。
- 支持多位 port/net 连接及 `[0:0]` 等位选择表达式。
- Selection 面板的 net、driver/load 和直接 fanin/fanout 可点击跳转并自动居中。
- Windows 原生轻量启动器和可复现的 ZIP Release 构建流程，无需终端用户安装 Node.js。

### Changed

- 优化 3000+ 行门级网表的解析、布局和渐进渲染性能。
- 将 Simple Layered 拆分为稳定的 placement、routing、validation、scoring 和 workspace 管线。
- 单输出 net 优先使用紧凑直连/局部折线，多输出 net 为共享布线保留空间并稳定主干顺序。
- Adjust 拖动期间复用布局缓存、合并渲染帧并只重布受影响的 edge。
- 正交路由、wire label、碰撞索引、route metadata 和 Golden route 比较改为共享基础设施。

### Fixed

- 修复 MUX select pin、子 module pin 和多位 output 连接遗漏或方向错误的问题。
- 修复 net 非法绕到全图顶部、穿过 cell、重叠、label 覆盖和点击命中矩形过大的问题。
- 修复 input 多 fanout/单 fanout 位置不合理及 net 交叉、远距离乱飞问题。
- 修复空白画布点击后无法缩放、拖动画布取消 net 高亮的问题。
- 修复布局顺序、wire bridge 和 Adjust route reservation 不稳定导致的旧问题回归。

## [0.4.0] - 2026-07-11

阶段 4 大图和工程化版本。

### Added

- LayoutProvider registry、Simple fallback 和离线 vendored `elkjs@0.11.1` ELK Layered provider。
- 顶部 provider 切换、异步布局进度和 ELK 失败自动回退。
- 400+ 可见对象的渐进式 SVG 批量渲染。
- 高 fanout net hub 简化和 300+ cell 自动 group collapse；支持点击展开与一键重新折叠。
- 低缩放自动隐藏文字/pin 细节及超宽图自适应缩放。
- 基于 `sessionStorage` 的网表、module、cone、搜索、provider、选项和视图变换恢复。
- 1024-cell 大图、hierarchical compare/timing examples 及对应 smoke tests。

### Changed

- Compare graph 构建从 `main.js` 拆入独立 workspace，并与 Single View 共用 provider 和 timing annotation。
- 大图默认启用 fanout hub 与 group collapse，优先提供可浏览概览。

### Fixed

- 修复 1024-cell 深链受固定 `4×` 上限影响无法看到 cell 的问题。
- 修复 Compare 模式导入 timing 后左右 cell 不显示 timing badge 的问题。
- 修复 ELK 模式下 Adjust 位置被下一次自动布局覆盖的问题；手动 override 现在保留 ELK 基础坐标并独立重布线。

## [0.3.0] - 2026-07-11

阶段 3 module compare 版本。

### Added

- 双 module Compare View，支持自动推荐 `_Flex`、`_orig`、`_new` 配对及手动选择左右 module。
- 默认上下、可切换左右的双 schematic 布局，以及同步/独立 pan、zoom 和 Fit Both。
- 同名且同方向 port 对齐、同名 net 和同类 gate kind 高亮、unmatched 结构差异候选标记。
- Cell count、gate kind count、logic depth 粗估、max fanout 和两侧差值统计。
- 两侧共有 output 的同步 fanin cone 对比和 cone 统计。
- Compare View 的跨侧对象选择、聚焦和 Single View 返回入口。

### Changed

- README 增加完整 Single/Compare 使用方法及结构差异高亮的预期与算法边界。
- Compare 默认使用 Top/Bottom 布局；进入后顶部按钮切换为 `Single`，再次点击直接退出。

### Fixed

- 修复 escaped hierarchical port（例如 `\u_dp_add_0/out0_33`）因安全节点 ID 与原始名称不同而产生空 output cone 的问题。
- Escaped port/cell 的对齐、高亮、跨侧选择和聚焦改为基于 graph reference 查找。

## [0.2.0] - 2026-07-11

阶段 2 实用分析能力版本。

### Added

- 设计级搜索与对象定位，cell/net 连接详情和 fanin/fanout 分析。
- Whole、Fanin Cone、Fanout Cone 视图与 depth 控制。
- Assign/Alias 规范化和 `Show aliases` 开关；alias 默认折叠。
- LocResyn timing 导入、可配置 badge 和 critical 标记。
- Adjust 布局校准、节点拖动、尺寸/属性修改、snap 和 golden 导出。
- 局部优先 wire routing、pin 附近 net label、wire spacing 和 crossing bridge。
- Cell type、instance、output net 和 fanout 紧凑元信息。
- 独立 SVG 导出，支持完整 module 和 cone 视图。
- 可拖动调整宽度的左侧详情栏。

### Changed

- Unknown cell 使用 libcell 功能前缀显示，不再统一只显示 BlackBox。
- Timing badge 可见时隐藏 cell 底部紧凑元信息，避免文字重叠。
- Wire 使用更宽的透明命中区域，改善 net 选择体验。

### Fixed

- 修复 pointer capture 导致 wire、node 和 Adjust 模式点击无响应的问题。
- 修复长 input 名称重叠、局部 input 过密、多输出布线和异常顶部绕线问题。

## [0.1.0]

- 阶段 1 原型：structural Verilog parser、cell/pin 推断、graph extraction、简单布局和 SVG schematic。
