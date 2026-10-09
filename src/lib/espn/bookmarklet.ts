/**
 * The Draft Room bookmark: loads the bridge (public/espn-bridge.js) from Draft Room's site into the
 * user's ESPN tab. Cache-busted per click so a fixed bridge reaches everyone on their next draft.
 * Kept to one short expression, since some browsers cap a bookmark's length.
 *
 * It loads the bridge with import(), not a script tag (APE-339): ESPN's phone site guards the DOM,
 * rewriting the src of any script it doesn't know to "//javascript:;" before the request goes out,
 * and a page can't intercept import(). That makes the bridge a module, which is served with CORS
 * and has no document.currentScript, so the bookmark leaves Draft Room's origin on window for it.
 *
 * Frozen since APE-331, and changed once for APE-339: this code lives in every user's bookmarks,
 * and changing it means asking them all to add it again. Anything new goes in the bridge, which
 * every click loads fresh. It carries the one thing the bridge can't do for itself: say so when the
 * bridge didn't load at all (a content blocker, or no connection), instead of doing nothing.
 */
export const bookmarkletFor = (origin: string): string =>
  `javascript:(()=>{window.__draftRoomOrigin='${origin}';import('${origin}/espn-bridge.js?t='+Date.now())` +
  `.catch(()=>alert("Draft Room couldn't load on this page. Check your connection, or turn off content blockers for ESPN, and try again."))})()`;
