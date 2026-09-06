# 阶段 7：应用编排与路由边界重构计划

日期：2026-09-06。状态：首批实施中，完成范围见下方记录。

## 执行记录（2026-09-06）

状态：首批实施中，不能将整个阶段视为完成。

- 批次 0：mapped runner 已增加失败分类、退出码、耗时、模式和最后阶段；远端普通连接及授权重试均为 SSH timeout。同环境两版本/default 与 no-collapse 对照仍未完成，历史 violation 归属仍未确定。
- 批次 1：已引入 workspaceRequest，保护旧布局成功/失败、渲染进度和完成回调；修复大图切小图/空态未取消旧批次。增加可控失效及取消测试。浏览器真实连续操作验证仍待补充。
- 批次 2：已共享 roots 状态归一化与动作结果，修复 Add 达上限后驱逐已有 root/误报已存在的问题；已绘制 Single root 激活直接定位。完整业务控制层（包括跨 module 和 Compare 同步反馈）仍需继续收敛。
- 批次 3：先抽取 searchControls 和 spacingControls，主入口只提供搜索索引、动作和持久化查询回调。空数字输入保留上次有效值；旧存档非 4 倍数不改写。输入/Cell Config、画布与日志控制的进一步拆分尚未实施。
- 批次 4：未修改布局几何，等待批次 0 的版本对照结论。
- 批次 5：尚无新浏览器性能证据，不引入缓存或 Worker。

本地替代验证原因：mfs-remote 两次连接超时，不能运行远端测试；轻量单元测试在 Windows 本地执行，mapped 输出保持在进程日志中，没有新增大型磁盘产物。

已执行验证：`npm test` 285/285 通过；`node --check src/app/main.js` 与 `git diff --check` 通过。真实浏览器交互与两版本性能对照尚未执行，不将单元测试视为这些项目的替代。

`npm run test:mapped-cases`：退出码 1，45/47 通过，dp_020 与 sop_004 均在 layout 阶段超过 45000ms；已完成案例累计 violations=59/120，最大 layout=30832ms、最大 heap=125MiB。超时案例没有完整质量数据，因此整套回归未通过。首批保留现有布局算法；下一轮先补版本对照与浏览器交互，再继续扩大重构范围。

## 目标与范围

在现有离线原生 ES modules 架构上，收敛应用状态操作、异步任务提交和路由几何策略，让后续增加交互时可以复用明确的边界。按可独立审查、可独立回退的小批次实施，不以文件数量或行数作为完成标准。

本次只交付计划；不修改功能代码。沿用已建立的 graphWorkspace、layoutWorkspace、viewport、pointerSession 和路由共享模块，不重新搭建同类框架。Liberty、Worker、Canvas/Wasm 继续属于独立功能或性能决策。

## 已观察到的事实与待验证问题

| 证据位置 | 已观察到的事实 | 重构价值或待验证问题 |
| --- | --- | --- |
| `src/app/main.js` | 约 3400 行，同时管理导入、搜索、Focused roots、布局提交、画布交互和持久化 | 按业务动作抽取控制层，降低一次交互改动跨越多个处理函数的成本 |
| `renderCurrentModuleGraph` / `renderCompareGraphs` | 成功回调检查 layoutRequestId；catch 直接调用 handleLayoutFailure | 旧请求失败可能影响新视图状态；须用可控 Promise 顺序复现后修正 |
| `commitCurrentGraph` / `renderGraphMount` | 渲染后的 transform/status/onRendered 回调另行编排 | 须检查取消渲染和切换 module 后是否仍会执行旧回调，不能仅凭代码位置判定已发生缺陷 |
| `focusedSelection.js` / `focusedViewPolicy.js` 与 main 的 Single/Compare handlers | 已共享 roots 归一化和集合操作，状态提交、同步侧选择、布局后定位仍分散 | 继续抽取完整业务动作，保留 Single/Compare 各自状态语义 |
| `localRouteCandidates.js` / `simpleRouteCandidates.js` | source inset 公式重复；局部 padding 分别为 8、9；目标可见间距已有共享 policy | 明确每种距离的语义和拥有者；不能因为数值接近就直接合并 |
| `tests/unit/app-ui.test.js` | 部分测试读取 HTML 或 main 源码并正则匹配 | 能验证控件存在，但不能证明连续搜索、旧请求失效和输入提交的行为正确 |
| `tools/test-mapped-cases.mjs` | 默认每例 45 秒；超时后 metrics 可能为 null，失败详情缺少阶段信息 | 增加可诊断结果，避免性能问题只能看到 TIMEOUT/null |

上一轮对 `5d65f38` 所含改动的验证记录：276 项单元测试通过；mapped 45/47 完成，dp_020、sop_004 超时。该记录是历史结果，本次未重跑。此前单独 dp_020 的 no-collapse 结果存在 1481 个 violation；不同模式结果不能直接比较，也不能据此断言是既有问题或此次回归。必须补做同环境、同模式的版本对照。

## 实施顺序

### 批次 0：固定行为与大案例基线（P0，小至中等成本）

- 在 mfs-remote 的 `/home/wzh/my_code/netlistGraphBuilder` 下使用隔离 checkout，记录 commit、Node 版本、操作系统、collapse 模式和预算。日志与大型产物保留远端。
- 比较 `45e4e12` 与 `5d65f38` 的 dp_020、sop_004：默认模式与 no-collapse 分开；如当前 HEAD 已变化，同时记录实际 HEAD。
- 默认 45 秒门禁保持不变。延长超时只用于单例诊断，不作为门禁通过依据；报告完成布线比例、violation 分类和阶段耗时。
- 改善 mapped runner 的失败输出：区分 timeout、非零退出、无效 JSON、布线不全和预算超限；保留退出码、已用时间与最后阶段。
- 把现有“搜索未绘制 cell 默认追加 roots”“显式 Set 才替换”的行为固化为控制层行为用例。

