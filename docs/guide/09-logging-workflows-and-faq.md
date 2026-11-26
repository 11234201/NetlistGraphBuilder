# 9. Process Log、终端日志、推荐工作流与常见问题

> 返回 [完整使用教程目录](../USER_GUIDE.md) · 上一章：[8. SSH 远程工作台、命令行启动器与 EDA/Tcl 集成](08-remote-workbench-and-eda.md)

本章介绍浏览器内 `Process Log` 与 `Diagnostics` 诊断抽屉、终端启动器磁盘日志与自动清理、六套典型工程推荐工作流，以及覆盖全功能的常见问题排查手册。

---

## 9.1 浏览器 Process Log 与 Diagnostics

底部状态栏右侧提供两个带计数的独立抽屉入口：

- **`Diagnostics`**：展示当前设计解析、Liberty 语义冲突、AIG/BLIF 映射与布局降级等业务诊断列表。
- **`Log`（Process Log）**：按 11 个处理阶段（`Phase`）记录运行轨迹与结构化错误：
  `Import`、`Parse`、`Timing`、`Graph`、`Layout`、`Render`、`Navigation`、`Export`、`Launcher`、`Persistence`、`Runtime`。

**面板控件与特性**：

- **过滤与操作**：支持按 `Level`（`Debug` / `Info` / `Warning` / `Error`）与 `Phase` 过滤；`Auto-scroll` 自动跟随最新条目；`Copy` 复制当前过滤结果；`Export` 导出为 `netlist-process-log.jsonl`；`Clear` 清空内存记录。
- **容量与脱敏**：页面内存中默认保留最近 **500 条**（相邻同任务渐进渲染进度自动合并）。失败条目的 `details` 保留原始错误名、调用栈、`cause`、操作上下文与源码位置，并递归过滤完整网表/时序/口令/token 等敏感字段，限制深度与大小。
- **归类规则**：
  - 用户主动取消或过期的异步任务不记为当前操作错误。
  - 会话或 `Cell Config` 读写失败归入 `Persistence`（连续自动保存失败仅报告一次，恢复后记录 `Session saving recovered`）；配置已保存但刷新视图失败归入 `Render`；SVG / Golden / Cell Config 生成或下载失败归入 `Export`。

---

## 9.2 终端与启动器磁盘日志

Bash 预览入口、Node、Python、Linux 单文件 `ngb` 与 Windows 离线启动器会自动将终端侧 JSONL 日志写入磁盘（与页面内存 `Process Log` 独立），用于排查启动、文件读取、HTTP 请求、状态文件与退出问题：

- **默认目录与自定义**：
  - Linux：`${XDG_STATE_HOME:-$HOME/.local/state}/netlist_graph_builder/logs`
  - Windows：`%LOCALAPPDATA%\netlist_graph_builder\logs`
  - 可通过环境变量 `NGB_LOG_DIR` 自定义目录；启动时的 `log.ready` 事件会指明路径。
- **文件命名与大小轮转**：每次启动生成 `<运行时>-<时间>-<PID>.run.jsonl`（全级别，普通 4xx 记为 `Warning`）与 `.error.jsonl`（仅 `Error`）。单文件默认约 **2 MiB** 轮转并保留一个 `.1` 备份，可通过 `NGB_LOG_MAX_BYTES`（`1024`–`67108864` 字节）调整。
- **自动过期清理（默认 14 天）**：启动时自动清理超过 14 天且同组文件全部过期、对应 PID 已退出的旧日志；可通过 `NGB_LOG_RETENTION_DAYS`（`1`–`3650` 天，`0` 关闭）调整。不递归子目录、不碰无关文件与符号链接，清理结果记入 `log.cleanup` / `log.cleanup_failed`。
- **脱敏与标准流隔离**：JSONL 字段包含 `time`、`level`、`runtime`、`pid`、`event`、`message` 等，绝不记录查询参数、请求正文或网表原文。正常请求仅写文件，启动/失败诊断同步至 `stderr`；日志目录不可写时告警一次并回退至 `stderr`，不影响服务启动与 `stdout` 单行 `ready` JSON 协议。

```bash
NGB_LOG_DIR="$PWD/dc_runs/launcher_logs" bash tools/start-preview.sh --port 0 --no-open
```

---

## 9.3 推荐工程工作流

### 1. 大型网表中快速定位并追踪目标单元

1. 导入网表（`> 500` 单元的模块自动进入 `Search-first`）。
2. 按 `/` 聚焦顶部搜索，输入目标实例或线网名并按 `Enter`，瞬间进入围绕该对象的 `Focused` 视图。
3. 在画布上方调整 `Fanin` / `Fanout` 深度。
4. 在 `Inspector → Connections` 中点击上下游驱动、负载或跨层 `Parent` 连接顺藤摸瓜；随时按 `F` 居中放大选中项。

