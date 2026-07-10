# Netlist Graph Builder

一个面向门级网表的离线 schematic browser。目标是在没有 Liberty `.lib` 的情况下，快速解析 structural Verilog，生成可缩放、可搜索、可追踪 fanin/fanout cone 的结构图。

当前仓库处于项目准备阶段，先建立计划、规范和目录骨架；正式写功能代码前必须先通读 [docs/PLAN.md](docs/PLAN.md)。

## 目标

- 支持内网/离线使用。
- 支持 gate-level structural Verilog 的常见子集。
- 无 `.lib` 时通过 cell/pin 命名规则推断门类型和方向。
- 用交互图帮助分析结构，而不是只生成静态图片。
- 长期支持 module 对比、cone 追踪、层级折叠和可选 `.lib` 增强。

## 当前状态

阶段 1 最小原型已经具备：

- structural Verilog fixture 解析。
- module 选择。
- 无 `.lib` cell/pin 启发式推断。
- 简单 left-to-right layered layout。
- SVG schematic 渲染。
- 鼠标滚轮缩放、拖拽平移、fit to view。
- 文件导入。

## 目录

```text
docs/                 项目计划、架构、设计规范、流程规则
docs/skills/          项目专用 skill 文档和写入规范
examples/             示例网表和后续示例输出
src/parser/           Verilog structural parser
src/netlist/          Netlist IR 和图模型
src/infer/            无 lib cell/pin 推断规则
src/layout/           布局策略、节点几何和正交路由
src/render/           SVG gate symbol 和连线渲染
src/timing/           时序日志解析和 graph annotation
src/ui/               无状态面板渲染和 DOM 绑定
src/app/              应用状态和装配入口
tests/fixtures/       测试网表夹具
tests/unit/           单元测试
vendor/               离线 vendored 第三方前端库
tools/                开发、检查、打包脚本
```

## 运行

```powershell
node tools/serve.mjs
```

然后打开：

```text
http://127.0.0.1:4173/
```

当前版本没有外部运行依赖。页面默认加载内置示例网表，也可以通过工具栏打开 `.v`、`.sv` 或 `.txt` 文件。

## 测试

```powershell
node --test tests/unit/*.test.js
```

测试覆盖：

- escaped identifier tokenizer。
- fixture module 解析。
- assign 解析。
- 常见 cell type 推断。
- graph 构建。
- SVG smoke render。

## 开发前置规则

1. 写业务代码前，先通读 `docs/PLAN.md`。
2. 再读当前阶段的细化方案，例如 `docs/STAGE_1_PLAN.md`。
3. 涉及 UI 或图形交互时，同时通读 `docs/DESIGN_SPEC.md`。
4. 引入或更新项目专用工作流时，按 `docs/SKILLS_AND_RULES.md` 写入。
5. 每个阶段只实现当前阶段明确列出的功能，避免提前引入重依赖。
