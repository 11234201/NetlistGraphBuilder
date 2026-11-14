# 同 AIG 布局对比实验驱动

这些脚本只用于研究实验，不改变产品默认提供器或生产 AIG 功能。报告见 [三布局器实跑对比](../../../docs/research/aig_provider_comparison.md)。用户已明确优先保留 mockturtle / Graphviz 的视觉习惯，后续修正见 [原生风格实验](../../../docs/research/aig_mockturtle_style.md)。

## 运行

在 Linux 源码快照根目录执行，要求 Node 支持 ES modules 和 Array.toSorted，系统提供 Graphviz dot：

~~~sh
node /path/to/run_comparison.mjs \
  "$PWD" \
  /path/to/shared_cone.aag \
  /path/to/output
/path/to/venv/bin/python /path/to/render_comparison.py /path/to/output
~~~

渲染环境需要 CairoSVG 与 Pillow，示例只在实验虚拟环境中安装：

~~~sh
python -m pip install cairosvg pillow
~~~

样例来自 docs/research/assets/aig_visualization_2026_11_14/shared_cone.aag。将同目录 aigverse_metrics.json 放在样例旁边时，脚本会核对深度、节点关键性和扇出。

这是一份固定样例驱动，包含 15 节点、19 边、10 条反相边、9 条关键边的明确检查。它不是通用 AIGER parser 或 benchmark 框架。

## 输出与公平条件

- AnchorLayered、ELK 使用当前源码的 layoutMeasured 入口，ELK 加载 vendor/elkjs-0.11.1。
- Graphviz 直接接收相同节点尺寸与 HTML 端口的 DOT，使用 dot + spline。
- 方向 LR，节点测量框 72×48，主体 64×48，左侧 8 单位留给输入标记。
- 原始 fanin 槽位保留；不优化逻辑，不添加只针对某引擎的 rank=same。
- 节点/层间距配置分别为 48/80；各引擎实际间距可因路由需求变化。
- 同一 SVG 代码使用原始逻辑边路径；不修复路径，不重新布置节点。
- 红色为单位深度关键路径；空心圆为反相；橙色 fo 徽标代表引用数至少 2。
- comparison.png 是高亮版，comparison_plain.png 是关闭分析颜色的版；两图都保留反相标记。
- *_raw.json 保留原始 provider 输出；*_geometry.json 保存统一绘制所用几何。
- elk_engine_raw.json 与 elk_adapter_diagnostic.json 区分真实 ELK section 和项目适配后的转向。
- results.json 包含快照哈希、版本、共同输入条件、检查和指标。

指标边界：Graphviz 曲线按每个三次段 32 个采样间隔近似求长度与交点；只计内部横穿，排除同源重合段。逻辑边总长度会重复统计共享线干。曲线不按 0 折点处理，也不提交给正交专用 validator。耗时为一次冷调用，不作性能排名。

## 固定实验记录

### ABC DOT 与 BLIF 同图

用户确认 DOT 来自 ABC 的 AIG 导出，BLIF 为已经展开的 AND/NOT 结构。aig_input.py 为研究 CLI，通过 Graphviz dot_json 解析 DOT 语法，独立读取 BLIF，再规范化为同一个带名称的 AIG。它没有接入产品浏览器。

~~~sh
python aig_input.py --format abc-dot /path/to/abc_input.dot /path/to/import_dot
python aig_input.py --format blif /path/to/abc_input.blif /path/to/import_blif
/path/to/venv/bin/python test_aig_input.py /path/to/fixtures
/path/to/venv/bin/python render_dual_format.py /path/to/fixtures /path/to/output
~~~

fixtures 需要 abc_input.dot、abc_input.blif，以及原始 shared_cone.aag。前两者已保存在 docs/research/assets/aig_dot_blif_2026_11_14，后者在第一轮资产目录。要求 Graphviz dot 提供 dot_json/svg；绘图依赖相同 CairoSVG / Pillow 环境。

本次实际输入由 ABC 在一次 read_aiger 之后依次 write_dot 和 write_blif 导出，未运行优化。12 项专项测试包含各格式 12 组重排/改名、完整 16 组输入真值、NOT/BUF 链、重复 fanin、常量、输入不可变和错误诊断。绘图驱动分别运行两个导入器和两次 dot，断言规范化模型、显示 DOT、SVG、高亮 SVG、PNG 相同。

支持边界：平坦组合、显式 PI/PO、至多二输入的 AND/NOT/BUF/常量 .names；不支持的逻辑、层次、寄存器和歧义输入显式报错。两个身份独立但结构相同的 AND 当前也报错，不会静默合并。详细范围见 [同图报告](../../../docs/research/aig_dot_blif_consistency.md)。

远端目录：
/home/wzh/my_code/netlistGraphBuilder/aig_visualization_research_20261114/dual_format_comparison

### 原生 mockturtle 风格与高亮

新增 render_mockturtle_style.py，直接把第一轮 mockturtle.dot 交给 dot -Tsvg，然后在同一几何上叠加分析颜色与描边：

~~~sh
/path/to/venv/bin/python render_mockturtle_style.py \
  /path/to/aig_visualization_2026_11_14 \
  /path/to/mockturtle_style_output
~~~

输入目录须包含 mockturtle.dot、shared_cone.aag、aigverse_metrics.json。仍使用相同 CairoSVG / Pillow 环境；拼图字体来自 Linux DejaVuSans。脚本只支持固定组合 fixture，不是通用 AIGER parser，也不处理源目标相同的多重边。生产适配必须保留 edge ID 与 fanin 槽位。

输出原生与高亮 SVG、PNG、并排图、DOT 副本和 checks.json。断言两版所有几何、曲线控制点、箭头、标签和虚线一致，并核对 16 节点（保留原生常量 0）、19 边、10 反相、9 关键边，以及前次 aigverse 节点分析。高亮只改样式，不重跑布局。

### 三布局器统一矩形实验

本次实验使用 2026-11-14 的工作区快照，归档哈希为
6a46922822c1569fd1ebce0b9ac3db792311850babfcb08da7874fcc135f21bb。
当时 Git HEAD 为 59eea493d2ad947b74119771dbe7357cd54ea1b9，包含未提交修改。

远端目录：
/home/wzh/my_code/netlistGraphBuilder/aig_visualization_research_20261114/project_provider_comparison

历史 results.json 中的 sourceRevision 与 Graphviz 版本描述对应此实验环境。复跑时应使用实际环境元数据，并以新的源码和输入哈希识别结果。
