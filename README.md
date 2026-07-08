# Netlist Graph Builder

一个面向门级网表的离线 schematic browser。目标是在没有 Liberty `.lib` 的情况下，快速解析 structural Verilog，生成可缩放、可搜索、可追踪 fanin/fanout cone 的结构图。

当前仓库处于项目准备阶段，先建立计划、规范和目录骨架；正式写功能代码前必须先通读 [docs/PLAN.md](docs/PLAN.md)。

## 目标

- 支持内网/离线使用。
- 支持 gate-level structural Verilog 的常见子集。
- 无 `.lib` 时通过 cell/pin 命名规则推断门类型和方向。
- 用交互图帮助分析结构，而不是只生成静态图片。
- 长期支持 module 对比、cone 追踪、层级折叠和可选 `.lib` 增强。

## 目录

```text
docs/                 项目计划、架构、设计规范、流程规则
docs/skills/          项目专用 skill 文档和写入规范
examples/             示例网表和后续示例输出
src/parser/           Verilog structural parser
src/netlist/          Netlist IR 和图模型
src/infer/            无 lib cell/pin 推断规则
src/layout/           布局适配层，长期以 ELK.js 为主
src/render/           SVG gate symbol 和连线渲染
src/ui/               离线网页 UI
src/app/              应用装配入口
tests/fixtures/       测试网表夹具
tests/unit/           单元测试
vendor/               离线 vendored 第三方前端库
tools/                开发、检查、打包脚本
```

## 开发前置规则

1. 写业务代码前，先通读 `docs/PLAN.md`。
2. 涉及 UI 或图形交互时，同时通读 `docs/DESIGN_SPEC.md`。
3. 引入或更新项目专用工作流时，按 `docs/SKILLS_AND_RULES.md` 写入。
4. 每个阶段只实现当前阶段明确列出的功能，避免提前引入重依赖。

