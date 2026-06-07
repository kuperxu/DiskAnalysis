# UI(Renderer)

React 18 + zustand + immer + D3。三栏 grid 布局:左边目录树,中间 treemap,右边详情面板,顶部控制条。

## 文件

- `src/renderer/main.tsx` — React root mount
- `src/renderer/App.tsx` — 三栏 grid + IPC 订阅生命周期
- `src/renderer/store.ts` — zustand store + `applyPatch`(immer)+ `locate(root, path)` 路径游走
- `src/renderer/categories.ts` — 颜色 / 字节格式化 / `dominantCategory` / `isDirInert` / `isFileTrashing`
- `src/renderer/styles.css` — 全部样式(深色,Apple 风)
- `src/renderer/components/`
  - `ControlBar.tsx` — 顶部:Choose Folder…(填色蓝色 CTA)/ Pause / Resume / Breadcrumb / 右侧 status pill(带颜色点 + 文本,scanning 时蓝点呼吸)
  - `Sidebar.tsx` — 已有扫描时:`Scans` header + 可折叠目录树;未扫描时:`SidebarEmpty`(folder + 放大镜 SVG 插图、`No scans yet`、`Recent folders` / `Smart cleanup rules` 两枚 placeholder 按钮)
  - `TreemapView.tsx` — D3 squarified treemap(扫描存在时才挂载)
  - `LandingHero.tsx` — 未扫描时占据中间区域:大幅 SVG 插图、`Start with a folder scan` 标题、`Choose a Folder to Scan` / `Scan Entire Disk` 双按钮、`Discover` 分隔线 + 三张分类卡(Large Files / Duplicates / Cache & Logs,目前是装饰性的,未与预设扫描挂钩)
  - `DetailsPanel.tsx` — 目录 / 文件 / pseudo 三种视图,Show in Finder + Move to Trash 按钮(扫描存在时才挂载)
  - `GettingStartedPanel.tsx` — 未扫描时占据右栏:`Getting Started` 头、`3 Simple Steps` 卡(编号步骤)、`Why scan?` 卡(✓ 列表)、`Scans stay on this Mac` 隐私 footer
  - `Notices.tsx` — Toast (`<ToastHost />`) + 非阻塞 confirm modal (`<ConfirmHost />`),见 [notices.md](notices.md)
  - `Settings.tsx` — 浮动 `<SettingsButton />` + `<SettingsModal />`,见 [settings.md](settings.md)

## Store

```ts
{ tree, focusPath, selectedPath, lifecycle }
```

- `applyPatch(patch)` 用 `produce` 修改 draft:替换 target 自身的字段,merge child stubs(已存在的只更新 size/status 不动 children)。
  - **重置守卫**:如果 patch 的 path 不在当前 tree 范围内,说明用户切换了根目录(或这是首次扫描),先把 tree 清空再 synthesize。否则旧 tree 上 `locate(...)` 返 null,patch 被默默丢掉,UI 看起来"按了 Choose Folder 没反应"。
- `setLifecycle(s)` 也带反向重置:lifecycle 携带的 `root` 和当前 `tree.path` 不一致时主动清树,这样新扫描的进度文本能立刻反映到顶栏,而不必等到第一条 patch 抵达。
- `nodeAt(path)` 按 `/` 切片走 children map(child 键是 basename,不是全路径)。
- `setFocus(p)` 同时清掉 `selectedPath`(从一个目录跳到另一个,前一个目录里选中的文件不应跨过去)。

## 空状态(pre-scan landing)

`tree === null` 时三栏分别渲染:

