# 时序数据输入格式规范（Timing Format Specification v1.0）

## 1. 背景与设计目标

为支持 **Netlist Graph Builder** 与主流及自研 EDA 工具（逻辑综合、局部重综合、物理布局布线、静态时序分析 STA）的深度集成，项目决定**全面废弃早期临时定义的 `LocResyn timing`（`inst <...> pin <...>`）与 `Global/Local 边界表格` 解析逻辑**，重新建立一套符合 STA 业界惯例、跨阶段通用且极简清晰的时序数据输入规范。

### 核心设计原则
1. **默认极简（Simple by Default）**：默认仅需提供 `point`（时序点）与 `at`、`rt`、`slack` 三个核心指标，零多余语法负担。
2. **按需详细（Opt-in Detailed Mode）**：通过表头或 JSON 可选字段，平滑扩展增量延时（`delay`/`incr`）、转换时间（`slew`）、边沿极性（`edge`）等物理诊断信息。
3. **全阶段贯通**：同一套格式无缝覆盖 **综合映射前（Pre-map）**、**综合映射后（Post-map）** 与 **物理布局后（Post-layout）**。
4. **人机双友好**：同时定义对等的 **列式文本格式（Tabular，适合终端粘贴与 Tcl/C++ 直接打印）** 与 **结构化 JSON 格式（适合 EDA 工具 API 传递）**。

---

## 2. 核心概念与 STA 物理语义约定

### 2.1 什么是 `point`（时序观测点）？
借鉴 Synopsys PrimeTime 与 OpenSTA 报告的核心术语，原理图中的所有时序挂载目标统称为 **`point`**。一个 `point` 可以对应网表中的三类实体之一：
- **`port`**：当前模块的输入/输出边界端口（如 `clk`, `in_data[0]`, `out_valid`）。
- **`pin`**：模块内部单元实例的引脚，采用 `<instance>/<pin>` 层级路径表示（如 `u_alu/u_add_0/A1`, `u_reg/D`）。
- **`net`**：连接端口与引脚的逻辑线网（如 `n_carry_12`, `w_sum[3]`）。

---

### 2.2 关键约定：当 `point` 在 `net` 上时，表达的是 Source 端还是 Target 端？

> **规范定义：当 `point` 指定为一条 `net` 时，其 `at`、`rt`、`slack` 严格定义为该线网驱动源端（Source / Driver Root）的时序。**

#### 为什么必须是 Source（驱动端）而非 Target（负载端）？

在静态时序分析（STA）的时序图（Timing Graph）模型中，假设线网 $N$ 由唯一源端驱动引脚 $P_{\text{src}}$ 驱动，并扇出（Fanout）至 $k$ 个目标负载引脚 $P_{\text{tgt}, 1}, P_{\text{tgt}, 2}, \dots, P_{\text{tgt}, k}$，各扇出支路的物理线延时分别为 $d_1, d_2, \dots, d_k$：

1. **正向到达时间（Arrival Time, $AT$）的唯一性**：
   - 信号从源端注入线网的时刻是唯一的，即 $AT(N) = AT(P_{\text{src}})$。
   - 而在物理布局后（Post-layout，$d_i > 0$），由于不同负载距离驱动源远近不同、RC 寄生不同，到达各个 Target 端的时间为：
     $$AT(P_{\text{tgt}, i}) = AT(P_{\text{src}}) + d_i$$
   - 当 $k > 1$（多扇出线网）时，各个 Target 端的 $AT$ 互不相同，因此**一条 Net 无法用单一数值表达 Target 端的到达时间**，唯有 Source 端的 $AT$ 是唯一确定的。

2. **反向要求时间（Required Time, $RT$）与最差裕量（Slack）的守恒性**：
   - 在 STA 反向传播中，各个 Target 端的要求时间 $RT(P_{\text{tgt}, i})$ 减去各支路线延时 $d_i$ 后汇聚到驱动源端，取最严苛值（以 Setup/Max 分析为例）：
     $$RT(P_{\text{src}}) = \min_{i \in \{1 \dots k\}} \big( RT(P_{\text{tgt}, i}) - d_i \big)$$
   - 由此可得驱动源端的裕量（Slack）：
     $$\text{Slack}(P_{\text{src}}) = RT(P_{\text{src}}) - AT(P_{\text{src}}) = \min_{i \in \{1 \dots k\}} \Big( RT(P_{\text{tgt}, i}) - \big(AT(P_{\text{src}}) + d_i\big) \Big) = \min_{i \in \{1 \dots k\}} \text{Slack}(P_{\text{tgt}, i})$$
   - **重要推论**：无论是否存在物理线延时，**Net 在 Source 端的 Slack 恒等于该线网所有扇出 Target 分支中的最差（Worst）Slack**。

