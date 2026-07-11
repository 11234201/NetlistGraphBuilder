# Netlist Graph Builder

Netlist Graph Builder 是一个离线可用的 gate-level structural Verilog schematic browser。在没有 Liberty `.lib` 和大型 EDA 工具的环境中，它可以解析网表、推断常见 cell/pin 语义，并提供可搜索、可追踪、可对比的交互式 SVG 结构图。

当前版本：`v0.3.0`。阶段 3 已完成，支持 single module 分析和双 module compare。

## 主要功能

- 解析常见 structural Verilog：module、port、wire、assign、cell instance 和 escaped identifier。
- 在没有 `.lib` 时，根据 cell/pin 命名推断 gate kind 与 pin direction；未知 cell 显示为 blackbox。
- 使用分层布局和正交 wire 渲染 SVG schematic，支持缩放、平移和 Fit。
- 搜索 module、port、net、instance 和 cell type，并定位图中对象。
- 查看 cell、port、net 的 pin/net、driver/load、fanin/fanout 和推断来源。
- 切换 Whole、Fanin Cone 和 Fanout Cone，并设置追踪深度。
- 双 module 上下或左右对比、同步交互、同名 output cone 和启发式差异高亮。
- 导入 LocResyn timing 日志并显示 timing badge 和 critical 标记。
- Adjust 模式下调整节点、属性和 pin direction，并导出 SVG 或 layout golden。

## 运行

需要 Node.js 18 或更高版本。项目没有外部运行依赖。

```powershell
npm start
```

然后打开 `http://127.0.0.1:4173/`。页面默认加载内置示例，也可以打开 `.v`、`.sv` 或 `.txt` 文件。

## 示例文件

- `examples/two_equivalent_style_modules.v`：基础 resyn/Flex 双 module compare 示例。
- `examples/hierarchical_escaped_compare.v`：包含 escaped hierarchical module、port、net 和 Flex 配对的真实结构示例。
- `examples/hierarchical_escaped_timing.txt`：与 hierarchical compare 示例配套的 LocResyn timing 数据。
- `examples/large_buffer_chain_1024.v`：Stage 4 千级 cell 大图和 bounded cone smoke 示例。

大图文件由以下命令确定性生成：

```powershell
node tools/generate-large-example.mjs
```

`large_buffer_chain_1024.v` 是 1024 级严格串行链，Fit Whole 时会呈现为一条很细的全局概览。滚轮放大会根据画布宽度自动提高最大倍率；也可以搜索 `u_buf_512` 等 instance，视图会直接居中并放大到可读的 cell 尺寸。实际分析建议优先从 output 打开 bounded fanin cone。

## Single View 使用方法

1. 点击“打开网表”加载 structural Verilog，然后从 Module 下拉框选择 module。
2. 点击 node 或 wire，在 Selection 面板查看连接关系。
3. 选中 node 后使用 Whole、Fanin、Fanout 和 Depth 查看逻辑 cone。
4. 使用 `Show aliases` 控制 assign alias 是否显示。
5. 点击 Adjust 后可拖动节点；点击 Golden 保存布局记录。
6. 点击 SVG 导出当前完整 module 或 cone schematic。

## Compare View 使用方法

1. 加载至少包含两个 module 的网表，在 Single View 中先选中作为左侧基准的 module。
2. 点击顶部 `Compare` 进入对比模式。系统会优先推荐同名前缀及 `_Flex`、`_orig`、`_new` 后缀的配对 module。
3. 在 Module Compare 面板选择 Left 和 Right，然后点击 `Apply` 应用新的组合。
4. 进入后顶部按钮会显示为 `Single`；点击它或面板中的 `Single` 均可退出对比模式，不会执行 Fit。
5. Layout 默认为 `Top / Bottom`（上下）；可切换为 `Left / Right`（左右）。切换布局后两侧视图会自动 Fit。
6. `Sync pan / zoom` 默认开启：在任一视图缩放或平移时，另一侧使用相同变换。关闭后可单独操作两侧。
7. 点击 `Fit` 会同时重置两侧视图。
8. 点击任一侧的同名 port、net 或 cell，会在两侧高亮对应对象；port/cell 会自动居中聚焦。
9. 在 `Output cone` 中选择两侧共有的 output，例如内置示例的 `sco_891`，即可同时显示两侧 fanin cone。Depth 控制 cone 深度，选择 `Whole module` 返回整图。
10. Design 面板显示两侧 cell count、gate kind count、logic depth 粗估、max fanout、差值和 unmatched 数量。

## 结构差异高亮

Compare View 使用启发式结构对比，不进行逻辑等价或形式等价证明。

- 绿色实线表示两侧可建立基础对应关系：同名且方向一致的 port、同名 net，或两侧都存在的 gate kind。
- 红色虚线表示当前仅在一侧存在或无法建立上述对应关系的对象：unmatched port/net，以及 gate kind 只在一侧出现的 cell。
- 点击对象产生的橙色高亮表示当前选择，与绿色/红色的结构分类含义不同。
- port 对齐以规范化名称和方向为依据；net 对比以名称为依据；cell 目前只比较推断出的 gate kind，不自动匹配内部 instance 或拓扑子图。
- logic depth 根据图中最长 cell 路径粗估；max fanout 根据单个图节点的最大出边数计算。
- 因此红色代表“需要关注的结构差异候选”，不代表电路一定不等价；绿色也不代表对象在逻辑或拓扑上完全等价。

## 测试

```powershell
npm test
```

测试覆盖 parser、cell/pin inference、graph extraction、layout/routing、timing annotation、搜索、对象检查、cone、alias、module compare 和 SVG 渲染。

## 项目结构

```text
docs/                 路线图、阶段计划、架构和设计规范
examples/             示例输入与输出
src/analysis/         cone、alias、对象连接和 module compare 分析
src/app/              应用状态和浏览器入口
src/infer/            无 Liberty 的 cell/pin 推断规则
src/layout/           分层布局、节点几何、routing 和 snap
src/netlist/          Netlist IR 与 graph extraction
src/parser/           Structural Verilog tokenizer/parser
src/render/           SVG 渲染与独立 SVG 导出
src/search/           设计对象索引与搜索
src/timing/           LocResyn timing 解析与图标注
src/ui/               Selection、Timing 和 Adjust 面板
tests/fixtures/       小型测试网表
tests/unit/           单元测试
tools/                本地开发工具与大图示例生成器
```

## 当前限制

- 只支持 structural Verilog 常用子集，不是完整 Verilog/SystemVerilog 前端。
- 不解析 Liberty `.lib`，复杂或定制 cell 可能需要手动修正 pin direction。
- 当前使用简单分层布局，大型 module 的布局和性能优化属于后续阶段。
- Compare 是名称、gate kind 和图统计驱动的启发式分析，不提供形式等价或逻辑等价证明。

详细路线图见 [docs/PLAN.md](docs/PLAN.md)，阶段 3 完成记录见 [docs/STAGE_3_PLAN.md](docs/STAGE_3_PLAN.md)。
