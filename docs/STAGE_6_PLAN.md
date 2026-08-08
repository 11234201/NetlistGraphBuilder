# 阶段 6 细化计划：时序、聚焦浏览与 EDA 集成

## 阶段目标

阶段 6 面向真实 resyn/remap 调试工作流，统一 Global/Local 边界时序输入和全图时序显示策略，改善大图的局部逻辑浏览与布线可读性，并提供可由已有 EDA 工具调用的启动接口。

本阶段继续保持离线可用，不引入必须联网的服务，不把完整大图渲染作为主要分析路径，也不改变阶段 5 的可选 Liberty 目标。

## 需求计划表

> 实施更新（2026-08-07）：R6-1 至 R6-11 已全部完成。下表状态列保留需求制定时的规划基线，当前状态以 `docs/PLAN.md` 为准。

| ID | 需求 | 现状 | 计划交付物 | 验收标准 | 优先级 | 规划时状态 |
| --- | --- | --- | --- | --- | --- | --- |
| R6-1 | 解析新的 module 边界时序格式 | 仅支持 `inst <...>` 与 `pin ..., at ..., rt ..., slack ...` 格式 | 统一 timing IR；兼容旧格式和 `direction at rat slack [Global/Local]...` 表格；保存 `Apply` 结果；支持 module boundary，并为后续 instance 同格式预留 scope matcher | 给定样例解析为一个 timing scope，Global/Local 各 20 条记录，其中 8 个 OUTPUT、12 个 INPUT；`rat` 规范化为内部 `rt`；`Apply:None` 保留且 Auto 默认选择 Global；旧格式测试保持通过 | P0 | 计划中 |
| R6-2 | 全图统一设置 cell/port 显示的时序 | 当前按单个 cell、pin 和 metric 设置 badge | 新增全图 `Timing snapshot: Auto/Global/Local` 与 `Timing metric: Slack/AT/RT/All`；统一 Single、Compare 和 SVG 导出行为；Selection 详情仍展示全部数值 | 修改一次设置后，所有已匹配 cell 和 module boundary port 同步更新；新 Golden/session 保存全图策略；旧 Golden 可读取且不崩溃 | P0 | 计划中 |
| R6-3 | 增加可调 Cell spacing 并缓解 net 重叠 | 已有 Wire spacing，只调整平行走线 lane pitch | 新增 Cell spacing；调整同层最小间距和 fanout 留白；按层拥塞、pin 数和 boundary pressure 自适应扩大通道；保留 Wire spacing 独立控制 | 调节 Cell spacing 可立即重排当前图；不同 net 不发生非法共线重叠，wire 不穿越非端点 cell；布局保持确定性；真实 fixture 与千级示例通过质量预算 | P1 | 计划中 |
| R6-4 | 精简顶部控件 | 导入、布局、Golden、导出和校准操作全部堆在 topbar | 顶部保留 Import、Module、module 前进/后退、Compare、Fit 和 More；Layout/Timing 设置移入侧栏折叠区；SVG、Golden 和 Reset 收入 More | 常用操作一层可达；窄窗口不遮挡主要控件；所有移动后的操作保持键盘可达并有 tooltip | P1 | 计划中 |
| R6-5 | 时序支持直接粘贴 | 全局粘贴可识别旧格式，但没有显式时序粘贴入口，也不能识别新表格格式 | 通用文本导入对话框；Import 菜单提供 Paste netlist/Paste timing；扩展 quick-input 自动检测；保留全局 `Ctrl+V` | 新格式文本无需落盘即可载入；显式 Timing 模式不被误判为 Verilog；解析失败不覆盖已加载成功的数据并给出可定位诊断 | P0 | 计划中 |
| R6-6 | 提供 EDA 工具可调用的启动接口 | 目前主要通过浏览器、Node/Python preview server 或 Windows launcher 手动启动 | 抽取与 DOM 无关的应用控制层；统一 Node、Python 和 Windows launcher 参数；提供 netlist、timing、module、focus、fanin/fanout depth、no-open 等启动参数；输出结构化 ready 信息 | 外部进程通过一条命令打开指定 netlist/module/focus；路径含空格时可用；仅监听 localhost；失败返回非零退出码和明确错误；接口有端到端测试与文档 | P2 | 计划中 |
| R6-7 | 大图改为搜索驱动的双向局部逻辑视图 | 已有 Whole/Fanin/Fanout 单向 cone；大图默认仍进入整图布局/渲染 | 新增 Focused neighborhood；Fanin depth 与 Fanout depth 独立可调，0 表示关闭该方向；搜索 cell 后自动设为 root；大图超过阈值时默认 Search-first，不自动布局/渲染整图；Overview 保留为显式入口 | 1024-cell 示例载入后无需先布局整图；搜索中间 cell 后只显示前后指定深度的并集；节点/边去重；增加深度只扩展对应方向；搜索和局部视图有性能预算 | P0 | 计划中 |
| R6-8 | module 浏览增加后退和前进 | 双击 module instance 可以进入定义，但返回父 module 只能手动选择下拉框 | 新增 module 导航历史、Back/Forward 按钮和快捷键；记录 module、view、cone root/depth、selection 与 viewport；历史恢复不重复入栈；新导航清空 forward 分支 | 从父 module 连续进入多层子 module 后可逐级后退和前进，并恢复原视图位置与选择；按钮无历史时禁用；重新加载 design 后旧历史清空；失效 module 项安全跳过 | P0 | 计划中 |
| R6-9 | 增加过程日志控件 | 当前状态栏只显示最后一条摘要，较早的解析、匹配、布局和渲染过程不可回看 | 新增底部可折叠 Process Log drawer；统一记录时间、级别、阶段、消息和可选详情；支持级别/阶段过滤、暂停自动滚动、清空、复制和导出；错误可自动展开；使用有上限的内存缓冲区 | 能连续查看 import、parse、timing match、graph、layout、render、navigation、export 和 launcher 过程；日志顺序稳定；高频渲染进度被节流/合并；达到容量上限后淘汰最旧记录且不拖慢千级图；默认不记录网表/时序原文 | P1 | 计划中 |
| R6-10 | 定位并放大到所选 cell | 搜索命中时可以居中，但缺少对当前 selection 可重复调用的统一定位操作，普通点击选择后也没有明确的 Focus 控件 | 在 View 区增加 Focus selected cell 按钮和快捷键；将所选 cell 移到可视区域中心，并按目标屏幕宽度计算稳定缩放；复用 viewport 纯函数；cell 不在当前局部图时先以它建立 Focused neighborhood；异步 layout/render 完成后再提交定位 | 选中任意可搜索 cell 后一键居中，cell 屏幕宽度达到默认约 320px 并受全局最小/最大缩放限制；重复调用结果稳定；selection 保持不变；无 cell selection 时控件禁用；不在局部图或折叠组中的 cell 也能正确显示并定位；Single 和 Compare active side 行为一致 | P0 | 计划中 |
| R6-11 | 可编辑并保存可复用 Cell Config | 当前可以对单个 instance 临时修改属性和 pin direction，但无法把未知 cell 的识别规则保存为按 cell type 复用的配置 | 新增 Cell Definition 编辑器；以 canonical cell type 为键设置受支持的 gate kind（AND/OR/MUX/INV/NAND/NOR/XOR/XNOR/BUF/REGISTER/BLACKBOX 等）和每个 pin 的 input/output/inout/unknown；应用到所有同类型实例；支持本地持久化、版本化 JSON 导入/导出、删除/重置和 `--cell-config` 启动参数 | 配置未知 cell 后当前 design 中所有同类型实例立即按新 gate/pin 语义重新构图；重新加载页面或其他网表仍可识别；导出后在新环境导入结果一致；不覆盖真实 submodule 定义；配置来源在 UI/诊断中标记为 `user-config`；非法 kind/direction/schema 被拒绝且不破坏已有配置 | P0 | 计划中 |

