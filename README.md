# dsh-care-sessions

[中文](#中文) | [English](#english)

DSH（DeepSeek Harness）Web 增强插件：**把你在意的对话钉成一份跨工作区的清单，随时一点就跳过去。**

并行的活儿一多，会话就散在十几个工作区里，每次切回去都要重新找。这个插件让你像收藏网页一样收藏会话：在侧栏会话行上点一下 ☆，它就进了「最关心对话」；之后无论你在哪个工作区，点侧栏「工作区」那一行里的 ★ 就能看到这份清单，点任意一条直接跳过去。

> 纯客户端插件，没有 Host 半边：不注册路由、不写宿主文件，清单存在浏览器 localStorage 里。

## 中文

### 用起来是什么样

**收起态**：侧栏「工作区」标题行里多一枚星标，就住在 搜索 / 视图选项 / 添加工作区 / W 那一排里。清单里有几条，星标右上角就显示几。

**展开态**：点星标，浮出一张卡片。

```
最关心对话  5 个                                    ✕
─────────────────────────────────────────────────
● 你看看termdrive这个插件。它似
  sr-sim · 1 天前
● 自制epub翻译审稿
  default-workspace · 进行中 · 21 分钟前
  检查dsh命令模型的推理等级配置
  edge浏览器控制专用工作区 · 5 天前
  edge-cdp 与 playwright 设计哲学
  dsh-plugins · 1 天前
  喂
  LearnCANN · 5 天前
─────────────────────────────────────────────────
拖动标题栏移动 · 点对话跳转
```

- 拖动标题栏可以把它摆在任何地方，位置记在浏览器里，下次打开还在原处；
- 蓝点表示那个会话正在跑；你现在正待着的那个会话整行高亮；
- 鼠标移到某一行，右侧出现 ✕，把它从清单里拿掉；
- 点任意一行 → 切到那个会话（跨工作区一步到位，不用先展开工作区分组）。

### 怎么把会话加进来

两个入口，都挂在会话行上：

| 入口 | 位置 |
|---|---|
| ☆ 按钮 | 鼠标移到侧栏某个会话行上，最右侧图标组里（归档 / 删除 / 置顶 旁边） |
| 菜单行 | 会话行的「…」菜单里，「加入最关心对话」 |

已经加过的会话，☆ 是实心的；再点一次就是移出。清单里显示的是**加入时的顺序，新的在最上面**。

### 它不做什么

- **不自动收集。** 清单里有什么，完全是你点进来的。没有「最近访问」这类自动累积 —— 那是另一个产品，混在一起只会让这份清单失去「我挑的」这个意义。
- **不碰原生的置顶。** 原生「置顶会话」是把会话顶到它自己工作区分组的头上；这份清单是跨工作区的，两件事互不干扰。
- **不复制任何原生状态。** 清单本身只有一份（插件的 store），会话标题 / 是否在跑 / 属于哪个工作区都是每次渲染时从 `ctx.sessions.list` 和 `ctx.workspaces.list` 现读的。会话改名、归档、被删掉，清单里跟着变，不需要同步。

### 实现取向

| 关注点 | 做法 |
|---|---|
| 卡片挂哪 | `shell.overlay` —— 框架级浮动层，位于所有列之上、滚动容器之外，天然点击穿透，条目自行选择是否接收指针事件 |
| 星标挂哪 | 没有槽位可用，所以插进侧栏 `_sectionHeader` / `_headerActions` 的 DOM 契约里，**借用同排原生按钮的 class**，颜色尺寸 hover 全跟着原生走 |
| 跳转 | `ctx.uiWorkspace.openSession(id)` —— 选中会话 + 显示对话一步完成，跨工作区不需要先展开分组 |
| 当前会话 | `ctx.sessions.list` 里该行的 `retainedBy.mainView > 0`（ui-session 自己判定「当前会话」用的就是这个字段） |
| 拖动手感 | 拖动期间只改 `transform`（合成层内移动，不触发重排、不读写布局），松手时才把位移折进 `left/top` 并存盘 |
| 拖动不断触 | 卡片与星标都带稳定 key；拖动期间任何重渲染都不会替换正在被拖的那个节点 |

**这几处都是踩过才写下的：**

- 位置不能只写在 effect 里 —— 席位状态变化会让 React 换掉那个子节点，而 effect 依赖没变就不会再跑，新节点于是没有坐标；
- 重试不能用 `requestAnimationFrame` —— 后台标签页里 rAF 根本不触发，而 DSH 常常是在后台标签页里加载的；
- 那一排图标有**固定宽度预算**（原生两个按钮 60px，`dsh-wsl-workspace` 自己加成 92px）。多放一个就得自己把预算加够（四个 = 124px），否则 `overflow: hidden` 会把原生最后一个按钮挤出可视区；折叠成 56px 图标轨道时只够放一个按钮，这时星标主动让位、退回页面左缘的浮标，绝不挤掉原生按钮；
- 那条宽度预算要按掉 `max-width` 的过渡：CSS 层叠里**过渡的优先级高于 `!important`**，原生那排自带 `transition: max-width .18s`，一旦在后台标签页里开始过渡就会被冻在起点，那期间原生按钮会被裁掉。

### 安装

未发布到 npm，按 profile 从 GitHub 安装：

```powershell
dsh plugin --profile web add github:Firefly-Star/dsh-care-sessions#v0.1.0
```

`dsh plugin` 会把参数原样转给 profile 目录里的 pnpm。装完**刷新页面**即可 —— profile 开了 HMR 的话 bundle 会直接加入正在运行的组合，不需要重启 DSH。

卸载：

```powershell
dsh plugin --profile web remove dsh-care-sessions
```

#### 改代码时（本地目录安装）

要在本仓库里改代码、让 profile 直接吃这个目录，用它自带的接线脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -DryRun   # 先看它打算做什么
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1           # 真的装
```

它做三件事，每件都先检查再动手：往 profile 的 `package.json` 加一条依赖和一条 `dsh.profile.bundles` 记录（改前自动备份）、在 profile 的 `node_modules` 下建 junction 指向本目录并验证它确实是 reparse point、报下一步。卸载用 `-Uninstall`。

> 两种方式不要混着用：`file:` 依赖和 `github:` 依赖是同一个包名，后装的会覆盖前一个。
> `~/.dsh` 在 agent 的文件沙箱之外，所以这一步要么你自己在普通 PowerShell 窗口里跑，要么由 agent 带着一次显式授权跑。

### 组成

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半：空实现，只为让 Loader 认领这一行 |
| `client.js` | 浏览器半：清单状态、星标席位、卡片、两个会话行入口 |
| `cordis.patch.yml` | 随包分发的 profile 层，安装后自动挂载 |
| `install.ps1` | 接线脚本（含 `-DryRun` / `-Uninstall`） |
| `assets/plugin-icon.svg` | 插件列表里的图标 |

### 已知限制

- **清单只存在这个浏览器里**（localStorage，跨标签页同步）。换浏览器、清站点数据就没了。要跨设备同步就得加 Host 半边。
- **清单顺序 = 加入顺序**，暂时不支持手动拖动排序。
- **侧栏锚点依赖 DOM 契约**（`_sectionHeader` / `_headerActions` 这对 CSS-module 后缀），和已装的 `dsh-wsl-workspace` 用的是同一对。DSH 改版若动了它，星标退回页面左缘的浮标，功能不会整个消失。
- **侧栏折叠成 56px 图标轨道时**，星标会让位到浮标（那一排只放得下一个原生按钮）。这条在后台标签页里不好验证（浏览器会冻结过渡与布局），是按几何算出来让位的。
- 只支持 Web 端，桌面端未验证。

## English

A DSH (DeepSeek Harness) web enhancement: **pin the sessions you care about into one cross-workspace list and jump to any of them in one click.**

Star a session in the sidebar, and it joins the care list. The star that lives in the Workspace header row opens a draggable card listing every cared session with its workspace, relative time and running state — click one and you are there, no matter which workspace it lives in.

> Browser-only: no host routes, nothing written outside the browser's localStorage.

### Behaviour

- **Collapsed**: one star in the Workspace section header row, beside search / view options / add workspace / W. A badge shows how many sessions are cared for.
- **Expanded**: a floating card — draggable by its title bar, position remembered, current session highlighted, a blue dot for a running session, ✕ on hover to remove a row, click a row to open it.
- **Adding**: the ☆ button in a session row's hover strip, or the session's "…" menu.

### Design stance

Nothing is duplicated from the native UI. The list itself is the plugin's only state (one store, persisted to localStorage); titles, running state, workspace membership and the current session are read from `ctx.sessions.list` / `ctx.workspaces.list` on every render, and opening a session goes through `ctx.uiWorkspace.openSession(id)`.

The card lives in `shell.overlay` (the frame-wide floating layer). The star has no slot to live in, so it is injected into the sidebar's `_sectionHeader` / `_headerActions` DOM contract and **borrows the class of a native button in the same row** — colours, size and hover come from the shipped stylesheet. When that row cannot fit another button (the 56px icon rail), the star yields and falls back to a small floating button so the native controls are never pushed out.

### Install

Not published to npm; install from GitHub into a profile:

```powershell
dsh plugin --profile web add github:Firefly-Star/dsh-care-sessions#v0.1.0
```

`dsh plugin` forwards the arguments to pnpm inside the profile directory. Then reload the page: with HMR enabled the bundle joins the running composition; no DSH restart is needed.

```powershell
dsh plugin --profile web remove dsh-care-sessions   # uninstall
```

To hack on this repository and have the profile consume the working directory instead, use the bundled script (`-DryRun` / `-Uninstall` are supported); it adds a `file:` dependency plus a `dsh.profile.bundles` row and links the package into the profile's `node_modules`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
```

> Do not mix the two: the `file:` and `github:` specs name the same package, so whichever is installed last wins.

### Known limitations

- The list lives in one browser (localStorage, synced across tabs of that origin); clearing site data clears it.
- Order is insertion order (newest first); no manual reordering yet.
- The sidebar anchor depends on a DOM contract shared with `dsh-wsl-workspace`; if a DSH upgrade moves it, the star falls back to a floating button rather than disappearing.
- Web only.

## License

MIT
