# ELK-Native (H08) 静态分层布局包

- **版本与契约基线**：基础 IR 契约 `1.1.0`，包版本 `0.3.0`，H08 语义配置（profile）`1.0.0`。采用浏览器原生 ES 模块编写，无需打包器（bundler）或包安装步骤。
- **产品集成与降级边界**：工作台默认选用 `H08` 引擎；若在 UI 层执行失败，由外层工作台依次尝试降级至 `ELK` 与 `Simple`（且不会将自动降级持久化为用户首选项）。本静态包自身绝不隐式调用其他备用布局引擎。

## 已实现的完整相位流水线

- **P0（规范化输入）**：不可变规范化快照（immutable canonical snapshot）与稳定拓扑身份。
- **P1（破环）**：加权贪心破环（Weighted Greedy Cycle Breaking）。
- **P2（分层）**：基于紧树（Tight-tree）的单纯形网络分层（Network Simplex Layering）。
- **Proper Graph 构建**：长边拆分（Long-edge splitting）与反向端口处理（Inverted-port processing）。
- **P3（交叉最小化与排序）**：支持固定端口的双分配器（Dual-distributor）扫层排序与超边虚拟节点合并（Hyperedge dummy merging）。
- **P4（坐标分配）**：四方向完整 Brandes–Köpf（BK）对齐压紧候选；在 P4 之前为固定西/东侧自环预留边距，仅在之后对完整连通分量进行打包。
- **P5（正交布线与恢复）**：边界超边正交布线（Boundary-hyperedge orthogonal routing），包含精确索引依赖图、关键环路拆分（Critical splitting）、加权反馈决策、拓扑槽位分配、层宽 $X$ 坐标投影、折点/交点计算以及逻辑边恢复（Logical-edge restoration）。
- **取消与一致性**：所有相位均支持 `AbortSignal` 取消检查；注册到工作台的适配器直接调用同一套静态实现，不依赖研究工具动态编译。

## 离线直接调用示例

无需 `npm install` 或任何构建步骤即可直接导入使用：

```js
import { layoutGraph } from './src/layout/elk_native/h08.js';
const controller = new AbortController();
const positioned = await layoutGraph({
  nodes: [{ id: 'a', width: 60, height: 40, ports: [] }],
  edges: []
}, { signal: controller.signal });
```

- **输入与输出契约**：
  - `Port` 包含规范化 `id`、`side`、相对坐标 `x` / `y` 以及可选的 `anchor`、尺寸与 `borderOffset`。
  - `Edge` 包含 `id`、`physicalNetId`、`sourcePortId` 与 `targetPortId`。
  - 输入对象在入口处立即生成快照，绝不原地修改调用方传入的数据。
  - 仅返回完整且通过几何硬约束校验的结果；若某相位失败，会携带相位诊断信息直接 `reject`，绝不返回残缺几何或私自调用其他路由器。
  - `index.js` 基础 profile 仅保留用于受控相位对比测试，不作为第二个 UI 布局引擎暴露。
  - 关于 H08 `orderGroups` 排序组输入、容量上限与 profile 元数据，请参阅 `docs/design/elk_h08_package.md`。

## 算法参考与项目适配说明

- **行为研究基线**：固定参考 Eclipse ELK 提交 `28e5173243cab0cf4e2c9816c803bc0d5c47ab24`（`EPL-2.0`），对应 `p1cycles/GreedyCycleBreaker`、`p2layers/NetworkSimplexLayerer` 与 `alg.common/networksimplex/NetworkSimplex`；Proper 图与层内排序机制对应 `LongEdgeSplitter`、`InvertedPortProcessor`、`HyperedgeDummyMerger`、`LayerSweepCrossingMinimizer`、两侧端口分配器、`BarycenterHeuristic`、`ForsterConstraintResolver` 及交叉计数器。并查集（DSU）/ 树状数组（Fenwick）组织方式与拓扑种子候选为本项目独立实现，不直接翻译上游源码，也不导入已退役的旧版 Native 算法。
- **已记录的项目级适配**：
  - 使用规范化 ID 确定性决胜（tie-breaking）替代上游依赖随机数种子或内存分配顺序的行为。
  - 在不等优先级下采用加权相等判定保护分层平衡最优性；迭代耗尽时保留可行秩并附带显式非最优诊断（与 ELK 有界循环语义一致），绝不发布残缺或违反硬约束的几何结果。
  - 规范化适配器完整保留顺时针固定端口顺序与源几何尺寸。完整相位契约与验收标准详见 `docs/design/elk-native-phase-contracts.md` 与 `docs/plans/elk-native-reimplementation-plan.md`。

## 测试与相位差分工具

运行本包全部单元测试：

```bash
node --test tests/unit/elk_native*.test.js
```

使用 `tools/research/elk_phase_oracle/compare_native_phases.mjs` 可针对已保存的上游相位快照定位首个决策分歧点（原始相位观察回调仅用于测试，绝不向生产环境发布未完成的几何数据）。
