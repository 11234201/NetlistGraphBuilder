# 阶段 1 细化计划

## 阶段目标

阶段 1 要交付一个最小可用原型：用户打开本地网页，加载 structural Verilog 文本，选择 module，看到可缩放和平移的 SVG gate-level schematic。

本阶段仍然坚持无 `.lib` 默认可用，不引入需要联网安装的依赖。

## 任务拆分

### 1. Parser 与 IR

实现 structural Verilog 子集解析：

- `module ... endmodule`
- port list
- `input/output/inout/wire`
- simple `assign lhs = rhs`
- gate instance：`CELL inst (.PIN(net), ...);`
- escaped identifier，例如 `\a_q[25] `

输出稳定 Netlist IR：

- `Design`
- `Module`
- `Port`
- `Net`
- `Cell`
- `PinConnection`
- `Assign`

### 2. 无 `.lib` 推断

实现内置启发式规则：

- `ND/NAND/CKND -> nand`
- `NR/NOR -> nor`
- `INV/CKINV -> inv`
- `XOR -> xor`
- `XNR/XNOR -> xnor`
- 未识别 cell -> `blackbox`

pin 方向推断：

- 常见输出 pin：`Z`, `ZN`, `Y`, `Q`, `QN`, `CO`, `S`
- 其他 pin 默认作为 input

推断结果必须保留来源：`rule`、`fallback` 或 `unknown`。

### 3. 图模型与布局

把 Netlist IR 转为 schematic graph：

- PI 节点作为 driver
- PO 节点作为 load
- cell 节点作为 gate
- assign 节点暂时作为 `buf`
- undriven net 生成 implicit input

实现简单 left-to-right layered layout：

- input/implicit/constant 在左侧
- cell/assign 按依赖层级排列
- output 在右侧
- edge 使用正交折线

### 4. SVG 渲染

渲染内容：

- input/output port
- gate/assign/blackbox
- net edge 和 net label
- NAND/NOR/INV/XNOR 的输出 bubble
- SVG `viewBox` 支持清晰缩放

### 5. 离线 UI

第一版 UI 是工作台，不做 landing page：

- 顶部工具栏
- 文件打开
- module selector
- fit 按钮
- 主 SVG 画布
- 左侧属性/统计面板
- 鼠标滚轮缩放
- 鼠标拖拽平移

### 6. 验证

最少验证：

- fixture 能解析出两个 module。
- 示例中的 escaped identifier 能保留显示。
- 两个 module 都能生成 graph。
- unknown cell 能稳定渲染为 blackbox。
- SVG smoke test 通过。

## 本阶段不做

- 不做完整 Verilog/SystemVerilog。
- 不做 Liberty 解析。
- 不做 cone 追踪和搜索高亮。
- 不做 module compare view。
- 不引入 ELK.js，先保留 `SimpleLayeredLayoutProvider`。
