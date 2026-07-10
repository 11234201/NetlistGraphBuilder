# Netlist Graph Builder

Netlist Graph Builder 是一个离线可用的 gate-level structural Verilog schematic browser。在没有 Liberty `.lib` 和大型 EDA 工具的环境中，它可以解析网表、推断常见 cell/pin 语义，并提供可搜索、可追踪、可调整的交互式 SVG 结构图。

当前版本：`v0.2.0`，阶段 2 实用分析能力已完成。

## 主要功能

- 解析常见 structural Verilog：module、port、wire、assign、cell instance 和 escaped identifier。
- 在没有 `.lib` 时，根据 cell/pin 命名推断 gate kind 与 pin direction；未知 cell 显示为 blackbox。
- 使用分层布局和正交 wire 渲染 SVG schematic，支持缩放、平移和 Fit。
- 搜索 module、port、net、instance 和 cell type，并定位到图中对象。
- 点击 cell、port 或 net 查看 pin/net、driver/load、fanin/fanout 和推断来源。
- 切换 Whole、Fanin Cone 和 Fanout Cone，并设置追踪深度。
- 默认折叠纯 `assign` alias；可通过 `Show aliases` 展开为明确的 `ALIAS` 节点。
- 导入 LocResyn timing 日志，显示 input AT、output AT/slack 和 critical 标记。
- 在 Adjust 模式拖动节点、调整尺寸和属性，并使用 grid/pin-y snap 辅助对齐。
- 调整 wire lane spacing、侧栏宽度，并导出 layout golden。
- 导出包含内嵌样式的独立 SVG，支持完整 module 和 cone 视图。

## 运行

需要 Node.js 18 或更高版本。项目没有外部运行依赖。

```powershell
npm start
```

然后打开 `http://127.0.0.1:4173/`。页面默认加载内置示例，也可以打开 `.v`、`.sv` 或 `.txt` 文件。

## 基本操作

1. 点击“打开网表”加载 structural Verilog，并选择 module。
2. 点击 node 或 wire，在 Selection 面板查看连接关系。
3. 选中 node 后，使用 Whole/Fanin/Fanout 和 Depth 查看逻辑 cone。
4. 使用 `Show aliases` 控制纯 net alias 是否显示。
5. 点击 Adjust 后拖动节点；点击 Golden 导出布局记录。
6. 点击 SVG 导出当前完整或 cone schematic。

## 测试

```powershell
npm test
```

测试覆盖 parser、cell/pin inference、graph extraction、layout/routing、timing annotation、搜索、对象检查、cone、alias 规范化和 SVG 导出。

## 项目结构

```text
docs/                 路线图、阶段计划、架构和设计规范
examples/             示例输入与输出
src/analysis/         cone、alias 和对象连接分析
src/app/              应用状态和浏览器入口
src/infer/            无 Liberty 的 cell/pin 推断规则
src/layout/           分层布局、节点几何、routing 和 snap
src/netlist/          Netlist IR 与 graph extraction
src/parser/           Structural Verilog tokenizer/parser
src/render/           SVG 渲染与独立 SVG 导出
src/search/           设计对象索引与搜索
src/timing/           LocResyn timing 解析与图标注
src/ui/               Selection、Timing 和 Adjust 面板
tests/fixtures/       测试网表
tests/unit/           单元测试
tools/                本地开发工具
```

## 当前限制

- 只支持 structural Verilog 常用子集，不是完整 Verilog/SystemVerilog 前端。
- 不解析 Liberty `.lib`，复杂或定制 cell 可能需要手动修正 pin direction。
- 当前使用自研简单分层布局，大型 module 的宽高平衡和性能优化属于后续阶段。
- 暂不提供 module compare、形式等价或逻辑等价分析。

详细路线图见 [docs/PLAN.md](docs/PLAN.md)，阶段 2 完成记录见 [docs/STAGE_2_PLAN.md](docs/STAGE_2_PLAN.md)。
