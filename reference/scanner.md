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
- **关闭透明 asar**:`src/main/index.ts` 顶部 `process.noAsar = true`。Electron 默认把所有 `fs.*` 在 `.asar` 路径上劫持去解析归档,对我们这种"只想 lstat 拿 size"的扫描器来说既慢又会把损坏的 asar(VSCode 测试 fixture / 一些工具仓库)打到 stderr `archive.cc Failed to parse header`。关掉后 .asar 当普通文件处理。

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

关键性能点:`markTrashing` **O(1) on the target**,不递归子树。subtree inert 状态在 `serializeNode()` 时通过 `trashingRoots` / `trashedRoots` Set 派生;queue 里 doomed 任务在 `runTask` 开头检查跳过,而不是 O(n) heap drop。

## expandDirThreshold 折叠策略

来自 [settings.md](settings.md) 的 `Settings.expandDirThreshold`(默认 100 MiB):

**核心承诺:size 永远准确**。所有目录都会被完整扫到叶子,size 和 breakdown 都是真实值。阈值只控制 UI 是否展开细节。

实现走"事后折叠":

- `runTask` 不做任何阈值判断,所有 subdir 都正常入队扫描。
- 每个目录有一个 `pendingChildCount`(controller 私有 Map),初始 = `result.subdirs.length`。
- 一个目录的 readdir 完成后,如果它没 subdir → 立刻 `onSubtreeSettled(node)`;否则等所有子节点的 settle 事件来递减计数。
- `onSubtreeSettled(node)` 触发两件事:
  1. `maybeCollapse(node)`:如果 node 自己 status==='done' 且 `node.size < threshold` 且不是扫描根 / 不在 expandedOverrides → **drop 子树**(`removeFromIndex` 把所有后代节点从 index 摘掉,`children = {}`、`files = []`),status 翻 `'collapsed'`。size 和 breakdown **保留**,所以祖先合计不变。
  2. 沿父链递减 `pendingChildCount`,父亲到 0 后递归 settle。
- 用户点击 `'collapsed'` 节点 → `controller.focus()` → `expandCollapsed(t)`:加 `expandedOverrides.add(t)` 防止它被立刻再折叠;扣掉它在祖先的 size 贡献(后续 patch 会重新加回去);status 翻 `'pending'` 入队重扫,这次 maybeCollapse 因 expandedOverrides 而 noop。
- `applySettings` 阈值变化 → `reapplyThreshold()` 走全树深度优先:每个节点先递归子节点(让最深的先 collapse),再 maybeCollapse 自己。这样阈值升高时父子可以连续折叠。**只折叠不展开**:阈值降低后,被折叠的不会自动恢复,用户得手动点开(否则要重做 I/O,违反"不丢已扫数据"的原则)。

性能层面诚实交代:**I/O 不省**(本来就是大头),**省的是渲染层内存** — 千万级文件不再每个一条 FileEntry,treemap 也不需要画几百层。这跟用户"folder 准确数字"的优先级匹配。
