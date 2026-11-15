# 已退役的早期 Native 分层布局实现

早期实现于 H08 布局引擎正式接管注册表时（2026-10-15）移出运行时。其 22 个 JS 副本和专属内部测试现已移除：它们没有当前产品或研究工具的调用者，不再随 `npm test` 执行。

历史源码与断言保存在提交 `18ba252fc12fb63f935eede1f140499b52da9a90` 中，可只读查看，例如：

```sh
git show 18ba252fc12fb63f935eede1f140499b52da9a90:tests/reference/retired_native_layered/native_layered_layout_provider.js
git show 18ba252fc12fb63f935eede1f140499b52da9a90:tests/unit/native-layered-provider.test.js
```

旧实现不作为当前共享模块的兼容性要求，也不得恢复到生产依赖或发布产物中。

当前产品的布局行为由 `tests/unit/anchor_layered*.test.js`、provider 注册表及共享工作区集成测试覆盖；其中 `anchor_layered_focused.test.js` 保留 eq012 与 sop015 聚焦场景，统一的架构门禁继续阻止运行时导入归档实现。Simple 冻结测试和 mapped fixtures 不受此次清理影响。