验收：历史问题与新增回归有可比较证据；所有失败都有明确分类。若确认正确性回归，先另行修复并验证，再进入路由策略重构，不能通过放宽预算推进。

### 批次 1：统一异步请求生命周期（P0，中等成本）

- 在 app 层引入小型请求协调模块，统一 workspace 构建、结果提交、失败回调和渲染完成检查。
- 用 design/module/view 所属请求上下文识别过期结果；Compare 双侧作为同一次 workspace 提交，selection focus 使用独立但关联的请求身份。
- 成功、失败、进度和 onRendered 均只允许当前任务影响可见状态。明确“丢弃结果”与“取消计算”的区别；暂不承诺中断同步布局。
- 继续消费现有 progressive renderer 的取消机制，先核实其 resolve/cancel 语义，再连接协调模块。

验收：旧请求后成功、后失败、渲染中切 module、Single/Compare 切换、连续 focus 等可控时序测试通过；旧回调不改变当前图、selection、viewport 或 Ready/error 状态。

### 批次 2：收敛 Focused 与搜索业务动作（P0，中等成本）

- 在现有 focusedSelection / focusedViewPolicy 基础上建立不依赖 DOM 的动作入口：Set、Add、Remove、Clear、Activate、Reveal search target。
- 每个动作显式返回 roots、active root、selection、是否需要重建和是否需要定位；副作用由控制层执行。
- Single 与 Compare 共用动作语义，Compare adapter 负责 active side 和同步匹配；另一侧不存在匹配目标时保留其已有有效状态。
- 同 module 搜索未绘制 cell 默认追加；重复 Add 幂等；跨 module roots 不混用。root 上限仍遵循现有 policy，并明确拒绝/截断时的反馈。
- Session、Golden、历史恢复继续接受旧单 root 字段，在输入边界归一化为多 root 状态，不扩大持久化范围。

验收：连续加入 A/B/C、删除 active root、清空、重复加入、跨 module、同步开关、旧 session/Golden 恢复均有行为验证；已绘制对象的纯定位不额外调用 provider。

### 批次 3：拆分 main 的控制职责（P1，中等成本）

- 在前两批形成稳定接口后，依次抽取搜索控制、输入/Cell Config 控制、Layout 控件绑定、画布控制和日志/导出绑定。
- main 最终主要负责创建 state、取得 DOM、组装依赖和启动；模块通过明确参数/回调协作，避免把整个全局 state 和全部 handlers 重新注入每个模块。
- 复用现有 UI panel 与 pointer/frame helpers，Single/Compare 用 adapter 表达差异。
- 数字输入、滑块和 session/Golden 恢复由同一个控件绑定边界同步；检查空输入、非法数字、上下限、最近 4 倍数与失焦提交。兼容旧非 4 倍数存档的行为需明确记录，不能静默改写源数据。

验收：入口无需了解各个面板的内部事件；没有循环依赖；浏览器验证搜索、数字输入、模块前后退、Compare、拖动与缩放。纯抽取提交保持布局输出不变。

### 批次 4：统一端点几何策略（P1，中至高风险）

- 盘点 source escape、target approach、node padding、可见转角间距的含义与所有消费方。
- 将重复端点 inset 公式归入共享几何边界；先保持原数值与输出，几何调优使用单独提交。
- 检查 Simple 基础/局部/全局 fallback、Adjust 与 ELK 归一化路径对 top/bottom pin 的一致性。
- 将可见转角视为可读性目标；不得为了凑足 16px 破坏正交、端点进入和节点避障。若要升级为硬约束，先定义可行条件并接入共享 validator。
- 用 top/bottom、近距离、反向边、拥塞、退化共线和输入排列变化覆盖边界，不加 fixture 特判，不扩大候选搜索规模。

验收：纯提取前后 fixture 几何一致；行为调整另有质量指标与 determinism、fixture、mapped 回归。no-collapse 报告单独列出，失败不得称为通过。

### 批次 5：按证据选择缓存与异步计算（P2，条件性工作）

- 先测量 focused 深度/spacing/timing 改变分别消耗在建图、布局和 DOM 的时间，再决定是否缓存 full graph。
- 如缓存有收益，定义 design、module、Cell Config、alias、timing 和 overrides 的版本键及失效矩阵；缓存不能修改 IR 或复用过期注释。
- 只有浏览器仍出现明显计算阻塞时，再沿已有性能计划评估 Worker；成本需包含离线启动、数据复制、取消、错误传播和 Windows 包验证。

验收：同环境多次测量显示目标操作改善，缓存命中与失效有明确行为测试；无明确收益则不实施。本批不阻塞前四批交付。

## 验证、提交与收尾

- 普通代码批次运行 focused tests 与 `npm test`；布局/图变更补 determinism、layout-fixtures、mapped，复杂度变更补 benchmark。
- 完整测试与性能工作优先远端；浏览器交互和 Windows 专有打包检查按需要本地进行。每次保留真实环境与命令。
- 将源码正则测试中涉及业务语义的断言逐步替换为控制层行为测试；保留有价值的静态 HTML/安全转义检查，不为文件拆分机械增加测试。
- 每批独立提交，纯重构与行为修复分开；记录涉及文件、验证结果、已知失败和下一批入口。文档状态只随真实交付更新。
- 需要更新架构/设计文档时，在实现边界实际改变的批次更新；本计划不是现行架构声明。

建议首轮范围：批次 0、1、2。先稳住快速切换与多 root 搜索，再拆 main 和收敛几何策略。此顺序优先覆盖最近反复调整的用户路径。