#### 三阶段下的 Net 与 Pin 配合法则

| 设计阶段 | 线网物理延时 ($d_i$) | Source 与 Target 的关系 | 推荐标注方式 |
| :--- | :--- | :--- | :--- |
| **综合映射前 (Pre-map)** | $d_i = 0$（无物理走线，常无具体标准单元引脚） | $AT_{\text{src}} = AT_{\text{tgt}, i}$<br>$RT_{\text{src}} = \min_i RT_{\text{tgt}, i}$ | 直接以 **`port`** 和 **`net`**（或逻辑节点名）作为 `point`。此时 Net 时序即代表该逻辑节点的输出时序。 |
| **综合映射后 (Post-map)** | $d_i = 0$ 或同一线载估算值 $d_{\text{wlm}}$ | 同网各负载端延迟基本一致 | 以 **`port`** 和 **`pin` (`inst/pin`)** 为主，也可直接用 **`net`** 标注整根线的驱动时序。 |
| **物理布局后 (Post-layout)** | 各分支 $d_i > 0$ 且互不相等（含真实 RC 寄生） | $AT_{\text{tgt}, i} = AT_{\text{src}} + d_i$<br>各负载分支时序分化 | **必须以 `pin` (`inst/pin`) 为主**：<br>• 驱动端输出 Pin（如 `u_drv/Z`）体现 **Net Source** 时序；<br>• 负载端输入 Pin（如 `u_load1/A`, `u_load2/B`）体现各分支经过走线 RC 延时后的 **Net Target** 时序；<br>• 差值 $AT(\text{u\_load/A}) - AT(\text{u\_drv/Z})$ 即为该支路的精确走线延时。 |

---

## 3. 详细格式定义

支持 **列式文本格式（Tabular）** 与 **JSON 格式**。解析器根据首非空字符（是否为 `{`）自动识别。

### 3.1 格式一：列式文本格式（Tabular Text，推荐日常粘贴与脚本流式生成）

支持以 **空白字符（空格或 Tab）** 或 **逗号（CSV）** 分隔。

#### (1) 元数据指令行（可选，支持单文件多模块分段）
以 `@` 开头，可置于文件顶部或在文件中间开启新的模块分段（从而支持在同一个时序文件中包含 Compare 视图左右两侧模块的时序）：
- `@module <name>`：开启或切换当前后续行所属的模块作用域（缺省则作为全局通用作用域，匹配当前打开的模块）。
- `@stage <pre_map|post_map|post_layout>`：声明当前所处的工程阶段（缺省为 `post_map`）。
- `@unit <ns|ps>`：时间单位（缺省为 `ns`）。

#### (2) 注释与分隔线
- 以 `#` 或 `//` 开头的行为注释行，解析时忽略。
- 纯横线（如 `----`）作为视觉分隔线，解析时自动跳过。

#### (3) 默认简单模式（Simple Mode —— 固定 4 列）
如果未写表头，或表头为 `point at rt slack`（`rt` 列名兼容 `rat`），则按以下 4 列解析：

```text
# 简单模式示例：仅需 point, at, rt, slack 四列
@module alu_core
@stage post_map
@unit ns

point                 at        rt        slack
-------------------------------------------------
# 模块边界 Port
in_a[0]               0.120     0.100    -0.020
out_sum[0]            0.850     0.800    -0.050
clk                   0.000     -         -

# 内部单元引脚 Pin (inst/pin)
u_add_0/A1            0.728     0.717    -0.011
u_add_0/A2            0.406     0.703     0.297
u_add_0/Z             0.825     0.814    -0.011

# 内部线网 Net (代表该 Net 的 Source 驱动端时序)
n_carry_chain_0       0.825     0.814    -0.011
```

#### (4) 详细模式（Detailed Mode —— 表头驱动扩展列）
当需要导入更丰富的物理/时序属性时，只需在表头行显式列出列名（列顺序可自由排列，但必须包含 `point`）：

