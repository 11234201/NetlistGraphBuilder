# Netlist Schematic Skill

## 适用场景

当任务涉及门级网表解析、结构图生成、fanin/fanout cone 分析、module 对比、cell/pin 推断或 SVG schematic 交互时，使用本 skill。

## 必读上下文

开始实现前，先读：

- `docs/PLAN.md`
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

## 验证清单

- escaped identifier 是否保留正确显示。
- assign alias 是否被合理处理。
- 每个 output 是否能追到 driver。
- 多 fanout net 是否能显示或高亮。
- unknown cell 是否能稳定渲染。
- SVG 缩放后文字和 gate 是否清楚。

