# Scanner

负责把磁盘读出来变成内存里的 `DirNode` 树,并向渲染层广播增量 patch。

## 文件

- `src/main/scanner/controller.ts` — `ScannerController`,持有树、队列、并发循环、状态机
- `src/main/scanner/queue.ts` — `PriorityQueue`,二叉小顶堆 + `reprioritize` / `drop`
- `src/main/scanner/tree.ts` — `scanDirectory()`(单目录 readdir+lstat)、`makeNode()`、默认排除规则
- `src/main/scanner/fileTypes.ts` — 扩展名 / 路径 → `FileCategory` 映射,颜色和顺序常量

## 调度模型

- **BFS + 优先级**:每个待扫目录一个 `DirTask { path, depth }`,默认 priority = depth → 先扫完一级再扫二级。
- **Focus boost**(`controller.focus(path)`):优先级降到 `-1_000_000 + depth`。维护 `focusedPrefixes: Set<string>`,新发现的子目录在 `priorityFor()` 里也自动套用,而不仅仅是已经在队列里的。
- **暂停**(`pause()` / `resume()`):`pauseGate` 是一个 Promise,`runTask` 开头 `await pauseGate`;暂停时新建未 resolve 的 Promise,resume 时调 `releasePause()`。**已 in-flight 的 readdir 不打断**,让它跑完再 gate。
- **取消**(`start()` 重新开始时):`cancelToken++`,旧的 in-flight 任务返回前对比,不一致就丢弃。

## 并发

I/O bound 不需要 worker_threads。直接维护 N 个并发 Promise,N = `max(4, os.cpus().length)`,跑在 libuv threadpool 上(`UV_THREADPOOL_SIZE=32`,在 `src/main/index.ts` 顶部设置)。`spinUp()` 是经典 self-feeding loop:`runTask().finally(() => spinUp())`。

## 树语义

- `DirNode` 只为目录创建。叶子文件汇总在 `parent.files: FileEntry[]`(不再单独 node,千万级文件也只占几百 MB)。
- 完成扫描后:`node.size = ownSize + Σ children.size`,size delta 通过 `bubbleUp()` 一路冒泡到根,每一层都触发 ancestor patch。
- `breakdown: Record<FileCategory, number>` 是子树聚合,treemap 用它的 dominant 类来染色。

## macOS 特殊处理

- `lstat`(不跟符号链接),`stat.dev !== rootDev` 跳过(自动屏蔽 `/Volumes/*` 上挂的外接盘)。
- 默认排除集合在 `tree.ts:DEFAULT_EXCLUDES`:`/System`、`/private/var/vm`、`/private/var/db`、`/.Spotlight-V100`、`/.fseventsd`、`/.DocumentRevisions-V100`、`/Volumes`。
- 权限错误(`EACCES` / `EPERM`)→ 节点 `status: 'denied'`,treemap 标红边框,不向下扫。

## 文件分类

`fileTypes.ts:categorize(name, parentPath)`:

1. `.app` → `'app'`,`.framework` / `.bundle` → `'binary'`
2. 父路径含 `/Caches/`、`/Cache/`、`/Library/Logs/`、`/.Trash/`、`/node_modules/.cache/`、`/.cache/`、`/DerivedData/` 之一 → `'cache'`
3. 否则查扩展名表,fallback `'other'`

## 增量广播

- `emitPatch(path, node)` 不立刻发,先塞 `pendingPatches: Map<string, TreePatch>`(同 path 后写覆盖前写)。
- `scheduleFlush()` 起一个 80ms 的 `setTimeout`,到点把整批一次性 emit,再附带一次 `lifecycle` snapshot 给 UI。
- `serializeNode()` 输出**浅拷贝**:子节点只保留 size/status/breakdown 等 stub,孙子全部丢掉。每个目录通过自己的 patch 维护各自子树,IPC 流量上限可控。

## 删除入口

`markTrashing(path)`、`markTrashed(path)`、`unmarkTrashing(path)`、`prune(path)` — 详见 [trash.md](trash.md)。
