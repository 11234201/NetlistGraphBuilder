# 项目专用 Skill 与文档维护规范

## 1. 目的

本项目在演进过程中沉淀了一系列领域专用的开发工作流与约束，例如：

- 如何解析结构化 Verilog（Structural Verilog）并保留双名称标识。
- 如何在缺乏 Liberty（`.lib`）时推断标准单元门类型与引脚方向。
- 如何设计并验证原理图（Schematic）交互与工作区生命周期。
- 如何量化和校验 SVG 正交布局与布线质量。
- 如何维护零构建、纯离线的第三方依赖与跨平台单文件发布包。

这些规范需要稳定记录在版本库中，避免散落在临时对话记录里。

## 2. 文档与 Skill 存放位置

项目专用的 AI 辅助开发技能（Skill）统一存放在：

```text
docs/skills/<skill-name>/SKILL.md
```

公共设计规范、系统架构与阶段工程计划存放在：

```text
docs/DESIGN_SPEC.md
docs/ARCHITECTURE.md
docs/PLAN.md
docs/STAGE_<N>_PLAN.md
```

仓库根目录的 `AGENTS.md` 是 AI 编码代理与新贡献者的自动发现入口，仅保留跨领域、必须无条件遵守的核心工程约束，并路由链接至上述详细文档与对应 Skill。具体领域细节不在 `AGENTS.md` 与 `SKILL.md` 之间重复堆砌。

若日后需要将某项项目 Skill 提升为全局通用 Skill，应从 `docs/skills/` 中挑选已充分验证的稳定版本进行安装，切勿将尚处于试验阶段的规则直接写入全局配置目录。

## 3. Skill 编写要求

每个 `SKILL.md` 必须包含以下结构：

- **可被工具解析的 YAML Frontmatter**：包含 `name` 以及清晰覆盖触发场景的 `description`。
- **适用场景**：明确何时应当激活该技能。
- **必读上下文**：开始修改代码前必须预先阅读的文档清单。
- **核心工作原则与实现约束**：输入输出契约、分层边界与禁止事项。
- **验证矩阵**：不同模块改动对应的最低验证要求。

**职责区分**：Skill 用于指导可复用的开发与验证流程，不能替代项目路线图。长期演进路线写入 `docs/PLAN.md`，各阶段任务拆解写入 `docs/STAGE_<N>_PLAN.md`，模块分层边界写入 `docs/ARCHITECTURE.md`，界面与交互准则写入 `docs/DESIGN_SPEC.md`。

## 4. 文档维护与变更准则

- 修改 `SKILL.md` 前，请确认其描述的是可复用的工程规范，而非一次性任务日志。
- 修改 `docs/DESIGN_SPEC.md` 前，请评估是否与现有 UI 交互行为存在冲突。
- 修改 `docs/ARCHITECTURE.md` 中的模块契约或边界时，请检查是否需要同步更新 `README.md`、`docs/PLAN.md` 及对应阶段计划。
- 引入任何新的开发工具或运行时依赖时，必须明确说明其离线运行方式与许可证合规策略。

## 5. 受控环境下的远程推送故障处理

在受控 Agent 环境（如带有推送审批服务的沙箱环境）中执行 `git push` 时，若审批服务在 Git 命令真正执行前因网络或连接中断拒绝了操作，请遵循以下处理步骤：

1. 不要将审批连接中断误判为 Git 仓库损坏或 GitHub 远端故障，切勿擅自篡改提交历史、远端 URL 或认证配置。
2. 先执行 `git status --short --branch` 确认本地分支仍领先于远端分支；必要时通过 `git log -3 --oneline` 核对待推送的提交记录。
3. 向用户明确说明失败发生在推送审批阶段，并在获得用户再次授权后原样重试 `git push origin <branch>`。
4. 推送返回成功后，再次核对分支状态；仅当确认本地分支不再领先远端时，才向用户报告推送完成。
5. 严禁尝试通过非授权脚本、替代命令或外部接口绕过推送审批机制。

## 6. 编码前必读清单

在动手编写或修改任何功能代码之前，必须依次阅读：

1. `AGENTS.md`
2. `docs/PLAN.md`
3. 当前阶段对应的 `docs/STAGE_<N>_PLAN.md`
4. `docs/ARCHITECTURE.md`
5. 若改动涉及界面、SVG 渲染、布局或交互，必须额外阅读 `docs/DESIGN_SPEC.md`。
6. 若改动涉及自动化工作流、Agent 规则或领域核心逻辑，必须额外阅读 `docs/SKILLS_AND_RULES.md` 与 `docs/skills/netlist-schematic/SKILL.md`。
