/**
 * dsh-care-sessions — Client half（「最关心对话」）。
 *
 * 一块可以拖动的浮动卡片，列出**你手动加进来**的跨工作区会话，点一下就跳过去。
 * 收起态不是飘在页面上的，而是缩成一枚星标图标，住进左侧栏「工作区」标题行
 * 的图标组里（和 搜索 / 视图选项 / 添加工作区 / W 同一排）。
 *
 * 三个席位，各司其职：
 *   1. `sidebar.workspaces.session.row.action` — 会话行悬停时的 ☆ 按钮（加入 / 移出）；
 *   2. `sidebar.workspaces.session.menu.item` — 会话「…」菜单里的一行（同样的动作，好找）；
 *   3. `shell.overlay` — 框架级浮动层：卡片本体 + 侧栏那枚星标的 portal 宿主。
 *
 * 为什么收起态要 portal 到侧栏标题行：DSH 没有为那一排图标留槽位
 * （`sidebar.workspaces` 是 single 槽，占了就等于把整个浏览器换掉），
 * 所以只能把图标插进 `_sectionHeader` / `_headerActions` 这个 DOM 契约里。
 * 做法与已装的 dsh-wsl-workspace 同源：**借用同排原生按钮的 class**，
 * 于是它跟着原生样式走，不需要猜任何颜色。找不到锚点时退回页面左下角的
 * 一枚浮标，功能不会因为 DSH 改版而整个消失。
 *
 * 状态全部在浏览器里（localStorage），Host 半边是空的：不注册路由、不写宿主文件。
 */

