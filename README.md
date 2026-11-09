# Netlist Graph Builder

Linux 单文件启动器、CMake 构建及 EDA/Tcl 集成说明见 [LINUX_SINGLE_FILE_LAUNCHER.md](docs/LINUX_SINGLE_FILE_LAUNCHER.md)。

**Netlist Graph Builder** 是一个离线可用的门级结构化 Verilog 原理图浏览器（Gate-level Structural Verilog Schematic Browser）。在缺乏 Liberty（`.lib`）时序库与大型商业 EDA 工具的环境中，它能够直接解析网表、自动推断常见标准单元（cell）与引脚（pin）语义，并生成支持搜索、路径追踪与双模块对比的交互式 SVG 结构图。

- **当前版本**：`v1.2.0`（全量单元测试 913/913 通过，47/47 映射网表严格门禁通过）。
- **默认布局引擎**：默认使用 `Native Layered AnchorLayered`（物理锚点分层布局）；若布局失败，会依次自动降级至 `ELK`、`Simple`，若 `Simple` 仍失败则停止重试。自动降级不会覆盖用户保存的首选项；缺少首选项版本号的旧 `Simple` 会话会一次性迁移回 `AnchorLayered`，此后用户主动选择的 `Simple` 或 `ELK` 仍会正常保留。生产级 AIG 导入功能尚未开放。
- **零构建离线调用**：`AnchorLayered` 布局引擎可在克隆仓库后直接离线 `import` 调用，无需构建或安装步骤，详见 [AnchorLayered 静态包契约](docs/design/elk_anchor_package.md)。关于开发历程、失败试验、验收结论与已知限制，请参阅 [AnchorLayered 开发总结](docs/reports/anchor_development_summary.md)。
- **验证记录说明**：验证结论需严格区分代码版本与运行环境：`v1.1.1` 在 Linux 环境下全图回归曾为 46/47（`DP020` 超过 45 秒门限）；2026-10-16 修复后的源码在 Linux（Node 24.16.0）下达到 47/47 通过、硬违规数为 0，`v1.2.0` 完整单元测试 913/913 通过、47/47 映射网表严格门禁通过。后续通过记录不撤销历史超时记录，亦不承诺跨机器环境的性能绝对恒定。视觉验收仅限于已评审语料，不代表任意拓扑均与 ELK 视觉等价。旧版 Native 算法仅归档于测试参考目录，不进入离线运行时。

完整功能介绍、操作流程、数据格式示例与故障排查请阅读 [完整使用教程](docs/USER_GUIDE.md)（Windows 发布包根目录亦随附 `USER_GUIDE.md`）。

## 近期核心功能演进

| 能力领域 | 入口位置 | 当前行为说明 |
| --- | --- | --- |
| **标准 STA 时序与 Metric 过滤** | 左侧 Timing 面板、Selection 面板与全局输入 | 全面支持工业级标准 STA 表格与 JSON 格式导入，驱动源自动沿 assign 链回溯；侧边栏提供 `Worst Slack`、`AT`、`RT`、`Delay`、`Slew`、`All` 与 `None` 模式；支持自定义 Slack 违例判定阈值（Threshold，默认 0.0）；内置验证时序默认联动呈现负 Slack 违例关键路径。 |
| **Cell / Net 多根节点聚焦** | 顶部 Search、左侧 View 区与 Focused root chips | 支持以 Cell 或 Net 作为聚焦根节点（最多保留 32 个）。点击未在当前画布绘制的搜索结果会追加为新 root 而不替换既有 roots；`+ Focus` / `Add selected` 为显式追加，`Set selected as Focused` 为显式替换。 |
| **跨层次连接与模块树** | 左侧 `Module hierarchy` 与 `Selection` 面板 | 可展开查看模块实例层次并点击切换；未展开时不构建层次树，遇到递归或超大层次时有界截断。`Selection` 将连接明确划分为 `Current module`（本层连接）与 `Parent occurrence`（跨边界父层连接）。 |
| **可切换逻辑门符号** | 左侧 View 区 `Gate symbols` | 支持在 `Rectangles`（矩形框）与 `Conventional`（标准逻辑门符号，含反相气泡）之间即时切换，不影响节点尺寸、引脚端点或布线几何。 |
| **统一视图历史（View History）** | 顶部 `←` / `→`、`Ctrl+Z` / `Ctrl+Y`、`Alt+方向键` | 事务化记录并恢复模块切换、视图模式、Focused roots 与深度、选中项、视口缩放平移及手动布局调整。 |
| **间距精确输入与垂直引脚转角** | 左侧 Layout 区与自动/手动布线 | `Wire spacing` 与 `Cell spacing` 支持滑块调节与数字直接输入（提交后自动吸附至最近的 4 的倍数）。连接顶部/底部引脚（top/bottom pin）的末段连线会预留可见转角，避免近距离折线重叠难辨。 |
| **恢复校验与大图完成态渲染** | Session、Layout Golden、拖放/粘贴与渐进渲染 | Golden v3 采用内容指纹（fingerprint）校验网表一致性并恢复聚焦深度；批量导入严格按“网表 → 时序 → Golden”顺序执行。大图渐进渲染按可见节点与连线总量触发，渲染完成后完整恢复线桥（wire bridge）、标签与点击热区。 |

