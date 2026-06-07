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
1. 同步守卫:!fs.existsSync(p)  → notice "Already gone" + { ok: false }
                  p === scanRoot     → notice + refusal
                  fs.accessSync(parent, W_OK) 失败 → 立即 notice + 返回
                  (pre-flight 权限检查避免等 shell.trashItem 几百 ms 才报错)
2. scanner.markTrashing(p)         ← O(1),仅 target 节点 + 加入 trashingRoots
3. void (async () => {              ← 后台异步,不 await
     try {
       await shell.trashItem(p)
       scanner.markTrashed(p)
       setImmediate(() => cache.invalidate(p))  ← 让出主循环,不抢 patch
     } catch (e) {
       scanner.unmarkTrashing(p)
       notify(classifyTrashError(p, e))         ← 友好文案给 toast
     }
   })()
4. return { ok: true }              ← 几毫秒就返回,IPC 通道不阻塞
```

错误分类见 [notices.md](notices.md)。

## Controller API

`src/main/scanner/controller.ts`:

- `markTrashing(path)` — **O(1) on the target**:仅改 target 节点自己的 status,并把路径加入 `trashingRoots: Set<string>`(主进程内部状态)。**不递归子树**(之前的设计在 `~/Library` 这种几万节点的目录上会同步卡死 main 几百毫秒到几秒)。
  - 子树的视觉 inert 状态由 `serializeNode()` 在 IPC 边界**派生**:每次序列化一个节点时,如果它本身或祖先在 `trashingRoots/trashedRoots` 里,所有 child stub 的 `status` 都被翻成 `'trashing'`/`'trashed'`。
  - Queue 里已经入队的子树任务**不显式 drop**(避免 O(n) heapify);改在 `runTask` 开头 `isUnderTrashRoot(task.path)` 检查,doomed 任务被静默跳过。
- `markTrashed(path)` — 目录:status 翻 `trashed`,从 `trashingRoots` 移到 `trashedRoots`。文件:从 `parent.files` 摘掉,size delta 冒泡。
- `unmarkTrashing(path)` — 目录:status 翻回 `done`,从 `trashingRoots` 移除(此时 serializeNode 自动恢复子树外观)。文件:从 `parent.trashingFiles` 移除。

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
