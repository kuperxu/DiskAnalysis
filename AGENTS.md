# Disk Analysis

渐进式 macOS 磁盘占用分析工具。Electron + React + TypeScript;扫描走 BFS + 优先级队列(可暂停 / 点击聚焦 / 异步删到废纸篓),UI 是 D3 squarified treemap。

## 模块文档(`reference/`)

- [scanner.md](reference/scanner.md) — 扫描控制器、优先级队列、文件类型分类
- [cache.md](reference/cache.md) — better-sqlite3 持久化缓存
- [ipc.md](reference/ipc.md) — 主进程 / 渲染进程 IPC 契约和共享类型
- [ui.md](reference/ui.md) — 渲染层 store、treemap、各面板组件
- [trash.md](reference/trash.md) — 异步删除流程和三态(trashing / trashed)UI
- [notices.md](reference/notices.md) — Toast 通知 + 非阻塞确认 modal
- [build.md](reference/build.md) — electron-vite、tsconfig、打包

## 编码规则

**任何修改(无论先写 plan 还是直接动手 code)都必须同步更新本文件和受影响的 `reference/` 文档**。reference 是单一真相源:代码改了文档没改 = 半成品。新增模块时新建对应 reference 文件并把链接挂到上面这张目录。
