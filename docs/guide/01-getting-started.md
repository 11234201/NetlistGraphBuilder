# 1. 安装、运行与界面总览

> 返回 [完整使用教程目录](../USER_GUIDE.md)

本章介绍 **Netlist Graph Builder** 的软件定位、各平台启动方式、工作台界面分区、左右面板控制与快捷键一览。

---

## 1.1 软件定位与能力边界

**Netlist Graph Builder** 是一款离线运行的门级结构化 Verilog 原理图浏览器，同时内置独立的 AIG（And-Inverter Graph）浏览与逻辑分析工作区。

**典型适用场景**：

- 在缺乏 Liberty（`.lib`）库文件或商业 EDA 环境的条件下，直接解析综合（Synthesis）、重综合（Resyn）或 ECO 后的门级结构化 Verilog，自动推断常见逻辑门类型与引脚方向，生成交互式正交 SVG 原理图。
- 从关键单元、线网或输出端口出发，向前（Fanin）、向后（Fanout）追踪指定层数的逻辑锥（Logic Cone），或用 `Show Path` 查看任意起点与终点间的逻辑路径及最短/最长逻辑级数。
- 导入工业界标准列式或 JSON 时序报告（NGB Timing Format v1.0），在图元与面板中直观核对 `AT`、`RT`、`Slack`、`Delay`、`Slew` 与漏配原因。
- 并排对比两个结构相近的模块（如优化前后版本），同步视口、聚焦根与同名输出逻辑锥，快速定位差异。
- 通过 `Cell Config` 为缺乏内置规则的工艺库原语补充可复用的引脚与门类型定义，或加载可选文本 `.lib` 辅助识别。
- 在独立 AIG 工作区中导入 ABC AIG DOT 与平坦两输入组合 BLIF，叠加 `.level` 逻辑层级与裕量报告，执行重汇聚与 XOR/XNOR/MUX 逻辑块识别。
- 通过 SSH 端口转发、服务器文件选择器、交互式终端 REPL 与 EDA Tcl 脚本（`ngb.tcl`）远程驱动多个浏览器页面。

**能力边界说明**：

- 本工具并非完整的 Verilog / SystemVerilog 编译器，亦不提供形式化逻辑等价验证（Formal Equivalence Checking）。
- Netlist 工作区与 AIG 工作区相互独立：AIG 支持 ABC AIG DOT 与平坦两输入组合 BLIF，尚不支持二进制/ASCII AIGER（`.aig` / `.aag`）、网表转 AIG 或 AIG 双图并排 Compare；Netlist 专属能力（Timing、Liberty、Cell Config、Adjust、Compare、Golden）不适用于 AIG。
- 100% 离线运行，仅绑定本机回环地址 `127.0.0.1`，不发起任何外网请求。

---

## 1.2 运行方式

仓库提供通用源码单入口（`./ngb` / `.\ngb.cmd`）以及四种底层运行时启动器（Windows 离线版、Linux 单文件 `ngb`、Node.js、Python 3），均共享同一套命令行参数与 182 条远程工作台命令，详见 [8. SSH 远程工作台与 EDA 集成](08-remote-workbench-and-eda.md) 与 [通用源码启动入口](../UNIVERSAL_LAUNCHER.md)。

### 通用源码单入口（推荐，无需 npm）

在仓库根目录直接运行统一入口，无需安装 npm 或第三方依赖，自动探测可用的 **Node.js 18+**，不可用时自动探测 **Python 3.6+**（Linux 顺序：`node` → `python3` → `python`；Windows 顺序：`node.exe` → `py.exe -3` → `python3.exe` → `python.exe`）：

```bash
./ngb --no-open --port 4173
```

Windows PowerShell 或 CMD 使用：

```powershell
.\ngb.cmd --no-open --port 4173
```

- 原样透传 `start`（默认）、`status`、`stop`、`cmd` 及全部启动参数，无需 `npm start --` 的 `--` 分隔符；所有相对路径始终相对于**调用时的工作目录**解析。
- 可设置环境变量 `NGB_RUNTIME=auto|node|python`（默认 `auto`）固定会话所用的运行时；同一会话的 `start` / `status` / `cmd` / `stop` 请保持一致的运行时。

### Windows 离线版

1. 完整解压 `NetlistGraphBuilder-v<version>-win-x64.zip`（升级时请完整解压同一版本并核对 `.sha256` 校验值）。
2. 双击运行 `NetlistGraphBuilder.exe`。
3. 程序会在 `127.0.0.1` 启动本地服务（默认端口 `4173`，占用时自动顺延）并自动打开默认浏览器。
4. 使用期间请保留控制台启动窗口；按 `Ctrl+C` 或关闭窗口即可退出。

