# Liberty reader 首版执行计划

日期：2026-11-10；授权：用户要求先出详细计划，然后按计划编码测试。分支 `codex/liberty-reader`，基线 `a8a1a0e`。本计划将阶段 5 的 L0–L4 及 L5 中常见 bus/多库冲突处理纳入本轮；启动器 `--liberty`、gzip、完整 STA、任意布尔等价和厂商私有扩展不在首版。

## 交付与顺序

| 编号 | 工作 | 具体交付 / 验收 | 状态 |
| --- | --- | --- | --- |
| I0 | 基线与环境 | 远端隔离目录；原始 npm test / architecture 结果；不覆盖既有远端项目 | 完成：913/913 |
| I1 | 结构 reader | 原生 ESM、source span、注释/转义/续行/嵌套；library/cell/pin、方向、function、ff/latch/three_state/pg_pin 标记；不保存 timing/power 表数组 | 完成：单测与浏览器已验证 |
| I2 | 语义模型 | 不可变纯数据 Library IR；同名 cell 冲突拒绝；bus/type 成员方向；有界布尔解析与常见单输出门识别；复杂输出/顺序/三态保守处理 | 完成：单测与浏览器已验证 |
| I3 | 共享推断 | module-definition > 实例 override > user-config > library > rule/fallback；图与 hierarchy 共用；按字段来源，缓存包含库身份 | 完成：单测与浏览器已验证 |
| I4 | 导入生命周期/UI | 领域库附件拥有快照；注入窄查询/命令，不增加全局 legacy 状态；选择文件、拖放/粘贴识别、取消、卸载、来源/诊断可见；prepare 后提交 | 完成：单测与浏览器已验证 |
| I5 | 真实库与全链路验证 | Nangate45、IHP 两角对照；单测/架构/47 mapped full-node/benchmark/浏览器；发布资源验证 | 完成验证：默认 mapped 24 例既有失败，HEAD 全量复现 |
| I6 | 收尾 | 使用说明、现行契约与结果记录、检查 diff；不自动提交或推送 | 完成 |

每一步先更新执行记录，再进行下一步；实际失败与限制必须保留，不能仅记录最后一次成功。

## 文件与边界

- `src/parser/liberty_*.js`：纯词法/结构读取，只生成结构信息或解析事件，不推断门功能；调用方可驱动 iterator 分片。
- `src/infer/liberty_*.js` 与共享 cell semantics：独立 Library 模型、function 语义和来源优先级；不依赖 DOM、app 或领域控制器。
- `src/domains/netlist/`：库导入准备、绑定与不可变快照；Netlist feature 和层次查询消费相同库版本。
- `src/application/`：通用可取消分片执行器，接收 iterator，不知道 Liberty。
- `src/ui/`：库状态、取消/卸载按钮及导入事件，通过注入命令通信。
- `src/app/`：既有工作区输入/identity 适配，注入 readCellLibrary；抽出 main 的完整 DOM 元素绑定表，为新组合接线腾出空间并降低行数上限。

## 冻结的首版契约

- 输入为文本 `.lib`，可包含多个 library；每次导入替换当前库附件。每个 cell 名必须唯一；跨角同名 cell 不静默覆盖，用户选择一份角文件后重新导入。
- 输出是纯数据：libraries/cells/pins、原始 function、库名/文件名/span、支持状态和 diagnostics。索引用 Map 或安全 own-property 检查，大小写敏感，保留显示名。
- 真实 Verilog 子模块身份保持现状。leaf 字段来源可单独查询；显式 `unknown` 用户配置不被库绕过。未知 function 不影响已验证方向。
- 常见 bus/type 记录范围、继承方向与展开成员；不猜未声明范围或不一致成员。bundle 及复杂 bus 功能保留诊断，不伪造信号位映射。现有 concat 展示端点语义保持。
- 顺序单元保留标记，简单 FF 可展示 register；latch/复杂顺序、三态与多输出不误判普通逻辑门。常量与无法匹配的 function 使用黑盒并保留表达式。
- `include_file` 未提供解析器，明确报错并不提交；结构损坏、超限、歧义 cell 不替换有效快照。单个不支持属性给出诊断/支持状态，不能宣称完整 Liberty 校验。
- 库不持久化到 localStorage/Session/Golden；刷新后需重载。变更语义版本失效 full graph、层次模板和几何缓存；过期异步导入不能提交。

## 资源限制与性能准入

统一入口定义：64 MiB UTF-8 文本、单 token 1 MiB 字符、256 层嵌套、100,000 cell、每 cell 65,536 pin、1,000 条诊断；溢出给出位置和限制名。分片扫描目标每 64 Ki 字符让出控制；最大 token 工作仍受单 token 上限约束。布尔表达式最多 4,096 字符、256 节点、64 层，最多 8 个变量做有界识别，不做任意输入数真值表。

真实库字段对照零未解释差异；重排不同 cell/属性/组后语义一致；相同输入输出重复一致。单次 64 MiB 合成大表解析远端 Node 预算 15 秒，4→16→64 MiB 不得出现超线性数量级增长；保留 IR 不随跳过表内容等比例增长。浏览器取消目标 500ms 内响应（记录实测，不以调高限制掩盖失败）。

## 验证与环境

- 远端目录：`/home/wzh/my_code/netlistGraphBuilder/liberty_reader_20261110`。该目录为本轮新建隔离副本；上层目录含旧研究文件，不覆盖。
- Node `v24.16.0`；构建、依赖、完整库、日志和截图留在远端；第三方数据放 `/home/wzh/open_source/` 的独立固定版本目录。
- 单测：lexer/parser 语法反例、资源限制、function 语义、方向优先级、冻结输入、同名冲突、原子提交/取消/卸载、缓存失效、真实 workspace 到 Scene。
- 门禁：`npm test`、`npm run test:architecture`、`MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases`、`npm run benchmark`；布局输出若因方向更正改变仍须满足既有硬规则。
- 浏览器：真实导入前后 direction/source 变化、Single/Compare、失败保留旧库、卸载恢复、拖放与取消、无 pageerror。使用服务器已有 Playwright/Chrome，离线运行代码不增加依赖。
- 发布：前端资源变更需要 Windows release 构建；这是 Windows 专用检查，按环境约束仅这一部分允许本机执行；其余测试保持远端。检查 vendored ELK 许可证与新源码资源均被收录。

## 风险控制

现有 .vscode/AGENTS/审查文档/调试脚本/WorkBuddy 文件归用户所有。本轮不清理、不提交这些文件。失败语料以通用语法/语义反例处理，不加实例名规则、不删除既有 mapped 用例、不放宽路由门限。所有新阶段完成情况回写本计划、统一执行计划和工作日志。

最终证据见 [验证报告](../research/liberty_reader_validation.md)：926 单测通过、三库字段零差异、浏览器与发布验证完成；默认 Simple mapped 与 HEAD 均 24/47 失败，47 份无库图完全相同。该门禁未全绿，保留既有失败而不扩大本轮为布局修复任务。
