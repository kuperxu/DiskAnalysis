# IPC

主 / 渲染进程之间的契约。所有跨进程类型集中在 `src/shared/types.ts`,通道字符串集中在同文件的 `IPC` 常量,渲染端通过 preload 暴露的 `window.api` 调用。

## 文件

- `src/shared/types.ts` — 单一真相源:`DirNode` / `FileEntry` / `FileCategory` / `ScanStatus` / `ScanLifecycle` / `TreePatch` / `RendererApi` / `IPC` 常量
- `src/preload/index.ts` — `contextBridge.exposeInMainWorld('api', api)`,把 `ipcRenderer.invoke` / `on` 包成有类型的 RendererApi
- `src/main/index.ts` — `ipcMain.handle(IPC.X, ...)` 的注册位置

## 通道

| 常量 | 方向 | 用途 |
| --- | --- | --- |
| `IPC.pickRoot` | renderer → main → renderer | 调系统目录选择对话框 |
| `IPC.start` | renderer → main | 重置并开始扫描指定 root |
| `IPC.pause` / `IPC.resume` | renderer → main | 暂停 / 继续 |
| `IPC.focus` | renderer → main | 用户点击目录,boost 该子树扫描优先级 |
| `IPC.trash` | renderer → main → renderer | 异步移到废纸篓(立即返回,见 trash.md) |
| `IPC.reveal` | renderer → main | `shell.showItemInFolder`,失败 fallback 打开父目录 |
| `IPC.getTree` | renderer → main → renderer | 渲染层(重新)挂载时 hydrate 当前树 |
| `IPC.patch` | main → renderer (event) | 增量树 patch,80ms 批 |
| `IPC.lifecycle` | main → renderer (event) | `idle` / `scanning` / `paused` / `done` / `error` 状态 |

## DirNode 序列化

`controller.serializeNode()` 把内存节点转成 IPC 安全的形态:
- 子节点只保留 size / status / breakdown 等 stub,孙子全部丢掉
- `trashingFiles: Set<string>` 序列化为 `string[]`(渲染端通过 `isFileTrashing()` helper 兼容两种形式)
- 渲染端用 immer 把 patch 应用到 zustand store,不替换 node 引用,merge 已存在的 child(因为它们各自的子树由它们自己的 patch 维护)

## 共享类型怎么改

加字段:
1. 改 `src/shared/types.ts`(`DirNode` / `RendererApi` / 通道常量)
2. preload 暴露(`src/preload/index.ts`)
3. main handler(`src/main/index.ts` + 实现位置)
4. controller serializer(`src/main/scanner/controller.ts:serializeNode`)
5. renderer store patch merger(`src/renderer/store.ts:applyPatch`)
6. 同步本文件 + 相关 reference

漏一步就是潜在的 bug 来源。
