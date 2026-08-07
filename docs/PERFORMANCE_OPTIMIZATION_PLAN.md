# 性能优化计划

## 目标

在保持纯前端离线运行、公开 Netlist IR、布局结果和 UI 行为不变的前提下，优先消除解析与 Simple Layered 布局中的重复线性扫描。先完成可测量、低风险的 P0/P1 优化，再依据真实网表数据决定是否进入 Worker、混合渲染或 WebAssembly 阶段。

## 执行计划

| 优先级 | 优化项 | 主要改动 | 验收方式 | 预期收益 |
| --- | --- | --- | --- | --- |
| P0 | 固化性能基线 | 增加可重复运行的 1K/4K/8K cell 分阶段基准，记录解析、建图、布局、折叠和 SVG 时间 | 多次运行取中位数；性能数据独立于单元测试的正确性断言 | 使后续优化可以量化比较 |
| P1 | Netlist IR 索引 | 在 `src/netlist/model.js` 内部使用 `Map`/`Set` 索引 net、port 和 port order，保持公开 IR 数组结构不变 | parser 全部测试通过；重复声明、隐式 net 升级和 display name 行为一致 | 消除解析阶段接近 O(n²) 的名称查找 |
| P1 | 布局按层复用分桶 | placement pipeline 一次生成 `nodesByLevel`，alignment、spacing 和 branch lane 共享，取消每层扫描全部节点 | 布局 determinism、golden、routing 和大图测试通过 | 降低深层 DAG placement 的复杂度 |
| P1 | 性能回归覆盖 | 增加索引一致性与深层分层测试；benchmark 仅报告数据，避免用严格耗时制造不稳定测试 | `npm test` 全部通过，现有布局输出不漂移 | 防止重新引入重复全量扫描 |
| P2 | Web Worker 异步计算 | 把解析、建图和 Simple Layout 移到 Worker，保留 request ID 和过期结果丢弃语义 | 大文件处理期间 UI 保持响应，快速切换不提交旧结果 | 改善交互卡顿 |
| P2 | 渐进渲染降内存 | 避免同时保留完整批次列表、大 SVG 字符串和 DOM | 对 8K 以上图记录首批可见时间与峰值内存 | 降低渲染内存峰值 |
| P3 | Canvas/SVG 混合 | 大图 wire 使用 Canvas，交互节点保留 SVG | 缩放、选中、导出和低细节规则保持一致 | 提高数万对象的浏览上限 |
| P3 | 可选 Rust/Wasm | 仅在算法与渲染优化后仍不达标时迁移 parser/图算法热点 | 与 JavaScript 实现进行结果一致性验证 | 进一步降低 CPU 时间 |

## 当前执行范围

本轮只执行 P0 和 P1：

1. 建立独立的大图 benchmark。
2. 优化 Netlist IR 名称查找。
3. 复用 placement 的 level 分桶。
4. 增加正确性回归测试。
5. 运行完整测试，并记录优化后的 1K/4K/8K 数据。

P2 和 P3 必须根据本轮结果另行评估，不在本轮隐式引入架构变化或新依赖。

## 基线

2026-08-07 在 Node.js 24.12.0 下，对同构 buffer 深链进行本地微基准：

| Cell 数 | 解析 | 建图 | 完整布局 | SVG 字符串 |
| ---: | ---: | ---: | ---: | ---: |
| 1,024 | 约 20–27 ms | 约 11–14 ms | 约 46–79 ms | 约 10–14 ms |
| 4,096 | 约 211 ms | 约 58 ms | 约 262 ms | 约 34 ms |
| 8,192 | 约 560–595 ms | 约 156 ms | 约 659–737 ms | 约 76 ms |

这些数据不包含浏览器实际 DOM 插入时间，只用于比较纯 JavaScript 流水线的相对变化。

## 完成标准

- 公开 `Module` 的 `ports`、`nets`、`portOrder`、`cells` 和 `assigns` 数据形状不变。
- parser、graph、layout、routing、render 与 UI 测试全部通过。
- Simple Layered 的确定性与现有布局语义不变。
- 8K 深链解析与布局相对基线均有明确改善；若未改善，必须保留测量结果并重新定位瓶颈。
- 不新增网络依赖，不改变离线运行方式。

## 本轮执行结果

2026-08-07 完成 P0/P1。使用新增的 `npm run benchmark` 运行三次并取中位数：

| Cell 数 | 解析 | 建图 | 完整布局 | SVG 字符串 |
| ---: | ---: | ---: | ---: | ---: |
| 1,024 | 6.5 ms | 7.4 ms | 32.8 ms | 9.3 ms |
| 4,096 | 12.4 ms | 15.4 ms | 115.1 ms | 33.7 ms |
| 8,192 | 31.8 ms | 31.2 ms | 204.9 ms | 66.5 ms |

相对本文件记录的优化前数据：

- 8K 解析由约 560–595 ms 降至 31.8 ms，约提升 17.6–18.7 倍。
- 8K 建图由约 156 ms 降至 31.2 ms，约提升 5 倍。
- 8K 完整布局由约 659–737 ms 降至 204.9 ms，约提升 3.2–3.6 倍。
- 8K placement 阶段中，`align-driven-links` 由约 238 ms 降至 16 ms，`resolve-level-overlaps` 由约 223 ms 降至 9 ms。
- 完整单元测试以同进程隔离方式运行，182 项全部通过。

本轮未修改 UI、公开 Netlist IR 数据形状、布局 provider 边界或离线依赖策略。P2/P3 是否执行，应结合真实网表和浏览器 DOM 性能另行决定。
