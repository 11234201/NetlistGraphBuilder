# 算法代码审查（2026-11-08）

范围：structural Verilog parser、Netlist IR 到图的转换、cone/Compare 分析、共享布局几何与 Native/H08 layout。下列 17 项最初均使用本地 Node 最小输入复现，随后已在当前工作树中完成修复并加入统一回归测试。

## 修复状态（2026-11-08）

17 项均已修复。新增 `tests/unit/algorithm-review-regressions.test.js` 覆盖所有根因组合，验证结果：

- 完整单元与架构测试：904/904 通过。
- H08 full-node mapped 严格门禁：47/47 通过，0 violation，最慢 21.780 秒，峰值堆 578 MiB。
- 大图 benchmark：1024/4096/8192 cell 均 routed、0 violation；layout 中位数 201.8/1540.1/6440.3 ms。
- 默认 Simple full-node mapped 仍有既有未完成路由与超时，不能用作本批 H08 修复的通过证据；本批未放宽任何 Simple 或 H08 validator/budget。

## 1. [P1] 图节点 ID 编码有碰撞，会吞掉不同实例

- 位置：`src/netlist/graph.js:382`（makeId），节点去重位于同文件 addNode。
- 输入：`module m(input a,output y,z); BUF \u/a (.A(a),.Y(y)); BUF u_a (.A(a),.Y(z)); endmodule`
- 实测：parser 保留两个实例 `u/a`、`u_a`，图中却只有一个 `cell:u_a`，同时驱动 y 和 z，无诊断。
- 原因：所有非白名单字符统一替换为 `_`，不是可逆编码。层级名、escaped name、向量名都有碰撞风险。
- 建议：使用无碰撞的规范标识编码，并检查所有引用此 ID 的 override/session 边界。测试不同合法名称映射不相等及其连接完整性。

## 2. [P1] assign 表达式被静默截断为错误 alias

- 位置：`src/parser/verilogParser.js:240`、`:345`。
- 输入：`module m(input a,b,output y); assign y = a & b; endmodule`
- 实测：产生 `lhs=y,rhs=a`，没有诊断；b 从逻辑依赖中消失。
- 同根因输入：`module m(input [3:0] a,output y); assign y = a [2]; endmodule` 被解析为 y 到整个 a 的 alias，丢失位选择。LHS 带分离的位选择时还会影响等号读取。
- 建议：完整读取左右两侧 token，再验证支持的结构。对不支持的运算表达式报告诊断，不生成伪 alias；合法位选择必须与空格格式无关。

## 3. [P1] 自反馈边在图构建阶段被直接丢弃

- 位置：`src/netlist/graph.js:179`。
- 输入：`module m(output y); BUF u(.A(y),.Y(y)); endmodule`
- 实测：只保留 u 到 output:y 的边，u.Y 到 u.A 的反馈边不存在，无诊断。
- 影响：反馈 cone、环分析和最终 schematic 均缺少真实连接；底层布局已有 self-loop 实现，也无法恢复上游删掉的边。
- 建议：保留不同引脚之间的同节点边；如需过滤特殊 inout 的重复自身连接，应按端点语义过滤，不能只比较 nodeId。

## 4. [P1] 多驱动网络只保留最后一个驱动

- 位置：`src/netlist/graph.js:134`、`:169`。
- 输入：`module m(input a,b,output y); BUF u(.A(a),.Y(y)); BUF v(.A(b),.Y(y)); endmodule`
- 实测：y 只连接 v；没有多驱动诊断。原因是 drivers.set 覆盖此前记录，改变实例声明顺序会改变选择结果。
- 影响：多驱动/三态网络结构不完整；异常设计也会被呈现为正常单驱动图。
- 建议：收集全部驱动，明确表示多驱动关系；若当前图协议暂不支持，至少给出诊断而非任意选取最后一个。加入声明排列测试。

## 5. [P1] inout 引脚被定位到其他输入/输出引脚