- **Sidebar** → `<SidebarEmpty />`:`Scans (0)` header + folder/放大镜 SVG 插图 + `No scans yet` 标题 + 两枚 disabled placeholder 按钮(`Recent folders`、`Smart cleanup rules`,留给后续 feature)。
- **Centre treemap pane** → `<LandingHero />`:hero SVG(folder + 放大镜 + 浮动 doc/image/chart 三张纸 + 磁盘 slab)、标题、副标题、`Choose a Folder to Scan` 主 CTA(→ `pickRoot` + `start`)、`Scan Entire Disk` 次 CTA(→ `useConfirm.ask` + `start('/')`)、`Discover` 分隔线 + 三张装饰卡。
- **Right details pane** → `<GettingStartedPanel />`:`3 Simple Steps`(Choose / Review / Clean up) + `Why scan?`(三条 ✓) + 隐私 footer(`Scans stay on this Mac`)。

`Scan Entire Disk` 的二次确认走自定义非阻塞 modal(见 [notices.md](notices.md)),提示用户需要 Full Disk Access、系统路径会被自动跳过。

一旦 `tree` 非空,中间切到 `<TreemapView />`,右栏切到 `<DetailsPanel />`,Sidebar 顶部换成 `Scans (1)` 并展示目录树。

## 自适应布局

`.app` 是 CSS Grid:

- 桌面宽度(>880px):`minmax(180,240) minmax(320,1fr) minmax(220,300)` 三列。两侧栏宽度可压缩到下限,treemap 永远拿到 320px 起步,details 永远 ≥ 220px 不会被挤出可视区。
- 紧凑(≤880px):`@media` 切到两行布局 — treemap 顶部独占,sidebar + details 底部并排。
- 每个 grid track 都设了 `min-width: 0`(包括 sidebar / treemap-pane / details / topbar),否则长路径会撑爆 track,把其它面板挤出窗口。
- topbar 里 `breadcrumb` 是 `flex: 1 1 0; min-width: 0; overflow-x: auto`(收缩到 0 时变滚动),`status` 限到 38ch 配 ellipsis 防止占满。
- details 面板按钮 `width: 100%; word-break: break-word`,长 label("Move to Trash (1.5 GB)")在窄面板里会换行而不是横向溢出。

## TreemapView

- 渲染**当前 focused 节点的直接 children + 自己的 leaf files**(不画整棵树)。
- `useMemo` 依赖含:`focused.size`、children 数、`files.length`、`status`、`trashingFiles` 序列化、子节点状态序列化指纹 — 这些任一变化都触发 re-layout。
- 文件分组阈值:size ≥ `max(0.5% of own, 1MB)` 单独成块(top 200);剩余的按 category 聚合成伪文件 `path/§other-<category>`。这是为了避免上万个小文件把 treemap 撑爆,代价是这些"others"块只能 hover,不能 drill-in。
- 块染色:目录用 `CATEGORY_COLOR[dominantCategory(breakdown)]`,文件用 `CATEGORY_COLOR[file.category]`。状态修饰:`scanning` 蓝虚线、`denied` 红边、`trashing/trashed` 详见 [trash.md](trash.md)。
- 点击行为:目录 → `setFocus(path) + window.api.focus(path)`(顺手 boost 优先级);文件 → `setSelected(path)`;inert 节点直接 return。

## Sidebar

- 第一层默认展开;子层默认折叠,点行 / 三角分别"聚焦+展开"和"切折叠"。
- 状态 class:`scanning`(`…` 后缀)、`trashing`(灰 + "trashing…")、`trashed`(灰红 + 删除线 + "trashed",not-allowed)。
- 大目录 children 数千上万也只渲染前 200 项,其它隐藏(暂没分页 UI,留待迭代)。

## DetailsPanel

按上下文选择视图:
- 选中文件 → `FileInfo`(路径、size、category、Show in Finder、Move to Trash)
- 选中 pseudo 块 → `PseudoInfo`(说明这是聚合块)
- 否则 → `DirInfo`(总大小、own files、subdirs 数、status、按 category 的横条 + 列表)

`isDirInert(node.status)` 时 Move to Trash 按钮 disable + 改文案为 "Already moved to Trash" / "Moving to Trash…"。
