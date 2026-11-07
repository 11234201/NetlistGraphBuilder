# 浏览器入口职责收敛

状态：本轮入口收敛已完成。main.js 从 4191 行降为 611 行（测试口径，包含末尾换行）。
目标是按职责迁移、明确状态所有者，不能用拆成多个共享全局变量的大文件替代。

## 已完成的边界

- `application/workspace_execution.js`：Single/Compare 共用的同步/异步 job 调度、过期结果过滤和错误出口。
- `app/workspace_inputs.js`：旧 state 到 Single workspace 请求的兼容投影；不保存状态。
- 回归覆盖同步/异步、双侧共同提交、过期结果和失败；原 JobCoordinator 继续拥有 revision 与取消。
- `architecture-boundaries.test.js`：入口行数不得超过当前上限；禁止直接 start/runSync、判断 executionMode，
  禁止其他源码反向 import main。入口预算只能随迁移降低，不能提高或通过压缩代码满足。

## 已完成的职责迁移

| 批次 | 职责 | 目标边界 | 验收 |
| --- | --- | --- | --- |
| 2 | 导入、导出、Golden | input/golden 控制器；领域校验继续消费现有 domain API，下载走 platform | 已完成；Chrome 文件导入、Golden/SVG 导出通过 |
| 3 | View History | history 控制器；事务实现仍由 application 边界拥有 | 已完成；历史单测及 Chrome Back/Forward 通过 |
| 4 | 选择详情、编辑和画布 | inspector、selection_navigation、cell_config、canvas、compare_canvas 等职责模块 | 已完成；共享 helper 保留，Chrome Focused/Compare 通过 |
| 5 | state 镜像写入入口 | state_commands + 既有 ViewSession bridges | 已完成迁移；正常编辑走 commands，生命周期/存档恢复保留显式兼容适配 |


每批完整迁移一个职责及其测试，降低入口预算后再结束。新 controller 不接收整个 app state，
而接收最小只读查询和命令回调；不能反向 import main，也不能复制 Single/Compare 逻辑。

## 新功能落点

1. 领域规则或 IR/查询语义：domains 及其已有 parser/analysis 边界。
2. 应用用例、调度、事务：application；不读取 DOM、不按领域 ID 分支。
3. DOM 事件、面板、手势生命周期：ui；通过回调调用用例。
4. 存档格式：persistence；浏览器下载与存储适配：platform。
5. main 只实例化模块、注入依赖、绑定入口；新增 wiring 需要先释放现有预算。

必要验证是 `npm test` 和受影响的浏览器工作流；只有修改图、布局或渲染算法时才追加 mapped
和相应性能门禁。涉及发布资源清单时检查 Windows 离线包；不为纯职责迁移重新生成算法基线。

## 状态与兼容边界

- DocumentStore 拥有源文档，ViewSessionStore 拥有计算 revision 与画布策略/选择/override。
- state_commands 控制器统一 Single/Compare 的命令入口与旧 UI 镜像写回；入口不再直接实现这些写入。
- 旧 state 未被删除：导入、历史恢复和持久化仍需兼容旧格式。这些混合用例留在 app 适配层，
  不把 Netlist 或 DOM 依赖移入领域中立 application。它们通过 `legacy_port` 获得逐项声明的字段，
  不能增加新字段或访问整个对象；模块的 state/elements/services 契约与实现放在同一文件。
- 临时变量分别由对应控制器拥有：cell config 草稿、Focused 防抖 timer、历史事务序号及存档 timer。
- `workbench_controllers.js` 仅静态组装；无模块全局共享变量，无反向入口依赖，也无第二个业务大文件。
- 旧源码形状检查通过测试专用 source loader 寻找迁移后的函数；实际依赖注入另有 port/commands 行为测试
  及真实 Chrome 工作流验证，不能用源码匹配替代行为证据。

## 可复现验证

- 远端目录：`/home/wzh/my_code/netlistGraphBuilder-architecture-fix-20261106`。
- `npm test`；`npm run test:docs`。
- `npm run test:workbench` 是可选开发工具检查，需要既有 Playwright；不向离线运行时引入依赖。
  可通过 `NGB_PLAYWRIGHT_MODULE` 指定模块路径、`NGB_CHROME` 指定 Chrome 可执行文件。
  它覆盖导入、alias、Focused、历史、Golden/SVG 下载、Compare 与 Worker 取消。
- Windows 临时工作区运行 `npm run release:windows -- -SkipTests`，完整单测在 Linux 执行。
