# UI(Renderer)

React 18 + zustand + immer + D3。三栏 grid 布局:左边目录树,中间 treemap,右边详情面板,顶部控制条。

## 文件

- `src/renderer/main.tsx` — React root mount
- `src/renderer/App.tsx` — 三栏 grid + IPC 订阅生命周期
- `src/renderer/store.ts` — zustand store + `applyPatch`(immer)+ `locate(root, path)` 路径游走
- `src/renderer/categories.ts` — 颜色 / 字节格式化 / `dominantCategory` / `isDirInert` / `isFileTrashing`
- `src/renderer/styles.css` — 全部样式(深色,Apple 风)
- `src/renderer/components/`
  - `ControlBar.tsx` — 顶部:Choose folder / Pause / Resume / Breadcrumb / Status 文本
  - `Sidebar.tsx` — 可折叠目录树,按 size 降序,每层最多渲染 200 项
  - `TreemapView.tsx` — D3 squarified treemap
  - `DetailsPanel.tsx` — 目录 / 文件 / pseudo 三种视图,Show in Finder + Move to Trash 按钮
  - `Notices.tsx` — Toast (`<ToastHost />`) + 非阻塞 confirm modal (`<ConfirmHost />`),见 [notices.md](notices.md)

## Store

```ts
{ tree, focusPath, selectedPath, lifecycle }
```

- `applyPatch(patch)` 用 `produce` 修改 draft:替换 target 自身的字段,merge child stubs(已存在的只更新 size/status 不动 children)。第一条 patch 会 synthesize root 节点。
- `nodeAt(path)` 按 `/` 切片走 children map(child 键是 basename,不是全路径)。
- `setFocus(p)` 同时清掉 `selectedPath`(从一个目录跳到另一个,前一个目录里选中的文件不应跨过去)。

## 空状态

```
Choose a folder to scan   (主按钮 → window.api.pickRoot → window.api.start)
Scan entire disk          (次按钮,window.confirm 后 window.api.start('/'))
```

`Scan entire disk` 的二次确认提示用户需要 Full Disk Access、系统路径会被自动跳过。

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
