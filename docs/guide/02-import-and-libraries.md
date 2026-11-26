# 2. 导入设计、多文件合并、Liberty 库与 Cell Config

> 返回 [完整使用教程目录](../USER_GUIDE.md) · 上一章：[1. 安装、运行与界面总览](01-getting-started.md)

本章覆盖所有数据导入入口、批量导入与失败保护规则、支持的 Verilog 语法与注释属性、Liberty（`.lib`）标准单元库管理，以及自定义单元语义配置（Cell Config）。

---

## 2.1 从 File 菜单打开与追加文件

点击全局栏 `File` 菜单，顶部为统一入口，下方按 **`Netlist + Timing`**、**`AIG + Level`** 与 **`Export & snapshots`** 分组：

- **`Open design…`**：支持同时单选或多选 `.v`、`.sv`、`.dot`、`.blif`、`.level`、`.txt`、`.csv`、`.tsv`、`.timing`、`.sta`、`.log`、`.rpt`、`.json`，自动识别并配对导入 Verilog + Timing 或 AIG + Level。
- **`Open from server…`**：当页面通过 SSH 配对连接到后端服务时显示，可直接浏览服务器 `--browse-root` 目录内的文件并执行打开或追加（详见 [8. SSH 远程工作台与 EDA 集成](08-remote-workbench-and-eda.md)）。
- **`Netlist + Timing` 分组**：
  - `Add design file(s)…`：向当前已打开的 Verilog 设计追加合并一个或多个网表文件。不同文件中的同名模块自动以 `<模块名> [<文件名>]` 区分显示，同时保留原始模块名用于层次化实例引用、Compare 自动配对与 `@module` 时序匹配。
  - `Paste netlist…`：在弹窗中粘贴结构化 Verilog 代码，点击 `Draw`（或按 `Ctrl+Enter` / `Cmd+Enter`）解析绘图。
  - `Open timing…` / `Add timing file(s)…`：替换或向当前时序数据集追加时序报告（支持 `.log`、`.txt`、`.rpt`、`.timing`、`.sta`、`.csv`、`.tsv`、`.json`）。
  - `Paste timing…`：明确按 Timing 格式粘贴并解析，避免短小文本被自动识别为 Verilog。
- **`AIG + Level` 分组**：
  - `Open AIG…`：打开 ABC AIG DOT 或平坦两输入组合 BLIF，进入独立 AIG 工作区。
  - `Add AIG file(s)…` / `Append pasted AIG…`：向当前页面的 AIG 集合追加多份独立的 DOT / BLIF，并通过顶栏 `Active AIG graph` 切换。
  - `Paste AIG…`：粘贴 DOT 或 BLIF 文本，可选 `Logic View`、`Search-first` 或 `Standard` 视图提交。
  - `Open AIG in Search-first`：勾选后，后续打开或拖入的大型 AIG 先建索引再按需布局。
  - `Cancel AIG import`：在导入或布局进行期间随时取消，安全保留原视图。
  - `Open levels…` / `Paste levels…`（AIG 活动时启用）：为当前 AIG 导入 `.level` 层级与裕量报告（详见 [7. AIG 工作区完整指南](07-aig-workspace.md)）。

成功导入新设计会替换当前 Design 并重建模块列表、搜索索引、诊断信息与视图状态；若新输入解析失败，系统报错并安全保留此前已成功加载的 Design。

**超大文本粘贴优化**：当粘贴超过 `256 KiB` 字符的大网表或长时序文本时，弹窗在内存中完整保留原文，仅在界面渲染带提示的头部预览，避免浏览器卡顿。预览状态下可直接粘贴替换、`Ctrl+A` 复制完整原文或点击 `Draw` 提交完整原文；点击 `Clear` 清空，确实需要手改时可点击 `Edit full text` 展开完整原生文本框。

---

## 2.2 拖放与全局粘贴

除顶部 `File` 菜单外，还可直接将文件拖放到页面任意位置，或在焦点不处于任何可编辑输入控件时按 `Ctrl+V` / `Cmd+V`。系统自动识别以下内容：

