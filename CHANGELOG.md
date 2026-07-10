# Changelog

本项目使用语义化版本号。

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
