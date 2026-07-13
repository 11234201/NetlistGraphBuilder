# Linux 适配与验证计划

## 1. 结论

当前项目在实现层面已经具备较好的 Linux 可运行基础，并已提供 VS Code Remote-SSH 一键预览和 CentOS 7 的 Python 3 回退，但尚未形成“正式支持 Linux”的完整 CI 验证闭环。

- 应用主体是浏览器端原生 ES Modules、HTML、CSS 和 SVG，不依赖 Windows API。
- 本地服务和示例生成器只使用 Node.js 标准库，并通过 `node:path`、`URL` 处理路径。
- 项目没有外部运行时依赖；ELK 已 vendored，运行时无需联网安装前端包。
- 仓库通过 `.gitattributes` 固定文本文件为 LF/UTF-8，未发现仅大小写不同的跟踪文件。
- 现有 79 个 Node 单元测试全部通过，但本次只在 Windows 主机上执行。
- 仓库尚无 Linux CI、Linux 实机启动冒烟和 Linux 浏览器端 E2E。

因此当前状态应表述为：**预期可在 Linux 上运行，但尚未经过持续、可复现的 Linux 验证，不宜承诺为正式支持。**

## 2. 支持范围

第一阶段建议明确支持：

- Ubuntu 22.04 LTS 和 Ubuntu 24.04 LTS；
- Node.js 18、20、22；
- Chromium/Chrome 和 Firefox 的近期稳定版本；
- 本机交互使用：服务默认只监听 `127.0.0.1`。

CentOS 7 作为 best-effort 兼容目标：预览服务可回退到 Python 3，但当前 VS Code Server 和官方 Node.js 二进制的系统库要求均高于 CentOS 7 默认环境，不能把 Remote-SSH 本身纳入项目的支持承诺。

容器部署、局域网访问和公网部署不作为基础 Linux 适配的验收条件；如需支持，应作为单独的部署能力建设。

## 3. 已识别的缺口和风险

| 优先级 | 缺口或风险 | 影响 |
| --- | --- | --- |
| P0 | 没有 Linux CI | 路径大小写、Node 版本和平台回归无法及时发现 |
| P0 | 没有静态服务冒烟测试 | `npm start` 能否启动、首页和模块资源能否返回 200 未被自动验证 |
| P0 | 尚未在真实 CentOS 7/Ubuntu 主机执行自动化验证 | Python 回退和 Bash 选择器目前只有代码级检查 |
| P1 | 没有浏览器 E2E | 文件导入、ELK 加载、SVG 导出和 session 恢复只由单元测试间接覆盖 |

## 3.1 已完成的适配

- `.vscode/launch.json`、`tasks.json` 和 `settings.json` 提供 F5 一键启动、远端浏览器代理和端口恢复。
- `tools/start-preview.sh` 在 Linux 上优先选择可用 Node，并在 Node 不可用时回退 Python 3。
- `tools/serve.py` 提供不依赖第三方包的老 Linux 静态预览服务。
- Node 静态服务不再依赖当前工作目录，并支持 `HOST`/`PORT` 环境变量和可靠的路径边界判断。
- README 已补充 Remote-SSH、CentOS 7、手动端口转发和命令行启动说明。

## 4. 实施计划

### 阶段 A：建立 Linux 基线（P0，约 0.5 天）

1. 在 Linux 环境手工执行一次基线验证：

   ```bash
   node --version
   npm test
   npm start
   curl --fail http://127.0.0.1:4173/
   curl --fail http://127.0.0.1:4173/src/app/main.js
   ```

2. 记录发行版、Node 版本、浏览器版本和结果；若失败，先将问题归类为路径大小写、权限、Node 版本或浏览器差异。
3. 验证示例生成命令，并确认生成前后 Git diff 为空：`node tools/generate-large-example.mjs`。

交付物：一份可复现的 Linux 基线结果，所有失败均有对应 issue/任务。

### 阶段 B：加入 Linux CI 门禁（P0，约 0.5 天）

1. 增加 CI，至少在 `ubuntu-latest` 上使用 Node.js 18、20、22 运行 `npm test`。
2. 增加静态服务冒烟任务：后台启动服务，轮询首页和关键 JS/ELK 资源，完成后可靠地停止进程。
3. CI 同时检查示例生成器的确定性，以及跟踪文件是否存在大小写冲突。
4. 将 Linux/Node 20 设为必过门禁；Node 18 和 22 可先作为兼容矩阵，稳定后全部设为必过。

交付物：每次提交都能自动证明 Linux 下测试、启动和资源加载正常。

### 阶段 C：收紧跨平台实现（P1，约 0.5～1 天）

1. 让 `tools/serve.mjs` 的站点根目录基于脚本位置确定，而不是依赖启动时的当前目录。
2. 支持 `HOST` 和 `PORT` 环境变量；默认仍保持 `127.0.0.1:4173`，避免无意暴露服务。
3. 将文件边界检查改为可靠的相对路径/真实路径校验，并补充以下测试：
   - `/` 和静态资源正常返回；
   - 不存在的资源返回 404；
   - `..`、URL 编码穿越和符号链接逃逸被拒绝；
   - 带空格、中文路径的仓库副本可启动。
4. 保持所有路径拼接使用 Node URL/path API，不引入硬编码 `/`、`\\` 或盘符。

交付物：启动行为不依赖 shell 和当前目录，Linux 路径边界有自动化覆盖。

### 阶段 D：浏览器端 Linux 验收（P1，约 1 天）

1. 使用 Playwright 或等价工具，在 Ubuntu Chromium 上覆盖最小关键路径：
   - 首页加载且控制台无错误；
   - 内置示例完成解析和渲染；
   - 加载 `.v` 文件并切换 module；
   - Simple/ELK 布局均可执行；
   - 搜索、cone、compare、SVG 导出可用；
   - 刷新后 session 状态恢复。
2. 至少保留一条 Firefox 冒烟用例，发现浏览器 API 差异。
3. 将 Chromium 冒烟纳入必过 CI；较慢的完整 E2E 可按提交或定时运行。

交付物：Linux 图形浏览器中的核心用户流程有自动化证明。

### 阶段 E：文档与发布声明（P0，约 0.5 天）

1. README 增加 Linux 前置条件和 Bash 命令，明确 Node.js 支持矩阵。
2. 说明默认仅本机访问；远程主机/容器使用时如何设置 `HOST=0.0.0.0`，并提示网络暴露风险。
3. 增加常见问题：端口占用、无 GUI 服务器、文件权限、浏览器下载策略。
4. Linux CI 与 E2E 连续稳定后，在 README/CHANGELOG 中正式标记 Linux supported。

交付物：用户可以只依赖 README 在受支持 Linux 上完成启动和基本操作。

## 5. 验收标准

满足以下全部条件后，可将项目状态从“预期兼容”改为“正式支持 Linux”：

- Ubuntu 22.04/24.04 上 Node.js 18、20、22 的单元测试全部通过；
- `npm start` 后首页、主模块和 vendored ELK 资源均能成功加载；
- Chromium 核心 E2E 全部通过，Firefox 冒烟通过；
- 从非仓库当前目录启动、带空格/中文路径启动均通过；
- README 有经过实际验证的 Linux 使用步骤；
- CI 对后续提交持续执行上述检查。

## 6. 推荐执行顺序

先完成 A、B、E，快速获得“可验证、可使用、可说明”的 Linux 基线；随后完成 C 和 D，补足服务端边界与真实浏览器流程。预计总工作量约 3 个工程日，不包含发现平台特有缺陷后的额外修复时间。