## 数据和状态设计

### 1. Timing IR

parser 只解析文本，不读取 graph。建议统一为以下概念结构：

```text
TimingDataset
  format
  scopes[]

TimingScope
  subject
  scopeKind: module | instance | unknown
  apply
  snapshots
    global
    local

TimingRecord
  direction: input | output
  at
  rt
  slack
  fullPath
  objectName
```

`rat` 只作为输入格式别名，进入 IR 后统一使用 `rt`。Global 表示 resyn 前，Local 表示 resyn 后。Auto snapshot 的默认规则为：`Apply:None` 使用 Global，明确应用优化结果时使用 Local；未知 Apply 值保留原文并给出诊断，不静默猜测。

### 2. 全图时序显示策略

```text
TimingDisplayPolicy
  snapshot: auto | global | local
  metrics: [at | rt | slack]
```

策略属于 graph/workspace 状态，不属于单个 cell。Selection 面板可以读取完整 timing record，但不能创建与全图策略冲突的单 cell 显示配置。

### 3. 聚焦视图状态

```text
FocusedViewState
  rootNodeId
  faninDepth
  fanoutDepth
```

Focused graph 是 fanin cone 与 fanout cone 的并集。完整 graph 仍用于搜索和连接分析，但大图默认不对完整 graph 执行 layout 和 SVG render。