> **注意**：请勿单独复制 `NetlistGraphBuilder.exe` 到其他目录运行，它依赖同级目录中的 `app/` 前端资源文件夹与 `runtime/` 内置 CPython 运行时。发布包内同时附带 `examples/`、`ngb.tcl`、`README.md`、`CHANGELOG.md`、`USER_GUIDE.md`、`docs/` 以及 `PYTHON-LICENSE.txt`、`ELKJS-LICENSE.md`、`VIZ-LICENSE.txt`、`GRAPHVIZ-LICENSE.txt`、`EXPAT-LICENSE.txt`。

### Linux 单文件启动器

Release 提供 `NetlistGraphBuilder-v<version>-linux-x64` 单文件 ELF（已内嵌前端源码、vendored ELK、Graphviz/Viz.js WASM 与许可证），下载后 `chmod +x` 即可直接运行；也可通过 CMake 从源码构建。详见 [Linux 单文件启动器指南](../LINUX_SINGLE_FILE_LAUNCHER.md)。

### 直接指定 Node.js 或 Python 3 后端

```powershell
# Node.js 18+（默认监听 http://127.0.0.1:4173/）
npm start
node tools/serve.mjs --port 4210 --no-open

# Python 3（零第三方库）
python3 -u tools/serve.py
```

### VS Code 一键启动

在本地或 Remote-SSH 工作区中打开仓库后，进入 `Run and Debug`（`Ctrl+Shift+D`），选择 `Netlist Graph Builder: Open View` 并按 `F5`，即可自动拉起预览服务并在右侧 Integrated Browser 中打开工作台（`tools/start-preview.sh` 转发至通用入口 `./ngb`）。

---

## 1.3 界面总览

网表工作台按“全局操作、当前视图与对象详情”分区；打开 AIG 后会自动切换为专用工具栏与面板。

- **全局栏（Topbar）**：
  - `File`：汇集 `Open design…`、`Open from server…`（服务器配对时显示）、`Netlist + Timing` 分组、`AIG + Level` 分组，以及 `Export & snapshots`（`Export SVG`、`Save Golden`、`Load Golden…`）。
  - `Settings`：集中管理 `Display`、`Layout`、`Timing`、`Liberty`、`Cell Config`（AIG 模式下切换为 `AIG overlays`）。
  - 全局 `Search` 框、当前源徽标（`Sample` 或文件名）、同页多份 AIG 图选择器（`Active AIG graph`）、配对页号（如 `p1`）、`Compare` / `Single` 切换按钮与 `?` 帮助弹窗。
- **上下文工具栏（Contextbar）**：
  - 左侧 `Navigator` 显隐开关、视图历史 `←` / `→` 按钮、当前模块/实例路径标题与视图模式徽标。
  - `Whole` / `Focused` 切换、`Show Path` 开关、`Fit view`、`Adjust` 手工校准开关。
  - 右侧当前选中对象摘要（点击可快速展开 Inspector）与 `Inspector` 显隐开关。
- **条件工具栏（画布上方）**：
  - Compare 模式下显示 A/B 配置行（模块选择器、`A files` / `B files`、`Apply`、`Split`、`Sync & cone`）。
  - Focused 模式下显示 `Roots` 菜单、`Fanin` 与 `Fanout` 深度控件。
  - 启用 Show Path 后显示紧凑的 `#pathToolbar` 状态条（`Open Path`、`Turn off`、`Clear`）。
- **Navigator（左侧导航面板）**：
  - 网表模式：`Hierarchy`（模块实例树）、`Design`（设计/对比统计与模块注释属性）、`Analysis`（当前可见子图的重收敛路径）、`Path`（Show Path 路径与逻辑级数）。
  - AIG 模式：`Design`、`Objects`、`Names`（存在 BLIF 名称映射时显示）、`Analysis`、`Path`。
- **Inspector（右侧详情面板）**：
  - 顶部固定展示对象摘要（完整名称、复制按钮、Single / Compare A/B 来源），并提供 `Zoom to selection`、`Add to Focused`、`Replace roots` 及 Show Path 快捷添加按钮。
  - 网表模式五页签：`Connections`、`Attributes`、`Analysis`、`Timing`、`Adjust`；底部 `Edit cell type…` 打开类型级 `Cell Config` 编辑器。
  - AIG 模式三页签：`Connections`、`Analysis`、`Source`。
- **中央主画布**：渲染当前模块的交互式 SVG 原理图，或在 Compare 模式下分屏展示 A/B 两侧画布。
- **底部状态栏**：显示最新操作状态、当前布局 provider，以及带计数的 `Diagnostics` 与 `Log` 抽屉开关。

**交互细节**：所有下拉菜单均可再次点击、点击外部或按 `Esc` 收起；长名称支持完整查看与复制，宽时序表仅在表内横向滚动。