## 主要功能

### 浏览与逻辑追踪

- **结构化 Verilog 解析**：支持 `module`、`port`、`wire`、`assign`、单元实例（cell instance）、转义标识符（escaped identifier）、向量切片及拼接表达式（concatenation）。
- **无 `.lib` 智能推断**：在缺乏 Liberty 库文件时，根据单元与引脚命名自动推断逻辑门类型（gate kind）与引脚方向（pin direction）；未识别单元安全显示为黑盒（blackbox）。
- **全局搜索与定位**：支持按 module、port、net、instance 及 cell type 搜索并高亮定位目标对象。
- **层次化浏览**：展开 `Module hierarchy` 树查看实例层次路径，点击节点或双击画布中的子模块实例即可进入对应模块定义。
- **连接详情与锥体追踪**：在 `Selection` 面板查看单元、端口与线网的驱动（driver）、负载（load）、扇入（fanin）、扇出（fanout）及推断来源；点击面板中的关联项即可连续跳转并自动居中目标。
- **Whole 与 Focused 视图切换**：`Focused` 支持多根节点与独立的前向/后向追踪深度；大型模块默认采用 `Search-first`（搜索优先）模式按需加载局部图。
- **一键居中放大**：支持将当前选中单元按稳定阅读比例居中放大（快捷键 `F`），或将其设为新的聚焦根节点。

### 布局、微调与导出

- **正交原理图渲染**：采用从左到右的分层布局与正交（Manhattan）布线渲染交互式 SVG，支持滚轮缩放、拖拽平移与一键适配窗口（`Fit`）。
- **多布局引擎离线切换**：内置 `AnchorLayered`、`ELK` 与 `Simple` 三种布局引擎，完全离线运行；支持灵活调整导线间距（Wire spacing）与单元间距（Cell spacing）。
- **Adjust 手工校准模式**：支持拖拽微调节点位置、修改节点尺寸、覆盖实例显示属性及单实例引脚方向；释放鼠标后仅对受影响导线做局部正交重布线，`Reset` 可随时恢复自动布局。
- **大图渲染优化**：支持渐进式分批渲染、高扇出中继节点（Fanout Hub）及低倍率缩放自动隐藏细节文字；后续性能演进均面向完整图与局部聚焦视图，不再使用结构分组折叠。
- **Golden 快照与离线 SVG 导出**：支持保存、校验并重载布局 Golden JSON，支持导出带完整内嵌样式的独立 SVG 文件。

### 模块对比、时序标注与工具链集成

