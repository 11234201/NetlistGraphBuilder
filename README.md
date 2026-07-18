# Netlist Graph Builder

Netlist Graph Builder 是一个离线可用的 gate-level structural Verilog schematic browser。在没有 Liberty `.lib` 和大型 EDA 工具的环境中，它可以解析网表、推断常见 cell/pin 语义，并提供可搜索、可追踪、可对比的交互式 SVG 结构图。

当前版本：`v0.4.0`。阶段 4 已完成，支持离线 ELK、大图渐进渲染、结构简化和 session 恢复。

## 主要功能

- 解析常见 structural Verilog：module、port、wire、assign、cell instance 和 escaped identifier。
- 在没有 `.lib` 时，根据 cell/pin 命名推断 gate kind 与 pin direction；未知 cell 显示为 blackbox。
- 使用分层布局和正交 wire 渲染 SVG schematic，支持缩放、平移和 Fit。
- 搜索 module、port、net、instance 和 cell type，并定位图中对象。
- 查看 cell、port、net 的 pin/net、driver/load、fanin/fanout 和推断来源。
- Selection 面板中的 net、driver/load、直接 fanin/fanout 可点击跳转，并自动选中、居中目标对象。
- 切换 Whole、Fanin Cone 和 Fanout Cone，并设置追踪深度。
- 双 module 上下或左右对比、同步交互、同名 output cone 和启发式差异高亮。
- 导入 LocResyn timing 日志并显示 timing badge 和 critical 标记。
- 支持文件选择、拖放、全局粘贴和 Paste 文本框，自动识别 Verilog、layout Golden 与 LocResyn timing 日志。
- 支持保存和载入 layout Golden，快速复用人工调整后的节点、pin 和布线布局。
- 识别层次化子 module 实例，双击实例可直接跳转到对应 module 定义。
- Adjust 模式下调整节点、属性和 pin direction，并导出 SVG 或 layout Golden。
- Simple/ELK 布局 provider 离线切换，大图渐进渲染、fanout hub、结构分组折叠和低缩放降细节。
- 同一浏览器标签页刷新后恢复网表、module、cone、搜索、provider、布局选项和 pan/zoom。

## 运行

### VS Code 一键启动（推荐）

仓库已包含 VS Code task 和 launch 配置。在本地工作区或 Remote-SSH 工作区中打开仓库后：

1. 打开 `Run and Debug`（`Ctrl+Shift+D`）。
2. 选择 `Netlist Graph Builder: Open View`。
3. 按 `F5`。

VS Code 会启动远端预览服务，并在编辑器区域的 Integrated Browser 标签页中打开网表视图。服务仅监听远端 `127.0.0.1:4173`；工作区配置会启用 VS Code 的远端浏览器代理并保留 4173 端口转发，不需要开放服务器防火墙端口。

Linux 启动器按以下顺序选择运行时：

1. 如果 `node` 可正常执行，使用 `tools/serve.mjs`；
2. 否则，如果存在 Python 3，使用无第三方依赖的 `tools/serve.py`；
3. 两者都不可用时，在 VS Code Terminal 中给出明确错误。

因此 CentOS 7 即使无法运行要求较新 glibc 的 Node.js 官方二进制，也可以通过 Python 3 启动视图。建议先检查：

```bash
python3 --version
```

如果当前 VS Code 版本没有 `editor-browser` 调试类型，可以先运行 `Terminal > Run Task > Netlist Graph Builder: Serve`，再从 `Ports` 面板转发 4173，并执行 `Browser: Open Integrated Browser` 打开 `http://127.0.0.1:4173/`。

