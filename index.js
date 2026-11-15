//#region lib/types/index.js
/**
 * Host half of dsh-care-sessions.
 *
 * 「最关心对话」的全部逻辑都在浏览器里：列表存在 localStorage，跳转复用
 * ctx.uiWorkspace.openSession，界面挂在客户端槽位上。Host 侧没有路由、
 * 没有状态、不写任何文件 —— 这个入口只负责让 Loader 认领这一行，
 * 并把 package.json 里 `dsh.client` 声明的浏览器半边挂上去。
 */

/** Loader entry: the browser half is mounted through the package's client declaration. */
function apply() {}
//#endregion

export { apply };
