# Liberty reader 首版验证记录

日期：2026-11-10；分支 `codex/liberty-reader`，起点 `a8a1a0e`。验证已结束；通过、既有失败与未支持范围分别记录。

## 环境与范围

计算环境为 mfs-remote，Linux 6.2.0-32-generic、Intel Xeon Gold 6248R 3.00GHz（96 逻辑 CPU）、Node v24.16.0。工作目录 `/home/wzh/my_code/netlistGraphBuilder/liberty_reader_20261110`；完整库位于 `/home/wzh/open_source/ngb_liberty_corpus_20261110`；日志位于工作目录 `dc_runs/liberty/`。浏览器为服务器既有 Chrome 146 / Playwright。

运行时为原生 JS ESM，没有新增运行时依赖。Python 差分工具单独安装到远端 `dc_runs/liberty/oracle_env`：liberty-parser 0.0.29、lark 1.3.1、mpmath 1.3.0、numpy 2.2.6、sympy 1.14.0。不把 GPL 工具或库语料复制到产品包。

## 真实语料字段对照

来源提交与许可入口见 [调研记录](liberty_open_source_and_fixtures.md)。逐 cell 名、pin 名、direction、原始 function 对照独立 Python parser；不能外推为完整 Liberty 或 STA 语义验证。

| 语料 | 字节 | cells / pins | 未解释差异 | JS 解析+模型 ms | 模型字节 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Nangate45 typical | 6692032 | 135 / 541 | 0 | 265.18 | 212424 |
| IHP sg13g2 typ 1.20V 25C | 1720231 | 84 / 285 | 0 | 106.86 | 96834 |
| IHP sg13g2 fast 1.32V -40C | 1721355 | 84 / 285 | 0 | 110.26 | 97091 |

SHA-256：

- Nangate45：`8d540a4d4cf6d09d27c87ad067857a9c0c2eeb023ab7a56e058cd3113db4e9b1`
- IHP typical：`7677a8918689f452e80405ad16a83e744709342574f2aedcc507c2758986b396`
- IHP fast：`f191a3132d0f2f59ca2721884cdb1d8360c8fbf3e0012056af62583dd69ae701`

真实语料首次发现 Nangate 时钟门控单元的 `direction : internal` 被归一化成 unknown。已在 Library IR 保留 internal，并在共享语义层排除外部数据连线；补充回归后上述三库零差异、零模型告警。首次 Nangate 下载超时残片未使用；系统原有 Python 包缺依赖，未修改全局环境，改用隔离 venv。

复现示例（在远端工作目录）：

```sh
dc_runs/liberty/oracle_env/bin/python tools/liberty_oracle.py /home/wzh/open_source/ngb_liberty_corpus_20261110/nangate45.lib dc_runs/liberty/nangate45_oracle.json
node tools/test_liberty_cases.mjs /home/wzh/open_source/ngb_liberty_corpus_20261110/nangate45.lib dc_runs/liberty/nangate45_oracle.json
```

## 性能

`npm run benchmark:liberty` 使用固定行长的被跳过 timing 表，分别精确填充 4/16/64 MiB 输入。单次冷进程内递增输入的记录如下，非多次统计或通用硬件性能承诺。

| 输入 MiB | 解析+模型 ms | 保留 IR 字节 | 进程峰值 RSS MiB（累计） |
| ---: | ---: | ---: | ---: |
| 4 | 89.55 | 949 | 66 |
| 16 | 298.51 | 950 | 88.67 |
| 64 | 1174.96 | 952 | 155.14 |

64 MiB 低于预设 15 秒预算；输入四倍时耗时未超过八倍；跳过数组不随输入进入 IR。原文与词法临时对象仍占内存，不能宣称总内存常量。

常规 `npm run benchmark` 的 1024/4096/8192 cell 均 routed、硬违规 0；布局中位数分别 196 / 1484 / 6507.6ms，保留全部原始日志，不作为 parser 加速对比。

## 产品门禁

- 原始 HEAD 单测 913/913；首轮实现回归 917/920，修复旧签名断言、测试桩窄查询声明和入口行数后 920/920。新增更完整的接口/缓存/取消反例后，最终候选 **926/926 通过**，24.27s。日志 `final/dc_runs/liberty/unit_final.log`。
- 架构最终 247 模块、585 依赖、零未解析/越层/环；main 入口门限 611 → 530（当前 517 行）。
- 浏览器初轮文件导入、来源详情、错误保留、Compare 替换/卸载、混合拖放、扫描取消通过；扫描取消 31.5ms，无 pageerror。最终截图复验实际 Cancel 按钮 20.3ms、扫描取消 39.2ms，无 pageerror。截图 `final/dc_runs/liberty/browser.png`。
- **默认 Simple 的 mapped 门禁未通过，但完整 HEAD 对照确认失败已存在。** 相同 `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases`（47 例、45s 原超时）两组均 24 例失败、违规 1688/120，逐例 PASS/FAIL/TIMEOUT 状态差异为 0。日志 `mapped.log`、`mapped_head.log`、`mapped_comparison.json`。没有删除用例、抬高预算或修改布局算法。
- 两组单次最大 layout 时间分别 43395/44180ms，记录到的最大 heap 分别 986/689MiB；此为不同运行的采样值，不据此宣称内存或耗时改善。测试源码、原始日志均保留。
- 既有失败用例：dp_003、005、007、011、015、016、018、019、020；eq_004、011；sop_003–015。其余 23 例通过。本轮没有修复 Simple 的既有路由/超时问题，因此不能宣称仓库全部门禁全绿。
- Windows 发布检查使用本机专属 .NET Framework 编译器，在 `dc_runs/liberty_release_check` 隔离副本运行 `npm run release:windows -- -SkipTests`；单测放在远端完成。最终包约 1.01 MB，SHA-256 `1de365ed83d8cc2359427c8a64a9a3d179400fe035915c6624ef1822a503b792`；逐文件检查全部运行时源码与当前工作区一致。C# 编译、启动/HTTP 资源冒烟、ZIP、新 Liberty 模块与 ELK 许可证校验通过；没有覆盖既有 dist 包。
- 最终候选与 HEAD 的 47 个 mapped 文件、47 个 module 逐对象比较完整无库图，差异 **0**；命令 `node tools/compare_liberty_baseline.mjs ../dc_runs/liberty/head`，日志 `final/dc_runs/liberty/graph_baseline.json`。

## 已知支持边界

不包含 STA、库写回、.db/.lib.gz、include_file、启动器 --liberty、任意布尔等价、bundle 位映射或 bus 成员区间简写。顺序/三态/多输出等保守展示，未知 function 不抹掉已验证方向。同名 cell 跨库冲突拒绝；库仅本页面内存有效。测试覆盖两套公开标准单元库的标量接口，不代表所有商用工艺库已验证。

文档链接检查：9 份相关文档共 45 个相对链接全部存在；外链和锚点不在此检查范围。`git diff --check` 通过。未 stage、commit 或 push；既有用户文件保持原状。

后续已按用户要求重新下载两库、综合 47 份原 RTL，完成 94 组库/新网表闭环校验。独立连接、接口/真值、负对照和实际浏览器输入结果，以及首轮超时与重跑记录见[重新综合配对验证报告](liberty_synthesis_validation.md)；不改写本页原有布局基线结论。