| 列名（大小写不敏感） | 别名 | 类型 | 含义说明 |
| :--- | :--- | :--- | :--- |
| **`point`** | `object`, `name` | String | **必填**。Port 名、`inst/pin` 路径或 Net 名。 |
| **`at`** | `arrival` | Number / `-` | 信号到达时间（Arrival Time）。 |
| **`rt`** | `rat`, `required` | Number / `-` | 信号要求到达时间（Required Arrival Time）。 |
| **`slack`** | - | Number / `-` | 时序裕量（通常 $\text{slack} = \text{rt} - \text{at}$）。 |
| **`delay`** | `incr` | Number / `-` | **可选（详细模式）**。上一级到当前点的增量延时（门延时或支路线延时）。 |
| **`slew`** | `trans`, `transition` | Number / `-` | **可选（详细模式）**。当前点的信号转换时间（Transition Time）。 |
| **`edge`** | `rf`, `pol` | `r` / `f` / `-` | **可选（详细模式）**。触发最差时序的信号边沿：`r`（Rise 上升沿）或 `f`（Fall 下降沿）。 |
| **`kind`** | `type` | `port`/`pin`/`net` | **可选（详细模式）**。显式指定对象类型，用于极端重名场景下的精确消歧。 |

**详细模式示例（Post-layout 物理阶段排查线延时与 Slew 恶化）：**
```text
@module alu_core
@stage post_layout
@unit ns

point           kind    edge    delay    slew     at       rt       slack
--------------------------------------------------------------------------
u_buf/I         pin     r       0.012    0.020    0.591    0.580   -0.011
u_buf/ZN        pin     f       0.039    0.018    0.630    0.619   -0.011
u_add_0/A1      pin     f       0.098    0.065    0.728    0.717   -0.011
```
> 从上表第三行可见：`u_buf/ZN` 到 `u_add_0/A1` 是一段物理连线，其支路线延时 `delay = 0.098 ns` 且负载端转换时间恶化至 `slew = 0.065 ns`，在原理图上可立即定位出长走线瓶颈。

---

### 3.2 格式二：结构化 JSON 格式（推荐 EDA 工具后台接口集成）

#### (1) 默认简单模式（紧凑数组映射）
键为 `point` 名称，值为 `[at, rt, slack]` 三元数组（缺失值用 `null` 表示）：

```json
{
  "version": "1.0",
  "module": "alu_core",
  "stage": "post_map",
  "unit": "ns",
  "points": {
    "in_a[0]":    [0.120, 0.100, -0.020],
    "out_sum[0]": [0.850, 0.800, -0.050],
    "clk":        [0.000, null,  null],
    "u_add_0/A1": [0.728, 0.717, -0.011],
    "u_add_0/A2": [0.406, 0.703,  0.297],
    "u_add_0/Z":  [0.825, 0.814, -0.011]
  }
}
```

#### (2) 详细模式（对象值映射）
当某个 `point` 需要携带详细属性时，其值可直接写为 JSON 对象（简单数组与详细对象允许在同一个 `points` 字典中混用）：

```json
{
  "version": "1.0",
  "module": "alu_core",
  "stage": "post_layout",
  "unit": "ns",
  "points": {
    "in_a[0]": [0.120, 0.100, -0.020],
    "u_buf/ZN": {
      "at": 0.630,
      "rt": 0.619,
      "slack": -0.011,
      "delay": 0.039,
      "slew": 0.018,
      "edge": "f",
      "kind": "pin"
    },
    "u_add_0/A1": {
      "at": 0.728,
      "rt": 0.717,
      "slack": -0.011,
      "delay": 0.098,
      "slew": 0.065,
      "edge": "f",
      "kind": "pin"
    }
  }
}
```

#### (3) 多模块对比模式（Multi-Module JSON）
当需要在单份 JSON 文件中同时承载多个模块（如用于 Compare 对比视图的 `before` 与 `after` 模块）的时序数据时，支持使用顶层 `"modules"` 字典按模块名分区：

```json
{
  "version": "1.0",
  "stage": "post_map",
  "unit": "ns",
  "modules": {
    "hier_escape_before": {
      "points": {
        "\\u_dp_add_0/w_gen_1207": [0.000, 0.250, 0.250],
        "u_stage1/\\u_leaf$0/A":  [0.120, 0.280, 0.160],
        "u_stage1/\\u_leaf$0/Y":  [0.410, 0.350, -0.060]
      }
    },
    "hier_escape_after": {
      "points": {
        "\\u_dp_add_0/w_gen_1207": [0.000, 0.220, 0.220],
        "u_stage1/\\u_leaf$0/A":  [0.100, 0.260, 0.160],
        "u_stage1/\\u_leaf$0/Y":  [0.320, 0.350, 0.030]
      }
    }
  }
}
```

---

## 4. 缺失值、自动推导与名称匹配规则

### 4.1 缺失值与自动推导（Auto-Inference）
1. **缺省占位符**：文本格式中支持使用 `-`、`NA`、`null`、`*` 表示某指标未提供或无约束（在内部 IR 中统一存为 `null`）。
2. **三知二自动补全**：
   - 若提供了 `at` 与 `rt`，而 `slack` 为空（`-` / `null`），解析器自动推导吗？
     **约定**：为尊重 EDA 工具的精确计算（如考虑微小的舍入或特殊检查），若输入显式给出了数值则原样采用；若 `slack` 缺省且 `at`、`rt` 均为有效有限浮点数，则按 $\text{slack} = \text{rt} - \text{at}$ 自动计算并标记 `slackDerived: true`。

