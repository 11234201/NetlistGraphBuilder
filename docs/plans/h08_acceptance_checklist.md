# H08 静态入口与产品验收清单

本清单区分工程验证、用户视觉决定和产品切换。Simple 默认保持不变。

后续独立产品决定：验收完成后，用户明确要求默认使用新方法；1.1.1已统一新会话、registry与EDA
默认H08，Simple保留为失败回退，旧session显式选择继续尊重。下文“Simple默认不变”均为1.1.0
验收时的历史口径，不代表1.1.1；默认提升的新增验证见 `docs/reports/h08_development_summary.md`。
1.1.1新增验证：809/809单元、实际默认/EDA/Compare/显式Simple恢复、Windows构建通过；
但最新原47严格回归46/47，DP02045110ms超时，完成项硬0/0。因此1.1.1全图门禁未通过，
不以1.1.0历史47/47替代。runtime1e60ad93，604文件运行前后和本地/远端一致，核心算法JS未变。

最终状态：**本轮 H08 约定范围验收完成**。2026-10-15 用户对最后三个mapped分层样本
（sop001、eq006、dp002）的整体及固定局部窗口回复“可以通过”。结合此前视觉决定和工程证据，
可作限定结论：在已声明的平面网表支持范围和本次验收语料上达到约定的ELK可读性水平。
不代表任意网表、ELK全部选项、性能/内存稳定性或全算法等价；不自动提升默认provider。

| 门禁 | 当前证据 | 状态 |
| --- | --- | --- |
| 离线静态入口 | `src/layout/elk_native/h08.js`，package0.3.0/profile1.0.0；传递依赖无 Node、动态编译和网络依赖 | 已实现/单测通过 |
| P0/P3/P5 完整相位 | 静态/研究逐相位差分、排列/输入不变性、取消和提示快照；首轮完整 unit795/795 | 通过 |
| 恒零计分与首成员堆 | P1 100组完整旧实现差分；可变/访问器/修改 scratch 回退；完整实际41079节点P3全字段相同 | 通过 |
| 实际P3固定同输入对照 | old12055ms/current9291ms，摘要e2d3a6de…；单对诊断，不代表全图或稳定收益 | 已记录 |
| 六产品几何/完成态 SVG | 三 Focused、sop001/eq006/dp002 逐字段与原H08一致，包含优化后快照 | 通过 |
| 指定产品视觉 | 用户已接受 SOP015/5404 独立树与 EQ1471；只在几何/SVG一致时继承 | 通过（限定范围） |
| 合成机制视觉 | 11个可绘制图+1条专用探针报告，不是12张视觉图；用户已对共同视口评审页回复“可以通过” | 通过（2026-10-15） |
| 原47×45000ms/无折叠/严格检查 | 最终8c24f7d7快照47/47、hard0/0，max40534ms/heap采样543MiB；保留此前46/47和控制超时 | 通过（非性能稳定性承诺） |
| 产品注册provider原47门禁 | runtime52a93b92，原worker/47例/45000ms/no-collapse/hard，47/47、硬0/0，max41897ms/堆采样1137MiB；前后文件冻结相同 | 通过（非稳定性承诺） |
| 最新完整单元 | 产品核心/集成807/807；仅增加非运行时mapped审查导出器及其测试后808/808，runtime不变 | 通过 |
| Single/Compare/override/export | 实际Single/Compare H08完成；两侧override隔离，Reset完整路径恢复；实际SVG导出57节点；H08 session恢复与快速provider替换 | 通过 |
| UI registry/旧实现隔离 | registry整体接入H08，ID不变、Simple仍默认；旧22文件移至测试参考，架构测试防回流 | 通过 |
| benchmark | 最终产品同运行时Simple1024/4096/8192 routed/hard0，layout232.2/1603.9/6642.4ms | 通过；不代表H08性能 |
| Windows离线包 | v1.1.0编译/launcher smoke/实际包内H08 Single/Compare/210源码一致/ELK许可证通过；ZIP40f18087… | 通过（本地构建，未发布） |
| mapped分层样本最终视觉 | sop001/eq006/dp002完整几何未改，916KB无损gzip；用户对同尺度整体与固定canonical窗口评审回复“可以通过” | 通过（2026-10-15） |

源码、夹具、工具在每个全图 run 前后冻结；不同快照不拼成一次通过。单例诊断、相位计时、
源码检查、用户视觉接受均不能代替原47-case正式门禁。未取得用户视觉决定不伪造签收。

当前运行与失败原件在远端 `netlistGraphBuilder-physical-anchor-20261013/dc_runs/h08_*`；
仅必要的11组小型SVG回传至本地 `dc_runs/h08_static_corpus_review`，不进入Git。

静态准入时本地/远端599文件逐字节一致；产品切换更新包README、应用版本及UI调度，需使用新的
交付快照，不沿用8c24f7d7作为产品runtime哈希。包使用方式以 `docs/design/elk_h08_package.md` 为准。
既有Windows旧版本未覆盖；本轮生成的初版1.1.0在补齐session修复后重新构建。

最终交付603文件本地/远端runtimeEqual/fileSetEqual均true。原47正式run前后完全一致；最后两项
非运行时增加仅为 `export_product_review.mjs` 与对应单测。产品审查源8c24f7d7到产品52a93b92的
`src/layout/elk_native/*.js`（含子目录）全部相同，UI调度/标签等变化没有替换审查所用算法。

最终已签收页面：`http://127.0.0.1:5194/dc_runs/h08_mapped_product_review/index.html`。
原始大SVG/图JSON仍在远端；本地只回传916KB压缩完成图，GUI解压显示属于本地能力例外。
每张图所有原SVG字节保留；局部仅改viewBox，整体共用max bounds。选点预定为首个output、
最大出度节点和canonical顺序中位cell，不按布局好坏挑窗口。

2026-10-15 用户已签收11组机制场景。实验Native整体替换、实际Single/Compare、原provider47门禁
和Windows离线包工程验证均已完成。随后用户签收最后三个mapped样本，本轮约定范围验收闭合。
签收不修改冻结运行时或离线包，不重跑未变化算法；未提交、未推送、未对外发布。
