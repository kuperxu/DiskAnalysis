# Build

electron-vite 三个独立打包目标(main / preload / renderer)+ electron-builder 出 dmg。

## 文件

- `package.json` — 依赖、scripts、`build` (electron-builder) 配置
- `electron.vite.config.ts` — 三个 target 的 Vite 配置
- `tsconfig.json` — 根项目,引用下面两个
- `tsconfig.node.json` — main / preload / shared(Node 类型,no DOM)
- `tsconfig.web.json` — renderer / shared(DOM + react-jsx)
- `.gitignore` — `node_modules/`、`out/`、`dist/`、`.vite/`、`.DS_Store`、`*.log`

## 关键 scripts

| script | 命令 | 用途 |
| --- | --- | --- |
| `dev` | `electron-vite dev` | 启动 Electron + 三 target HMR |
| `build` | `electron-vite build` | 生产构建到 `out/` |
| `start` | `electron-vite preview` | 预览生产包 |
| `dist` | `build && electron-builder --mac` | 出 `dist/*.dmg` |
| `rebuild` | `electron-rebuild -f -w better-sqlite3` | 切 Electron 主版本后手动重编原生模块 |
| `postinstall` | `electron-builder install-app-deps` | 自动给当前 Electron 版本编译原生模块 |
| `typecheck` | `tsc --noEmit -p ...node + ...web` | CI 友好的纯类型检查 |

## 路径别名

- `@shared/*` → `src/shared/*`(三个 target 都有)
- `@renderer/*` → `src/renderer/*`(只 web)

`tsconfig.*.json` 和 `electron.vite.config.ts` 的 `resolve.alias` 必须**两边同时配**,否则 Vite 能跑但 tsc 报错(或反过来)。

## 原生依赖

`better-sqlite3` 是 prebuilt binary,但 Electron 的 ABI 和 Node 不一致,必须用 Electron 的 ABI 重编。`postinstall` hook 让 `npm install` 之后自动跑 `electron-builder install-app-deps`,免手动。如果手动切了 `electron` 主版本号,跑一次 `npm run rebuild`。

## main 进程入口

`package.json:"main": "out/main/index.js"`(打包后),`dev` 模式下 electron-vite 会代理到源文件。

## Renderer 入口

`src/renderer/index.html` 是 Vite 的 root,通过 `<script type="module" src="./main.tsx">` 拉起 React。

## 打包配置

`package.json` 的 `build` 字段(electron-builder):
- `appId: com.example.disk-analysis`
- `productName: Disk Analysis`
- `mac.category: public.app-category.utilities`
- `mac.target: dmg`
- `hardenedRuntime: false`,`gatekeeperAssess: false` — **无签名**,首次打开要右键 → 打开。后续要做发布版,需要 Apple Developer 证书 + notarize 流程。

## 加新依赖时

1. `npm install <pkg>` / `npm install -D <pkg>`
2. 如果是原生模块(N-API / nan): 检查 `postinstall` 能否覆盖,否则补 `npm run rebuild` 文档
3. 如果引入了**新构建产物路径**(比如 worker bundle):`electron.vite.config.ts` 里 `rollupOptions.input` 要加;打包后路径要稳定(`entryFileNames: '[name].js'`)