- **双模块对比（Compare View）**：支持上下或左右分屏对比两个模块，提供同步缩放平移、同名输出锥（Output Cone）联动查看及启发式结构差异高亮；左右两侧维护独立的聚焦根节点，并支持同步追加、移除与清空匹配单元。
- **时序报告导入与标注**：支持符合 EDA 工具习惯的标准列式时序文本（空格/Tab/CSV）与 JSON 双模格式（默认极简 `point at rt slack`，可选详细模式 `delay`、`slew`、`edge`、`kind`），完整覆盖映射前（Pre-map）、映射后（Post-map）与布局后（Post-layout）阶段，驱动源自动沿 `assign` 别名链回溯；侧边栏提供 `Worst Slack`、`AT`、`RT`、`Delay`、`Slew`、`All` 与 `None` 指标过滤，支持自定义 Slack 判定阈值（Threshold，默认 0.0）与默认内置验证时序启动联动。
- **便捷多格式输入**：支持文件选择器、任意位置拖放、页面全局 `Ctrl+V` 粘贴及专用粘贴文本框，自动识别并区分 Verilog 网表、Layout Golden 与时序日志。
- **自定义单元配置（Cell Config）**：支持在界面内编辑、浏览器本地持久化及 JSON 导入/导出未知单元类型的逻辑门种类与引脚方向。
- **过程日志（Process Log）**：底部可折叠日志面板支持按阶段（Phase）和级别（Level）过滤、一键复制与导出，便于排查解析或匹配问题。
- **跨平台 EDA 启动接口**：Node.js、Python、Windows 离线版与 Linux 单文件启动器共享统一的命令行协议，支持由外部 EDA 脚本指定初始网表、时序、单元配置、目标模块、聚焦实例与追踪深度；Linux 环境提供可复用的 Tcl 集成脚本（`ngb.tcl`）。

## 运行方式

### Windows 离线正式版（无需安装 Node.js）

Windows 离线发布包为 `NetlistGraphBuilder-v<version>-win-x64.zip`（当前最新附件为 `v1.1.2`），完整解压后双击运行 `NetlistGraphBuilder.exe`。程序仅在本机回环地址 `127.0.0.1` 启动本地服务并自动打开默认浏览器；使用期间请保留控制台启动窗口，按 `Ctrl+C` 或关闭窗口即可退出服务。

发布包内含 `examples/` 示例网表、`README.md`、`CHANGELOG.md`、`USER_GUIDE.md` 以及 `ELKJS-LICENSE.md`。**注意**：请勿单独拷贝 `.exe` 文件运行，启动器依赖同目录下的 `app/` 资源文件夹。若默认端口 `4173` 已被占用，启动器会自动顺延寻找空闲端口。

维护者可通过以下命令在本地重新构建 Windows 发布包（产物与 SHA-256 校验文件输出至 `dist/` 目录）：

```powershell
npm run release:windows
```

### Linux 单文件启动器与 CMake 构建

Release 提供 `NetlistGraphBuilder-v<version>-linux-x64` 单文件 ELF 可执行程序及 `.sha256` 校验文件；下载后执行 `chmod +x` 即可直接运行。该二进制在 Linux x86-64（glibc 2.35）环境下构建与验证，不承诺在 CentOS 7 或任意旧发行版上直接兼容。配套 Tcl 辅助脚本可从发布附件 `ngb.tcl` 下载，或直接取自仓库 `tools/eda/ngb.tcl`。

从源码构建 Linux 单文件启动器需要 CMake 3.16+、支持 C++11 的编译器与 POSIX threads；生成的二进制已内嵌全部前端源码与 ELK 资源，运行机器无需安装 Node.js、Python 或携带项目资源目录（仅依赖目标平台基础系统库与浏览器）：

```bash
cmake -S . -B build/linux -DCMAKE_BUILD_TYPE=Release -DNGB_BUILD_TESTS=ON
cmake --build build/linux --target ngb -j2
ctest --test-dir build/linux --output-on-failure
./build/linux/native/ngb start --netlist ./examples/two_equivalent_style_modules.v --port 0 --no-open
```

其中 `-DNGB_BUILD_TESTS=ON` 仅在运行构建测试时需要 Python 3.6+（运行 Tcl 集成测试另需 `tclsh`）。也支持以 `cmake -S native -B build/ngb` 方式独立构建，此时可执行文件生成于 `build/ngb/ngb`。关于安装目录定制、Tcl `Start/Status/Stop` 接口、父进程退出自动清理及跨发行版 ABI 说明，详见 [Linux 单文件启动器指南](docs/LINUX_SINGLE_FILE_LAUNCHER.md)。