window.__ModuleLoader__.load({
	id: "dsh-care-sessions",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require("react");
		const ReactDOM = require("react-dom");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const NS = "dsh-care-sessions";
		/** localStorage 键：整份「最关心」状态就存在这一个键上。 */
		const STORAGE_KEY = "dsh-care-sessions:v1";
		/** 列表上限，防止无节制地加。 */
		const MAX_ITEMS = 60;
		/** 相对时间自己走一格的周期。 */
		const TICK_MS = 30_000;

		/* ---- 词典：GUI 语言决定用哪一份 ---- */
		const zh = {
			"widget.title": "最关心对话",
			"widget.count": "{n} 个",
			"widget.untitled": "未命名对话",
			"widget.empty": "还没有关心的对话",
			"widget.emptyHint": "在左侧会话行上点 ☆ 加入",
			"widget.hint": "拖动标题栏移动 · 点对话跳转",
			"widget.close": "收起（回到侧栏星标）",
			"widget.openTitle": "最关心对话",
			"widget.fallbackSeat": "最关心对话（侧栏图标位未找到，暂放这里）",
			"row.remove": "移出最关心对话",
			"row.current": "当前会话",
			"action.add": "加入最关心对话",
			"action.remove": "移出最关心对话",
			"menu.add": "加入最关心对话",
			"menu.remove": "移出最关心对话",
			"state.running": "进行中",
			"state.archived": "已归档",
			"state.gone": "已不在会话列表",
			"workspace.unknown": "未分组",
			"relative.now": "刚刚",
			"relative.minutes": "{n} 分钟前",
			"relative.hours": "{n} 小时前",
			"relative.days": "{n} 天前"
		};
		const en = {
			"widget.title": "Care list",
			"widget.count": "{n}",
			"widget.untitled": "Untitled session",
			"widget.empty": "No cared sessions yet",
			"widget.emptyHint": "Hover a sidebar session and click ☆",
			"widget.hint": "Drag the title bar to move · click a session to open",
			"widget.close": "Collapse (back to the sidebar star)",
			"widget.openTitle": "Care list",
			"widget.fallbackSeat": "Care list (sidebar seat missing; parked here)",
			"row.remove": "Remove from the care list",
			"row.current": "Current session",
			"action.add": "Add to the care list",
			"action.remove": "Remove from the care list",
			"menu.add": "Add to the care list",
			"menu.remove": "Remove from the care list",
			"state.running": "Running",
			"state.archived": "Archived",
			"state.gone": "No longer in the session list",
			"workspace.unknown": "Ungrouped",
			"relative.now": "just now",
			"relative.minutes": "{n} min ago",
			"relative.hours": "{n} h ago",
			"relative.days": "{n} d ago"
		};

		const BASE_CSS = [
			/* 侧栏标题行里那枚星标：位置与间距交给原生那一排，这里只补 badge 与宽度预算 */
			".dcs-header-slot{display:inline-flex;align-items:center;justify-content:center;}",
			".dcs-toggle{position:relative;}",
			".dcs-toggle[data-open='true']{color:var(--dsw-alias-label-primary,#f2f5f9);}",
			".dcs-badge{position:absolute;top:-2px;right:-3px;min-width:13px;height:13px;padding:0 3px;border-radius:7px;",
			"background:var(--dsw-alias-state-business-primary,#3b82f6);color:#fff;font:700 9px/13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;",
			"text-align:center;pointer-events:none;}",
			/* 这一排图标有固定的宽度预算：原生两个按钮 60px，dsh-wsl-workspace 自己加成 92px。
			   我们多放一个，就得自己把预算加够（4 × 28px + 3 × 4px = 124px），
			   否则 overflow:hidden 会把原生最后一个按钮挤出可视区。
			   多带一层 _sectionHeader 是为了在层叠上压过 wsl 那条同形状的规则。
			   两条都带 !important，并且**把 max-width 的过渡按掉**：CSS 层叠里过渡的优先级
			   高于 !important，原生那排自带 `transition: max-width .18s`，一旦这行在后台
			   标签页里开始过渡就会被冻在起点（60px），那期间原生的「添加工作区」和 W 会被裁掉。
			   关掉这条过渡的代价只是这排宽度变化由 0.18s 动画变成瞬时 —— 按钮自身的
			   hover / 入场动画都不受影响。作用域已被 :has(> .dcs-header-slot) 限死。 */
			"[class*='_sectionHeader'] [class*='_headerActions']:has(> .dcs-header-slot){max-width:124px !important;transition:none !important;}",
			"[class*='_sectionHeader'] [class*='_headerActions'][class*='_headerActionsHidden']:has(> .dcs-header-slot){max-width:0px !important;}",
			/* 锚点没找到时的退路：侧栏左缘一枚浮标 */
			".dcs-fallback{position:fixed;left:10px;bottom:92px;z-index:2147482800;pointer-events:auto;display:flex;}",
			".dcs-fallback button{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;",
			"border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));border-radius:9px;cursor:pointer;",
			"background:var(--dsw-alias-bg-layer-1,#232324);color:var(--dsw-alias-label-secondary,#a8b6c8);",
			"box-shadow:0 8px 22px rgba(0,0,0,.4);}",
			".dcs-fallback button:hover{color:var(--dsw-alias-label-primary,#f2f5f9);}",
			/* 会话行上的按钮 */
			".dcs-row-action{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;",
			"border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b);cursor:pointer;flex:none;}",
			".dcs-row-action:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,#1a1a1a);}",
			".dcs-row-action[data-cared='true']{color:var(--dsw-alias-state-business-primary,#3b82f6);}",
			".dcs-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;background:transparent;",
			"color:var(--dsw-alias-label-primary,#f2f5f9);font:inherit;text-align:left;cursor:pointer;border-radius:6px;}",
			".dcs-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));}",
			".dcs-menu-icon{display:inline-flex;color:var(--dsw-alias-label-secondary,#a8b6c8);}",
			/* 卡片本体 */
			".dcs-card{position:fixed;z-index:2147482900;width:286px;display:flex;flex-direction:column;max-height:min(62vh,540px);",
			"background:var(--dsw-alias-bg-layer-1,#232324);color:var(--dsw-alias-label-primary,#f2f5f9);",
			"border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));border-radius:12px;overflow:hidden;pointer-events:auto;",
			"box-shadow:0 18px 46px rgba(0,0,0,.46);font:12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}",
			".dcs-head{display:flex;align-items:center;gap:6px;padding:8px 8px 8px 10px;cursor:grab;user-select:none;touch-action:none;",
			"border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));}",
			".dcs-head[data-dragging='true']{cursor:grabbing;}",
			".dcs-grip{display:inline-flex;color:var(--dsw-alias-label-tertiary,#adb2b8);flex:none;}",
			".dcs-title{flex:1;min-width:0;font-weight:600;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
			".dcs-title small{font-weight:400;color:var(--dsw-alias-label-tertiary,#adb2b8);margin-left:5px;}",
			".dcs-icon-button{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;flex:none;",
			"border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#a8b6c8);cursor:pointer;}",
			".dcs-icon-button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#f2f5f9);}",
			".dcs-list{overflow:auto;padding:4px;display:flex;flex-direction:column;gap:1px;flex:1;min-height:0;}",
			".dcs-row{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 8px;border-radius:8px;cursor:pointer;}",
			".dcs-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));}",
			".dcs-row[data-current='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));}",
			".dcs-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-border-l2,rgba(255,255,255,.22));}",
			".dcs-dot[data-run='true']{background:var(--dsw-alias-state-business-primary,#3b82f6);box-shadow:0 0 0 3px rgba(59,130,246,.16);}",
			".dcs-row-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}",
			".dcs-row-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
			".dcs-row-meta{color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
			".dcs-row-gone .dcs-row-title{color:var(--dsw-alias-label-secondary,#a8b6c8);}",
			".dcs-row-hover{opacity:0;display:inline-flex;flex:none;}",
			".dcs-row:hover .dcs-row-hover,.dcs-row:focus-within .dcs-row-hover{opacity:1;}",
			".dcs-empty{padding:16px 12px;text-align:center;color:var(--dsw-alias-label-tertiary,#adb2b8);}",
			".dcs-empty b{display:block;color:var(--dsw-alias-label-secondary,#a8b6c8);font-weight:500;margin-bottom:3px;}",
			".dcs-foot{padding:6px 10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));",
			"color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:10.5px;}",
			/* 万一这一层自己抛了：就地说明原因，而不是让界面静默消失 */
			".dcs-error{position:fixed;left:12px;bottom:12px;z-index:2147482900;max-width:420px;padding:8px 10px;border-radius:8px;",
			"background:var(--dsw-alias-bg-layer-1,#232324);border:1px solid rgba(255,90,90,.5);color:#ff9a9a;",
			"font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;pointer-events:auto;white-space:pre-wrap;}"
		].join("\n");

		/* ---- 小工具 ---- */

		/** 手绘五角星：内置图标集里没有星形，这一枚自己画，描边粗细对齐同排图标。 */
		function StarIcon({ size = 16, filled = false }) {
			return React.createElement(
				"svg",
				{ width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
				React.createElement("path", {
					d: "M8 2.1l1.79 3.63 4 .58-2.9 2.83.69 3.99L8 11.24 4.42 13.13l.69-3.99-2.9-2.83 4-.58L8 2.1z",
					fill: filled ? "currentColor" : "none",
					stroke: "currentColor",
					strokeWidth: 1.2,
					strokeLinejoin: "round"
				})
			);
		}

		/** 把各种来源的时间统一成毫秒；秒级时间戳也能认。 */
		function toMillis(value) {
			const num = typeof value === "number" ? value : Date.parse(typeof value === "string" ? value : "");
			if (typeof num !== "number" || !Number.isFinite(num) || num <= 0) return null;
			return num < 1e12 ? num * 1000 : num;
		}

		function relativeTime(value, t) {
			const at = toMillis(value);
			if (at === null) return "";
			const diff = Date.now() - at;
			if (diff < 60_000) return t("relative.now");
			if (diff < 3_600_000) return t("relative.minutes", { n: Math.floor(diff / 60_000) });
			if (diff < 86_400_000) return t("relative.hours", { n: Math.floor(diff / 3_600_000) });
			return t("relative.days", { n: Math.floor(diff / 86_400_000) });
		}

		function clamp(value, min, max) {
			return Math.min(Math.max(value, min), max);
		}

		/* ---- 状态：唯一定义在浏览器里，跨标签页同步 ---- */

		function isEntry(value) {
			return value !== null && typeof value === "object" && typeof value.id === "string" && value.id !== "";
		}

		function readStored() {
			try {
				const raw = window.localStorage.getItem(STORAGE_KEY);
				if (raw === null) return { items: [], open: false, pos: null };
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object") return { items: [], open: false, pos: null };
				const items = (Array.isArray(parsed.items) ? parsed.items : []).filter(isEntry).slice(0, MAX_ITEMS);
				const pos =
					parsed.pos !== null && typeof parsed.pos === "object" && Number.isFinite(parsed.pos.left) && Number.isFinite(parsed.pos.top)
						? { left: parsed.pos.left, top: parsed.pos.top }
						: null;
				return { items, open: parsed.open === true, pos };
			} catch {
				return { items: [], open: false, pos: null };
			}
		}

		function createStore() {
			let state = readStored();
			const listeners = new Set();

			const notify = () => {
				for (const listener of [...listeners]) listener();
			};
			/** 先换状态、再落盘、最后通知；渲染永远只看得到新的一份。 */
			const commit = (next) => {
				state = next;
				try {
					window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ...state }));
				} catch {
					/* 隐私模式或配额满：内存里照常工作，只是这次没落盘 */
				}
				notify();
			};

			const api = {
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				getSnapshot() {
					return state;
				},
				has(id) {
					return state.items.some((item) => item.id === id);
				},
				/** 加入：新加的在最上面；已在列表里则只把它提到最前。 */
				add(entry) {
					const item = {
						id: entry.id,
						title: typeof entry.title === "string" ? entry.title : "",
						at: Date.now()
					};
					commit({ ...state, open: true, items: [item, ...state.items.filter((existing) => existing.id !== item.id)].slice(0, MAX_ITEMS) });
				},
				remove(id) {
					commit({ ...state, items: state.items.filter((item) => item.id !== id) });
				},
				toggle(entry) {
					if (api.has(entry.id)) api.remove(entry.id);
					else api.add(entry);
				},
				setOpen(open) {
					commit({ ...state, open });
				},
				setPos(pos) {
					commit({ ...state, pos });
				},
				/** 另一个标签页改了同一份状态：整份换掉，不合并。 */
				replaceFromStorage() {
					const next = readStored();
					state = next;
					notify();
				},
				/** 只读快照，给 useSyncExternalStore 之外的地方用。 */
				peek() {
					return state;
				}
			};
			return api;
		}

		/* ---- 侧栏标题行的星标席位 ---- */

		/**
		 * 在侧栏「工作区」标题行里找一块地方放星标。
		 *
		 * 锚点是 `_sectionHeader` / `_headerActions` 这对 CSS-module 后缀（哈希前缀会随构建变），
		 * 和已装的 dsh-wsl-workspace 用的是同一对。找不到就当没坐下：卡片退回左下角浮标，
		 * 功能整体不会消失。React 重渲染可能把标题行整块换掉，所以每次变更后都重挂一次。
		 *
		 * 席位状态（坐下与否、借用到的原生 class）由 subscribe/getSnapshot 对外暴露，
		 * 好让 React 用 useSyncExternalStore 订阅——但它不能叫 subscribe/getSnapshot 之外的名字。
		 */
		function createHeaderSeat() {
			const holder = document.createElement("span");
			holder.className = "dcs-header-slot";
			holder.setAttribute("data-dcs", "header-toggle");

			const listeners = new Set();
			let strip = null;
			let snapshot = { seated: false, className: "" };

			const publish = (seated, className) => {
				if (snapshot.seated === seated && snapshot.className === className) return;
				snapshot = { seated, className };
				for (const listener of [...listeners]) listener();
			};

			const findStrip = () => {
				const scope = document.querySelector('[class*="_sidebarCol"]');
				const root = scope === null ? document : scope;
				const header = root.querySelector('[class*="_sectionHeader"]');
				if (header === null) return null;
				return header.querySelector('[class*="_headerActions"]');
			};

			/** 那一排当前占了多宽（含已有按钮之间的间距）。 */
			const stripWidthNow = (actions) => {
				let width = 0;
				for (const child of actions.children) width += child.getBoundingClientRect().width;
				return width + 4 * Math.max(0, actions.children.length - 1);
			};

			/**
			 * 这一排还装得下（现状 + extra 宽的一个按钮）吗？
			 *
			 * 那一排图标有宽度预算：宽侧栏里够放四个，折叠成 56px 图标轨道时只够放一个
			 * （36px 按钮 + 两侧内边距）。硬塞会把原生的「添加工作区」挤出可视区。
			 *
			 * @param actions - 那一排
			 * @param extra - 还要额外塞进去的宽度；量「已经坐在里面的现状」时传 0
			 * @returns 装得下为 true
			 */
			const fitsInStrip = (actions, extra) => {
				const header = actions.parentElement;
				if (header === null) return true;
				let used = 0;
				for (const child of header.children) {
					if (child === actions) continue;
					used += child.getBoundingClientRect().width;
				}
				const gaps = 4 * Math.max(0, header.children.length - 1);
				const gapForExtra = extra > 0 && actions.children.length > 0 ? 4 : 0;
				return used + gaps + stripWidthNow(actions) + gapForExtra + extra <= header.clientWidth + 1;
			};

			/**
			 * 幂等：在位就什么都不做，装不下就撤。
			 *
			 * 「装不下就撤」对**已经坐下**的情况同样要判：侧栏折叠成图标轨道时那一排变窄，
			 * 位置本身没变（DOM 节点被复用），只有重新量一次才知道该让位。
			 */
			const ensure = () => {
				const actions = findStrip();
				if (actions === null) {
					if (holder.isConnected) holder.remove();
					strip = null;
					publish(false, "");
					return;
				}
				const seatedHere = strip === actions && holder.isConnected;
				/* 借用同排原生按钮的 class：颜色、尺寸、hover 全跟着原生走。
				   优先借「常驻」那一个（不带 _wide），免得跟着入场动画忽隐忽现。 */
				const siblings = [...actions.querySelectorAll("button:not(.dcs-toggle)")];
				const sibling = siblings.find((button) => !button.className.includes("_wide")) ?? siblings[0];
				const className = sibling === undefined ? "" : sibling.className;
				const mine = sibling === undefined ? 28 : sibling.getBoundingClientRect().width || 28;

				if (!fitsInStrip(actions, seatedHere ? 0 : mine)) {
					if (holder.isConnected) holder.remove();
					strip = null;
					publish(false, "");
					return;
				}
				if (!seatedHere) {
					strip = actions;
					actions.insertBefore(holder, actions.firstChild);
				}
				publish(true, className);
			};

			return {
				holder,
				ensure,
				/**
				 * 已经坐下的位置现在还合适吗？侧栏在「宽栏 ↔ 图标轨道」之间切换时，
				 * 同一个 DOM 节点会被复用，光看 isConnected 是发现不了的。
				 */
				fits() {
					return strip === null ? true : fitsInStrip(strip, 0);
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				getSnapshot() {
					return snapshot;
				},
				dispose() {
					holder.remove();
				}
			};
		}

		/* ---- 从目录里解出要显示的行 ---- */

		/**
		 * 把「最关心」的 id 列表和当前会话目录、工作区目录合起来，得到渲染要用的行。
		 * 目录里查不到时退回加入时缓存的标题，并如实标成「已归档」或「已不在会话列表」。
		 *
		 * @param items - 存储里的条目（新在前）
		 * @param sessions - ctx.sessions.list 快照
		 * @param workspaces - ctx.workspaces.list 快照
		 * @param t - 翻译函数
		 */
		function resolveRows(items, sessions, workspaces, t) {
			const byId = sessions === undefined || sessions === null ? {} : sessions.byId ?? {};
			const views = workspaces === undefined || workspaces === null ? [] : workspaces.items ?? [];
			const archivedIds = workspaces === undefined || workspaces === null ? [] : workspaces.archivedSessionIds ?? [];
			const workspaceOf = new Map();
			for (const view of views) {
				for (const id of view.sessionIds) if (!workspaceOf.has(id)) workspaceOf.set(id, view.title);
			}
			const archived = new Set(archivedIds);
			return items.map((item) => {
				const summary = byId[item.id];
				return {
					id: item.id,
					title: summary === undefined ? item.title || t("widget.untitled") : summary.displayTitle || item.title || t("widget.untitled"),
					workspace: workspaceOf.get(item.id) ?? null,
					at: (summary === undefined ? null : summary.updatedAt) ?? item.at,
					running: summary !== undefined && summary.running === true,
					current: summary !== undefined && (summary.retainedBy?.mainView ?? 0) > 0,
					archived: archived.has(item.id),
					missing: summary === undefined
				};
			});
		}

		/* ---- 侧栏入口：会话行上的 ☆ ---- */

		function CareRowAction({ sessionId, displayTitle, store, t }) {
			const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
			const cared = state.items.some((item) => item.id === sessionId);
			const label = t(cared ? "action.remove" : "action.add");
			return React.createElement(
				primitives.Tooltip,
				{ label, side: "bottom", align: "end", delayMs: 400 },
				React.createElement(
					"button",
					{
						type: "button",
						className: "dcs-row-action",
						"data-cared": cared ? "true" : "false",
						"aria-pressed": cared,
						"aria-label": label,
						onClick: (event) => {
							event.stopPropagation();
							event.preventDefault();
							store.toggle({ id: sessionId, title: displayTitle });
						}
					},
					React.createElement(StarIcon, { size: 15, filled: cared })
				)
			);
		}

		/** 会话「…」菜单里的一行：同样的动作，给不爱悬停的人。 */
		function CareMenuItem({ sessionId, displayTitle, useMenuOpenState, store, t }) {
			const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
			const cared = state.items.some((item) => item.id === sessionId);
			const [, setMenuOpen] = useMenuOpenState();
			return React.createElement(primitives.MenuItemButton, {
				icon: React.createElement(StarIcon, { size: 14, filled: cared }),
				onSelect: () => {
					setMenuOpen(false);
					store.toggle({ id: sessionId, title: displayTitle });
				},
				children: t(cared ? "menu.remove" : "menu.add")
			});
		}

		/* ---- 侧栏那枚星标（portal 进标题行） ---- */

		function CareToggle({ store, seat, t }) {
			const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
			const info = React.useSyncExternalStore(seat.subscribe, seat.getSnapshot, seat.getSnapshot);
			const count = state.items.length;
			const label = t("widget.openTitle");
			const className = `${info.className === "" ? "dcs-icon-button" : info.className} dcs-toggle`;
			return React.createElement(
				"button",
				{
					type: "button",
					className,
					"data-open": state.open ? "true" : "false",
					"aria-label": label,
					"aria-expanded": state.open,
					title: label,
					onClick: () => store.setOpen(!state.open)
				},
				React.createElement(StarIcon, { size: 16, filled: state.open || count > 0 }),
				count > 0 ? React.createElement("span", { className: "dcs-badge" }, count > 99 ? "99+" : String(count)) : null
			);
		}

		/* ---- 浮层：卡片 + 星标 ---- */

		/** 默认落在右侧靠上，不挡会话开头；第一次拖动之后就用存下来的位置。 */
		function defaultPos() {
			return { left: Math.max(12, window.innerWidth - 306), top: 104 };
		}

		/**
		 * 浮层这一层的壳：卡片与星标都从这里出去。
		 *
		 * 外面套一层 try 不是为了掩盖问题——这一层一旦抛，整套界面会整块消失且不留痕迹
		 * （槽位只留一个空的 data-slot-error）。所以改成就地显示原因：
		 * 看得见的报错比看不见的空白好排查，而且在用户那边也说得清。
		 */
		function CareLayer(props) {
			try {
				return CareLayerBody(props);
			} catch (error) {
				const message = error !== null && typeof error === "object" && typeof error.message === "string" ? error.message : String(error);
				return React.createElement("div", { className: "dcs-error" }, `${NS}: overlay failed\n${message}`);
			}
		}

		function CareLayerBody({ store, seat, sources, t, openSession }) {
			const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
			const sessions = React.useSyncExternalStore(sources.sessions.subscribe, sources.sessions.getSnapshot, sources.sessions.getSnapshot);
			const workspaces = React.useSyncExternalStore(sources.workspaces.subscribe, sources.workspaces.getSnapshot, sources.workspaces.getSnapshot);
			const info = React.useSyncExternalStore(seat.subscribe, seat.getSnapshot, seat.getSnapshot);

			/* 相对时间要自己往前走，否则「刚刚」会一直停在刚刚 */
			const [, tick] = React.useReducer((n) => n + 1, 0);
			React.useEffect(() => {
				const id = window.setInterval(tick, TICK_MS);
				return () => window.clearInterval(id);
			}, []);

			const cardRef = React.useRef(null);
			const dragRef = React.useRef(null);

			/** 把落定位置写进样式。左右上下都夹回视口内，窗口再小也看得见。 */
			const applyPosition = (el, pos) => {
				const anchor = pos ?? defaultPos();
				el.style.left = `${clamp(anchor.left, 4, Math.max(4, window.innerWidth - 80))}px`;
				el.style.top = `${clamp(anchor.top, 4, Math.max(4, window.innerHeight - 44))}px`;
			};

			/* 位置走 ref 回调 + effect 两条路。
			   只写 effect 是不够的：席位落定会让 React 换掉这一个子节点，
			   而 effect 的依赖没变就不会再跑，新节点于是没有坐标（卡片贴在左上角）。 */
			const attachCard = React.useCallback(
				(el) => {
					cardRef.current = el;
					if (el !== null && dragRef.current === null) applyPosition(el, state.pos);
				},
				[state.pos]
			);

			React.useLayoutEffect(() => {
				const el = cardRef.current;
				if (el === null || dragRef.current !== null) return;
				applyPosition(el, state.pos);
			}, [state.pos, state.open]);

			/* 视口一变（窗口缩放、整页截图临时改尺寸、开发者工具）就按**存下来的位置**重新摆一次：
			   夹回可见区是为了不让人把卡片弄丢，但夹完不停在原地 —— 视口恢复后它自己回到原处。
			   若这里直接把「夹过的」坐标留在元素上，一次截图就能把卡片永久挪到左上角。 */
			React.useEffect(() => {
				const onResize = () => {
					if (cardRef.current === null || dragRef.current !== null) return;
					applyPosition(cardRef.current, state.pos);
				};
				window.addEventListener("resize", onResize);
				return () => window.removeEventListener("resize", onResize);
			}, [state.pos]);

			const onPointerDown = (event) => {
				if (event.button !== 0) return;
				if (event.target instanceof Element && event.target.closest("button") !== null) return;
				const el = cardRef.current;
				if (el === null) return;
				const rect = el.getBoundingClientRect();
				dragRef.current = {
					pointerId: event.pointerId,
					startX: event.clientX,
					startY: event.clientY,
					baseLeft: rect.left,
					baseTop: rect.top,
					el
				};
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch {
					/* 指针已经不活跃（或事件是合成的）：捕获失败不影响下面的拖动逻辑，
					   因为移动与落定都只依赖 dragRef，不依赖捕获本身。 */
				}
				event.currentTarget.dataset.dragging = "true";
				/* 拖动期间只改 transform：合成层内移动，不触发布局，也不必依赖 rAF */
				el.style.willChange = "transform";
				event.preventDefault();
			};

			const onPointerMove = (event) => {
				const drag = dragRef.current;
				if (drag === null || drag.pointerId !== event.pointerId) return;
				const maxX = Math.max(4, window.innerWidth - 80) - drag.baseLeft;
				const maxY = Math.max(4, window.innerHeight - 44) - drag.baseTop;
				const dx = clamp(event.clientX - drag.startX, 4 - drag.baseLeft, maxX);
				const dy = clamp(event.clientY - drag.startY, 4 - drag.baseTop, maxY);
				drag.el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
			};

			const endDrag = (event) => {
				const drag = dragRef.current;
				if (drag === null || (event !== undefined && drag.pointerId !== event.pointerId)) return;
				dragRef.current = null;
				if (event !== undefined && event.currentTarget instanceof Element) {
					event.currentTarget.dataset.dragging = "false";
					try {
						event.currentTarget.releasePointerCapture(drag.pointerId);
					} catch {
						/* 指针已经没了：无需释放 */
					}
				}
				/* 落定：把 transform 折进 left/top，再存下来 */
				const rect = drag.el.getBoundingClientRect();
				drag.el.style.willChange = "";
				drag.el.style.transform = "";
				store.setPos({ left: Math.round(rect.left), top: Math.round(rect.top) });
			};

			const rows = resolveRows(state.items, sessions, workspaces, t);

			const header = React.createElement(
				"div",
				{
					className: "dcs-head",
					"data-dragging": "false",
					onPointerDown,
					onPointerMove,
					onPointerUp: endDrag,
					onPointerCancel: endDrag
				},
				React.createElement(
					"span",
					{ className: "dcs-grip" },
					React.createElement(
						"svg",
						{ width: 12, height: 12, viewBox: "0 0 12 12", fill: "none", "aria-hidden": "true" },
						React.createElement("path", {
							d: "M4 3h.01M8 3h.01M4 6h.01M8 6h.01M4 9h.01M8 9h.01",
							stroke: "currentColor",
							strokeWidth: 1.7,
							strokeLinecap: "round"
						})
					)
				),
				React.createElement(
					"span",
					{ className: "dcs-title" },
					t("widget.title"),
					React.createElement("small", null, t("widget.count", { n: rows.length }))
				),
				React.createElement(
					"button",
					{
						type: "button",
						className: "dcs-icon-button",
						"aria-label": t("widget.close"),
						title: t("widget.close"),
						onClick: () => store.setOpen(false)
					},
					React.createElement(primitives.IconCloseOutlineRegular, { size: 14 })
				)
			);

			const body =
				rows.length === 0
					? React.createElement(
							"div",
							{ className: "dcs-empty" },
							React.createElement("b", null, t("widget.empty")),
							t("widget.emptyHint")
						)
					: React.createElement(
							"div",
							{ className: "dcs-list" },
							rows.map((row) => {
								const meta = [row.missing ? (row.archived ? t("state.archived") : t("state.gone")) : row.workspace ?? t("workspace.unknown")];
								if (row.archived && !row.missing) meta.push(t("state.archived"));
								if (row.running) meta.push(t("state.running"));
								const time = relativeTime(row.at, t);
								if (time !== "") meta.push(time);
								return React.createElement(
									"div",
									{
										key: row.id,
										className: `dcs-row${row.missing ? " dcs-row-gone" : ""}`,
										"data-current": row.current ? "true" : "false",
										title: t("widget.openTitle"),
										onClick: () => openSession(row.id)
									},
									React.createElement("span", { className: "dcs-dot", "data-run": row.running ? "true" : "false" }),
									React.createElement(
										"span",
										{ className: "dcs-row-text" },
										React.createElement("span", { className: "dcs-row-title" }, row.title),
										React.createElement("span", { className: "dcs-row-meta" }, meta.join(" · "))
									),
									React.createElement(
										"span",
										{ className: "dcs-row-hover" },
										React.createElement(
											"button",
											{
												type: "button",
												className: "dcs-icon-button",
												"aria-label": t("row.remove"),
												title: t("row.remove"),
												onClick: (event) => {
													event.stopPropagation();
													store.remove(row.id);
												}
											},
											React.createElement(primitives.IconCloseOutlineRegular, { size: 13 })
										)
									)
								);
							})
						);

			const card = React.createElement(
				"div",
				{ className: "dcs-card", ref: attachCard, key: "card" },
				header,
				body,
				React.createElement("div", { className: "dcs-foot" }, t("widget.hint"))
			);

			const toggle = React.createElement(CareToggle, { store, seat, t });
			/* 每一项都带 key：席位开关会让中间这一项出现/消失，
			   没有 key 的话 React 按序号对位，会把卡片节点整个重建。 */
			const pieces = [
				/* 星标始终渲染，只是住的容器可能被挪走；容器离屏时另给一枚左下角浮标兜底 */
				ReactDOM.createPortal(toggle, seat.holder, "toggle"),
				info.seated
					? null
					: React.createElement(
							"div",
							{ className: "dcs-fallback", key: "fallback", title: t("widget.fallbackSeat") },
							React.createElement(CareToggle, { store, seat: seat, t })
						),
				state.open ? card : null
			];
			return React.createElement(React.Fragment, null, pieces.filter((piece) => piece !== null));
		}

		/* ---- 装配 ---- */

		function apply(ctx) {
			const store = createStore();
			const t = ctx.locale.bind(NS);

			/* 四个订阅面：都在 Client 根的整个生命周期里稳定，可以放心交给 useSyncExternalStore */
			const sources = {
				sessions: {
					subscribe: (listener) => ctx.sessions.list.subscribe(listener),
					getSnapshot: () => ctx.sessions.list.getSnapshot()
				},
				workspaces: {
					subscribe: (listener) => ctx.workspaces.list.subscribe(listener),
					getSnapshot: () => ctx.workspaces.list.getSnapshot()
				}
			};

			const seat = createHeaderSeat();

			/** 点一行就跳过去：选中会话 + 显示对话，跨工作区一步到位。 */
			const openSession = (id) => {
				try {
					ctx.uiWorkspace.openSession(id);
				} catch {
					/* 会话已经不在了：列表下一帧会把它标成「已不在会话列表」 */
				}
			};

			const runtime = { store, seat, sources, t, openSession };

			/* 样式只装一次：插件重载时同 id 的 style 会被复用 */
			if (typeof document !== "undefined" && document.head !== null) {
				const attribute = "data-plugin";
				if (document.head.querySelector(`style[${attribute}="${NS}"]`) === null) {
					const style = document.createElement("style");
					style.setAttribute(attribute, NS);
					style.textContent = BASE_CSS;
					document.head.appendChild(style);
					ctx.effect(() => () => style.remove(), `${NS}: styles`);
				}
			}

			ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`);

			/* 星标席位：进页面先挂一次，之后在「被 React 换掉」或「启动时侧栏还没挂」时补挂。
			   重试一律走 setTimeout，**不用 requestAnimationFrame**：后台标签页里 rAF 根本不触发，
			   而 DSH 常常是在后台标签页里加载的 —— 那样第一个 rAF 就再也不会回来了。 */
			const retryTimers = [];
			const retry = () => {
				seat.ensure();
			};
			retry();
			for (const delay of [0, 120, 350, 900, 2000, 4000]) {
				retryTimers.push(window.setTimeout(retry, delay));
			}
			if (typeof window.MutationObserver === "function") {
				let scheduled = false;
				const schedule = () => {
					if (scheduled) return;
					scheduled = true;
					retryTimers.push(
						window.setTimeout(() => {
							scheduled = false;
							seat.ensure();
						}, 0)
					);
				};
				/* 席位还在位时也要复检：侧栏在「宽栏 ↔ 56px 图标轨道」之间切换时节点被复用，
				   只有重新量一次才知道那一排还装不装得下。
				   限频但**不丢**——窗口内先约一次，到点必查。侧栏折叠是 CSS 过渡，
				   过渡本身不产生 DOM 变更，如果只「跳过」不「补做」，过渡结束后的真实几何
				   就再也没人量过，星标会一直坐在那儿把原生按钮挤掉。 */
				let nextFitCheck = 0;
				let fitTimer = 0;
				const checkFitSoon = () => {
					if (fitTimer !== 0) return;
					const wait = Math.max(0, nextFitCheck - Date.now());
					fitTimer = window.setTimeout(() => {
						fitTimer = 0;
						nextFitCheck = Date.now() + 500;
						if (seat.getSnapshot().seated && seat.holder.isConnected && !seat.fits()) seat.ensure();
					}, wait);
				};
				const observer = new window.MutationObserver(() => {
					if (!seat.getSnapshot().seated || !seat.holder.isConnected) {
						schedule();
						return;
					}
					checkFitSoon();
				});
				observer.observe(document.body, { childList: true, subtree: true });
				ctx.effect(
					() => () => {
						observer.disconnect();
						if (fitTimer !== 0) window.clearTimeout(fitTimer);
						seat.dispose();
					},
					`${NS}: header seat observer`
				);
			}
			ctx.effect(
				() => () => {
					for (const timer of retryTimers) window.clearTimeout(timer);
				},
				`${NS}: header seat retries`
			);

			/* 另一个标签页动了同一份列表：跟着换 */
			const onStorage = (event) => {
				if (event.key === STORAGE_KEY) store.replaceFromStorage();
			};
			window.addEventListener("storage", onStorage);
			ctx.effect(() => () => window.removeEventListener("storage", onStorage), `${NS}: cross-tab sync`);

			ctx.slots.inject("sidebar.workspaces.session.row.action", () =>
				ctx.slots.register(
					{ name: "sidebar.workspaces.session.row.action", id: "care", order: 300, inject: () => runtime },
					CareRowAction
				)
			);
			ctx.slots.inject("sidebar.workspaces.session.menu.item", () =>
				ctx.slots.register(
					{ name: "sidebar.workspaces.session.menu.item", id: "care", order: 250, inject: () => runtime },
					CareMenuItem
				)
			);
			ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register({ name: "shell.overlay", id: "care-sessions", order: 400, inject: () => runtime }, CareLayer)
			);
		}

		exports.apply = apply;
		/*
		 * 用到哪个服务就必须在这里声明：cordis 的服务访问是白名单制的，
		 * 少写一个不是「取到 undefined」，而是当场抛 "cannot get property … without inject"。
		 *   slots        挂三处界面
		 *   locale       中英文词典
		 *   sessions     会话目录（标题 / 活跃时间 / 是否当前会话）
		 *   workspaces   会话属于哪个工作区、是否已归档
		 *   uiWorkspace  点一下跳过去（选中会话 + 显示对话，跨工作区一步到位）
		 */
		exports.inject = ["slots", "locale", "sessions", "workspaces", "uiWorkspace"];
		return module.exports;
	}
});
