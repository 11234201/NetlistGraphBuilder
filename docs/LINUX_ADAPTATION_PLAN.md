# Linux 适配状态与后续门禁

更新：2026-10-21。构建、安装、CLI/Tcl 接口见 [Linux 单文件指南](LINUX_SINGLE_FILE_LAUNCHER.md)，
实测与待办见 [维护计划](plans/linux_launcher_maintenance.md)。本文件取代最初“仅在 Windows 跑过 79 tests”的陈旧状态，不修改历史实验数据。

## 已具备

- Native ES modules、vendored ELK、Node/Python 源码预览，无需 bundler/npm 安装。
- Linux C++ 单文件启动器、顶层/独立 CMake 入口、可配置 EDA 安装。
- 标准库 Python 原生协议测试、Tcl helper 与可选 CTest 门禁。
- Linux/Node 24.16.0 已有应用单元与 mapped 严格回归记录；单机结果不代替系统矩阵。

## 尚未承诺

| 项目 | 状态与要求 |
| --- | --- |
| 多发行版 ABI | 需在目标 glibc/libstdc++ 基线构建实测；单文件不是静态链接 |
| CentOS 7 | best-effort；Node/VS Code Server 自身系统依赖不由本项目修复 |
| 多架构、musl | 未完成发布验证，不宣称可直接通用 |
| Linux 浏览器矩阵 | HTTP/CLI 通过不等于 Chromium/Firefox 完整 UI E2E |
| 持续 CI | 服务器手动测试不等同于已配置跨版本 CI |
| 公网/局域网服务 | 不在范围内，保持仅监听 127.0.0.1 |

## 后续顺序

1. 保持应用测试、Node/Python launcher 协议与 native CTest 可复现。
2. 按真实 EDA 环境选择最低系统库基线，补 Tcl 版本与工具内集成验证。
3. 补目标发行版、架构、浏览器及 CI 矩阵，再决定正式支持声明。

原计划建议 HOST=0.0.0.0 与当前 localhost 契约冲突，已删除；远程使用通过端口转发。
