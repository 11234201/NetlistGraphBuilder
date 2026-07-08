# 阶段 0 细化计划

## 阶段目标

阶段 0 负责把项目从空目录变成可持续演进的工程仓库。重点是计划、规范、目录边界和示例资产，不写核心业务代码。

## 任务拆分

### 1. 初始化仓库

- 创建 Git 仓库。
- 建立基础忽略规则。
- 固定文本编码和行尾策略。
- 完成初始提交。

### 2. 建立目录骨架

需要创建并保留以下目录：

- `docs/`
- `docs/skills/`
- `examples/`
- `src/parser/`
- `src/netlist/`
- `src/infer/`
- `src/layout/`
- `src/render/`
- `src/ui/`
- `src/app/`
- `tests/fixtures/`
- `tests/unit/`
- `vendor/`
- `tools/`

### 3. 写入总计划与规范

必须写入：

- `README.md`
- `docs/PLAN.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN_SPEC.md`
- `docs/SKILLS_AND_RULES.md`

### 4. 建立项目专用 skill 草案

必须写入：

- `docs/skills/netlist-schematic/SKILL.md`

该 skill 只作为项目内工作流，不直接写入全局 Codex skill。

### 5. 准备示例网表

必须写入：

- `examples/two_equivalent_style_modules.v`
- `tests/fixtures/two_equivalent_style_modules.v`

## 完成标准

- `git status` 干净。
- 新成员可以通过 `README.md`、`docs/PLAN.md`、`docs/ARCHITECTURE.md` 理解项目方向。
- 写代码前阅读规则明确。
- 目录边界清楚。

## 本阶段不做

- 不实现 parser。
- 不实现 UI。
- 不引入第三方依赖。
- 不做任何网表渲染逻辑。
