# Notices(Toast 通知 + 非阻塞确认 modal)

`window.confirm()` 和 `window.alert()` 是同步阻塞渲染进程主线程的。即便后端 IPC 已经做成异步,只要 UI 一调原生 confirm,所有 React 渲染、动画、事件都冻结。本模块用 React + Promise 自定义实现替代它们,并新增一个上报通道把 main 进程的错误反馈给用户。

## 文件

- `src/renderer/components/Notices.tsx` — `useToasts` / `useConfirm` 两个 zustand store + 配套的 `<ToastHost />` / `<ConfirmHost />` 组件
- `src/renderer/App.tsx` — 挂载 `<ToastHost />` `<ConfirmHost />`,订阅 `window.api.onNotice`
- `src/main/index.ts` — `notify()` helper + `classifyTrashError()`(把 errno 翻译成友好文案)
- `src/shared/types.ts` — `Notice` 类型,`IPC.notice` 通道,`RendererApi.onNotice`、`RendererApi.openExternal`

## Notice 形态

```ts
interface Notice {
  kind: 'info' | 'success' | 'error' | 'permission'
  title: string
  body?: string
  path?: string        // 单独行,等宽字体
  id?: string          // 同 id 后到的会替换前一条(避免堆叠重复)
}
```

`info` 和 `success` 4.5 秒自动消失;`error` 和 `permission` 一直留到用户点 ×。`permission` 额外多一个"Open Full Disk Access settings"按钮,通过 `window.api.openExternal` 调 `shell.openExternal(x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles)` 直接 deep-link 到对应面板。

## Main → Renderer 上报路径

`notify(notice)` 走 `IPC.notice` 推给渲染层。当前用法:

- 删除路径不存在 → `info` "Already gone"
- 想删扫描根 → `error` "Can't trash the scan root"
- 父目录写权限不足(pre-flight `fs.accessSync(parent, W_OK)`)→ `permission` 含 Full Disk Access 引导
- `shell.trashItem` 失败 → `classifyTrashError` 按 `code`(`EACCES` / `EPERM` / `EROFS` / `ENOENT`)和 message 模式分类

## Permission 识别

macOS 的 `shell.trashItem` 在某些情况下不返回标准 errno,只在 message 里写 "Operation not permitted"。`classifyTrashError` 同时按 `err.code` 和正则 `/not permitted|permission|operation not permitted/i` 嗅探,任一命中就归到 `permission`。

## 非阻塞确认 modal

`useConfirm.ask({ title, body, confirmLabel, cancelLabel, danger }) → Promise<boolean>`:

- 推入一条 request 到 store,触发 `<ConfirmHost />` 渲染 backdrop + modal
- Enter 触发 confirm,Escape 触发 cancel,点击 backdrop 也是 cancel
- 完全用 React state 驱动,主线程不阻塞 → 在等用户决策期间 toast 仍能滚入、treemap 仍能继续接收 patch

### 防卡死 / race condition

- **重入保护**:如果在前一个 modal 还没关闭时再调一次 `ask(...)`,前一个 Promise 立刻 resolve 为 `false`(等价于用户 cancel)。不这样的话双击触发或两个按钮抢调用会让前一个 caller 永远 `await` 一个不会 settle 的 Promise,UI 上表现为按钮 disabled 状态卡住,看起来"没响应"。
- 调用方应当用 `try/finally` 包住 `await ask()` 和后续 IPC,确保 `busy` 等本地 state 任何情况下都能复位 — 见 `DetailsPanel.tsx:TrashButton`。
- `ConfirmHost` 早期版本有个 `mounted` 锁,从 false → true 后从不重置,导致 modal 关闭后第二次打开有 1 帧延迟显示。已移除,直接根据 `request` 是否为 null 决定是否渲染。

替换了 `DetailsPanel.tsx` 里 `Move to Trash` 的 `window.confirm`,以及 `App.tsx` 空状态里 `Scan entire disk` 的 `window.confirm`。

## 添加新通知

1. 在 main 进程相关 handler 里 `notify({ kind, title, body?, path? })`
2. `permission` kind 默认会渲染 Full Disk Access 按钮 — 别滥用,只在系统权限相关时用
3. 如果是用户主动操作的失败(同步路径),renderer 端也可以直接 `useToasts.getState().push(...)` 不走 IPC
