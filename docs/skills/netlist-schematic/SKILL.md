---
name: netlist-schematic
description: Maintain and extend this repository's structural-Verilog parser, netlist graph, cell/pin inference, schematic layout and routing, SVG rendering, timing annotation, comparison, and large-canvas interactions. Use for code, tests, fixtures, performance work, or reviews that touch `src/parser`, `src/netlist`, `src/infer`, `src/analysis`, `src/layout`, `src/render`, `src/timing`, schematic UI/workspaces, or mapped-netlist regressions.
---

# Netlist schematic development

## 适用场景

当任务涉及门级网表解析、结构图生成、fanin/fanout cone 分析、module 对比、cell/pin 推断或 SVG schematic 交互时，使用本 skill。

## 必读上下文

开始实现前，先读：

- `AGENTS.md`
- `docs/PLAN.md`
- 当前阶段对应的 `docs/STAGE_<N>_PLAN.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN_SPEC.md`
- `docs/SKILLS_AND_RULES.md`

## 工作原则

- 优先支持 structural Verilog 子集。
- 无 `.lib` 是默认工作模式，不应被视为异常。
- unknown cell 画 blackbox，不中断流程。
- parser 只解析结构，不做门类型推断。
- 推断规则必须可测试、可替换。
- UI 的第一目标是读结构、追 cone、比差异。
- 先确认改动属于 parser、IR/inference、display transform、layout、render 还是 UI；在拥有该
  约束的最低层实现并测试，不跨层打补丁。
- 优先扩展共享边界，使 Single/Compare、Simple/Adjust/ELK 同时获得一致行为。

## 实现约束

### Parser 与图模型

- parser 保留 canonical name、display name、packed range、source span 和声明语义，不消除
  assign alias，不推断 gate/pin。
- 无 `.lib` 时使用可追踪的 `rule`/`fallback`/`unknown` 来源；unknown cell 必须继续生成
  blackbox。新增标准单元匹配时同时验证 cell kind 和关键 pin direction。
- Netlist IR 是源数据。alias、timing、cone、fanout hub 和 group collapse 是派生显示图变换，
  不得修改 parser IR 或调用者传入的 graph。
- 对公开数组建立缓存索引时，数组被替换或长度变化后必须能够重建，不能改变公开 IR
  形状来换取性能。

### Timing

- timing parser 只把文本规范化为 timing IR，不读取 graph 或 DOM。输入中的 `rat` 统一存为
  `rt`，但不得破坏旧 LocResyn 格式兼容性。
- Global/Local 和 Apply 原文必须保留。Auto snapshot 使用明确、可测试的规则；未知 Apply 值
  产生诊断并安全回退，不能根据数值优劣自行猜测是否应用 Local。
- timing scope 到 module/instance 的匹配属于 annotation 层。层级匹配使用最长、无歧义的后缀；
  module boundary port 与 cell pin 不得混用匹配路径。
- timing display policy 属于 workspace/session 的全图状态，Single、Compare 和 SVG 必须消费同一
  snapshot/metrics 选择；Selection 可以展示完整记录，但不能创建冲突的单 cell 全局策略。

### Layout 与 routing

- 先把问题分类为硬约束或软目标。正交、pin 侧进入、端点保护、节点避障和不同 net 不共线
  重叠属于硬约束；直线率、折点、长度、交叉和 outer lane 使用属于软目标。
- 硬约束进入共享 orthogonal contract 和 validator；软目标进入 candidate/score/policy。
- Simple 与 Adjust 共享 route validation、lane collection、segment index、search limits 和 costs。
  ELK 输出也必须规范化为相同 positioned graph contract。
- 所有拓扑排序、lane reservation、label priority 和 reroute order 必须对 node/edge 数组排列不敏感。
- 候选搜索设置固定上限；用 spatial index 缩小集合，但最终仍用几何谓词判定。禁止恢复全图
  all-pairs 扫描或按图规模增长的 fallback 尝试。
- 自动 provider graph 与 adjusted graph 分开保存。人工位置/尺寸是 override；拖动不得重新运行
  provider，Reset 必须能恢复自动结果。

### Render 与交互

- render 只消费 positioned graph，不解析 Verilog、不重新布局、不计算 cone。
- 大图用惰性 render plan 和可取消的分批 DOM 提交，不能预先生成全部批次再假装渐进渲染。
- pan、zoom、drag 用共享 viewport/pointer/frame helpers。高频事件每帧最多提交一次轻量 DOM
  更新；gesture 中不做整图 innerHTML、provider layout 或 session persistence。
- 节点拖动中只移动 preview 节点并弱化相连边；松手后执行一次 override/reroute/full render。
- 所有来自网表、timing、Golden 或用户编辑的 HTML/SVG 文本都必须经过共享 escape helper。

## 验证矩阵

| 改动 | 最低验证 |
| --- | --- |
| parser / model / inference | 对应单元测试；包含真实命名、escaped/vector/hierarchy 边界 |
| timing parser / annotation | 新旧格式兼容、scope 匹配、Apply/Auto 和 Single/Compare policy 测试 |
| graph transform / workspace | 不变性测试；验证输入未突变，Single/Compare 行为一致 |
| layout / routing / labels | focused test + `layout-determinism` + `layout-fixtures` + `npm test` |
| viewport / pointer / panel | 纯 helper 单测；大图交互改动再做浏览器拖动、缩放、平移实测 |
| complexity-sensitive path | `npm run benchmark`，并检查没有尺寸相关的候选或扫描爆炸 |
| synthesized-netlist path | `npm run test:mapped-cases`；必要时设置 `MAPPED_CASE_NO_COLLAPSE=1` |
| Windows release inputs | `npm run release:windows`，验证离线启动、静态资源和许可证 |

映射 case 默认固定为 `tests/fixtures/mapped/` 下的 47 个 `_mapped.v` 文件。只有网表和稳定测试
脚本进入 Git；综合日志、JSON、报告和临时产物留在已忽略的 `dc_runs/`。

## 输入约定

常见输入：

- `.v` 或 `.sv` 文本。
- 单个 module 或多个 module。
- 可选 cell rule 配置。
- 未来可选 Liberty `.lib`。

## 输出约定

常见输出：

- Netlist IR。
- 分析图模型。
- 布局后的 positioned graph。
- SVG schematic。
- 交互状态，例如 selected object、highlight cone、search result。

## 禁止事项

- 不把 Mermaid/LLM 作为主要绘图路径。
- 不在 parser 层写 UI 逻辑。
- 不在 render 层解析 Verilog。
- 不因为某个 cell 无法识别就停止绘图。
- 不在没有必要时引入必须联网安装的依赖。
- 不用 instance 名称、fixture 文件名或单个绝对坐标修复布局。
- 不在 pointer/wheel handler 中复制 viewport 数学或运行昂贵流水线。
- 不通过放宽 validator、性能预算或 mapped-case 数量掩盖回归。

## 验证清单

- escaped identifier 是否保留正确显示。
- assign alias 是否被合理处理。
- 每个 output 是否能追到 driver。
- 多 fanout net 是否能显示或高亮。
- unknown cell 是否能稳定渲染。
- SVG 缩放后文字和 gate 是否清楚。
- node/edge 输入顺序变化后结果是否稳定。
- 大图候选数量、布局时间、首批渲染和交互响应是否仍有界。
- mapped case 是否全部完成布线并保持 violation budget。
