# Settings(用户设置持久化)

JSON 文件 + IPC,主进程为单一真相源,渲染层做镜像。当前只有一个字段(`minScanDirSize`),但骨架做成可扩展。

## 文件

- `src/main/settings/store.ts` — `SettingsStore`,文件 IO + 250ms 防抖写入
- `src/main/index.ts` — `whenReady` 里实例化,`IPC.getSettings` / `IPC.setSettings` handler;`setSettings` 之后调 `scanner.applySettings()`
- `src/shared/types.ts` — `Settings` 接口、`DEFAULT_SETTINGS` 常量、`IPC.getSettings` / `IPC.setSettings`
- `src/preload/index.ts` — `getSettings` / `setSettings` 暴露
- `src/renderer/components/Settings.tsx` — `useSettings` zustand store + `<SettingsButton />` + `<SettingsModal />`
- `src/renderer/App.tsx` — 启动时 `window.api.getSettings().then(hydrate)`;`<SettingsButton />` 挂在 `.sidebar` 内部 flex column 最下方

## 持久化路径

`app.getPath('userData')/settings.json`,JSON 美化输出,跟 `cache.db` 同目录。

## Sidebar 布局

`SettingsButton` 不是浮动定位,而是 `.sidebar` 这个 grid track 内部的一个 flex column 子项:

```
.sidebar (flex column, overflow:hidden)
├── .sidebar-list  (flex:1, overflow:auto)   ← 列表 + 自己的滚动条
└── .settings-button (flex:0 0 auto, full-width)
```

效果:settings 按钮永远卡在 sidebar 列宽底部,列表的滚动条只在按钮上方,跟磁盘列表无重叠。窗口高度变化时按钮位置自动跟着列底跑。在 ≤880px 的堆叠布局里这套 flex column 行为不变,sidebar 整列被 grid 移到底部一行,按钮还是在该列最下方。

## 防丢

- 写入 250ms 防抖(用户拉滑块时不会每帧 fsync)
- `app.on('window-all-closed')` 调 `settings.flush()` 强写一次,保证关窗时最新值落盘
- 读取失败(不存在 / corrupted)→ 用默认值,不阻塞启动

## 更新流

```
User 编辑    →  useSettings.set(patch)  →  optimistic local update
                                       →  window.api.setSettings(patch)
Renderer    ←──────────────────────────┘
                                              ↓
Main IPC handler:
  settings.set(patch)        // 内存 + 防抖写盘
  scanner.applySettings(s)   // 立刻生效
  return merged value
                                              ↓
Renderer    ←   reconcile state with returned value
```

## expandDirThreshold 字段

含义:**所有目录都完整扫到底,size 准确**。但子树总 size 低于阈值的目录,在 UI 上折叠成单个块(`status: 'collapsed'`),file-level 明细在内存中也被丢弃。

为什么不在"进去之前"决定:目录的 lstat size 是 inode 大小不是子树总和,扫之前**物理上无法**知道子树多大。要拿准确数字就必须扫完。

为什么"事后折叠"而不是"扫之前估算":估算会让 size 不准。我们选择"全量扫 + 事后丢明细"这条路 — **I/O 不省,内存省**,size 永远是真实值。

为什么阈值升高不自动展开已折叠的:展开需要重新跑 scanDirectory 拿明细,等于重做 I/O,而且用户大概率不想要(他刚把阈值升高就是想折叠更多)。用户点 collapsed 块手动展开即可,语义清楚。

实现细节见 [scanner.md](scanner.md) 的 "expandDirThreshold 折叠策略" 小节,关键点:

- `'collapsed'` 是新加的 `ScanStatus`,treemap / sidebar 用斜体虚线区分
- 用户点 collapsed 节点 → `controller.focus(path)` 检测到 status 是 collapsed → `expandCollapsed()`:扣掉旧 size 在祖先的贡献、清空 children/files、status 翻 `'pending'`、加 `expandedOverrides`(防止刚 expand 完又被立刻 collapse)、入队重扫
- 阈值变化 → `reapplyThreshold()` 深度优先走全树,先递归再决定 maybeCollapse,这样最深的子树先 collapse 让外层看到正确小 size 再决定自己是否 collapse

## 添加新设置字段

1. `Settings` 接口加字段,`DEFAULT_SETTINGS` 给默认值
2. UI 在 `SettingsModal` 加一行 form
3. 如果影响 scanner 行为,在 `controller.applySettings()` 处理变化(类似 `minScanDirSize` 的 reconsider 逻辑)
4. 文档同步本文件 + 受影响的 reference
