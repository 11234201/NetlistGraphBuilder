# Liberty 与重新综合网表的配对验证

日期：2026-11-10。分支 `codex/liberty-reader`。重新下载两套库并综合原 47 份 RTL，最终 94 组网表/库配对全部通过结构核验；首轮 4 个综合超时及后续重跑单独保留。本轮未发现需要修改运行时代码的 Liberty 缺陷。执行计划与失败记录见 [执行计划](../plans/execution-plan.md)和[工作日志](../progress/work-log.md)；此前字段对照、性能和原有布局基线见[首版验证](liberty_reader_validation.md)。

## 固定输入与环境

- RTL：`dc_runs/local_resyn_ut_yellow_cases_v6/yellow/{datapath,equal,sop}/*/top.v`，20 个 datapath、12 个 equal、15 个 SOP，47 文件共 110500 字节。
- Linux 隔离工作区：`mfs-remote:/home/wzh/my_code/netlistGraphBuilder/liberty_synthesis_20261110`。库、网表、Yosys JSON 与完整日志留在服务器；小型结果报告和两张 QA 截图另取回本地 ignored `dc_runs/liberty_validation/`。
- 综合器：`/home/wzh/software/yosys_install/yosys`，Yosys 0.53，git SHA `53c22ab7c0ced80861c7536c5dae682c30fb5834`，与历史 fixture 头一致；二进制 SHA-256 `322c1da215116fa04a478c984835125405ff103f580c62f4085b6354e1f9fa49`。每份 RTL/网表/JSON 的 SHA 均在 manifest 中。
- Node v24.16.0；独立语义 oracle 使用 liberty-parser 0.0.29 与 SymPy 1.14.0，仅作为测试依赖。
- 新库位于 `/home/wzh/open_source/ngb_liberty_synthesis_20261110`，来源、许可背景见[语料调研](liberty_open_source_and_fixtures.md)。

