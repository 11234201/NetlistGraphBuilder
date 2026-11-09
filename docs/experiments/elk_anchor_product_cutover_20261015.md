# H08 产品切换与离线交付验收

## 准入与范围

2026-10-15 用户对11组机制场景回复“可以通过”。此前已接受 SOP015 `_5426_`/`_5404_`
与 EQ1471。该决定只覆盖已审查语料；不外推所有网表等价ELK。
静态候选最终原47-case门禁已通过，先前失败和超时原件保留不覆盖。

## 切换单元

- registry 保持 `native-layered` ID，整体使用 H08；Simple 仍默认，ELK 保留。
- 原22个 Native 源文件移至 `tests/reference/retired_native_layered/`，内容和历史测试保留；
  仅机械修改相对引用，不随src进入发布包。对照工具改用当前注册provider。
- 增加运行时全目录导入隔离测试；包0.3.0/profile1.0.0，应用版本1.1.0。

## 实际UI发现与修复

第一次真实Single选择H08触发“synchronous job returned a Promise”并显式回退Simple。
原因是 UI 只按 `elk-layered` ID 进入异步分支，而候选workspace单测并不覆盖该分支。
现以provider `executionMode: async`统一决定Single/Compare任务调度，新增架构回归。
不修改布局/布线输出，不隐藏fallback，也不接回旧算法。

本地浏览器实测属于必须依赖本地GUI的能力例外；常规完整测试/47-case/benchmark在mfs-remote。

已实测：

- SOP015 Focused3/3，57节点60边，Ready为Native H08、No diagnostics。
- Adjust拖动一次产生1个位置override；Reset后节点outerHTML与全部SVG path d逐字节恢复。
- 实际菜单导出 `tc-focused-depth-3.svg`（96892字节，完整独立SVG，57节点）。
- 真实双module Compare，两侧H08完成、No diagnostics，左右布局与Fit均可用。
- Windows包内Compare左侧拖动后，右侧完整SVG未变；Reset恢复两侧全部路径。
- H08 session初始化暴露首个异步graph尚为空时的统计读取；统计边界显示Pending并加执行型单测。
  修复后恢复无启动错误，快速ELK→H08替换最终为H08，无控制台错误。现有session不保存Compare模式，
  不把该既有范围写成Compare模式刷新恢复已支持。

截图保存在忽略目录 `dc_runs/h08_product_acceptance/`。下载等待工具本轮异常耗时，
不将工具延迟当作布局性能证据；文件与UI导出成功状态均已确认。

## 正式回归

第一次注册provider冻结快照：805/805 unit，原47/47、hard0/0、45000ms、无折叠，
max38910ms，最大逐case堆采样857MiB。此快照尚未包含上述UI异步修复，不能作为最终交付快照。
第二次含async调度快照806/806、原47/47、hard0/0，max38252ms/heap采样540MiB；
统计空图修复后的最终产品runtime：
`sha256:52a93b928fe1bd4177d6a5437a4906188a5fa6110d80efe04cae725c4112929b`。
807核心/集成单元、原47/47、hard0/0、45000ms、noCollapse=true、原worker，
max41897ms、最大逐case堆采样1137MiB；run前后fileSetDigest相同。
同运行时Simple benchmark1024/4096/8192全routed/hard0，layout中位数232.2/1603.9/6642.4ms。
这不是H08性能结论；没有更改timer、夹具数或validator来过门禁。

最后加入非运行时mapped审查导出器及单测后完整808/808；基线差分仅这两个文件增加，runtime相同。
本地和远端603文件runtimeEqual/fileSetEqual均true。正式run为
`dc_runs/h08_delivery_final_47`；单元/benchmark为`h08_delivery_final_*`，工具增量为
`h08_delivery_review_unit.log`。不混用早期快照作为最终产品结果。

## 最终验收

2026-10-15 用户对最后三个mapped分层样本回复“可以通过”，本轮约定范围视觉及工程门禁均闭合。
Windows构建使用既有脚本`-SkipTests`，避免把已在远端进行的完整测试搬回本地；并非省略测试。
Windows包210源码逐文件哈希相同、ELK许可证相同、H08静态模块HTTP200/javascript，真实包内
Single/Compare与override/Reset已通过。ZIP为918971字节，SHA-256：
`40f1808776e67e9085da9f701f64098ba559da94601f83946f75357abdbb63fe`。
该包为本地构建未对外发布。签收只更新记录，不改变最终runtime、603文件基线或ZIP校验和。

## 最后视觉交接

页面：`http://127.0.0.1:5194/dc_runs/h08_mapped_product_review/index.html`。
已验证sop001整体、eq006中位cell、dp002中位cell窗口正常加载，完整SVG无损gzip仅916KB回传。
原大SVG/graphJSON留在服务器。每图同尺度整体用于追溯分支，固定局部以同一canonical对象为中心，
两侧同1800×1400窗口；不重新布局、不删几何、保留label/bridge/hit area。
抽样策略在导出器内固定为canonical首output、最大出度、cell中位项，并记录到review_source.json。
用户已回复“可以通过”；连同11机制和两个指定Focused签收，约定语料视觉门禁全部通过。
结论限于已声明的平面网表支持范围和本次验收语料，不宣称普遍等价ELK或性能稳定。
