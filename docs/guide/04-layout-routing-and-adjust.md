# 4. 布局引擎、显示选项、不布线 Net、Adjust 与导出恢复

> 返回 [完整使用教程目录](../USER_GUIDE.md) · 上一章：[3. 网表浏览、搜索、层次导航、Focused 与重收敛分析](03-netlist-navigation-and-views.md)

本章介绍网表的离线布局引擎与间距调节、显示与大图简化选项、指定 Net 不布线、`Adjust` 手工校准，以及独立 SVG 导出、Layout Golden 快照与状态恢复机制。

---

## 4.1 布局引擎选择与自动降级

`Settings → Layout → Provider` 提供三种完全离线运行的网表布局引擎：

- **`AnchorLayered`（默认）**：内置物理锚点分层布局与正交布线引擎，Single 与 Compare 共用同一流水线。若遇到超出支持范围的拓扑，输出明确诊断并自动依次尝试降级至 `ELK` 与 `Simple`。
- **`ELK Layered (Experimental)`**：本地化集成的 Eclipse Layout Kernel（vendored `elkjs 0.11.1`），适合尝试不同初始排布；失败时自动回退至 `Simple`。
- **`Simple Layered`**：轻量级分层布局引擎，可手动选择，同时作为最终兜底回退方案（Simple 处于冻结状态以保持既有行为稳定）。

**首选项与降级规则**：

- 新会话与命令行启动默认使用 `AnchorLayered`；自动降级仅影响当次布局，**不会覆盖用户已保存的默认首选项**；若 `Simple` 仍失败则停止重试，用户主动取消任务不触发降级。
- 缺少首选项版本号的旧 `Simple` 会话在首次升级打开时会一次性迁移回 `AnchorLayered`，此后用户主动选择的 `Simple` 或 `ELK` 会正常持久化保留。

---

## 4.2 导线间距、单元间距与垂直引脚转角

在 `Settings → Layout` 中可调节两项核心间距：

- **`Wire spacing`**：控制平行正交导线通道间距（Lane pitch），默认 `24 px`，范围 `4–96 px`（主要作用于 `Simple` 布局与 `Adjust` 局部重布线通道）。
- **`Cell spacing`**：控制单元、输入端口、输出端口间的水平/垂直间距与拥塞留白，默认 `8 px`，范围 `4–320 px`（调大可拉开密集单元并扩展走线通道）。

两项间距均支持**滑块拖动**与**数字直接输入**：输入数字并回车或失焦提交后，自动四舍五入吸附至最近的 **4 的倍数**并限制在合法区间内（如输入 `29` → `28`，输入 `30` → `32`；空值或非法字符恢复上一次有效值），修改后立即重排当前视图。

**垂直引脚（Top / Bottom Pin）末段转角保护**：当导线连接至单元顶部或底部引脚（如触发器清零/置位端或测试引脚）时，即便水平距离极近，正交布线器也会强制保留可见的垂直末段引导折弯，防止末段重叠难辨（`Adjust` 拖拽释放后同样生效）。

---

## 4.3 显示选项与大图渲染策略

### `Settings → Display`

- **`Show aliases`**：默认关闭，系统自动折叠纯 `assign` 连续赋值别名链以减少冗余节点；勾选后显式展示 `assign` 别名结构（显式例化的物理 `BUF` 单元始终作为真实单元保留，不会被当作别名折叠）。
- **`Fanout hubs`**：默认开启；对扇出负载数 `≥ 8` 的同源线网自动插入共享中继节点（hub），大幅减少长距离平行干线；取消勾选则逐一展开原始分支。
- **`Gate symbols`**：支持在两种风格间一键切换，**不改变节点几何边界、引脚坐标、布线路径或当前视口**：
  - `Rectangles`：所有单元统一绘制为标准矩形框。
  - `Conventional`：将已识别的 `BUF` / `INV`、`AND` / `NAND`、`OR` / `NOR`、`XOR` / `XNOR` 绘制为标准数字电路逻辑门符号（反相输出自动带反相气泡 bubble），子模块、黑盒、寄存器与未知单元保持矩形框。
- **UNIT 门标题简化**：形如 `UNIT_ADFFR_PN_GATE` 的单元在画布中心简化显示为 `ADFFR_PN`（保留内部下划线与数字）；实例显式标题优先，Inspector 仍保留完整 `cell type`。

### 渐进式渲染与分组折叠退役说明

- **分批渐进渲染**：当当前视图的可见节点与连线总数达到 `400` 时，自动启用可取消的分批 SVG 渲染，底部状态栏显示进度。拖拽或过渡预览帧中可临时省略装饰性跨线桥（wire bridge），完成后完整恢复所有桥接弧、标签与点击热区。
- **分组折叠已退役**：结构分组折叠（Group collapse/expand）已退出产品路线；大图统一通过完整图、`Search-first` 或 `Focused` 局部图浏览（旧存档中的折叠字段仅作向后兼容忽略）。

---

## 4.4 指定 Net 不布线（Net routing）

对于 `clk`、`reset` 等高扇出全局网络或任意干扰读图的线网，可单独关闭其几何连线绘制：

