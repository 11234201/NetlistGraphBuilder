# 阶段 4 细化计划

## 阶段目标

阶段 4 面向更大的真实工程片段，重点是布局质量、性能、状态保存和测试体系。此阶段可以引入离线 vendored 的布局库。

## 前置条件

- 阶段 3 compare view 可用。
- 单 module 和 compare view 的核心交互稳定。
- 已有 parser/infer/graph/render 单元测试。

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
