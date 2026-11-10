# Liberty 开源实现、解析库与测试语料调研

调研日期：2026-11-10。项目起点：`a8a1a0e`，开发分支：`codex/liberty-reader`。

本轮是源码与公开资料调研，未编译候选项目、未运行解析性能对比，也未将第三方代码或工艺库复制进仓库。下文“事实”来自指定源码/发布元数据，“建议”是结合本仓库约束作出的选型判断。实施步骤见[阶段 5 计划](../STAGE_5_PLAN.md)，工业流程与格式风险见[另一份调研](liberty_format_and_industry.md)。

## 1. 选型结论

**建议：浏览器运行时采用独立、轻量的原生 JavaScript Liberty reader；优先借鉴 Yosys 的选择性保留策略和 OpenSTA 的解析/语义分层；开发期用独立解析器交叉验证。** 当前无需引入整个 STA 引擎，也不把 `.lib` 转成用户 Cell Config 后丢掉原始来源。

这是针对“离线、原生 ES Modules、无安装步骤、只增强结构语义”的项目判断，不是说自研解析器天然优于成熟开源实现。自研方案必须以公开真实库和语法反例证明兼容性；若大文件实测不达标，再评估 Rust/WASM 或离线预处理。

## 2. 可复核版本

以下为本次实际查询并核对的源码版本，不代表承诺跟随最新版。Yosys、OpenTimer 的所读解析源码及 liberty-db 的 Cargo 清单已重新用固定 SHA 读取，与首次读取内容一致。

| 项目 | 固定提交/发布版本 | 本次核查层级 |
| --- | --- | --- |
| Yosys | `ad78a39992898a4aa8ec38744255442bc8d6a16c` | `libparse.cc`、`frontends/liberty/liberty.cc`、文件许可证头 |
| OpenSTA 官方上游 `parallaxsw/OpenSTA` | `044c18fd67770315c8783fc227a6a2e31d13f341` | `LibertyParse.yy`、`LibertyReader.cc`、`LibExprParse.yy`；OpenROAD fork README 指向此官方上游 |
| OpenTimer | `cd0565fc7a720368e75751c717be92d76350ee8d` | `ot/liberty/celllib.cpp`、README、LICENSE |
| liberty-db | `c1e36c1298892355843871076140fbcad4083c69`；清单 `0.17.5` | README、Cargo.toml、LICENSE-MIT；未审计全部语义实现 |
| Python `liberty-parser`，T. Kramer | PyPI `0.0.29`，发布页日期 2026-01-10 | 发布说明、接口示例、GPL-3.0-or-later 元数据；源码入口为 Codeberg |
| Rust `liberty-io` | docs.rs `0.0.4` | 发布包 README 与 Cargo.toml.orig |
| Python `eda-liberty-parser`，rohaansch | main 清单 `0.1.0`，开发状态 Alpha | README、pyproject.toml、仓库 MIT 标记；未固定提交，尚非准入候选 |

## 3. 实现与依赖比较

| 实现 | 核查到的能力 | 许可标识 | 对本项目的用途与限制 |
| --- | --- | --- | --- |
| **Yosys** | C++ 手写 lexer/递归解析，通用 `LibertyAst`，`LibertyFilter`，独立布尔表达式解析；前端可将 cell 导入为模块或 blackbox | 所查文件为 ISC 风格许可 | 最接近“提取结构子集”的参考；不能直接当浏览器 ESM 库使用。其导入错误策略面向综合，不照搬到浏览器 |
| **OpenSTA** | Flex/Bison 语法边界、库读取/建模边界、独立 function 语法；具备实际 STA 数据模型 | GPL-3.0-or-later；上游 README 另述商业许可 | 优先作为语义与真实库参考工具；引入整套 C++/Tcl/构建依赖超出本轮需要，不复制其实现进运行时 |
| **OpenTimer** | C++17 STA；独立 `Celllib/Cell/Cellpin/Timing/Lut` 文件；`read_celllib` 支持 min/max | LICENSE 实文为 MIT，不能仅凭 GitHub 的 NOASSERTION 元数据判断 | 可参考对象模型或作为另一路工具对照；所查 tokenizer 的 quoted-string 特殊处理被注释且标注问题，不能据此宣称完整 Liberty 语法覆盖 |
| **liberty-db** | Rust 强类型数据结构、parser/formatter、BDD 布尔表达式；README 声称覆盖 R-2020.09 数据结构 | MIT | Rust 原生工具备选优先级高；适合生成差分结果。WASM 体积、兼容性和浏览器峰值内存未验证，不能直接承诺可即插即用 |
| **Python liberty-parser** | `Group` 嵌套结构、属性/参数访问、解析和格式化；表格可转换为 Numpy 数组 | GPL-3.0-or-later | 适合 Linux 开发期快速提取 cell/pin/direction/function；不作为浏览器运行时依赖 |
| **Rust liberty-io** | 从 reader 流式读入、通用分组模型、writer | AGPL-3.0-or-later | 流式输入思路有价值；“不加载整份原文”不等于“最终模型恒定内存”，需单独测量 |
| **Python eda-liberty-parser** | 声明支持读取、编辑、保留格式写回；清单无必需第三方依赖 | MIT | 候补脚本工具，仍标 Alpha，先跑相同语料再决定；与 `liberty-parser` 是不同项目，不混淆包名和许可证 |

