# 离线 AnchorLayered 静态布局包契约说明

- **版本标识**：包版本 `0.3.0`，基础 IR 契约 `1.1.0`，固定 AnchorLayered（H08 兼容）语义配置（profile）`1.0.0`。
- **零依赖静态运行**：该 profile 具有显式版本号；基础相位对照（phase-oracle）基线仍保留在 `index.js` 中供测试调用。运行本包无需 `npm install`、打包工具（bundler）、源码重写、原生扩展、网络连接或外部 ELK 运行时。

## 最小调用示例

```js
import {layoutGraph} from './src/layout/elk_native/anchor.js';

const abortController = new AbortController();
const result = await layoutGraph({
  nodes: [
    {id:'a', width:40, height:30, ports:[{id:'a:o', side:'EAST', x:40, y:15}]},
    {id:'b', width:40, height:30, ports:[{id:'b:i', side:'WEST', x:0, y:15}]}
  ],
  edges: [{id:'ab', physicalNetId:'signal', sourcePortId:'a:o', targetPortId:'b:i'}]
}, {signal: abortController.signal});
```
（历史调用方亦可直接导入 `./src/layout/elk_native/h08.js`。）

## 职责边界与集成契约

- **输入测量与不可变保证**：调用方负责节点/端口几何测量及外部 DTO 转换（在工作台中由应用层适配器负责原理图节点测量、物理线网构建、标签排布及渲染器数据转换）。`layoutGraph` 不会修改传入对象，且仅返回完整通过校验的不可变几何结果；遇到不支持的输入会通过诊断明确拒绝，绝不静默返回残缺图形或私自调用备用布局引擎。
- **产品工作台集成策略**：工作台默认选用 `AnchorLayered`；仅当其在 UI 层失败时，由工作台外层依次尝试降级至 `ELK` 与 `Simple`（`Simple` 失败后停止重试）。用户主动取消任务不会触发降级，且临时自动降级不会持久化覆盖用户首选项。对于拼接（concat）引脚端点，应用层适配器会为其分配独立的显示引脚身份，即使它们在源网表中源自同一个物理引脚名。
- **`orderGroups` 排序组契约**：可选的 `orderGroups` 由基于公开拓扑派生的 `{nodeId, membershipKey}` 记录组成。入口函数会在执行任何异步观察前对其进行快照、校验与规范化排序，并在完整保留规范化 `inputDigest` 与结构排序摘要的同时，独立记录 profile/hint 摘要。显示文本标签（labels）绝不参与排序键计算；节点实际测量尺寸的变化则可合法改变布局坐标。
- **AnchorLayered 语义特性与显式限制**：AnchorLayered 固定了每条逻辑边的独立隐式端点身份、原有的三组 P3 候选加一组单位扫层（unit sweep）、不变的交叉/约束预算，以及仅限“同物理线网、同节点、同侧、精确同局部锚点”的 P5 物理共享邻接关系。当前的分组视觉带宽预测（group-band forecast）会显式拒绝带分组的自环图（grouped self-loop graphs）与合并秩列（merged rank columns），不会静默放宽容差或追加事后修补通道；未分组的自环则按基础流水线正常处理。
- **相位观察与取消机制**：`onPhase` 回调仅供测试观察不可变的原始相位边界；`yieldControl` 允许宿主环境在相位检查点之间让出调度权。取消信号（`AbortSignal`）在相位边界及有界搜索循环中检查；同步相位计算不承诺在单线程内即时抢占，但在浏览器中由独占 Worker 提供强制终止能力，同时应用层通过作业协调器隔离过期结果。

完整的验收清单、冻结实验哈希、已知大例耗时及用户视觉评审结论详见 `docs/plans/anchor_acceptance_checklist.md`。静态可导入性不代表对任意通用图均与上游 ELK 完全等价。
