# 综合映射网表回归用例（Mapped Netlist Fixtures）

本目录下的 **47 个门级结构化 Verilog 用例**由 Local Resyn 基准测试集通过 **Yosys 0.53** 配合 **Nangate Open Cell Library** 综合映射生成。仓库仅纳入映射后的 `.v` 网表文件与稳定测试脚本；综合过程日志、JSON 中间产物与性能基准报告均保存在已忽略的 `dc_runs/` 目录中。

执行常规映射网表布局回归测试：

```bash
npm run test:mapped-cases
```

执行不带分组折叠的完整节点（Full-node）严格回归测试：

```bash
MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases
```

在 Windows PowerShell 环境中，请先设置环境变量再运行测试：

```powershell
$env:MAPPED_CASE_NO_COLLAPSE = "1"
npm run test:mapped-cases
```
