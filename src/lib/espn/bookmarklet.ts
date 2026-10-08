/**
 * The Draft Room bookmark: loads the bridge (public/espn-bridge.js) from Draft Room's site into the
 * user's ESPN tab. Cache-busted per click so a fixed bridge reaches everyone on their next draft.
 * Kept to one short expression, since some browsers cap a bookmark's length.
 *
 * Frozen since APE-331: this code lives in every user's bookmarks, and changing it means asking
 * them all to add it again. Anything new goes in the bridge, which every click loads fresh. It
 * carries the one thing the bridge can't do for itself: say so when the bridge didn't load at all
 * (a content blocker, or no connection), instead of doing nothing.
 */
export const bookmarkletFor = (origin: string): string =>
  `javascript:(()=>{const s=document.createElement('script');s.src='${origin}/espn-bridge.js?t='+Date.now();` +
  `s.onerror=()=>alert("Draft Room couldn't load on this page. Check your connection, or turn off content blockers for ESPN, and try again.");` +
  `(document.body||document.documentElement).appendChild(s)})()`;