1. 点击画布中的导线，或在单元 `Inspector → Connections` 中点击目标 net 名称。
2. 在 `Inspector → Connections → Net routing` 区域取消勾选 `Route net`。

**行为说明**：

- 默认所有 net 均参与布线；同一信号链上的 `assign` 别名会同步隐藏或恢复，而赋为相同常量的独立 net 互不影响。
- 隐藏几何导线后，单元引脚标记、Inspector 连接详情、`Focused` 锥体追踪与重收敛逻辑分析均保持完整。
- 隐藏后仍可通过顶部 `Search` 或相邻单元的 `Connections` 列表重新选中该 net 并勾选 `Route net` 恢复连线。
- Compare 模式下 A/B 两侧独立维护各自的隐藏 net 集合。该设置支持视图历史、模块切换、Single 标签页刷新恢复、Golden 存取与 SVG 导出；执行 `Settings → Layout → Reset view overrides` 会一并恢复所有被隐藏 net 的布线。

---

## 4.5 Adjust 手工校准

点击上下文栏的 `Adjust` 按钮进入手工校准模式，再次点击退出。`AnchorLayered`、`ELK` 与 `Simple` 三种布局模式均支持混合手工微调。

- **拖拽移动节点**：按住任意单元或端口拖动，过程仅更新轻量级预览并弱化关联导线，支持网格吸附与相邻引脚水平对齐吸附；松开鼠标后仅对受影响的关联导线执行正交避障重布线。自动布局器会在画布顶部预留编辑缓冲区，方便将最顶排节点继续上移。
- **调整节点尺寸（`Inspector → Adjust → Size`）**：支持精确修改 `Width`（`24–420 px`）与 `Height`（`12–260 px`），`Reset size` 恢复自动计算尺寸。
- **覆盖单实例显示属性（`Properties`）**：可针对当前选中单个实例临时覆盖 `label`、`title`、`subtitle`、`gateKind`、`inferenceSource`，`Reset properties` 恢复默认值（如需按 `cell type` 批量复用请使用 `Cell Config`）。
- **覆盖单实例引脚方向（`Pin directions`）**：可将当前选中实例的某个引脚临时指定为 `input` 或 `output`，便于验证局部连接与布线效果；`Reset pin directions` 清除临时覆盖。
- **重置全部覆盖**：`Settings → Layout → Reset view overrides` 一次性清除当前视图的位置、尺寸、实例属性、引脚方向及不布线 net 覆盖（Compare 模式下同时作用于 A/B 两侧）。

---

## 4.6 导出 SVG、Layout Golden 与状态恢复

### 导出独立 SVG（`File → Export SVG`）

Single 视图下点击 `File → Export SVG`，将当前画布（整图或 Focused 局部图）导出为自包含 `.svg` 文件，内嵌完整导线、跨线桥、标签、时序徽标与 CSS 样式，离线可用。Compare 模式下可在 `Show Path → Path information` 中导出所选 A 侧或 B 侧的 SVG。

### Layout Golden 保存与加载

- **`File → Save Golden`**：将当前 Single 模块名称、视图模式、Focused roots、扇入/扇出深度、所有节点位置/尺寸/实例覆盖、不布线 net 与导线路径保存为 Golden JSON（Compare 中不可用）。
- **`File → Load Golden…`**：先载入对应网表后再加载 Golden JSON（在 Compare 中加载会退出对比并恢复对应的 Single 工作区）。
- **版本与内容指纹**：包含 Show Path 端点的查询保存为 **v4**，其余保存为 **v3**；均记录网表源码内容指纹（fingerprint）。若网表内容实质变更，即使文件名与大小相同也会安全拒绝，防止错配旧坐标；仅重命名文件但内容未变时可正常加载。同时向后兼容导入旧版 v1 / v2 Golden。

> **注意**：Layout Golden（保存单模块几何布局与实例覆盖）与 `Cell Config`（保存可跨网表复用的单元类型语义）是两种独立 JSON 格式。

### 标签页会话恢复与持久化范围对照

| 数据类型 | 存储位置 | 刷新标签页 | 关闭标签页 | 说明 |
| --- | --- | --- | --- | --- |
| 网表会话（网表、模块、Focused roots/深度、布局引擎/间距/符号、视口、手工微调、不布线 net） | `sessionStorage` | 自动恢复 | 自动清理 | 仅限当前标签页、当前站点地址 |
| AIG 会话（同页多份 AIG、各图 Level 附件、活动图、Focused、高亮开关、视口） | `sessionStorage` | 自动恢复 | 自动清理 | 超出配额时清除旧存档防止误恢复 |
| `Cell Config` 类型定义 | `localStorage` | 保留 | 保留 | 跨网表生效，可 JSON 导入导出 |
| 工作台界面偏好（面板开关、宽度、最近页签） | `localStorage` | 保留 | 保留 | 按浏览器与站点地址（含端口）保存 |
| Liberty `.lib` 库 | 页面内存 | **需重新加载** | 清除 | 不写入 `sessionStorage` 或 Golden |

---

> 下一章：[5. Timing 时序标注与 Compare 双模块对比](05-timing-and-compare.md)
