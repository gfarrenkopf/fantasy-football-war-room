import type { Browser, Scene } from "./BookmarkScenes";

/**
 * Saving and using the Draft Room bookmark, browser by browser (APE-299, APE-334): each step's words
 * and the scene that shows it. Bookmarklets can't be added directly on a phone, so every phone
 * browser does the same thing its own way: bookmark any page, then swap its address for the code.
 */

export interface Step {
  text: string;
  scene: Scene;
}

export interface BrowserGuide {
  label: string;
  /** Saving it, after the code is copied. */
  save: Step[];
  /** Running it, on whichever page: this one to test it, or ESPN's. */
  run: (page: "setup" | "espn") => Step;
  /** Why tapping it may do nothing here, likeliest first. */
  causes: string[];
}

const CHROME_MENU = ["New tab", "Add to Bookmarks", "Bookmarks", "History", "Settings"];

export const GUIDES: Record<Browser, BrowserGuide> = {
  "ios-safari": {
    label: "iPhone Safari",
    save: [
      { text: "Bookmark this page: tap Share, then Add Bookmark, then Save.", scene: { kind: "share", browser: "ios-safari" } },
      { text: "Tap the book icon, then Edit at the bottom.", scene: { kind: "bookmarks", browser: "ios-safari", pick: "edit" } },
      { text: "Tap the bookmark you just saved.", scene: { kind: "bookmarks", browser: "ios-safari", pick: "saved" } },
      { text: "Name it Draft Room. Clear the address, paste the code there, and tap Done.", scene: { kind: "edit", browser: "ios-safari" } },
    ],
    run: (page) => ({
      text: page === "espn" ? "On your ESPN page, tap the book icon, then Draft Room." : "Tap the book icon, then Draft Room.",
      scene: { kind: "bookmarks", browser: "ios-safari", pick: "draft-room", page },
    }),
    causes: [
      "The address still starts with https. Edit the bookmark, clear the whole address, and paste the code again.",
      "Only part of the code was pasted. Copy it again and paste it into an empty address.",
      "A content blocker is on for this site. Turn it off for draftroom.online and ESPN in Settings → Safari → Extensions.",
    ],
  },
  "ios-chrome": {
    label: "iPhone Chrome",
    save: [
      { text: "Bookmark this page: tap the three-dot menu, then Add to Bookmarks.", scene: { kind: "menu", browser: "ios-chrome", rows: CHROME_MENU, pick: "Add to Bookmarks" } },
      {
        text: "Open the menu again and tap Bookmarks. Touch and hold the one you just saved, then tap Edit Bookmark.",
        scene: { kind: "bookmarks", browser: "ios-chrome", pick: "held" },
      },
      { text: "Name it Draft Room, replace its URL with the code, and tap Done.", scene: { kind: "edit", browser: "ios-chrome" } },
    ],
    run: (page) => ({
      text: `${page === "espn" ? "On your ESPN page, tap" : "Tap"} the address bar, type Draft Room, and tap the bookmark with the star. Not the search.`,
      scene: { kind: "suggest", browser: "ios-chrome", page },
    }),
    causes: [
      "The search ran instead of the bookmark. Tap the line with the star, not the one with the magnifying glass.",
      "The URL still starts with https. Edit the bookmark and replace the whole URL with the code.",
      "Only part of the code was pasted. Copy it again and paste it into an empty URL.",
    ],
  },
  android: {
    label: "Android Chrome",
    save: [
      { text: "Bookmark this page: tap the three-dot menu, then the star.", scene: { kind: "star", browser: "android" } },
      { text: "Tap Edit on the message at the bottom. Missed it? Find the bookmark under the menu's Bookmarks and tap its pencil.", scene: { kind: "snackbar", browser: "android" } },
      { text: "Name it Draft Room, replace its URL with the code, then tap back to save.", scene: { kind: "edit", browser: "android" } },
    ],
    run: (page) => ({
      text: `${page === "espn" ? "On your ESPN page, tap" : "Tap"} the address bar, type Draft Room, and tap the bookmark with the star. Not the search.`,
      scene: { kind: "suggest", browser: "android", page },
    }),
    causes: [
      "The search ran instead of the bookmark. Tap the line with the star, not the one with the magnifying glass.",
      "The URL still starts with https. Edit the bookmark and replace the whole URL with the code.",
      "Only part of the code was pasted. Copy it again and paste it into an empty URL.",
    ],
  },
};

/** A computer: drag it to the bookmarks bar, click it there. */
export const DESKTOP = {
  save: { text: "Drag the Draft Room button to your bookmarks bar.", scene: { kind: "drag" } } satisfies Step,
  run: (page: "setup" | "espn"): Step => ({
    text: page === "espn" ? "On your ESPN page, click Draft Room in your bookmarks bar." : "Click Draft Room in your bookmarks bar.",
    scene: { kind: "click", page },
  }),
  causes: [
    "No bookmarks bar? Show it with Ctrl+Shift+B (⌘+Shift+B on a Mac), then drag the button again.",
    "The button was dropped as a link to this page. Delete that bookmark and drag the green button itself.",
    "A content blocker is on for this site. Allow draftroom.online and ESPN.",
  ],
};

/** Which phone browser this is. Chrome on iOS says CriOS; it shares Safari's engine but not its menus. */
export function detectBrowser(ua: string): Browser {
  return /android/i.test(ua) ? "android" : /CriOS/.test(ua) ? "ios-chrome" : "ios-safari";
}
