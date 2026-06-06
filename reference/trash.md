# Trash(异步删除)

为什么这个流程值得单开一篇:删除是跨进程、跨状态机、有失败路径的异步操作,UI 不能因为 `shell.trashItem` 慢就卡死。

## 三态生命周期

```
done ─ click ─▶ trashing ─ shell.trashItem ok ─▶ trashed (墓碑,目录) / removed (文件)
                   │
                   └─ shell.trashItem fail ─▶ done (恢复)
```

`ScanStatus`(`src/shared/types.ts`)在 `pending` / `scanning` / `done` / `error` / `denied` 之外又加了:
- `trashing` — 用户已点删除,后台 `shell.trashItem` 还在跑
- `trashed` — 删除成功,**目录类节点**保留为墓碑(灰红 + 删除线,不可点)。文件类节点直接从 `parent.files` 摘掉,因为单文件墓碑会让 treemap 杂乱。

## 为什么要墓碑

简单的"删完即从树里 prune"会让用户不知道刚刚删了什么、骨架图突然空一块。目录墓碑保留 size 让祖先合计不抖,用户可以看到"我刚清掉了这个 8GB 的 cache 目录"。文件不留墓碑是因为 treemap 里文件块通常很小,留下来视觉成本高于收益。

## Main 进程实现

`src/main/index.ts` 的 `IPC.trash` handler:

```
1. 同步守卫:!fs.existsSync(p) → { ok: false, error: 'Not found' }
                  p === scanRoot → { ok: false, error: 'Refusing to trash the scan root' }
2. scanner.markTrashing(p)         ← 立即对树打标,广播 patch
3. void (async () => {              ← 后台异步,不 await
     try {
       await shell.trashItem(p)
       scanner.markTrashed(p)
       queueMicrotask(() => cache.invalidate(p))
     } catch (e) {
       scanner.unmarkTrashing(p)
       console.error(...)
     }
   })()
4. return { ok: true }              ← 几毫秒就返回,IPC 通道不阻塞
```

## Controller API

`src/main/scanner/controller.ts`:

- `markTrashing(path)` — 找到节点(目录或文件),把目录子树所有 status 翻成 `trashing`,**同时从 PriorityQueue 里 drop 掉所有路径在 `path/` 下的待扫任务**(避免给注定要消失的子树继续做 I/O)。文件级:在 `parent.trashingFiles: Set<string>` 加一项。两种情况都 `emitPatch(parent.path, parent)` 让父节点的 child stub 更新到位。
- `markTrashed(path)` — 目录:整个子树翻 `trashed`(size 不动)。文件:从 `parent.files` 摘掉,size delta 冒泡。
- `unmarkTrashing(path)` — 目录:递归把 `'trashing'` 翻回 `'done'`(简化处理,不试图恢复到点击前的精确状态)。文件:从 `parent.trashingFiles` 移除。

## IPC 序列化注意

`DirNode.trashingFiles` 在内存里是 `Set<string>`,过 IPC 必须是 plain JSON,所以 `serializeNode()` 里 `Array.from(...)`。共享类型声明 `Set<string> | string[]`,渲染端用 `isFileTrashing(t, name)` helper 同时支持两种形式。修改时这三处要一起改:
- `src/main/scanner/controller.ts` 内部用 `(parent.trashingFiles as Set<string>).add/.delete`
- `controller.serializeNode` 转 array
- `src/renderer/categories.ts:isFileTrashing` 兼容判断

## UI 表现

| 状态 | Sidebar | Treemap rect | 详情面板按钮 |
| --- | --- | --- | --- |
| `trashing` | 灰 + "trashing…" 后缀,not-allowed | 红色虚线描边,opacity 0.35 | "Moving to Trash…" disabled |
| `trashed` | 灰红 + 删除线 + "trashed",not-allowed | 红色实线描边,opacity 0.5,文字加删除线 | "Already moved to Trash" disabled |
| 文件 trashing | (Sidebar 不显示文件) | 同上 trashing,从 `parent.trashingFiles` 判断 | "Moving to Trash…" disabled |

样式集中在 `src/renderer/styles.css` 的 `.tree-row.trashing/trashed` 和 `.cell.trashing/trashed`。
