/**
 * The War Room bookmark: loads the bridge (public/espn-bridge.js) from War Room's site into the
 * user's ESPN tab. Cache-busted per click so a fixed bridge reaches everyone on their next draft.
 * Kept to one short expression: bookmarklets have no error reporting, and some browsers cap length.
 */
export const bookmarkletFor = (origin: string): string =>
  `javascript:(()=>{const s=document.createElement('script');s.src='${origin}/espn-bridge.js?t='+Date.now();document.body.appendChild(s)})()`;