- 位置：`src/layout/nodeGeometry.js:109`；消费者包括 `src/layout/elk_native_layout_provider.js:25` 和 `src/layout/layoutValidator.js`。
- 复现：创建带 A(input)、IO(inout)、Y(output) 的节点并调用 buildNodePorts。随后 `getPort(node,'IO','target')` 返回 A；`getPort(node,'IO','source')` 返回 Y。
- 原因：精确名称匹配仍要求方向必须等于 input/output，未接受 inout，随后退回其他同方向引脚。
- 影响：Native adapter 的端点 ID 和其他布局的连接坐标均会指向错误引脚；校验器共用 getConnectionPoint，不能据此发现语义错误。
- 建议：先查找名称匹配且方向兼容的端点，inout 对两种 role 均兼容；未知 pin 不应被静默替换。测试最终边端点 ID 与坐标，而不仅比较校验器结果。

## 6. [P2] 同一声明中的第二个及后续实例被静默跳过

- 位置：`src/parser/verilogParser.js:309`，以及 parseModule 的实例识别循环。
- 输入：`module m(input a,output y,z); BUF u(.A(a),.Y(y)), v(.A(a),.Y(z)); endmodule`
- 实测：module.cells 仅有 u，v 消失，没有 unsupported-statement 诊断。
- 建议：同一 cell type 下循环读取实例列表；若暂不支持，应报告明确诊断。测试与两条独立实例声明的结构等价性。

## 7. [P2] 紧邻标识符的注释没有被词法层剥离

- 位置：`src/parser/verilogParser.js:118`。
- 输入：`module m(input a,output y); BUF u(.A(a/* comment */),.Y(y)); endmodule`
- 实测：A 被视为 unsupported connection，连接完全丢失。相同代码增加注释前空格则可以正常处理。
- 原因：普通 token 扫描仅在空白和 PUNCTUATION 处结束，吞入 `/*`，外层的注释分支不再获得控制权。
- 建议：普通 token 遇到注释起始符时结束；escaped identifier 内的字符仍按其规则保留。覆盖相邻块注释和行注释。

## 8. [P2] 常量识别误判普通 x/z 网络，且漏判合法常量

- 位置：`src/netlist/graph.js:374`。
- 输入：`module m(output x,z,y); BUF u(.A('0),.Y(y)); endmodule`
- 实测：未驱动的普通标识符 x、z 被生成 constant 节点，缺少未驱动诊断；真正的 `'0` 却被生成 implicit 节点并报告无驱动。
- 原因：graph 的正则把裸 x/z 当字面量，与 parser 接受的常量语法不一致，也未区分 escaped identifier 和 literal。
- 建议：IR 保留 reference/literal 类型，图层按类型处理；覆盖 `'0`、`'1`、signed based literal、普通 x/z 和 escaped names。

## 9. [P2] 同侧不同方向的 pin 被排到相同坐标

- 位置：`src/layout/nodeGeometry.js:85`–`:90`。
- 最小 helper 输入：`buildNodePorts({kind:'cell',portDescriptors:[{pin:'A',direction:'input',side:'left'},{pin:'Y',direction:'output',side:'left'}]},{width:128,height:108})`。
- 实测：A、Y 均位于 `(0,54)`。该问题需要调用方提供同侧且不同方向的 descriptors；默认左右分离的普通单元不触发。
- 原因：左右两侧的 pin 按 direction 分组排布，而不是按 side 分组；两组各自居中，产生重叠。
- 建议：按实际 side 分组分配槽位，方向只用于连接语义。覆盖左右反向引脚与混合方向同侧引脚。

## 10. [P1] pin 的合法向量切片在图中变成无驱动网络

- 位置：`src/netlist/graph.js:206`（端口展开）及 `src/netlist/pin_connections.js:5`（连接端点转换）。
- 输入：`module m(input [3:0] a,output y); BUF u(.A(a[2:1]),.Y(y)); endmodule`。
- 实测：parser 接受 a[2:1]；图却创建 `implicit:a_2:1_` 驱动 u，并报告 `Net a[2:1] has no explicit driver`。真实的 input:a[2] 和 input:a[1] 都没有连接 u。
- 原因：端口展开到单 bit，而 connection 仍是一个不可分解的字符串，两个边界缺少统一的向量引用语义。这与第 2 项 assign token 截断不同，单纯修 parser 的 assign 无法解决。
- 建议：保留 base/range/bit 结构并在图转换层统一解析位选择、part-select、concat 与整条 bus 的连接关系；覆盖升序和降序 range。

## 11. [P1] 深链逻辑深度统计导致调用栈溢出