### 2. 排查负 Slack 关键路径周边门级结构

1. 先导入 Verilog 网表，再导入配套 Timing 报告（或通过 `File → Open design…` 一同选中）。
2. 在 `Settings → Timing` 将 `Metric` 设为 `Worst Slack`，按需调整 `Threshold`（默认 `0.0`）。
3. 顶部搜索报告中的违例单元或端口进入 `Focused`（仅回溯驱动侧可将 `Fanout` 设为 `0`）。
4. 选中关键单元，在 `Inspector → Timing` 核对各引脚 `AT`、`RT`、`Slack` 与 `worst pin`；若缺时序，查看漏配原因并按需点击 `Log cell timing details`。

### 3. 补充未知标准单元定义并团队复用

1. 搜索或点击图中显示为 `BLACKBOX` 的未知原语单元。
2. 点击 Inspector 底部 `Edit cell type…`，核对自动预填的推断值并修正 `Gate kind` 与引脚方向。
3. 点击 `Save`，确认同类型实例全部更新且来源变为 `user-config`。
4. 通过 `Settings → Cell Config → Export definitions` 导出 JSON，供团队成员导入或通过 `--cell-config` 传入启动脚本。

### 4. 手工微调原理图并保存为 Golden 复盘

1. 点击上下文栏 `Adjust` 进入校准模式。
2. 拖拽调整节点位置，或在 `Inspector → Adjust` 修改尺寸/属性/引脚方向，释放鼠标检查局部重布线。
3. 再次点击 `Adjust` 退出校准，通过 `File → Save Golden` 导出 `.json` 快照。
4. 日后复盘时先加载同一份网表，再通过 `File → Load Golden…` 完整还原视图、路径查询与微调坐标。

### 5. 对比优化前后的两个模块（Resyn vs. Flex）

1. 加载包含两个模块的网表（或在 Compare 配置行用 `A files` / `B files` 独立导入两侧网表与时序）。
2. 点击顶部 `Compare`，确认 A/B 配对并点击 `Apply`。
3. 在 `Navigator → Design` 对比单元数、逻辑深度差值与模块注释属性，观察画布绿/红差异高亮。
4. 在 `Sync & cone → Output cone` 选择共有输出端口同步对比扇入锥，或点击同名对象跨侧联动定位。

### 6. 放大画布并按需恢复详情

1. 通过 Search 或 `Navigator → Hierarchy` 打开目标模块。
2. 点击 Navigator 与 Inspector 的 `Hide` 按钮让画布占满整个工作区宽度，继续缩放或点击 `Fit view`。
3. 点击图中对象时顶部对象摘要同步更新；需要查详情时点击该摘要或 `Inspector` 开关展开，看完再 `Hide`。Compare 模式同样适用。

---

## 9.4 常见问题与排查

### 网表与导入

- **导入后显示 `Search-first` 提示页而没有直接画图？**
  这是针对超过 `500` 个单元的大模块的预期性能保护。请用顶部 `Search` 检索目标进入 `Focused`，或显式点击上下文栏 `Whole` 渲染全图。
- **打开 `Cell Config` 编辑器时显示 `BLACKBOX`？**
  当该 `cell type` 未命中内置规则且无自定义配置时，默认回退为 `BLACKBOX` / `unknown`。手动指定后点击 `Save`，在 Inspector 确认来源变为 `user-config`。
- **保存 `Cell Config` 后布局发生变化？**
  修改引脚 `input`/`output` 方向会改变驱动/负载拓扑流向，因此需要重新提取图并布局；大模块会自动保持当前 `Focused` 局部图，不会触发全图重排。
- **`Whole` 整图模式画面很细长或较慢？**
  数千单元或上千级串行长链建议优先使用 `Search-first` + 有限深度 `Focused`，并保持 `Fanout hubs` 开启（分组折叠已退役）。
- **为什么点击搜索结果、`Add to Focused` 与 `Replace roots` 效果不同？**
  点击**已绘制**的搜索结果仅居中定位、不改 roots；点击**未绘制**的搜索结果自动**追加**为 root；`Add to Focused` 显式追加；`Replace roots` 显式清空旧集合仅保留当前选中项。上限 32 个 roots，跨模块搜索自动切换独立工作区。

### Timing、Compare 与 Golden