### 4. Module 导航历史

```text
ModuleHistoryEntry
  moduleName
  viewMode
  coneRootNodeId
  faninDepth
  fanoutDepth
  selectedNodeId
  selectedNet
  transform
```

双击子 module、Module 下拉选择、跨 module 搜索和外部启动接口定位均视为正常导航：提交新 entry 并清空 forward 分支。Back/Forward 恢复历史时不再次入栈。Compare view 使用独立状态，不污染 Single view 的 module 历史。重新加载 design 后历史重置为新 design 的初始 module。

### 5. Process Log

```text
ProcessLogEntry
  sequence
  timestamp
  level: debug | info | warning | error
  phase: import | parse | timing | graph | layout | render | navigation | export | launcher
  message
  details?
```

过程日志由应用层统一发布，parser、layout 和 renderer 通过事件或回调报告阶段信息，不直接操作 DOM。日志缓冲区使用固定容量的 ring buffer；高频 progress 事件按 phase/key 合并或节流，避免每个 SVG batch 都创建永久记录。状态栏继续显示最新摘要，Process Log drawer 负责历史查看。

默认不写入完整网表、完整时序文本、启动 token 或其他敏感原文。导出的日志使用 UTF-8 文本或 JSON Lines，并明确包含的字段。

### 6. 所选 Cell 定位策略

```text
SelectionFocusPolicy
  targetWidthPx: 320
  minimumScale
  maximumScale
```

定位缩放使用 cell 的 graph bounds、SVG viewBox 和实际 canvas 尺寸计算，使不同 module、窗口大小和 cell 尺寸下的阅读尺度一致，不直接写死某个 SVG transform。重复执行 Focus selected cell 应得到相同的中心点和目标尺度。

如果目标 cell 已在当前 display graph 中，只更新 viewport，不重新运行 layout；如果它只存在于 full graph，则先将其设为 Focused view root，等待最新 layout/render request 完成后再居中。过期的异步请求不得覆盖更新后的 selection 或 viewport。Compare view 以 active side 为准；同步模式开启且另一侧存在匹配 cell 时，两侧使用各自几何位置定位到等效阅读尺度。

### 7. 可复用 Cell Config

配置文件使用独立、版本化的 JSON schema，不与 layout Golden 混用：

```text
CellConfigBundle
  kind: netlist-cell-config
  version: 1
  cells
    <canonicalCellType>
      displayName
      gateKind
      pins
        <canonicalPinName>: input | output | inout | unknown
```

编辑器从当前 design 中所有同类型 instance 收集 pin 名并显示出现次数和现有推断来源。用户可选择受 renderer 支持的 gate kind，并逐 pin 设置方向；未配置 pin 继续走后续 inference，而不是默认猜成 input。保存后重新推断所有引用该 primitive/blackbox cell type 的实例并重建受影响 module。

建议的语义优先级为：

1. 真实 submodule definition，保持层次结构，不允许被 Cell Config 改成 primitive gate。
2. 明确的 per-instance 临时 override，只影响该 instance。
3. 已加载 Liberty 定义。
4. 用户保存的 Cell Config，来源标记为 `user-config`。
5. 项目内置 cell/pin rules。
6. fallback/unknown。

