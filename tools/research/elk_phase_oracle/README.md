# ELK Java 相位对照测试台（Phase Oracle Harness）

本目录为**仅供算法研究与回归验证使用的白盒测试台**，用于执行固定上游 Eclipse ELK 提交（`28e5173243cab0cf4e2c9816c803bc0d5c47ab24`）的真实处理器流水线。本目录代码不属于生产运行时，也不替代仓库内的纯静态浏览器原生实现（`src/layout/anchor_layered/`）。

## 1. 工作原理

本目录中的 Java 测试类、专用测试清单（manifest）与构建属性文件会被拷贝至上游 ELK 的 `layered` 测试 Bundle 中：
- 构建配置仅编译 `oracle_src/`，并移除了对上游重量级通用算法测试辅助包的冗余依赖。
- 测试台仅注册 `Core` 与 `Layered` 元数据提供者，由 Maven/Tycho 提供精确的 OSGi、EMF、Guava 与生成选项类路径（classpath）。
- 通过 `LayeredLayoutProvider.startLayoutTest()` 导入待测图，并调用 `ElkLayered.runLayoutTestStep()` 逐一单步执行实际配置的处理器（processor），在每一步执行后序列化中间图状态，标记 `P1`、`P2`、长边拆分（long-edge split）、`P3`、虚拟节点合并（dummy merge）、`P4`、`P5` 以及逻辑边恢复（restoration）等里程碑快照。

## 2. 远端运行方式

远端运行脚本默认期望以下工具链路径（均可通过环境变量覆盖）：

- 解压后的固定版本 ELK 源码：`/home/wzh/open_source/elk-layered-phase-oracle-pinned`（环境变量 `ELK_UPSTREAM_ROOT`）
- Java 17：`/home/wzh/open_source/toolchains/jdk17_apt/root/usr/lib/jvm/java-17-openjdk-amd64`（环境变量 `ELK_JDK_ROOT`）
- Maven 3.9.9：`/home/wzh/open_source/toolchains/apache-maven-3.9.9`（环境变量 `ELK_MAVEN_ROOT`）

将本目录拷贝至远端 `/home/wzh/my_code/elk-layered-phase-oracle/harness`（可通过 `ELK_ORACLE_ROOT` 覆盖）后执行：

```sh
bash /home/wzh/my_code/elk-layered-phase-oracle/harness/run_oracle.sh
```

可通过位置参数覆盖输出的 JSON 路径。Maven/Tycho 缓存与编译中间产物保留在远端构建机上，仅将规范化后的小型 oracle 快照 JSON 拷回代码仓库。

- **默认输入读取**：运行器默认读取仓库 `tests/fixtures/elk_parity/inputs/` 下的持久化 `SOP015` TSV 输入文件；若单独拷贝测试台目录运行，请将环境变量 `ELK_ORACLE_FOCUSED_INPUT` 指向单独拷贝的 TSV 文件。
- **扩展输入（Harness 1.4.0+）**：支持通过 `ELK_ORACLE_INPUT_DIR` 指定包含 `<case_id>.tsv`（由 `export_focused_inputs.mjs` 导出）的绝对目录。导出器完整保留实际的节点、端口、边数组顺序、测量几何尺寸以及无固定端口的**节点级端点**（用于高扇出 hub 节点，严禁凭空捏造固定端口）。
- **快照 Schema（1.1.0）与 BK 决策伴随文件（Harness 1.5.0+）**：
  - 主快照采用 schema `1.1.0`，记录 P2 目标值、P3 扫层候选、BK 数组/候选选择及 P5 依赖、拆分、槽位与层宽决策，并包含直接验证关键依赖环与线段拆分的第二组 JUnit 测试。
  - `export` 同时针对清单中的 `chain_4`、`diamond` 与 `reconvergent_long_edge` 生成快照，可通过 `validate_oracle.mjs <path>` 校验 schema，通过 `validate_artifacts.mjs` 校验图摘要。
  - Harness `1.5.0` 额外导出 `<case_id>.bk_decisions.json` 伴随文件（`traceVersion: 1.0.0`），记录阈值函数调用、选中边端点/所属端口下标、块完成顺序、延迟队列出队、移动与反向重试轨迹。

## 3. 质量隔离与相位差分诊断脚本（非生产引擎）

以下 CLI 工具专用于隔离验证单一阶段假设，每次运行均执行前后文件集一致性审计：

- **`compare_native_phases.mjs [oracle.json ...]`**：对比显式传入的相位快照文件（不传参时默认对比 6 个持久化基准用例），定位原生实现与上游快照在 P1 / P2 / P3 中的首个差异点。
- **`isolate_p3_quality.mjs <oracle.json> <logical-edge-id> <output-dir>`**：冻结上游真实的 P3 前置秩（ranks）、测量端口与初始顺序，校验保留的交叉计数器，并对比 P3 / 合并 / BK 候选结果。
- **`probe_portless_aliases.mjs <capture.json> <witness.json> <output-dir>`**：冻结 P1、秩与扰动键，仅改变隐式源端口身份，报告不同长边链高度与根节点差异。
- **`probe_display_name_ordering.mjs <output-dir>`**：在 6 个持久化输入上仅修改显示名称（display name），断言非显示类的 P0 / P1 / P2 数据完全不变，并报告首个 P3 排序分歧。
- **`probe_bk_boundary_threshold.mjs <oracle.json> <output-dir>`**：在不修改生产源码的前提下机械观察现有 BK 压紧器的行为，并断言观察结果与未观察结果逐字段一致。
- **`compare_bk_decisions.mjs <before-oracle> <observed-oracle> <sidecar> <candidate-report> <output.json>`**：校验原始快照不变性，并通过连通的 P4 前置身份对比有序决策（仅坐标字段允许 `1e-7` 浮点容差）。
- **`replay_bk_port_ties.mjs <oracle> <sidecar> <output-dir>`**：用于同节点同属端口顺序的因果回放验证（不可作为生产 Provider 使用）。
- **`isolate_p3_initialization.mjs <oracle> <output-dir>`**：冻结上游秩与原生扰动键，报告 8 组预声明的层/端口/几何初始化组合与 4 组正常/虚拟端口对照结果。