- **导入 Timing 后画布没有时序徽标？**
  依次检查：① `Settings → Timing` 的 `Metric` 是否为 `None`，或缩放倍率是否 `< 0.65`（触发 LOD 隐藏）；② `@module` 或 JSON `"module"`/`"modules"` 是否与当前模块一致；③ `point` 是否匹配当前模块对象；④ 列式文本表头与数据列是否对齐。若仅部分 cell 缺时序，选中后打开 `Inspector → Timing` 查看候选路径、作用域过滤与告警，并可点 `Log cell timing details` 导出排查。
- **Compare 中的红色虚线代表电路不等价吗？**
  **不是**。Compare 仅基于名称、方向、门类型与统计量做启发式结构提示，并非形式化等价验证（LEC）。
- **为什么 Layout Golden 无法加载？**
  请先载入对应网表。Golden v3/v4 校验领域、模块名与网表内容指纹（fingerprint），网表内容一旦改动即安全拒绝，具体原因见状态栏与 `Process Log`。

### 界面、恢复与安全

- **左右面板不见了，或点击对象后不弹出详情？**
  点击顶部 `Navigator` / `Inspector`（或顶部对象摘要）即可恢复。主动隐藏 Inspector 后点击对象不会强制弹出；窄屏抽屉在点击画布或刷新后收起且两侧不同时展开。
- **更新版本后还是旧界面，或面板偏好没沿用？**
  确认启动器来自最新程序包并访问启动器输出的实际 URL；Windows 需完整替换程序包、Linux 单文件版需使用新二进制；必要时强制刷新浏览器。面板偏好按浏览器与站点地址（含端口）保存，换端口后需重新设置。
- **刷新页面与关闭标签页后哪些数据会保留？**
  同标签页刷新从 `sessionStorage` 恢复网表/AIG 会话（关闭标签页清除）；`Cell Config` 与面板偏好保存在 `localStorage` 长期保留；Liberty 库仅驻留页面内存，刷新需重载。
- **运行时安全与离线边界是什么？**
  100% 离线运行、仅绑定 `127.0.0.1`、所有网表/用户输入插入 HTML/SVG 前严格 XSS 转义、`Process Log` 与 `ready` JSON 均不输出完整源码原文。

### AIG 与 Level

- **点选 AIG 节点后看不到相关结构，或只看到部分关联？**
  确认右侧在 `Inspector → Analysis` 且左侧当前范围分析已完成；查询 PO 请先经 `Connections` 跳至驱动 AND；重汇聚索引仅含两条见证路径，且每类关联列表最多展开前 20 项。
- **块标签与输出名称的 XOR / XNOR 含义不同？**
  块标签以正相根函数为准；查看 `Root output uses` 中该输出端口的公式即可确认经过出边极性后实际得到的函数。
- **分析显示完成，为什么 `Path union` 仍在计算或显示 `partial`？**
  主结构分析与按需路径并集各自独立运行与计费；并集受限不影响已证明的两条见证路径。
- **文件后缀正确但 AIG 导入失败？**
  `.dot` 须符合 ABC `write_dot` 约定；`.blif` 须为平坦两输入组合逻辑，不支持 `.latch`、`.subckt`、`.gate` 或超过两输入的真值表。
- **AIG 红色高亮是否代表 STA 时序违例？如何填入层级与裕量？**
  红色高亮表示按整数逻辑级数计算的最长拓扑层级路径（未载入 Level 时为单位 AND 深度，载入后计入主输入初始 `at_level`），非物理时间延时。通过 `File → AIG + Level → Open levels…` / `Paste levels…` 导入 `.level` 后可在 `Inspector → Analysis` 查看整数级 AT / RT / Slack。
- **在 `Navigator → Objects` 筛选后，画布为什么没变小？**
  `Objects` 筛选仅过滤左侧列表，点击 `Show selection` 可定位当前选中项所在页；裁剪画布请使用 `Focused` 或 `Show Path`。
- **遇到 Graphviz 布局超时（20 秒）怎么办？**
  点击 `File → Cancel AIG import`，勾选 `File → Open AIG in Search-first`（或在粘贴对话框选 `Search-first`）重新导入，再通过 `Focused` 或 `Show Path` 仅布局局部子图。
- **为什么 Timing、Golden、Compare、Liberty 或 Cell Config 按钮不可用？**
  这些功能专属于门级 Verilog 网表工作区；AIG 使用同组的 `Open levels…` / `Paste levels…` 与 `Add AIG file(s)…`。重新打开 Verilog 网表即可恢复全部网表功能。
- **标签页刷新恢复等同于保存文件吗？**
  **不是**。AIG 会话（含多图与 Level 附件）仅存于当前标签页 `sessionStorage`，长期保存请保留原始 `.dot` / `.blif` / `.level` 文件并按需 `File → Export SVG`。