- 结构化 Verilog 网表（`.v` / `.sv` / `.txt`）
- 时序报告文本（Tabular / CSV / JSON）
- AIG 文件或文本（ABC AIG `.dot`、两输入组合 `.blif`）
- AIG `.level` 文件，或含 `point` 及 `at_level` / `rt_level` / `slack_level` 至少一项的表格文本
- 布局快照文件（Layout Golden `.json`）
- Liberty 标准单元库（`.lib` 或 `library(...) { ... }` 文本）

> 自定义 `Cell Config` JSON 请通过 `Settings → Cell Config → Import definitions…` 或命令行 `--cell-config` 导入。

---

## 2.3 批量导入顺序与失败保护

当一次选中、拖入或粘贴多个文件时，系统按领域与依赖关系自动编排：

1. **网表批次依赖顺序**：严格按 **Liberty（如有）→ 网表 → Timing → Golden** 串行执行；同一批次含多个 Verilog 或多个 Timing 文件时，首个文件建立数据集，其余同类型文件自动追加合并。
2. **AIG + Level 智能配对**：一张 AIG 与一份 Level 一起导入时自动绑定，顺序与文件名均可自由选择；多张 AIG 与多份 Level 同批导入时，优先按同名文件主干配对（如 `before.blif` 配 `before.level`），若仍存在歧义则在修改工作区前拒绝并提示。混合批次同时包含网表与 AIG 时，先完成网表及其附件，再切换至 AIG 工作区。
3. **前置失败即中止**：若前置步骤（如 Liberty 或网表解析）或未识别文件失败，系统立即报错并跳过依赖它的 Timing / Level 附件，绝不将新附件误套用到旧设计或旧 AIG 上。
4. **单份 Liberty 约束**：单次批量操作至多接受一份 `.lib` 文件；包含多份 `.lib` 时整体拒绝并提示，避免按文件顺序隐式挑选工艺角（Corner）。
5. **活动视图保护**：所有新输入均在后台完成解析与校验后再提交视图，失败或取消不会破坏当前正在浏览的画面。

---

## 2.4 支持的 Verilog 语法与注释属性

本工具专注于综合映射后的门级结构化 Verilog（Gate-level Structural Verilog）：

- `module` / `endmodule` 模块定义，ANSI 与非 ANSI 端口声明
- `input`、`output`、`inout`、`wire` 声明与向量位宽（如 `[31:0]`、`[0:0]`）
- 位选择/切片（`bus[7]`、`bus[3:0]`）、拼接表达式（`{a, b[1:0]}`）与常量字面量（`1'b0`、`4'hF`）
- `assign` 连续赋值别名（Alias）
- 命名端口连接的单元实例化（如 `NAND2 u0 (.A(n1), .B(n2), .ZN(y));`）
- 转义标识符（Escaped identifiers，如 `\u_top/reg[0] `）与层次化名称
- **结构化注释属性（Structured comment attributes）**：自动解析形如 `// module: <目标> : <类别>, key=value, ...` 的注释元数据（支持 `module`、`port`、`bus port`、`net`、`bus net`、`instance` / `inst` / `cell`），并在 `Navigator → Design`（模块级属性）与 `Inspector → Attributes`（对象属性及子模块引用属性；折叠 `assign` 别名链时自动合并线网属性）中分组展示。