浏览器模式默认使用本地持久化 adapter，使后续 design 自动加载已保存配置；同时必须提供确定性排序的 JSON 导出、导入、冲突预览、删除和恢复默认。EDA 集成使用同一 schema，通过 `--cell-config <path>` 显式加载。配置文件只包含数据，不允许表达式、脚本或动态代码。

## 实施分批

### 第一批：时序输入和显示正确性

1. 增加新格式 fixture 和 parser 单元测试。
2. 实现统一 Timing IR、Global/Local/Apply 解析和旧格式兼容。
3. 扩展 module boundary port 与 instance timing 匹配。
4. 将逐 cell badge 选择迁移为全图 TimingDisplayPolicy。
5. 增加显式 Paste timing 和 quick-input 检测。

### 第二批：可复用 Cell Config

1. 定义并验证版本化 CellConfigBundle schema、canonical 名称和受支持 gate kind/direction。
2. 在 inference 边界接入 `user-config` 来源和明确优先级，不覆盖 submodule definition。
3. 增加 Cell Definition 编辑器、同类型 instance/pin 汇总和保存前预览。
4. 增加本地持久化、JSON 导入/导出、冲突处理、删除和恢复默认。
5. 保存后增量识别受影响 cell type，并安全重建相关 module/workspace。
6. 为 EDA 启动接口预留 `--cell-config`，并记录 config load/apply 的 Process Log。

### 第三批：导航与大图分析路径

1. 实现 fanin/fanout 并集和独立深度。
2. 搜索结果激活后进入 Focused neighborhood。
3. 增加大图 Search-first 阈值、空态和显式 Overview。
4. 增加 module Back/Forward 历史及状态恢复。
5. 增加 Focus selected cell 控件、快捷键和异步渲染后定位流程。
6. 覆盖子 module、多层返回、搜索跨 module、历史分支和 selection 定位测试。

### 第四批：布局与界面收敛

1. 增加 Cell spacing policy、范围和 UI 控件。
2. 扩展 level congestion 估计和自适应间距。
3. 运行 hard invariant、quality 和 determinism 回归。
4. 重组顶部工具栏、Import/More 菜单和侧栏 Layout/Timing 区域。
5. 增加底部 Process Log drawer、日志过滤/复制/导出和错误自动展开。
6. 检查窄屏、键盘操作、tooltip、状态栏和日志反馈。

### 第五批：EDA 集成接口

1. 从 `main.js` 抽取加载、module 选择、聚焦和视图控制 API。
2. 定义稳定的 CLI/启动清单协议。
3. 让 Node、Python 和 Windows launcher 使用同一参数语义，包括 `--cell-config`。
4. 增加 localhost 安全边界、ready 输出、错误码和路径转义测试。
5. 更新 README、架构说明和集成示例。

## 主要修改边界

- `src/timing/`：时序文本解析、统一 IR、scope/node 匹配、显示策略解析。
- `src/infer/`：Cell Config schema、gate/pin 规则解析、`user-config` 来源和推断优先级。
- `src/analysis/graphCone.js`：双向局部图计算，不负责 UI 和 layout。
- `src/app/`：workspace 编排、module 历史、search-first 状态、Cell Config 持久化/导入导出和启动数据加载。
- `src/app/` 的日志服务：过程事件、级别、阶段、ring buffer、进度合并和导出数据边界。
- `src/ui/`、`index.html`、`styles.css`：Import、Timing、Layout、Cell Definition、Back/Forward、Focused view、Focus selected cell 和 Process Log drawer 控件。
- `src/layout/`：Cell spacing、拥塞感知 placement 和既有 route contract 消费。
- `tools/`：Node/Python/Windows 启动适配，不把业务解析逻辑复制到 launcher。
- `tests/unit/`、`examples/`：新格式 fixture、导航历史、双向 cone、布局质量和启动接口测试。

## 验证计划

### 时序

- 给定的新 module boundary 样例精确验证 Global/Local、INPUT/OUTPUT、AT/RT/Slack、full path 和 Apply。
- 旧 LocResyn instance timing fixture 全部保持通过。
- 重名 module/instance、总线端口、escaped identifier 和歧义匹配不误标。
- Single、Compare、SVG 使用同一个 snapshot/metric 策略。

