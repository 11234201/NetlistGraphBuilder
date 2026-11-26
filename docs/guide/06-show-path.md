# 6. Show Path 路径追踪与逻辑级数

> 返回 [完整使用教程目录](../USER_GUIDE.md) · 上一章：[5. Timing 时序标注与 Compare 双模块对比](05-timing-and-compare.md)

**Show Path** 同时支持 **Netlist（Single 与 Compare A/B 两侧）** 与 **AIG** 工作区，用于抽取指定起点与终点之间的逻辑路径并集，并计算各输入、输出和中间对象之间的最短/最长逻辑级数。

---

## 6.1 打开入口与指定端点

可通过以下任一方式打开或添加端点：

- 点击上下文工具栏的 **`Show Path`**（或直接切换至 `Navigator → Path` 页签），在 `Find an endpoint` 中搜索对象，逐项加入 **`Starts`** 或 **`Ends`**，再点击 **`Apply`**。
- 在顶部全局 `Search` 下拉结果右侧点击 **`Add…` → `Add as start` / `Add as end`**。
- 选中画布对象后，在右侧 `Inspector` 顶部快捷操作区点击 **`Add as start`** 或 **`Add as end`**。

**支持的对象与约束**：

- **Netlist**：支持当前模块的端口（Port）、线网（Net）、单元（Cell）与明确的引脚（Pin）。Compare 模式下可通过面板顶部的 A/B 选择器指定操作侧（两侧可分别执行与取消路径任务）。
- **AIG**：支持画布节点、原始信号与 BLIF 映射名。
- 遇到同名候选时，可按对象类型、规范化 ID 与极性区分。
- 每端（`Starts` / `Ends`）最多指定 **32 项**。

---

## 6.2 查询模式与逻辑级数报告（Path information）

点击 **`Apply`** 后，系统按端点组合执行路径提取并生成 `Path information` 报告：

- **同时指定 Starts 与 Ends**：画布仅展示从任一起点可达任一终点的路径并集。
- **仅指定 Starts（留空 Ends）**：向扇出方向追踪至自动边界（`Auto ends`，包括组合逻辑停止的寄存器/黑盒/输出边界）。
- **仅指定 Ends（留空 Starts）**：向扇入方向回溯至自动起点（`Auto starts`）。
- 报告同步列出自动边界、不可达端点与预算截断情况。

### 逻辑级数（Logic Levels）阅读方式

- **比较各输入到选定终点的距离**：把目标输出加入 `Ends`，留空 `Starts`，点击 `Apply`，在 `Path information → Auto starts` 查看每个输入的 **`To selected end`**。存在多终点或不等长路径时，显示 `最短…最长` 级数区间。
- **查看仅起点查询的自动终点距离**：`To auto end` / `To auto ends` 对应报告列出的 `Auto ends`。
- **查看特定起点到特定终点的距离**：在 `Starts` 或 `Auto starts` 的某一行点击 **`Distances`**，对应终点行的 **`From start`** 即显示从该起点到该终点的最短与最长级数；展开 **`Object levels`** 可查看沿途中间对象的级数。
- **不可达与不确定标记**：无连接时显示 `unreachable`；存在组合环或方向歧义导致无法确定距离时显示 `unknown`。
- **计数口径**：两种距离均从当前起算点之后计数——**AIG** 每经过一个 AND 节点加 `1`（反相边加 `0`）；**Netlist** 每经过一个组合单元加 `1`（包含显式例化的物理 `BUF` / `INV`）。

---

## 6.3 与 Focused 联动、状态栏控制、保存与导出

- **画布上方状态条（`#pathToolbar`）**：启用 Show Path 后自动显示紧凑状态条，提供 `Open Path`、`Turn off`、`Clear` 快捷操作，无需在长侧栏中来回滚动。
- **与 `Focused` 组合裁剪**：可在 Show Path 提取的路径基础上再启用 `Focused` 进一步缩小画面范围。即使部分端点被裁剪到画面之外，它们仍完整保留在 `Path information` 报告中（标为 `outside Focused`），并在 `Display boundaries` 中列出当前画布的截断点与旁路输入。
- **`Turn off`、`Clear` 与 `Cancel`**：
  - `Turn off`：暂时关闭路径筛选并恢复原视图，**保留已编辑的端点草稿**。
  - `Clear`：清除全部端点与查询。
  - 两者均支持视图历史撤销（`Ctrl+Z`）；耗时查询运行中可点击 `Cancel` 中止。
- **保存与导出**：
  - 含 Show Path 端点的 Single 工作区可通过 `File → Save Golden` 保存为 **Golden v4**，重新加载后完整恢复查询与端点。
  - 点击 `Path information` 中的 **`Export SVG`**（或 Single 下 `File → Export SVG`），导出的独立 SVG 会在图下方附上当前路径查询摘要；**Compare 模式下可通过此入口分别导出 A 侧或 B 侧的 SVG**。

---

## 6.4 实战复现示例

### 示例 1：复现 BLIF 映射名中的 XOR 逻辑深度

1. 打开 [`examples/aig_mapped_names.blif`](../../examples/aig_mapped_names.blif)。
2. 打开 `Show Path`，搜索 `in_96` 并将该 PI 加入 `Starts`；再搜索 `n4` 并将该 PO 加入 `Ends`，点击 `Apply`。
3. 在 `Starts` 列表中，`in_96` 显示 `To selected end 2 · From start 0`；在 `Ends` 中 `n4` 显示距起点 2 级。
4. 再将 `n3` 加入 `Ends` 并重新点击 `Apply`，起点的级数范围更新为 `1…2`。
5. 若此时将 PO 设为 `Focused` 根且把 `Fanin` / `Fanout` 均设为 `0`，报告中仍可读到完全一致的级数数据。

### 示例 2：核对多输入到单输出的逻辑级数

1. 打开 [`examples/aig_structure_demo.blif`](../../examples/aig_structure_demo.blif)。
2. 打开 `Show Path`，搜索 `y`，点击 `po` 行的 `End +`，留空 `Starts` 并点击 `Apply`。
3. 在 `Path information → Auto starts` 中可以看到各主输入到 `y` 的逻辑级数：`a = 4`、`b = 4`、`c = 4`、`s = 2`。
4. 使用 `Focused` 仅保留其中一个输入，其余输入在报告中仍完整保留并标记为 `outside Focused`。

---

> 下一章：[7. AIG 工作区完整指南](07-aig-workspace.md)
