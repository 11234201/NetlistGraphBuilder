# Acorn 8.15.0（仅用于开发期架构门禁检查）

`acorn.cjs` 是从 Node.js `v24.12.0` 源码树 `internal/deps/acorn/acorn/dist/acorn` 中提取的独立 Acorn 语法解析包。架构门禁脚本直接以 CommonJS 方式加载该本地文件，既不调用 Node.js 内部私有 API，也无需执行 `npm install` 安装外部包。

- **上游地址**：https://github.com/acornjs/acorn/tree/8.15.0
- **开源许可证**：`MIT`（完整声明见同目录下的 `LICENSE` 文件）
- **`acorn.cjs` SHA-256 校验值**：`23db9caa827172bb60f50978d14a1a9d51ff34e11bfed2408787854a6359d53b`

**依赖范围边界**：仅 `tools/` 与 `tests/` 下的开发校验脚本依赖该文件；浏览器端运行时源码、Linux 单文件内嵌资源以及 Windows 离线发布包均**不包含**该文件。日后如需升级版本，必须同步核对并更新版本号、提取来源、许可证与 SHA-256 摘要，并重新运行模块依赖图测试（`npm run test:architecture`）。
