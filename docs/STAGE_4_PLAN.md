# 阶段 4 细化计划

> 状态：已完成。随 `v0.4.0` 于 2026-07-11 发布；当前完成度 8/8。

## 阶段目标

阶段 4 面向更大的真实工程片段，重点是布局质量、性能、状态保存和测试体系。此阶段可以引入离线 vendored 的布局库。

## 前置条件

- 阶段 3 compare view 可用。
- 单 module 和 compare view 的核心交互稳定。
- 已有 parser/infer/graph/render 单元测试。

## 需求完成表

| ID | 计划需求 | 完成标准 | 当前状态 |
| --- | --- | --- | --- |
| R4-1.1 | Layout Provider 抽象 | 应用只通过稳定 provider 接口布局；Simple Layered 作为默认 fallback 且可注册/查询 | 已完成 |
| R4-1.2 | 离线 ELK.js Provider | ELK.js vendored 到 `vendor/`，记录版本、来源和 license，并可与 fallback 切换 | 已完成 |
| R4-1.3 | Progressive Render | 大图布局和 SVG 分批呈现，主线程有明确进度状态 | 已完成 |
| R4-2.1 | Fanout Hub | 高 fanout net 可折叠为 hub，减少重复长边 | 已完成 |
| R4-2.2 | Group Collapse/Expand | 用户可折叠和展开结构分组，且 cone/选择状态保持可解释 | 已完成 |
| R4-2.3 | 低细节渲染 | offscreen 或低缩放节点降低细节，edge label 按缩放级别显示 | 已完成 |
| R4-2.4 | Session State | 恢复 module、视图模式、cone depth、provider、布局选项和 pan/zoom | 已完成 |
| R4-2.5 | 测试体系增强 | 增加大图、provider、progressive render、session 和 UI smoke 测试 | 已完成 |

状态口径：实现与自动化验证均完成后标记“已完成”；只有部分测试覆盖时保持“进行中”。

当前测试资产：

- `examples/large_buffer_chain_1024.v`：1024-cell 深链，验证完整解析、graph extraction 和 bounded output cone 布局/SVG smoke。
- `examples/hierarchical_escaped_compare.v`：escaped hierarchical identifier 与 Flex compare 示例。
- `examples/hierarchical_escaped_timing.txt`：与 hierarchical compare 配套的 LocResyn timing 示例。
- `tools/generate-large-example.mjs`：确定性重建千级 cell 示例，避免手工维护生成文件。
- 超宽图使用基于 `viewBox/viewport` 比例的自适应最大缩放和加速步进；搜索定位对象时按节点宽度计算可读聚焦倍率。
- Compare workspace 与 Single View 共用 timing annotation 语义；真实 hierarchical compare/timing example 覆盖左右 module badge 回归。

## 任务拆分

### 1. Layout Provider 抽象

建立 `LayoutProvider` 接口，保留 `SimpleLayeredLayoutProvider`，新增 `ElkLayoutProvider`。

### 2. 离线引入 ELK.js

ELK.js 必须 vend 到 `vendor/`，记录来源、版本和 license，不要求用户联网安装。

### 3. 大图降复杂度

支持 fanout hub 简化、group collapse/expand、offscreen 节点低细节显示、edge label 按缩放级别显示/隐藏。

### 3.1 Balanced/Folded 布局（遗留）

为深层、窄扇出的 DAG 增加可选折叠模式，解决严格 left-to-right 布局宽高比过大的问题：

- 默认布局继续保持从左到右，不改变已有 schematic 阅读习惯。
- 折叠模式按 4-6 个逻辑层分带，不使用单纯缩小列距的方案。
- 跨带 edge 走专用带间通道，避免反向线穿过节点。
- 输出和外部 input 仍按局部驱动/消费关系放置。
- 验证宽高比、edge bend 数、节点重叠和跨节点走线后再开放为 UI 选项。

### 4. Progressive Render

大图先显示布局中状态，再分批渲染节点和边，避免一次性 DOM 更新导致 UI 卡死。

### 5. Session State

保存当前文件名、module、视图模式、cone depth、layout provider 和 pan/zoom。

### 6. 测试体系增强

新增 parser fixture、inference、graph extraction、layout smoke、SVG smoke、UI basic smoke tests。

## 验证计划

- 千级 cell 的局部 cone 能浏览。
- provider 可以在 Simple 与 ELK 间切换。
- 大 fanout net 不会让图完全不可读。
- session state 刷新后能恢复。

## 本阶段不做

- 不做完整数据库项目管理。
- 不做多人协作。
- 不做服务器端渲染。
- 不做 Liberty function 语义绘制。

## 完成验证

- `elkjs@0.11.1` bundled runtime、EPL-2.0 license、来源和版本信息已完整 vendored；浏览器离线 ELK 切换通过。
- 1024-cell example 可自动折叠为 group、按需展开，并可用 bounded cone 浏览。
- 高 fanout hub、低缩放降细节和 progressive render 均有独立测试覆盖。
- 刷新页面后 provider、module、搜索、cone、布局选项和 pan/zoom session 可恢复。
- Single/Compare 均通过 Simple/ELK provider 路径；Compare timing badge 回归通过。
- `v0.4.0` 发布前自动化测试共 74 项通过。
