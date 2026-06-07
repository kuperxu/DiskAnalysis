# Cache

`better-sqlite3` 本地持久化,目的是再次扫同一目录时能秒开。

## 文件

- `src/main/cache/store.ts` — `CacheStore` 类,主进程单例
- 数据库文件:`app.getPath('userData')/cache.db`(由 `src/main/index.ts` 在 `app.whenReady()` 里实例化)

## Schema

```sql
CREATE TABLE nodes (
  path        TEXT PRIMARY KEY,
  parent      TEXT,
  size        INTEGER NOT NULL,
  own_size    INTEGER NOT NULL,
  mtime_ms    INTEGER NOT NULL,
  scanned_at  INTEGER NOT NULL,
  status      TEXT NOT NULL,
  breakdown   TEXT NOT NULL          -- JSON {category -> bytes}
);
CREATE INDEX nodes_parent_idx ON nodes(parent);

CREATE TABLE files (
  parent    TEXT NOT NULL,
  name      TEXT NOT NULL,
  size      INTEGER NOT NULL,
  category  TEXT NOT NULL,
  PRIMARY KEY (parent, name)
);
```

PRAGMA:`journal_mode = WAL`、`synchronous = NORMAL`。

## API

- `putNode(node, mtimeMs, parent)` — 事务内更新 nodes 行 + 清空再写 files。每个目录扫完时由 `src/main/index.ts` 的 `scanner.on('patch')` 监听器调用(只在 `status` 是 `'done'` / `'denied'` 时持久化)。
- `loadShallow(path)` — 返回 `{ size, ownSize, mtimeMs, status, breakdown, files, childPaths }` 或 `null`。子目录通过 `parent` 索引发现,不存 JSON 嵌套 → 局部读便宜。
- `invalidate(path)` — 事务内删 path 自身和所有 `path/...` 后代,对 `%` 和 `_` 做 `\` escape。

## 写路径(已通)

`scanner` 的 patch 事件 → `IPC.patch` 同步前先 `fs.lstat(path)` 拿 mtime → `cache.putNode(...)`,best-effort。失败(文件刚被删)直接吞。

## 读路径(roadmap)

设计意图:`scanner.start(root)` 时先 `loadShallow(root)`,递归用 `childPaths` 把整棵子树拉进内存(瞬间出 treemap),再起一个后台 BFS 对每个目录 `lstat` 比 mtime,变了的才重 `scanDirectory`。**目前 controller 还没接这一路**,见 README roadmap。接的时候要避免和 patch 持久化死锁:hydration 阶段先把 cache 当只读源,等 revalidation 重写时才再走 putNode。

## 使整失效

`shell.trashItem` 成功后,`src/main/index.ts` 的 trash handler 用 `queueMicrotask(() => cache.invalidate(p))` 异步清行,不阻塞树更新广播。