### Cell Config

- 验证 exact cell type 匹配、canonical/escaped 名称、同类型多 instance 和不同 pin 集合。
- 验证 gate kind、pin direction、未知字段、错误版本和损坏 JSON 的 schema 诊断。
- 验证 submodule/per-instance/Liberty/user-config/built-in/fallback 的完整优先级矩阵。
- 验证保存后当前 design 重建、本地持久化、导入/导出 round trip、冲突处理、删除和恢复默认。
- 验证配置文件排序确定，不含代码；加载失败保留最后一份有效配置。

### 局部视图与导航

- fanin depth、fanout depth、0 深度和环路图均有单元测试。
- 搜索隐藏在 group 中的 cell 时基于 full graph 建立 Focused view。
- 1024-cell fixture 验证默认不做 Whole layout，搜索和局部 layout 满足性能预算。
- 多层 module 进入、后退、前进、新分支覆盖和 design reload 均验证历史状态。
- Focus selected cell 验证居中误差、目标屏幕宽度、缩放上下限、重复调用、隐藏目标、异步请求失效和无 selection disabled 状态。
- Compare 验证 active side 定位，以及同步模式下同名 cell 的双侧等效阅读尺度。

### 布局与 UI

- 所有仓库 Verilog fixture 继续满足正交、端点方向、node clearance 和不同 net 无共线重叠。
- Cell spacing 最小值、最大值和 session/Golden round trip 有测试。
- 顶部菜单、粘贴对话框、Back/Forward disabled 状态和键盘快捷键有 UI 测试。
- Process Log 验证阶段顺序、级别/阶段过滤、容量淘汰、进度合并、复制/导出、错误自动展开和无敏感原文。
- 1024-cell 渲染期间日志记录不得突破单独的交互性能预算。

### 启动接口

- Node、Python 和 Windows 参数契约一致。
- netlist-only、netlist+timing、指定 module、指定 focus 和非法输入均有端到端测试。
- `--cell-config` 验证有效配置、路径含空格、配置冲突和无效 schema 的退出行为。
- 默认只监听 `127.0.0.1`，不提供任意路径读取 API。

## 完成标准

- 新旧时序格式均可通过文件、拖放和直接粘贴载入。
- module boundary 和后续同格式 instance timing 可以复用同一 IR 与匹配流程。
- 未知 primitive/blackbox cell 可以配置 gate kind 和 pin direction，保存后在后续 design 和启动中自动复用，并保持可导入导出。
- 全图可统一切换 Auto/Global/Local 和 Slack/AT/RT/All。
- 大图可以不渲染 Whole，搜索 cell 后直接查看可调双向局部逻辑。
- Cell spacing 能有效增加走线通道且不破坏既有布局硬约束。
- module 层次浏览具备可恢复视图状态的后退和前进。
- 所选 cell 可以从 View 区一键居中并缩放到稳定可读级别，目标不在当前局部图时可自动建立 Focused neighborhood。
- 用户可以通过可折叠 Process Log 回看关键处理阶段、过滤或导出日志，且大图进度日志不会造成明显卡顿。
- 现有 EDA 工具可以通过稳定启动命令打开指定设计和分析位置。
- `npm test`、布局质量回归、1024-cell 性能测试和启动接口端到端测试全部通过。

## 本阶段不做

- 不进行 STA 计算，只消费外部时序结果。
- 不根据 Local 优于或劣于 Global 自行决定是否 Apply，只遵循输入中的 Apply 结果并提供查看。
- 不实现完整 Verilog/SystemVerilog 或完整 Liberty timing。
- 不承诺为超大 module 生成一张始终可读的完整静态图，优先保证搜索和局部 cone 工作流。
- 不在启动接口中开放远程网络访问或任意文件系统浏览。
- 不默认持久化无限历史日志，也不默认记录完整网表、完整时序文本或安全 token。
- Cell Config 不执行脚本，不替代真实 submodule definition，也不扩展为完整 Liberty 数据库。