### VS Code 一键启动（源码开发预览）

仓库内置了 VS Code 任务与调试启动配置。在本地工作区或 Remote-SSH 远程工作区中打开仓库后：

1. 打开 `Run and Debug` 面板（`Ctrl+Shift+D`）。
2. 选择 `Netlist Graph Builder: Open View`。
3. 按下 `F5`。

VS Code 会自动在后台拉起预览服务，并在编辑器右侧的 Integrated Browser 标签页中打开网表工作台。预览服务仅监听 `127.0.0.1:4173`；工作区配置会自动启用 VS Code 远程端口转发代理，无需开放服务器防火墙端口。

源码预览脚本 `tools/start-preview.sh` 会按以下优先级选择运行时（与单文件二进制 `ngb` 无关）：

1. 若 `node` 可正常执行，优先运行 `tools/serve.mjs`；
2. 否则，若存在 `python3`，自动回退至零第三方依赖的 `tools/serve.py`；
3. 若两者均不可用，则在终端输出明确的诊断提示。

因此，即便在无法运行新版 Node.js 官方二进制的旧版 Linux（如 CentOS 7）环境中，只要具备 Python 3 即可正常启动源码预览：

```bash
python3 --version
```

若当前 VS Code 版本不支持 `editor-browser` 调试类型，可依次执行 `Terminal > Run Task > Netlist Graph Builder: Serve`，在 `Ports` 面板确认转发 `4173` 端口，随后通过命令面板调用 `Browser: Open Integrated Browser` 访问 `http://127.0.0.1:4173/`。