### 4.2 对象名称匹配与消歧规则（Graph-Validated Name Resolution）
在扁平化网表（如包含 `\u_dp_add_0/w_gen_1207` 的综合后网表）中，**端口（Port）或线网（Net）的合法名称本身可能包含路径分隔符 `/`**。因此，解析器在词法阶段**绝不能盲目按 `/` 强拆 `<instance>/<pin>`**，而必须在 `annotateGraphTiming` 阶段结合当前模块的真实图实体集合进行消歧：

1. **顶层模块前缀剥离**：
   - 若当前模块名为 `alu_core`，且输入的 `point` 带有 `/alu_core/...` 或 `alu_core/...` 前缀，优先生成剥离模块名后的候选相对路径。
2. **显式 `kind` 优先**：
   - 若记录显式提供了 `kind`（`port` | `pin` | `net`），则仅在对应类型的图实体集合中匹配。
3. **缺省 `kind` 时的图实体校验优先级**：
   - **步骤 1（尝试匹配存在实例的单元引脚 `pin`）**：当候选路径包含 `/` 时，以最后一个 `/` 切分为 `<instanceCandidate>` 与 `<pinCandidate>`，在当前图的 `cell` 节点集合中查找是否存在匹配的实例（支持归一化标识符匹配与层次路径最长后缀匹配）。**唯有当 `<instanceCandidate>` 确实命中图中的 Cell 节点时**，才将该记录归类为该 Cell 的 `pin`。
   - **步骤 2（匹配边界端口 `port`）**：若步骤 1 未命中任何现有 Cell 实例（或名称不含 `/`），将完整归一化名称与当前图的 `input` / `output` Port 节点直接比对（从而正确支持 `\u_dp_add_0/w_gen_1207` 这类含 `/` 的转义端口名）。
   - **步骤 3（匹配内部线网 `net` 并回溯 Source 驱动端）**：若仍未命中，将完整归一化名称与当前模块的 Net 集合比对。命中后：
     - 记录到 `graph.netTiming[netName]`（同时登记原始名与 `assign` 别名链根名）；
     - 沿 `assign` 连续赋值别名链向上游回溯，找到真正的非 `assign` 物理驱动源（`input` Port 或 `cell` 输出 Pin），将该 Net 的 Source 时序挂载至该驱动端（若驱动端已有显式 Pin/Port 时序记录，则显式记录优先，不覆盖）。
4. **Verilog 转义标识符（Escaped Identifier）兼容**：
   - 遵循 Verilog-2001 规范，剥离前导 `\` 与末尾空白进行归一化比对，同时保留原始显示名称；在列式文本中若 `point` 自身含空格，可使用双引号 `"..."` 包裹。

---

## 5. 内部 Timing IR 目标结构（供代码重构对接）

为兼容工作区缓存签名序列化（`createWorkspaceArtifactKey` 要求状态对象为无环纯数据结构，避免冗余深拷贝）以及现有的 CLI/导入统计契约（`recordCount` / `instanceCount`），`src/timing/timingParser.js` 的输出统一收敛为如下纯对象结构：

```text
TimingDataset
  version: "1.0"
  format: "tabular" | "json"
  module: string | null                  # 默认/首个目标模块名（单模块文件时使用）
  stage: "pre_map" | "post_map" | "post_layout"
  unit: "ns" | "ps"
  records: TimingPointRecord[]           # 扁平化总记录数组
  scopes: Record<string, TimingPointRecord[]> # 按模块名分组的记录（无模块归入 "__default__"）
  recordCount: number                    # 有效时序点记录总数（供导入器与 CLI 校验）
  instanceCount: number                  # 涉及的独立对象/实例估算数（供状态栏摘要展示）
  diagnostics: Diagnostic[]

TimingPointRecord
  point: string                          # 原始标识名
  module: string | null                  # 所属 @module 作用域（未指定则为 null）
  kind: "port" | "pin" | "net" | null    # 显式指定的类型（未指定则为 null，留待图消歧）
  at: number | null
  rt: number | null
  slack: number | null
  slackDerived: boolean                  # slack 是否由 rt - at 自动推导
  delay: number | null                   # 详细模式可选
  slew: number | null                    # 详细模式可选
  edge: "r" | "f" | null                 # 详细模式可选
  line: number | null                    # 源文件行号（供诊断定位）
```