| 库 | 固定来源 | 字节 | SHA-256 |
| --- | --- | ---: | --- |
| Nangate45 typical | [ORFS f34d4d9c](https://github.com/The-OpenROAD-Project/OpenROAD-flow-scripts/blob/f34d4d9cde545e629985b36813b8cc9a75b0cdcc/flow/platforms/nangate45/lib/NangateOpenCellLibrary_typical.lib) | 6692032 | `8d540a4d4cf6d09d27c87ad067857a9c0c2eeb023ab7a56e058cd3113db4e9b1` |
| IHP sg13g2 typical 1.20V 25C | [IHP 5e6d592e](https://github.com/IHP-GmbH/IHP-Open-PDK/blob/5e6d592e4002946a4616f798c357f0f3c06cf3b6/ihp-sg13g2/libs.ref/sg13g2_stdcell/lib/sg13g2_stdcell_typ_1p20V_25C.lib) | 1720231 | `7677a8918689f452e80405ad16a83e744709342574f2aedcc507c2758986b396` |

历史 OpenTimer Nangate 文件 SHA 为 `2efd0b32eb580e4e60e72fc0575bb3bc69aac907c91d908442e4ae6d7fe55895`，与本次下载文件不同，所以本轮重新映射，不将旧网表当成新库的配对证据。现有 checked-in 47 份 mapped fixtures 未覆盖。

## 验证层次

1. **重新综合**：`read_verilog -sv; hierarchy -check -top tc; synth -top tc; dfflibmap -liberty; abc -liberty; read_liberty -lib -ignore_miss_func; clean -purge; check -assert; stat -liberty; write_verilog -norename -noattr -noexpr -nodec; write_json`。首轮两个并行任务、每例 180s，超时项新目录串行 600s 功能复核。输出目录必须新建；manifest 核对完成状态、预期数量和身份，保留所有 attempts。
2. **独立结构对照**：以 Yosys JSON 为 oracle，逐实例检查 cell type、pin 集合、pin 方向及连接的每个 net bit；检查图的输入/输出端点、cell 间边对应同一 Yosys bit、每个已连接输入有入边、没有隐式驱动。库来源必须为 `library`，Verilog 与图诊断均为零。读取前验证库/网表/JSON 哈希。
3. **独立布尔语义**：Python liberty-parser 解析实际使用的 cell 接口；SymPy 对有界组合 function 枚举真值表，JS 验证已识别门分类与这些结果一致。顺序元件检查顺序类别及接口，复杂组合门保守保留 blackbox。
4. **浏览器输入**：每库真实导入 `.lib` 和新生成的 dp_001、eq_001、sop_001，核对画布单元数量与选中单元类型/库来源，再检查 Compare 两侧。Compare 要求不同模块名，因此只将第二份实际 SOP 网表的模块声明改为 `tc_peer`，其余 cell/pin/连线原样保留；派生 `.v` 留在测试输出目录。使用产品实际的 pointerdown 入口，断言选中状态、Compare side 和 library 来源。保留截图、pageerror 和失败现场。

## 最终结果

| 对应库 | 配对用例 | cell 实例 | pin 检查 | 图边检查 | 实际 cell 类型 | 真值表行 | 差异/诊断 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Nangate45 | 47 | 54575 | 226834 | 154807 | 29 | 132 | 0 |
| IHP typical | 47 | 51749 | 195166 | 148924 | 27 | 132 | 0 |
| 合计 | **94** | **106324** | **422000** | **303731** | **56** | **264** | **0** |

最大单例分别为 Nangate sop_015（3867 cell）与 IHP dp_020（3810 cell）。56 种实际使用的 cell 接口及原始 function/three_state 与独立 parser 一致；其中 34 种已识别组合单元以 264 行真值表校验门分类，2 种顺序单元核对类别，其他 20 种保守保留黑盒。这里的数量是不同 cell 类型，不是 34 种门符号。

- 保留名称后的 pilot：6/6 综合与配对核验通过，290 cell、1077 pin，零图诊断。
- 三项负对照全部被正确拒绝：错库产生 `library-missing-cell`；改错输入方向触发非输入边目标；改错 net bit 触发连接不一致。日志 `pilot_controls.log`，报告 `dc_runs/liberty_synthesis/pilot_named/controls/controls_report.json`。
- 浏览器最终 **6/6** 新网表实际导入、**2/2** 库的 Compare 两侧检查通过，pageerror **0**；使用默认 **45000ms**，`diagnostic=false`，页面就绪分别 1724/1719ms。两张最终截图已逐张查看，能看到对应库、零告警与左右一致的门类型。
- 补齐远端测试输入后，完整 **npm test 926/926**，38.29s。运行时 **247 文件**逐一 SHA 与本地完全一致；本轮只新增验证工具并维护结果文档，未改变运行时契约。

远端主要证据（均相对上述隔离工作区）：

| 证据 | 路径 |
| --- | --- |
| 首轮/补跑/含全部 attempts 的配对清单 | `dc_runs/liberty_synthesis/{full/manifest.json,retry_nangate45/manifest.json,combined_manifest.json}` |
| 逐例结构结果、独立真值、汇总 | `dc_runs/liberty_synthesis/{reader_report.json,oracle.json,truth_report.json,summary.json}` |
| 浏览器报告、派生 Compare 输入、截图 | `dc_runs/liberty_synthesis/full/browser_corrected/` |
| 完整单测及源码一致性 | `unit_final.log`、`snapshot_verification.json` |
| 首轮及失败日志 | `full_synthesis.log`、`retry_synthesis.log`、`pilot*.log`、`unit_synthesis.log` |

## 失败及限制

- 初轮 6 例综合成功，校验失败于 Yosys 默认 Verilog 导出重命名，而 JSON 保留原实例名。根据本机 `help write_verilog` 使用 `-norename` 后重新综合，6 例对照通过；原始输出和失败日志保留。
- 一次读取诊断在 30s 停止于读库阶段；独立扫描诊断随后约 2.4s 完成 Nangate 解析与建模，完整配对也完成。远端负载与耗时有波动，未确定根因，未据此修改产品预算或声称性能改善。
- 浏览器两次初始 `goto` 超过 45s，HTML 为初始 Ready，失败截图也未在 5s 内取得。追加 600s 诊断模式后进入导入，先暴露测试用了错误 click 事件，再发现单模块不满足 Compare 前置条件；这些测试问题均修正。最终完整流程恢复默认 45s 并通过，没有用长时限诊断冒充默认门禁通过。
- 首轮综合 **90/94 通过**；Nangate dp_018/019/020、eq_011 超时，前三者日志分别停在 ABC 后读库、ABC 后读库、synth/techmap。单独串行复核配置 600s，实际分别 **2.556/3.368/7.778/2.056s** 全通过。首轮失败没有删除或改写；不宣称初次 180s 全绿或稳定性能改善。
- 本轮首次单测 925/926，唯一失败为隔离副本遗漏 `docs/design/elk-native-phase-contracts.md` 和对应 schema 输入；补齐仓库原文件后完整重跑 926/926。源代码没有为此变更。
- 本验证针对两套公开库实际映射使用的接口与支持的逻辑分类；不等于完整 Liberty 支持、STA、RTL 与网表形式等价证明，也不代表商用 PDK 均已覆盖。原有 Simple 布局基线失败仍见首版报告。

## 复跑命令

以下在远端隔离工作区运行；再次综合需换一个不存在的输出目录。

```sh
python3 tools/synthesize_liberty_cases.py \
  --yosys /home/wzh/software/yosys_install/yosys \
  --rtl-root dc_runs/local_resyn_ut_yellow_cases_v6/yellow \
  --library nangate45=/home/wzh/open_source/ngb_liberty_synthesis_20261110/nangate45.lib \
  --library ihp=/home/wzh/open_source/ngb_liberty_synthesis_20261110/ihp_typ.lib \
  --output dc_runs/liberty_synthesis/full
# 本轮仅以下 4 项需补跑；新的运行应以实际失败项为准。
python3 tools/synthesize_liberty_cases.py \
  --yosys /home/wzh/software/yosys_install/yosys \
  --rtl-root dc_runs/local_resyn_ut_yellow_cases_v6/yellow \
  --library nangate45=/home/wzh/open_source/ngb_liberty_synthesis_20261110/nangate45.lib \
  --output dc_runs/liberty_synthesis/retry_nangate45 \
  --cases dp_018 dp_019 dp_020 eq_011 --jobs 1 --timeout 600
python3 tools/merge_liberty_synthesis_runs.py dc_runs/liberty_synthesis/combined_manifest.json \
  dc_runs/liberty_synthesis/full/manifest.json dc_runs/liberty_synthesis/retry_nangate45/manifest.json
node tools/test_liberty_synthesis.mjs dc_runs/liberty_synthesis/combined_manifest.json dc_runs/liberty_synthesis/reader_report.json
/home/wzh/my_code/netlistGraphBuilder/liberty_reader_20261110/dc_runs/liberty/oracle_env/bin/python \
  tools/liberty_synthesis_oracle.py dc_runs/liberty_synthesis/combined_manifest.json dc_runs/liberty_synthesis/oracle.json
node tools/test_liberty_truth.mjs dc_runs/liberty_synthesis/combined_manifest.json dc_runs/liberty_synthesis/oracle.json dc_runs/liberty_synthesis/truth_report.json
# 已执行的负对照来自 pilot_named；可对最终清单重新运行：
node tools/test_liberty_synthesis_controls.mjs dc_runs/liberty_synthesis/combined_manifest.json dc_runs/liberty_synthesis/controls_new
NGB_PLAYWRIGHT_MODULE=/home/wzh/my_code/papers-highlights-20261017/node_modules/playwright/index.mjs \
NGB_CHROME=/opt/google/chrome/chrome node tests/e2e/liberty_synthesis_e2e.mjs \
  dc_runs/liberty_synthesis/full/manifest.json dc_runs/liberty_synthesis/full/browser_corrected
npm test
```