- 位置：`src/analysis/moduleCompare.js:90`–`:104`。
- 最小输入：5000 个 kind=cell 的节点，ID 为 0 到 4999；边为 `(i+1) -> i`，nodes 按 ID 升序排列；调用 analyzeGraphStats。
- 实测：抛出 `RangeError: Maximum call stack size exceeded`，无法返回统计结果。该输入生成和执行只用了轻量本地 Node 诊断。
- 原因：estimateLogicDepth 使用递归 DFS，第一次计算节点 0 时递归遍历整条链。memo 无法限制首次遍历的调用栈深度。
- 建议：改为显式栈或 SCC/拓扑动态规划；保留环处理语义。回归应同时覆盖长链及 nodes 顺序反转。

## 12. [P2] Focused 合并预算按名称截断，会留下与 root 断开的节点

- 位置：`src/analysis/graphCone.js:118`–`:125`。
- 输入拓扑：`a -> z -> r -> b -> c`；root=r，faninDepth=2，fanoutDepth=2，maximumVisibleNodes=3。
- 实测：fanin 和 fanout 分别选到 3 个节点，合并后按 ID 字典序截取，最终节点为 r、a、b，仅保留 r->b；a 的路径中间节点 z 被丢掉，a 成为孤立节点。
- 影响：有限预算的 Focused 视图展示了孤立的远端节点，同时隐藏更近、用于解释连接的节点；结果受命名影响。
- 建议：在统一预算下按层遍历两侧，或者裁剪时维护每个保留节点到 seed 的路径闭包；测试预算下的 root 可达性，而不只是节点数上限。

## 13. [P2] fanout hub 的身份依赖输入边顺序

- 位置：`src/analysis/fanoutHub.js:11`、`:21`–`:23`。
- 输入：s 通过 net=n 驱动 a、b，t 通过 net=m 驱动 a、b，threshold=2。
- 实测：原边顺序得到 `hub:n:0`、`hub:m:1`；仅反转 edges 数组后变成 `hub:m:0`、`hub:n:1`。
- 原因：Map 插入顺序决定分组遍历顺序，再把遍历 index 纳入 hubId；hub-in 还取未规范排序的第一条边。
- 影响：相同拓扑的派生节点/边身份不稳定，破坏后续布局稳定排序和 ID 关联状态的前提。本轮确认的是派生图 ID 差异，未声称已测得具体坐标差异。
- 建议：hub ID 由 source+canonical net 无碰撞编码生成；分组及代表边使用稳定拓扑排序。加入完整派生图的排列不变性测试。

## 14. [P2] Compare 将不同宽度的端口报告为 matched

- 位置：`src/analysis/moduleCompare.js:23`。
- 输入模块分别为 `module m(input [3:0] a); endmodule` 和 `module n(input [7:0] a); endmodule`；调用 alignModulePorts。
- 实测：a 的 matched=true，即使两个 range.width 分别为 4 和 8；compareModules 因而把 a 列入 matchedPorts。
- 原因：匹配条件只比较名称与 direction，忽略已经存在于 IR 的 range。
- 建议：区分名称对应关系和接口兼容性；比较宽度及约定的索引范围/顺序语义，并向 Compare 暴露差异原因。覆盖标量与 bus、宽度差异和反向 range。

## 15. [P2] Native FIXED_ORDER 的混合排序条件不满足传递性

- 位置：`src/layout/elk_native/ir.js:31`–`:33`。
- 最小输入：单节点宽 60、高 50，portConstraints=FIXED_ORDER，三个 EAST port 的 x 均为 60：a(y=30,order=0)、b(y=20,未指定 order)、c(y=10,order=1)，edges=[]。
- 实测：createCanonicalGraph 输入 ports=[a,b,c] 返回顺序 [c,b,a]；仅改为 [b,a,c] 则返回 [b,a,c]，inputDigest 也不同。两份输入均通过 P0 校验。
- 原因：两端都有 declaredOrder 时按 order 比，否则按坐标比，使 a<b、b<c、c<a 这样的比较环成为可能；sort 无法产生与原始排列无关的结果。
- 影响：可接受的 FIXED_ORDER 输入不具有规范化确定性，而且第一种结果把显式 order=1 排在 order=0 前面。此触发条件针对显式使用 FIXED_ORDER 的调用方；默认 FIXED_POS 不触发。
- 建议：先定义缺省 order 的统一填充规则，再使用单一全序键；或明确拒绝混合显式/缺省顺序。对这三端口的全部排列增加测试。

