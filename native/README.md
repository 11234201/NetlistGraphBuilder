# Linux native launcher

```sh
cmake -S . -B build/linux -DCMAKE_BUILD_TYPE=Release -DNGB_BUILD_TESTS=ON
cmake --build build/linux --target ngb -j2
ctest --test-dir build/linux --output-on-failure
```

Run from the repository root. Binary: build/linux/native/ngb.
Standalone cmake -S native -B build/ngb produces build/ngb/ngb.
CMake 3.16+, Linux C++11 and threads are required; tests additionally need Python 3.6+, and Tcl tests need tclsh.
The executable embeds runtime assets and ELK license, but requires compatible Linux system libraries.
The separately installed Tcl helper is not required to run the single executable.

See [build/install/CLI/Tcl contract](../docs/LINUX_SINGLE_FILE_LAUNCHER.md) and [maintenance evidence](../docs/plans/linux_launcher_maintenance.md).