> **CentOS 7 远程连接提示**：[VS Code Remote Development 官方系统基线](https://code.visualstudio.com/docs/remote/linux)要求远程主机具备 glibc 2.28、libstdc++ 3.4.25 与 kernel 4.18，CentOS 7 已不在官方支持范围内。若 Remote-SSH 自身无法建立连接，建议优先升级至 Rocky Linux、AlmaLinux 或 RHEL 8+，或参考 [VS Code Remote FAQ](https://code.visualstudio.com/docs/remote/faq) 配置自定义 sysroot。本项目提供的 Python 回退仅解决预览 Web 服务的运行时依赖，无法替代 VS Code Server 自身的底层系统库。

### 命令行直接启动

常规源码开发推荐使用 Node.js 18 或更高版本（零外部 npm 依赖）：

```bash
npm start
```

在缺少新版 Node.js 的 Linux 环境中，可直接使用 Python 3 启动：

```bash
python3 -u tools/serve.py
```

所有启动器均仅绑定本地回环地址 `127.0.0.1`，默认自动唤起浏览器；传入 `--no-open` 可仅启动后台服务，传入 `--port`（或设置环境变量 `PORT`）可指定监听端口。服务就绪后会在 `stdout` 输出单行 JSON 格式的 `ready` 消息，供外层脚本或 EDA 进程解析实际 URL 与启动目标。

### EDA 命令行与脚本接口

Node.js、Python、Windows 离线版与 Linux 单文件 `ngb` 共享一致的业务命令行参数。以下命令示例会加载指定的网表、时序与单元配置，默认打开 `top` 模块，并以实例 `u0` 为中心展示扇入深度 1、扇出深度 2 的局部聚焦图：

```powershell
node tools/serve.mjs --netlist "C:\EDA jobs\design one.v" --timing "C:\EDA jobs\timing one.txt" --cell-config "C:\EDA jobs\cells.json" --module top --focus u0 --fanin-depth 1 --fanout-depth 2 --no-open
```

使用 Python 时只需将命令前缀替换为 `python3 -u tools/serve.py`；使用 Windows 发布包时替换为 `NetlistGraphBuilder.exe`。常用参数说明如下：

- `--netlist <path>`、`--timing <path>`、`--cell-config <path>`：指定启动时自动加载的输入文件路径（含空格路径请加引号）。
- `--module <name>`、`--focus <instance>`：指定初始打开的模块名称与聚焦单元实例。
- `--fanin-depth <0-99>`、`--fanout-depth <0-99>`：分别设置 Focused 视图向输入侧（fanin）和输出侧（fanout）扩展的层数，`0` 表示关闭该方向。
- `--port <0-65535>`：指定本地监听端口，传入 `0` 由操作系统自动分配空闲端口；`--no-open`（兼容旧别名 `--no-browser`）禁止自动打开浏览器。

此外，Node.js、Python 与 Linux `ngb` 均支持面向自动化脚本的会话生命周期管理子命令：

```bash
node tools/serve.mjs start --netlist ./results/top.v --port 0 \
  --state-file ./results/ngb-session.json --no-open
node tools/serve.mjs status --state-file ./results/ngb-session.json
node tools/serve.mjs stop --state-file ./results/ngb-session.json
```

其中 `start` 子命令可省略以兼容传统直接传参写法；`stop` 严格依据状态文件校验目标进程身份后安全终止服务，绝不按端口号盲目搜索或强杀无关进程。

服务启动成功后输出的 `ready` JSON 仅包含文件名与目标摘要，绝不泄露网表、时序或配置原文：

```json
{"event":"ready","host":"127.0.0.1","port":4173,"url":"http://127.0.0.1:4173/?startup=1","startup":{"netlist":"design one.v","timing":"timing one.txt","cellConfig":"cells.json","module":"top","focus":"u0","faninDepth":1,"fanoutDepth":2}}
```

当输入文件不可读、Cell Config JSON 结构非法、指定的 `module`/`focus` 在网表中不存在（Node 启动预校验）或数值参数越界时，启动器会在绑定端口前输出清晰报错并以非零状态码退出。可执行 `npm run test:launcher` 运行端到端启动协议测试。

若启动时未指定任何输入文件，页面将默认加载内置示例网表。用户可随时通过顶部菜单打开、向页面任意位置拖放 `.v` / `.sv` / `.txt` 网表、`.json` Layout Golden 及 `.log` 时序文件；当输入焦点不在文本框内时，也可直接按 `Ctrl+V` 粘贴剪贴板中的文件或文本。若只需临时查看一小段网表代码，点击顶部 `Import > Paste netlist` 粘贴文本即可立即绘图。

## 快速上手指南

### 快速输入与层次浏览

1. **载入网表**：点击顶部 `Import > Open netlist`、将文件直接拖入页面，或在页面空白处按 `Ctrl+V` 粘贴 Verilog 文本，均可快速加载设计。
2. **代码片段直绘**：`Import > Paste netlist` 适合直接复制一小段结构化 Verilog 代码并立即成图，无需先保存为本地文件。
3. **多文件智能识别**：拖放与全局粘贴会自动区分 Verilog 网表、Layout Golden 与时序日志；当同时拖入多个文件时，系统会严格按“先加载网表，再依次应用配套 Timing 与 Golden”的顺序等待执行。
4. **Golden 布局存取**：通过 `More > Save Golden` 保存当前模块的布局与手动微调结果；下次先载入相同网表，再点击 `More > Load Golden` 即可恢复布局（Golden v3 会自动校验目标模块名与网表内容指纹）。
5. **层次化跳转**：对于包含子模块实例的层次化网表，双击画布中的子模块实例即可钻取进入其模块定义；也可随时通过顶部 `Module` 下拉框切换模块。
6. **模块实例树**：展开左侧 `Module hierarchy` 面板可查看完整实例层次路径并点击切换上下文；折叠该面板时不会消耗资源构建层次树。

### 示例文件说明

仓库 `examples/` 目录提供了多组典型测试网表：

- `examples/two_equivalent_style_modules.v`：基础重综合（resyn / Flex）双模块对比示例。
- `examples/hierarchical_escaped_compare.v`：包含转义层次化标识符（escaped hierarchical identifiers）与 Flex 配对模块的真实结构示例。
- `examples/hierarchical_escaped_timing.txt`：与 `hierarchical_escaped_compare.v` 配套的标准多模块时序报告示例。
- `examples/large_buffer_chain_1024.v`：1024 级缓冲器长链大图与有界锥体（bounded cone）测试示例，可通过以下命令确定性生成：

```powershell
node tools/generate-large-example.mjs
```

> **提示**：`large_buffer_chain_1024.v` 为 1024 级严格串行链路，在 `Whole` 整图适配（Fit）时会呈现为一条细长的全局概览。滚轮缩放会根据画布实际宽度动态提升最大放大倍率；建议直接在顶部搜索框搜索 `u_buf_512` 等实例名称，视图会自动居中并放大至清晰可读的尺寸，或从输出端口开启有限深度的 `Focused` 视图进行分析。

### Single View（单模块视图）操作流程

1. 载入结构化 Verilog 网表，从顶部 `Module` 下拉框选择目标模块。
2. 单击画布中的单元（node）、端口（port）或导线（wire），在左侧 `Selection` 面板查看详细连接；点击面板内的关联 net、`Connected`、`Fanin` 或 `Fanout` 按钮可快速跳转并居中目标对象。选中长导线后可按住画布拖动追踪至远端（平移操作不会清除当前高亮，单击空白区域才会取消选择）。
3. 双击子模块实例可直接进入对应的子模块定义视图。
4. 点击 `Whole` 查看完整模块图；对于大型模块，搜索未绘制的单元会自动进入或追加至 `Focused` 局部视图，通过 `Fanin depth` 与 `Fanout depth` 独立控制前后向展开层数。搜索结果右侧的 `+ Focus` 与 View 区的 `Add selected` 用于追加聚焦根节点，`Set selected as Focused` 则用于替换全部根节点。
5. 切换 `Show aliases` 可控制是否显式展示 `assign` 别名连线；切换 `Gate symbols` 可在矩形框与标准逻辑门符号之间切换。
6. 开启 `Adjust layout` 后可自由拖拽节点位置或修改尺寸；通过 `More > Save Golden` 保存校准结果，通过 `More > Load Golden` 恢复。
7. 点击 `More > Export SVG` 可将当前完整模块或局部聚焦原理图导出为独立 SVG 文件。

### Compare View（双模块对比视图）操作流程

1. 载入至少包含两个模块的网表，可先在 Single View 中选中作为左侧基准的模块。
2. 点击顶部工具栏的 `Compare` 按钮进入对比模式。系统会自动识别并优先推荐同名前缀及带有 `_Flex`、`_orig`、`_new` 等常见后缀的配对模块。
3. 在左侧 `Module Compare` 面板分别指定 `Left` 与 `Right` 模块，点击 `Apply` 应用对比组合。
4. 进入对比模式后，顶部原按钮变为 `Single`；点击顶部或左侧面板中的 `Single` 均可返回单图模式（保持各自视口，不强制重置 Fit）。
5. 分屏布局（`Layout`）默认为 `Top / Bottom`（上下分屏），可切换为 `Left / Right`（左右分屏），切换分屏方向后两侧视图会自动适配窗口。
6. `Sync pan / zoom` 默认开启：在任意一侧缩放或平移画布时，另一侧会同步应用相同的视口变换；关闭后两侧可独立缩放平移。点击顶部 `Fit` 会同时重置两侧视口。
7. 单击任一侧的同名端口、线网或匹配单元，两侧画布会同步高亮对应对象，且端口与单元会自动居中聚焦。
8. `Sync Focus roots` 默认开启：在一侧追加、移除或清空聚焦根节点时，会自动对另一侧的匹配单元执行相同操作；若另一侧无对应单元，则仅更新当前侧。
9. 在 `Output cone` 下拉框中选择两侧共有的输出端口（例如内置示例中的 `sco_891`），即可同步对比两侧的扇入逻辑锥；调整 `Depth` 控制追踪层数，选择 `Whole module` 返回整图对比。
10. 左侧 `Design` 统计面板会并列展示两侧的单元总数、门类型分布、估算逻辑深度（logic depth）、最大扇出（max fanout）、数量差值及未匹配（unmatched）对象统计。

### 大图渲染与布局策略

1. **布局引擎与降级**：`Layout` 默认选用 `Native Layered AnchorLayered`；若遇到不支持的复杂拓扑导致失败，会依次尝试 `ELK Layered (Experimental)` 与 `Simple Layered`。ELK 引擎已完整本地化（vendored），运行时无需联网；主动取消任务不会触发降级。
2. **高扇出中继（Fanout hubs）**：默认开启，扇出数不少于 8 的同源线网会自动插入共享 hub 节点，显著减少长距离平行干线。
3. **全图与聚焦策略**：结构分组折叠（Group-collapse）已退出产品路线；映射网表回归、性能优化与大图交互均围绕完整图、`Search-first` 与 `Focused` 局部图构建（旧存档中的折叠字段仅作向后兼容忽略）。
4. **渐进式渲染**：当可见节点与连线总数达到 400 时，自动启用可取消的分批 SVG 渲染，底部状态栏实时显示渲染进度；渲染完成后会完整恢复所有跨线桥接弧（wire bridge）、线网标签与点击热区。
5. **LOD 细节自适应**：当画布缩放倍率低于 `0.65` 时，自动隐藏引脚名、线网标签、单元元信息与时序徽标文字以保证流畅度，放大后自动恢复。
6. **标签页会话保持**：当前网表与工作台状态自动保存在浏览器 `sessionStorage` 中；刷新同一标签页可无缝恢复网表、模块、聚焦状态与视口位置，关闭标签页后自动释放。
7. **混合手工微调**：在 `AnchorLayered`、`ELK` 或 `Simple` 模式下均可开启 `Adjust` 手工拖拽节点；未改动节点保持自动布局坐标，改动节点的关联导线自动执行正交避障重布线，点击 `Reset layout` 即可恢复自动布局结果。
8. **间距吸附与引脚可读性**：`Wire spacing` 与 `Cell spacing` 支持滑块和数字输入（自动吸附至 4 的倍数）；连接单元上下边缘引脚的导线会自动保留末段可见转角。

### 结构差异高亮说明

Compare View 采用**基于名称、方向与门类型的启发式结构对比**，不等同于形式化逻辑等价性证明（Formal Equivalence Checking）：

- **绿色实线**：表示两侧对象建立了基础结构对应关系——包括规范化名称相同且方向一致的端口（port）、同名线网（net），或两侧均存在的逻辑门类型（gate kind）。
- **红色虚线**：表示仅在单侧存在或无法建立上述对应关系的对象——包括未匹配的端口/线网，以及门类型仅在其中一侧出现的单元。
- **橙色高亮**：表示用户当前点击选中的对象，与绿/红结构分类正交叠加。
- **对比粒度说明**：端口对齐依据规范化名称与方向；线网对比依据名称；单元对比目前依据推断出的 `gate kind`，不会自动对内部匿名实例名或异构子图做拓扑同构匹配。
- **统计指标说明**：`logic depth` 根据当前图中最长单元路径做启发式估算；`max fanout` 按单个图节点的最大出边数计算。因此，红色虚线代表“值得关注的潜在结构差异点”，并不代表两侧电路功能不等价；绿色实线也不代表两侧在逻辑或拓扑上完全等价。

## 测试与验证

日常开发可通过以下命令运行验证套件：

```powershell
npm test
npm run test:architecture
npm run test:docs
npm run test:launcher
npm run test:mapped-cases
```

- `npm test`：运行 904 项单元测试，覆盖语法解析、单元/引脚推断、图模型提取、布局与正交布线、时序标注、搜索、锥体分析、别名折叠、模块对比、会话持久化及 SVG 渲染。
- `npm run test:architecture`：基于离线 Acorn AST 校验全仓模块依赖方向、跨层边界与无环约束。
- `npm run test:docs`：校验核心文档与教程中的所有相对路径链接有效性。
- `npm run test:launcher`：验证 Node.js 与 Python 启动器的 CLI 参数、状态文件及 HTTP 协议。
- `npm run test:mapped-cases`：在 47 个真实综合映射网表（`tests/fixtures/mapped/`）上运行布局与几何硬约束回归。
- Linux 单文件启动器的 CMake、HTTP 生命周期与 Tcl 集成测试通过 `ctest --test-dir build/linux --output-on-failure` 独立运行。

## 项目目录结构

现行模块边界详见 [架构设计说明](docs/ARCHITECTURE.md)，多领域工作台演进设计见 [可扩展工作台架构](docs/architecture_evolution.md)，迁移与审计记录见 [阶段 7 计划](docs/STAGE_7_PLAN.md)，跨层追踪、Cell/Net 聚焦、标准门符号与大图交互优化见 [阶段 8 计划](docs/STAGE_8_PLAN.md)（内存 AIG 样例仅用于验证多领域架构边界，生产级 AIG 导入尚未作为正式功能开放）。

```text
docs/                 项目路线图、阶段计划、架构说明、设计规范与使用教程
examples/             示例 Verilog 网表与配套时序文件
native/               Linux C++11 单文件启动器、资源嵌入脚本与 CMake 构建配置
src/analysis/         逻辑锥（cone）、别名规范化、对象连接查询与模块对比分析
src/app/              浏览器入口组装、工作区桥接与旧状态兼容投影
src/application/      Document/ViewSession 状态存储、命令总线、任务协调与对比会话
src/bootstrap/        静态领域注册与工作台依赖组装
src/contracts/        ObjectRef、领域接口、查询与视图契约定义
src/diagram/          领域中性的显示图模型、共享视图流水线与几何测量契约
src/domains/netlist/  Netlist 领域特性、图投影、时序/单元配置/Golden 业务用例
src/foundation/       无业务含义的标识符编码、不可变结构值与基础图/几何工具
src/infer/            无 Liberty 环境下的标准单元类型与引脚方向推断规则
src/layout/           AnchorLayered / ELK / Simple 布局引擎、节点几何、正交布线与网格吸附
src/netlist/          Netlist IR 数据模型与结构图提取
src/parser/           结构化 Verilog 词法与语法解析器
src/persistence/      会话、启动清单与源码指纹等版本化编解码器（codec）
src/platform/         浏览器文件下载与本地存储等平台副作用适配
src/render/           SVG 场景渲染器、渐进式分批渲染与独立 SVG 导出
src/search/           设计对象索引构建与搜索匹配
src/timing/           标准 Tabular/CSV/JSON 时序解析及图实体消歧标注
src/ui/               画布手势、视口变换、搜索栏及 Selection / Timing / Adjust 面板
tests/fixtures/       单元测试与 47 个综合映射网表回归用例
tests/unit/           全量单元测试套件
tools/                本地开发服务、架构门禁、性能基准与大图生成脚本
tools/eda/            面向 EDA 工具的 Tcl 启动、状态查询与安全关闭辅助脚本
```

## 当前已知限制

- **Verilog 语法子集**：仅支持综合后常见的结构化门级 Verilog 子集，并非完整的 Verilog / SystemVerilog 编译前端（不支持行为级 `always`、宏展开或复杂参数化展开）。
- **无 `.lib` 启发式推断**：不解析 Liberty `.lib` 文件；遇到命名非标的定制单元或复杂宏单元时，可能需要通过 `Cell Config` 或 `Adjust` 面板手动指定引脚方向。
- **超大图浏览策略**：深层 DAG 的 Balanced/Folded 折叠排布仍属暂缓的实验方向；当前针对大型模块优先通过 `AnchorLayered` / `ELK`、`Search-first` 与有限深度的 `Focused` 局部视图进行浏览，不再扩展结构分组折叠（group collapse）。
- **启发式模块对比**：`Compare` 模式基于端口/线网名称、逻辑门类型及图统计特征提供启发式结构对比，不提供形式化等价性证明。
- **AIG 支持范围**：测试套件中的内存 AIG 仅用于验证多领域工作台架构边界，尚未提供生产级 AIGER 文件导入、AIG 专用界面或逻辑等价分析。

长期路线图详见 [docs/PLAN.md](docs/PLAN.md)；大图性能基线见 [阶段 4 计划](docs/STAGE_4_PLAN.md)，工作台架构重构与审计证据见 [阶段 7 计划](docs/STAGE_7_PLAN.md)，当前阶段功能规划见 [阶段 8 计划](docs/STAGE_8_PLAN.md)。
