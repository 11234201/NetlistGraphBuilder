# Linux 原生单文件启动器（`native/`）

在仓库根目录下可执行以下命令完成构建与测试：

```sh
cmake -S . -B build/linux -DCMAKE_BUILD_TYPE=Release -DNGB_BUILD_TESTS=ON
cmake --build build/linux --target ngb -j2
ctest --test-dir build/linux --output-on-failure
```

- **构建产物路径**：从仓库根目录构建时，生成的可执行文件位于 `build/linux/native/ngb`；若直接以 `cmake -S native -B build/ngb` 方式独立构建，则生成于 `build/ngb/ngb`。
- **构建与测试环境要求**：编译需要 **CMake 3.16+**、支持 **C++11** 的 Linux 编译器及 **POSIX threads**；开启 `-DNGB_BUILD_TESTS=ON` 运行集成测试需要 **Python 3.6+**，运行 Tcl 辅助脚本测试另需 `tclsh`。
- **运行时说明**：生成的单文件二进制已内嵌全部前端运行时源码、vendored ELK 及开源许可证，运行时无需外部 `src/` 目录或独立安装的 Tcl 辅助脚本，仅依赖目标 Linux 系统的基础 C/C++ 动态库。

完整构建选项、CMake 安装集成、CLI 启动协议与 Tcl 接口契约请参阅 [Linux 单文件启动器指南](../docs/LINUX_SINGLE_FILE_LAUNCHER.md) 及 [Linux 启动器维护记录](../docs/plans/linux_launcher_maintenance.md)。
