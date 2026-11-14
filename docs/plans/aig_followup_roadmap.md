# AIG 后续需求备忘

记录日期：2026-11-14。状态：计划中，尚未启动。

本文件记录用户明确提出的后续需求，供下一轮排期时检查。**以下两项及 Compare 默认方向调整均不属于当前 [AIG 主界面接入计划](aig_graphviz_integration.md) 的 P0–P5 开发或验收范围，也不作为本轮发布前置条件。**

## F-AIG-01：AIG Compare 与 before/after 对比

用户要求：

1. AIG 支持 Compare。
2. Compare 默认视图改为左右分屏。
3. 支持 before 和 after 的 AIG 图比较。

后续交付内容：

- 在现有 Compare 工作台接入 AIG，支持分别载入 before / after 两份 AIG；沿用已支持的 ABC AIG DOT、AND/NOT BLIF 导入与 Graphviz 绘制路径。
- **默认左侧为 Before / A，右侧为 After / B**，明确标识两侧来源；两侧保留输入输出名称和原始对象映射。
- Compare 的默认分屏方向统一改为左右，适用于网表及 AIG 的新建/未设置视图；保留上下切换能力，尊重已显式保存的布局偏好。此处修改的是两个画布的排列，不改变各 AIG 图内部的 BT 信号方向。
- 两侧文档、选择、分析高亮与任务相互隔离，复用既有 Compare 视口同步及左右信息栏联动边界，不另造一套独立比较页面。

最低验收：before / after 能在左右两侧正确载入和浏览；两侧名称、来源及高亮不串用；默认左右与显式上下偏好均正确；现有网表 Compare 无新增回归。

该需求首先是 before/after 的图形对照。自动结构匹配、差异标记的具体策略在后续启动时细化，不将视觉比较表述为形式化逻辑等价证明。

## F-AIG-02：Netlist → AIG，支持 cone、Whole 和 Compare

用户要求：

1. 在网表里选定 cone，转成 AIG 视图。
2. 网表处于 Compare 时，支持转成 AIG 对比图。
3. Whole 模式默认将当前 module 全部转成 AIG。

转换范围与对应关系：

| 网表入口 | 转换范围 | 结果 |
| --- | --- | --- |
| Single：选定 cone | 当前明确选定的逻辑锥及其边界信号 | 对应 cone 的 AIG 视图 |
| Single：Whole | 当前 module 的完整逻辑，不仅是当前屏幕可见节点，也不是整个 design | 当前 module 的完整 AIG 视图 |
| Compare：cone | A/B 两侧各自确定的 cone，保持两侧来源和范围对应 | 左 Before / A、右 After / B 的 AIG 对比图 |
| Compare：Whole | A/B 两侧各自当前 module 的完整逻辑 | 两个 module 转换后的 AIG 对比图 |

后续实现需要保留的约束：

- 转换从源网表结构及已确定的 cone 范围生成派生 AIG，不从 SVG 或布局虚拟节点反推逻辑，不改写原始网表。
- cone 的边界信号成为对应 AIG 的 PI/PO，保留可定位的信号名称、原 module/实例上下文及来源映射；Whole 保留当前 module 的输入输出名称。
- Compare 转换保留两侧各自的范围与来源，不能仅转换活动侧后复制到另一侧，也不能把两侧不同的 cone 静默扩为 Whole。
- 转换产物进入同一 AIG 模型、Graphviz、分析和 Scene 路径，与直接导入的 AIG 保持统一显示规则；支持追溯原网表。
- 转换引擎、单元布尔函数来源、层次展开策略、寄存器/黑盒边界及失败恢复在该项启动时细化。缺失功能定义不能猜测为 AND，不能静默丢失逻辑。

最低验收：同一 module 的选定 cone 与 Whole 转换范围准确；PI/PO 与边界信号名称可追溯；Compare 两侧对应正确；原网表和当前视图状态不被转换过程破坏；转换逻辑与已知样例的真值/结构检查一致。

## 后续排期关系

- 当前轮：完成 ABC DOT / AND-NOT BLIF 的 AIG Single 主界面接入、两侧信息栏和高亮。
- 下一轮候选：F-AIG-01，接入 AIG Compare，并调整 Compare 默认分屏。
- 后续候选：F-AIG-02，先建立 Netlist → AIG 转换与来源映射，再贯通 cone / Whole / Compare；其中 Compare 转换依赖 F-AIG-01。

以上仅记录需求与依赖，不预设本轮的额外工作量或交付日期。开始下一轮 AIG 工作时先检查本文件，实施状态更新在此处维护。