---

## 1.4 隐藏、恢复与调整左右面板

| 需要做什么 | 操作 | 结果 |
| --- | --- | --- |
| 隐藏左侧导航 | 点击 Navigator 标题旁的 `‹ Hide`，或顶部 `Navigator` | 导航收起，停靠时占用的宽度交还画布 |
| 隐藏右侧详情 | 点击 Inspector 标题旁的 `Hide ›`，或顶部 `Inspector` | 详情收起，停靠时占用的宽度交还画布 |
| 两侧都隐藏 | 分别收起仍展开的两侧面板 | 画布占满工作区宽度，顶部工具栏仍可使用 |
| 恢复某侧面板 | 点击顶部 `Navigator` 或 `Inspector` | 打开对应面板；开关高亮表示展开 |
| 查看当前选择详情 | 点击顶部对象名称摘要，或 `Inspector` | 打开 Inspector，显示当前选中对象 |
| 调整停靠面板宽度 | 拖拽面板与画布之间的分隔条 | Navigator 可调至 `220–360px`，Inspector 可调至 `320–560px` |

- 主动隐藏 Inspector 后，再次点击画布中的对象仅更新选区与顶部对象摘要，**不会强制弹出详情面板**。页面宽度小于 `1024px` 时，顶部对象摘要会自动收起，请点击 `Inspector` 开关查看详情。
- 开合或调宽面板适用于 Single、Focused 与 Compare，**始终保持当前图中心和缩放倍率**，不触发重新布局，也不修改网表或 Focused roots。如需将全图重新适配新画布尺寸，请显式点击 `Fit view`（Compare 中同时适配两侧）。

---

## 1.5 窗口宽度与界面偏好

未保存过面板偏好时，工作台按浏览器页面可用宽度采用以下默认策略：

| 页面可用宽度 | Navigator | Inspector |
| --- | --- | --- |
| `≥ 1600px`（如 1920px） | 默认停靠并展开（宽 `240px`） | 默认停靠并展开（宽 `336px`） |
| `1280–1599px`（如 1366/1440px） | 默认关闭，点击后以抽屉覆盖画布 | 默认停靠并展开（宽 `320px`） |
| `< 1280px` | 默认关闭，按需打开抽屉 | 默认关闭，按需打开抽屉；两侧同时只开一个 |

- 抽屉模式覆盖部分画布而不压缩画布宽度，不显示拖宽分隔条；点抽屉外部或按 `Esc` 可关闭（存在浮层时 `Esc` 先关闭顶层浮层）。
- 面板开关、宽度与最近页签保存在当前浏览器、当前站点地址（含端口）的 `localStorage` 版本化偏好中，不写入网表会话或 Golden，也不占用视图历史。抽屉不会在刷新时自动弹出。

---

## 1.6 快捷键一览

| 快捷键 | 功能说明 | 生效条件 |
| --- | --- | --- |
| `/` | 聚焦全局 Search | 非编辑状态、无模态对话框、未处于输入法组合中 |
| `Ctrl+Enter` / `Cmd+Enter` | 提交 `Paste netlist`、`Paste AIG`、`Paste timing` 或 `Paste levels` 文本 | 文本粘贴导入对话框打开时 |
| `Ctrl+Z` / `Alt+Left` | 视图历史后退（View History Back） | 焦点不在文本输入框内 |
| `Ctrl+Shift+Z` / `Ctrl+Y` / `Alt+Right` | 视图历史前进（View History Forward） | 焦点不在文本输入框内 |
| `F` | `Zoom to selection`，居中放大选中的单元、线网或 Compare 端口 | 焦点不在文本输入框内且存在可定位对象 |
| `ArrowUp` / `ArrowDown` | 在搜索下拉候选列表中上下切换 | 顶部搜索框获得焦点时 |
| `Enter` | 激活并定位当前选中的搜索结果 | 顶部搜索框获得焦点时 |
| `Esc` | 收起搜索候选、活动菜单、抽屉或对话框 | 对应界面处于打开状态时；关闭后归还触发按钮焦点 |
| `Ctrl+V` / `Cmd+V` | 全局粘贴并自动识别网表、AIG、Level、时序、Golden 或 Liberty | 焦点不在任何可编辑输入控件内 |
| `ArrowLeft` / `ArrowRight` | 按 `16px` 步进调整 Navigator 或 Inspector 宽度 | 停靠面板分隔条获得焦点时 |
| `ArrowLeft` / `ArrowRight`、`Home` / `End` | 切换页签，或跳至首个/末个页签 | Navigator 或 Inspector 页签获得焦点时 |

---

> 下一章：[2. 导入设计、多文件合并、Liberty 库与 Cell Config](02-import-and-libraries.md)
