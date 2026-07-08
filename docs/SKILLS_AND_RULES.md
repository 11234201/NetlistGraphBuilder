# Skill 与写入规则

## 目的

本项目会逐渐积累项目专用工作流，例如：

- 如何解析 structural Verilog。
- 如何判断 cell/pin 方向。
- 如何设计 schematic 交互。
- 如何验证 SVG 布局质量。
- 如何处理离线依赖。

这些规则需要稳定存放，避免散落在临时对话中。

## 存放位置

项目专用 skill 放在：

```text
docs/skills/<skill-name>/SKILL.md
```

公共设计和工程规范放在：

```text
docs/DESIGN_SPEC.md
docs/ARCHITECTURE.md
docs/PLAN.md
docs/STAGE_<N>_PLAN.md
```

如果未来需要迁移到 Codex 全局 skill，再从 `docs/skills/` 中挑选稳定版本安装，不直接把实验性规则写进全局目录。

## 写入规则

每个 skill 必须包含：

- 适用场景。
- 必读上下文。
- 输入和输出约定。
- 禁止事项。
- 验证清单。

skill 不能替代项目计划。长期路线写入 `docs/PLAN.md`，阶段细化写入 `docs/STAGE_<N>_PLAN.md`，架构边界写入 `docs/ARCHITECTURE.md`，界面/交互规范写入 `docs/DESIGN_SPEC.md`。

每个阶段的细化方案必须单独写入：

```text
docs/STAGE_<N>_PLAN.md
```

总计划中只保留阶段边界和链接，不把所有细节堆进 `docs/PLAN.md`。

## 修改规则

- 修改 skill 前，先确认它描述的是可复用流程，而不是一次性任务记录。
- 修改设计规范前，检查是否会影响已有 UI 行为。
- 修改架构边界前，检查是否需要同步更新 `README.md`、`docs/PLAN.md` 和对应阶段计划。
- 新增依赖或工具链规则时，必须说明离线使用方式。

## 写代码前阅读规则

任何功能代码开始前，必须读：

1. `docs/PLAN.md`
2. 当前阶段对应的 `docs/STAGE_<N>_PLAN.md`
3. `docs/ARCHITECTURE.md`

如果涉及 UI、SVG、布局或交互，必须额外读：

1. `docs/DESIGN_SPEC.md`

如果涉及自动化、agent workflow、提示词或项目专用技能，必须额外读：

1. `docs/SKILLS_AND_RULES.md`
2. 相关 `docs/skills/<skill-name>/SKILL.md`