> **提示**：行为级 `always` 块、复杂算术/逻辑运算符表达式、宏定义展开（`` `define ``）及参数化 `generate` 展开不属于结构化网表阅读器的目标范围，建议输入经综合器映射后的门级网表。

---

## 2.5 Liberty 标准单元库（`.lib`）

`Settings → Liberty` 展开独立库管理面板（不占用左侧导航栏），用于离线加载、替换、取消和卸载文本 `.lib` 标准单元库（Single 与 Compare 共用）：

### 导入与生命周期

- 点击 `Load .lib` 选择文件，或直接拖放 `.lib`、全局粘贴 `library(...) { ... }` 文本；支持先加载库再加载网表。
- 收起菜单（再点按钮、点外部或按 `Esc`）不会卸载库或中断扫描；如需中止正在扫描的大库，点击 `Cancel import`。
- 每次成功导入会替换当前库并立即刷新连接方向与门类型；点击 `Unload` 恢复无库命名推断语义。
- 若遇到语法错误、超限或同名 `cell` 冲突，系统拒绝新库并保留旧库（单文件允许多个不同名 `library` 块，但 `cell` 名称必须全局唯一）。
- **内存驻留**：Liberty 库仅保存在当前页面内存中，刷新或重开标签页后需重新加载，不会写入 `Cell Config`、`sessionStorage` 或 Golden 文件。

### 语义推断优先级与诊断

- 选中单元后，`Inspector → Attributes` 显示库名、源文件名及原始布尔 `function`；取自库声明的引脚方向来源标记为 `library`。
- 存在真实 `module` 定义的层次化子模块始终遵循其模块端口声明；对于原语（leaf）单元引脚，方向优先级从高到低依次为：
  **单实例 `Adjust` 覆盖 > `Cell Config`（含显式 `unknown`）> Liberty 库声明 > 内置命名规则**。
- 缺失 `cell` / `pin` 或人工配置与库声明冲突时，底部 `Diagnostics` 会明确提示；电源/地引脚（`pg_pin`）与内部引脚不作为信号连线绘制。

### 支持子集与容量边界

- 支持标量接口、`pg_pin`、`ff` / `latch` 标记、三态标记，以及带显式 `type` 位范围的同方向 `bus`。常见 `AND` / `NAND` / `OR` / `NOR` / `XOR` / `XNOR` / `BUF` / `INV` / `MUX` 采用有界布尔识别；复杂逻辑、常量、多输出、锁存器与三态单元保持保守展示。面板展示前 20 条告警（完整告警保留在库模型中）。
- **容量上限**：文本上限 **64 MiB**（UTF-8），单个 token 上限 **1 MiB** 字符；超限报错指明限制项与行列位置。
- **暂不支持**：`include_file`、`.lib.gz`、二进制 `.db`、`bundle` 位映射、`bus` 成员区间简写；Liberty 仅辅助方向与门类型识别，不执行 STA 延时计算，命令行启动器暂不设 `--liberty` 参数。

---

## 2.6 Cell Config（自定义单元类型配置）

`Cell Config` 用于按 **单元类型（cell type）** 定义并持久化逻辑门类别与引脚方向，适合补充无 `.lib` 环境下内置规则尚未覆盖的工艺库原语单元。

### 创建或修改单元类型定义

1. 在画布或搜索结果中选中目标原语单元实例。
2. 点击 Inspector 底部的 `Edit cell type…`。
3. 在弹出的编辑器中设置 `Gate kind` 以及各个引脚的 `direction`。
4. 点击 `Save` 保存。

- **智能预填**：打开编辑器时自动填入内置规则已识别出的 `gate kind` 与 `pin direction`，只需修正个别引脚即可。
- **支持的 `Gate kind`**：`AND`、`OR`、`MUX`、`INV`、`NAND`、`NOR`、`XOR`、`XNOR`、`BUF`、`REGISTER`、`BLACKBOX`。
- **支持的 `Pin direction`**：`input`、`output`、`inout`、`unknown`。
- 保存后，当前网表中所有属于该 `cell type` 的原语实例立即更新，推断来源显示为 `user-config`（真实子模块实例不受影响）。在大模块中保存时会自动保持当前 `Focused` 视图，避免触发全图重排。

### 删除、重置与本地持久化

- `Delete saved`：删除当前选中单元类型的自定义配置，恢复默认推断。
- `Settings → Cell Config → Reset all definitions`：清空浏览器本地保存的全部自定义配置。
- `Cell Config` 持久化保存在浏览器的 `localStorage` 中，刷新、重开标签页或导入其他网表后依然生效。

### 导入与导出 JSON

- `Settings → Cell Config → Export definitions`：按确定性字母序导出为 `netlist-cell-config.json`。
- `Settings → Cell Config → Import definitions…`：载入 version 1 JSON 配置；若与本地已有同名 `cell type` 冲突，会弹窗确认是否覆盖。格式非法或枚举值无效时安全拒绝，不破坏现有配置。

```json
{
  "kind": "netlist-cell-config",
  "version": 1,
  "cells": {
    "MY_NAND2": {
      "displayName": "MY_NAND2",
      "gateKind": "NAND",
      "pins": {
        "A": "input",
        "B": "input",
        "ZN": "output"
      }
    }
  }
}
```

---

> 下一章：[3. 网表浏览、搜索、层次导航、Focused 与重收敛分析](03-netlist-navigation-and-views.md)