来源：[Yosys parser](https://github.com/YosysHQ/yosys/blob/ad78a39992898a4aa8ec38744255442bc8d6a16c/passes/techmap/libparse.cc)、[Yosys frontend](https://github.com/YosysHQ/yosys/blob/ad78a39992898a4aa8ec38744255442bc8d6a16c/frontends/liberty/liberty.cc)、[OpenSTA grammar](https://github.com/parallaxsw/OpenSTA/blob/044c18fd67770315c8783fc227a6a2e31d13f341/liberty/LibertyParse.yy)、[OpenSTA function grammar](https://github.com/parallaxsw/OpenSTA/blob/044c18fd67770315c8783fc227a6a2e31d13f341/liberty/LibExprParse.yy)、[OpenSTA 项目与许可说明](https://github.com/The-OpenROAD-Project/OpenSTA/blob/master/README.md)、[OpenTimer parser](https://github.com/OpenTimer/OpenTimer/blob/cd0565fc7a720368e75751c717be92d76350ee8d/ot/liberty/celllib.cpp)、[OpenTimer LICENSE](https://github.com/OpenTimer/OpenTimer/blob/cd0565fc7a720368e75751c717be92d76350ee8d/LICENSE)、[liberty-db 清单](https://github.com/zao111222333/liberty-db/blob/c1e36c1298892355843871076140fbcad4083c69/Cargo.toml)、[liberty-db README](https://github.com/zao111222333/liberty-db/blob/c1e36c1298892355843871076140fbcad4083c69/README.md)、[Python 发布页](https://pypi.org/project/liberty-parser/0.0.29/)、[liberty-io 清单](https://docs.rs/crate/liberty-io/0.0.4/source/Cargo.toml.orig)、[liberty-io README](https://docs.rs/crate/liberty-io/0.0.4/source/README.md)、[eda-liberty-parser 清单](https://github.com/rohaansch/liberty-parser/blob/main/pyproject.toml)。

许可列只记录上游标识，不代替具体文件的再分发审查。本轮没有引入依赖或复制源码。上游 README 中的大文件吞吐、完整覆盖及商业工具验证表述仅是上游声明，本轮不拿它们作为性能排名或兼容性验收。

### Yosys 值得借鉴的细节

- `LibertyInputStream` 分块补充输入；`LibertyFilter` 决定是否保留某类节点。被过滤的组仍经过结构解析，因此可以不保存 timing/power 大表，又不把包含字符串或嵌套组的内容当作简单文本截断。
- `try_parse` / `parse` 区分跳过节点与组结束，过滤不会提前终止 cell。为真实库兼容，源码还接受部分额外分号、缺分号换行等输入；这些宽容行为应记录为工具行为，不能自动当作规范要求。
- `read_liberty -lib` 与功能导入是不同用途；所查版本中 bus 功能导入受限，黑盒导入可以处理部分 bus。`-ignore_miss_func/-ignore_miss_dir/-ignore_buses` 会忽略 cell，故差分时必须记录这些开关和实际接受的 cell，不能只比较“工具退出成功”。

### OpenSTA 值得借鉴的细节

- `LibertyParse.yy` 将 group、simple attribute、complex attribute、variable 分开处理；`LibertyReader` 再消费库和 cell。function 由独立的 `LibExprParse.yy` 处理。
- function 支持前缀 `!`、后缀 `'`、隐式 AND、显式 AND/OR/XOR 及常量。只在字符串上匹配 `A&B` 或只剥一层 `!` 会漏掉合法表达式。
- OpenSTA 是有实现选择的参考工具，并非 Liberty 规范本身；与另一个工具不一致时，需要最小反例与规范核对，不能简单投票判错。

### 其他搜索结果的处置

- [csguth/LibertyParser](https://github.com/csguth/LibertyParser) 包含 C 语法、lexer、检查代码；README 要求参考 `COPYING.pdf`。本轮未核对该许可全文，且不是确认过的官方最新发行，不列为可直接 vendoring 的候选。
- `liyanqing1987/libertyParser` 仓库仍可访问、元数据标 GPL-2.0；所尝试的 `README.md` 路径不存在，本轮不据第三方介绍断言其覆盖率。
- `smprather/liberty-tools` 搜索摘要宣称 Rust/Python 流式索引；仓库 API 已返回迁移响应，旧 README 读取失败，未确认新位置与许可，暂不推荐集成。
- 检索了 JavaScript/npm 实现，但本次没有确认同时满足原生 ESM、Liberty 语义覆盖、许可证及真实库证据的即用候选。这是本轮检索结论，不是“JavaScript 不存在 Liberty parser”的断言。

## 4. 公开标准单元库与语料

“开源库”需要同时区分解析软件与被解析的标准单元数据。以下三个来源足够支撑第一轮互补语料；没有必要下载完整 PDK。

| 数据来源 | 实际核查的文件/形态 | 适合覆盖 | 准入注意点 |
| --- | --- | --- | --- |
| **Nangate45 / ORFS** | `flow/platforms/nangate45/lib/NangateOpenCellLibrary_typical.lib`，目录 API 报 6,692,032 bytes | 常见组合/时序标准单元、完整 timing 块跳过、大于极简 fixture 的解析规模 | README 声明是研究测试用、不可制造的库；所查平台 LICENSE 为 Apache-2.0。落地 fixture 前还需核对具体 `.lib` 文件头 |
| **SKY130 HD** | `google/skywater-pdk-libs-sky130_fd_sc_hd` 的 `timing/` 为 `.lib.json`，存在多个 corner | 厂商前缀命名、多 PVT、pg_pin、复杂 function | JSON 不是原生 `.lib` 解析验收。应按官方生成流程获得文本 `.lib`，同时固定生成工具版本；库仓库 LICENSE 为 Apache-2.0 |
| **IHP SG13G2** | `ihp-sg13g2/libs.ref/sg13g2_stdcell/lib/` 内有 fast/slow/typical 与多个电压版本；typ_1p20V_25C 文件 1,720,231 bytes | 另一套命名、同名 cell 的多角候选与显式库绑定 | 根 LICENSE 为 Apache-2.0；本轮只核查路径、大小和许可入口，尚未全量解析或核对每个 cell |
| **项目自写最小 fixture** | 将来新增于独立 Liberty fixture 目录 | 转义、bus/bundle、重复 cell、截断字符串、非法方向、资源上限、HTML 特殊字符 | 是精确反例的主力，不能替代真实完整库；不要改造现有 47 个 mapped Verilog 来迁就 reader |

目录与许可来源：[Nangate45 README](https://github.com/The-OpenROAD-Project/OpenROAD-flow-scripts/blob/f34d4d9cde545e629985b36813b8cc9a75b0cdcc/flow/platforms/nangate45/README.md)、[Nangate45 文件目录](https://github.com/The-OpenROAD-Project/OpenROAD-flow-scripts/tree/f34d4d9cde545e629985b36813b8cc9a75b0cdcc/flow/platforms/nangate45/lib)、[Nangate45 LICENSE](https://github.com/The-OpenROAD-Project/OpenROAD-flow-scripts/blob/f34d4d9cde545e629985b36813b8cc9a75b0cdcc/flow/platforms/nangate45/LICENSE)、[SKY130 timing](https://github.com/google/skywater-pdk-libs-sky130_fd_sc_hd/tree/ac7fb61f06e6470b94e8afdf7c25268f62fbd7b1/timing)、[SKY130 LICENSE](https://github.com/google/skywater-pdk-libs-sky130_fd_sc_hd/blob/ac7fb61f06e6470b94e8afdf7c25268f62fbd7b1/LICENSE)、[官方文件类型说明](https://skywater-pdk.readthedocs.io/en/main/contents/file_types.html)、[IHP lib 目录](https://github.com/IHP-GmbH/IHP-Open-PDK/tree/5e6d592e4002946a4616f798c357f0f3c06cf3b6/ihp-sg13g2/libs.ref/sg13g2_stdcell/lib)、[IHP LICENSE](https://github.com/IHP-GmbH/IHP-Open-PDK/blob/5e6d592e4002946a4616f798c357f0f3c06cf3b6/LICENSE)。大小来自本次目录 API，尚不是下载后的完整性校验。

数据版本记录：ORFS `f34d4d9cde545e629985b36813b8cc9a75b0cdcc`；SKY130 HD `ac7fb61f06e6470b94e8afdf7c25268f62fbd7b1`；IHP `5e6d592e4002946a4616f798c357f0f3c06cf3b6`。实施时需记录选用文件 SHA-256、许可文件、抽取方式与工具版本。

## 5. 第一轮验证怎么做

1. 在 `mfs-remote` 的 `/home/wzh/open_source/` 固定候选工具和测试库版本；项目试验放在 `/home/wzh/my_code/netlistGraphBuilder/` 的隔离目录。构建、完整库、差分 JSON 和日志留在服务器。
2. 先建立项目原有无库路径基线，再让每个 reader 输出排序后的 `(library, cell, pin, direction, function, sequential-kind)` 清单。仅比较双方明确支持的语义子集，保留不支持项和诊断。
3. 方向逐项精确比较；function 的空白差异不能直接判语义不同。第一轮以小规模有界输入真值表或经过审查的规范化表达式比较，不对任意大表达式做指数展开。
4. 至少覆盖 Nangate 完整库与 IHP 两个角；SKY130 在确认文本生成来源后加入。语法失败必须定位到文件/行列；合法但暂不支持的组不能破坏其后 cell 的提取。
5. 性能只报告同硬件、同输入、同输出保留策略的耗时与峰值 RSS/浏览器内存；全 AST parser 与只保留接口的 reader 不作无说明的速度排名。另测大 timing 块下的 retained model 大小、取消延迟及旧结果不提交。

未验证项：所有候选的本地/远端构建情况、浏览器 WASM 支持、真实库解析一致性和性能。当前交付只完成调研，不宣称这些测试已通过。