> CentOS 7 兼容说明：[当前 VS Code Remote Development 官方基线](https://code.visualstudio.com/docs/remote/linux)要求 glibc 2.28、libstdc++ 3.4.25 和 kernel 4.18，CentOS 7 已不在正式支持范围内。如果 Remote-SSH 本身无法连接，应优先升级到 Rocky Linux、AlmaLinux 或 RHEL 8+；也可以按 [VS Code Remote FAQ](https://code.visualstudio.com/docs/remote/faq) 配置自定义 sysroot。项目提供的 Python 回退只解决预览服务运行时，不会修复 VS Code Server 自身的系统依赖。

### 命令行启动

常规开发需要 Node.js 18 或更高版本。项目没有外部运行依赖：

```bash
npm start
```

老版本 Linux 也可以直接使用 Python 3：

```bash
python3 -u tools/serve.py
```

然后打开 `http://127.0.0.1:4173/`。可以用 `HOST` 和 `PORT` 修改监听地址和端口，例如 `HOST=0.0.0.0 PORT=8080 npm start`。只有确实需要从局域网直接访问时才应监听 `0.0.0.0`；Remote-SSH 场景保持默认地址更安全。

页面默认加载内置示例。可以打开或拖入 `.v`、`.sv`、`.txt` 网表、`.json` layout Golden 和 `.log` timing 日志；鼠标不在输入框中时，也可以直接按 `Ctrl+V`，程序会自动识别剪贴板中的文件或文本。对于一小段临时网表，点击顶部 `Paste` 后粘贴文本即可立即画图。

## 快速输入与层次浏览

1. 点击“打开网表”、将文件拖到页面，或在页面上直接粘贴 Verilog 文本，均可快速载入网表。
2. `Paste` 文本框适合复制一段小型 structural Verilog 后立即查看，不需要先保存成本地文件。
3. 拖放和全局粘贴会自动区分 Verilog、layout Golden 与 LocResyn timing；同时提供多个文件时，会先载入网表，再应用与之配套的 Golden 和 timing。
4. 点击 `Save G` 保存当前 layout Golden；先载入对应网表，再点击 `Load G`，即可恢复布局。Golden 必须与目标 module 匹配。
5. 层次化网表中的子 module 实例可通过双击进入其 module 定义；使用 Module 下拉框可随时切换到其他 module。

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

1. 载入 structural Verilog，然后从 Module 下拉框选择 module。
2. 点击 node 或 wire，在 Selection 面板查看连接关系；点击其中的 net、Connected、Fanin 或 Fanout 项可快速选中并居中对应对象。选中长 net 后可拖动画布追踪到远端，平移不会取消高亮，单击空白处才会清除选择。
3. 双击子 module 实例可直接跳转到对应 module 定义。
4. 选中 node 后使用 Whole、Fanin、Fanout 和 Depth 查看逻辑 cone。
5. 使用 `Show aliases` 控制 assign alias 是否显示。
6. 点击 Adjust 后可拖动节点；使用 `Save G` 保存布局，使用 `Load G` 恢复与当前网表匹配的布局。
7. 点击 SVG 导出当前完整 module 或 cone schematic。

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

## Stage 4 大图功能

1. 顶部 `Layout` 默认使用稳定的 `Simple Layered`；`ELK Layered (Experimental)` 仅作为大图初始排布的可选实验布局。ELK 已 vendored 到仓库，运行时不联网；失败时自动回退 Simple。
2. `Fanout hubs` 默认开启：fanout 不少于 8 的同源 net 使用共享 hub，减少重复长干线。
3. `Collapse large groups` 默认开启：300 个以上 cell 的图按 50 个 cell 自动折叠为紫色虚线组。点击组可展开，`Collapse all groups` 恢复全部折叠。
4. 400 个以上可见节点/边使用分批 SVG 渲染，状态栏显示 rendering 进度。
5. 缩放低于 0.65 时自动隐藏 pin、net、metadata 和 timing 文字，放大后恢复。
6. 当前网表文本保存在浏览器 `sessionStorage`；刷新同一标签页会恢复网表和工作状态，关闭标签页后由浏览器清理。
7. ELK 模式支持混合 Adjust：ELK 生成基础布局，手动位置/尺寸覆盖只修改目标节点，相连 edge 自动进行 Manhattan 重布线；Reset 恢复 ELK 自动坐标。

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

测试覆盖 parser、cell/pin inference、graph extraction、layout/routing、timing annotation、搜索、对象检查、cone、alias、module compare、provider、结构简化、session 和 SVG 渲染。

## 项目结构

```text
docs/                 路线图、阶段计划、架构和设计规范
examples/             示例输入与输出
src/analysis/         cone、alias、对象连接和 module compare 分析
src/app/              应用状态和浏览器入口
src/infer/            无 Liberty 的 cell/pin 推断规则
src/layout/           Simple/ELK provider、节点几何、routing 和 snap
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
- Balanced/Folded 深层 DAG 布局仍是实验性遗留方向，当前大图主要通过 ELK、bounded cone 和 group collapse 浏览。
- Compare 是名称、gate kind 和图统计驱动的启发式分析，不提供形式等价或逻辑等价证明。

详细路线图见 [docs/PLAN.md](docs/PLAN.md)，阶段 4 完成记录见 [docs/STAGE_4_PLAN.md](docs/STAGE_4_PLAN.md)。
