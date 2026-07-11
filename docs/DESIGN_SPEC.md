# 设计规范

## 产品体验原则

这是工程分析工具，不是营销页面。第一屏应该直接是可用工作台：

- 顶部工具栏：文件、module、视图模式、搜索、导出。
- 左侧可选检查面板：module 列表、对象属性、统计。
- 中间主画布：schematic。
- 底部可选状态栏：解析状态、选择对象、布局耗时。

不做落地页，不做大面积装饰图，不用解释性空话占据主画布。

## 视觉风格

- 背景使用中性浅色或深色可切换，但默认应适合长时间读图。
- gate、port、wire 颜色要帮助区分结构，不要使用单一色系铺满整个界面。
- 文本字号保持稳定，不随 viewport 宽度缩放。
- 按钮、输入框、工具栏高度要稳定，避免 hover 或动态文本导致布局跳动。
- 卡片只用于重复项、属性面板、弹窗，不把页面 section 做成层层卡片。

## 交互规范

### 画布

- 支持滚轮缩放。
- 支持鼠标拖拽平移。
- 支持 fit to view。
- 支持选中对象后居中。
- 支持导出当前图为 SVG。
- 支持 Simple/ELK layout provider 切换；异步布局和渐进渲染通过状态栏报告进度。
- 大图允许自动 group collapse，紫色虚线组点击展开，并提供重新折叠入口。
- 低缩放级别允许隐藏 pin、label、metadata 和 timing 文本，放大后必须恢复。
- 支持布局校准模式：该模式下拖动单个 schematic 节点，普通查看模式下拖拽仍表示平移。
- 布局校准模式应支持网格吸附和相连 pin 的 y 方向吸附，方便把 wire 调成水平或短折线。

### 搜索

搜索对象包括：

- module
- port
- net
- instance
- cell type

搜索命中后：

- 高亮对象。
- 视图居中到对象。
- 属性面板显示对象详情。

### 高亮

对象点击后的默认行为：

- 单击 gate：选中 gate，显示 pins 和 connected nets。
- 单击 net：选中 net，显示 driver 和 loads。
- 双击 output/net：进入 fanin cone。
- 双击 input/net：进入 fanout cone。

高亮样式必须可叠加：

- selected
- fanin
- fanout
- search-hit
- compare-diff

## Schematic 绘制规范

- 默认方向：left-to-right。
- PI 放左侧，PO 放右侧。
- gate 输入 pin 默认在左，输出 pin 默认在右。
- 对 NAND/NOR/INV/XNOR 等反相输出显示 bubble。
- unknown cell 使用矩形 blackbox，显示 cell type 和 instance。
- net label 默认贴近相关 pin，优先靠近 target cell input pin；避免漂在长 wire 的中间位置。
- fanout 较大时允许折叠为 hub。
- wire routing 优先局部直连和短 dogleg，只有长跨层或局部冲突明显时才使用顶部 lane。

## 可访问性和可读性

- 文本不能与线或节点不可控重叠。
- 缩放后文字仍应可读。
- 高亮不能只依赖颜色，必要时加粗线宽或改变边框。
- 所有图标按钮必须有 tooltip。