## 16. [P2] H08 P5 把非零高度差当作直线，产出最终校验不接受的斜线

- 位置：`src/layout/elk_native/p5_routing.js:55`、`:62`；容差定义在 `policy.js` 的 ORTHOGONAL_ROUTING_PROFILE，最终检查在 `validate_routes.js:9`。
- 输入：两个 40×30 节点 a、b。a 的 EAST 输出 ao=(40,15)，b 的 WEST 输入 bi=(0,15)、bj=(0,15.0005)。两条同 physicalNetId=n 的边分别 ao->bi、ao->bj。使用公开 `h08.js` layoutGraph 默认选项。
- 实测：P5 的 e2 points 只有 `(40,15),(60,15.0005)`，已经是斜线；入口最终抛 `p5: wrong-port-access`，entityIds=[e2]。
- 原因：P5 在小于 0.001 的高度差下跳过路由折点，最终 validator 却要求 1e-8 内的水平端点访问；它们对同一几何的有效性定义不一致。
- 建议：固定端点不允许随意吸附时，非零高度差仍需保留正交转折；统一 owning geometry contract，不通过放宽最终 validator 掩盖斜线。测试 onPhase P5 的几何及最终返回值。

## 17. [P2] H08 恢复逻辑边时删掉真实短折弯，使正确的 P5 路由失效

- 位置：`src/layout/elk_native/restore_edges.js:16`；被调用的 `src/layout/orthogonalRouting.js:3`、`:9`–`:20`。
- 输入：沿用第 16 项，但 bj.y=15.25。
- 实测：onPhase 观察到 P5 e2 为 `(40,15),(50,15),(50,15.25),(60,15.25)`，完全正交；恢复时 compactOrthogonalPoints 采用 EPSILON=0.5 判断共线，两个折点都被移除，最终抛 `p5: wrong-port-access`。把 bj.y 改成 15.75 则完整布局成功。
- 影响：H08 接受有限小数坐标，却不能稳定处理小于半像素的真实折弯。与第 16 项独立：只修 P5 的 0.001 分支仍然会在 restore 阶段失败。
- 建议：简化函数只能删除真正共线且保持原路径的点；不能把接近共线等同于可直接连接。为 shared simplifier 增加正交性保持测试，并在 H08 完整入口复验。

### H08 最小可执行复现（16–17）

在仓库根目录使用 Node ES module 执行以下代码；无需安装依赖：

```js
import { layoutGraph } from './src/layout/elk_native/h08.js';
for (const delta of [0.0005, 0.25, 0.75]) {
  const input = {
    nodes: [
      { id: 'a', width: 40, height: 30,
        ports: [{ id: 'ao', side: 'EAST', x: 40, y: 15 }] },
      { id: 'b', width: 40, height: 30,
        ports: [{ id: 'bi', side: 'WEST', x: 0, y: 15 },
                { id: 'bj', side: 'WEST', x: 0, y: 15 + delta }] }
    ],
    edges: [
      { id: 'e1', physicalNetId: 'n', sourcePortId: 'ao', targetPortId: 'bi' },
      { id: 'e2', physicalNetId: 'n', sourcePortId: 'ao', targetPortId: 'bj' }
    ]
  };
  try {
    await layoutGraph(input, { onPhase(graph) {
      if (graph.phase === 'p5') console.log(delta, graph.edges.map(e => e.points));
    }});
    console.log(delta, 'complete');
  } catch (error) {
    console.log(delta, error.message, error.diagnostic);
  }
}
```

本轮另检查 AnchorLayered（H08）分组候选、band forecast、physical-anchor adjacency、dummy merge、BK placement 和最终校验代码。grouped self-loop、merged rank columns 的拒绝已经在 `docs/design/elk_anchor_package.md` 声明，本报告没有把这些已知范围限制重复计为新增算法缺陷。上述小数坐标复现属于公开 AnchorLayered 入口证据；修复后已通过文首记录的 full-node mapped 严格门禁。

## 验证结论

上述 17 项均已在其所属边界加入回归并完成修复。第 8 项额外覆盖 signed based literal 与 escaped numeric identifier，常量身份由 parser/IR 元数据传递，图层不再仅凭名称正则猜测。完整验证结果见文首“修复状态”；默认 Simple full-node mapped 的既有失败仍不计作本批 H08 修复证据。
