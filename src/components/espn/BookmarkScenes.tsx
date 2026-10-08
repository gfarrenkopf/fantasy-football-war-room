import { useId, type ReactNode } from "react";

/**
 * Drawn, not screenshotted (APE-334): one device frame, one callout style and one set of icons for
 * every browser, so iPhone Safari, iPhone Chrome and Android Chrome read as one set of instructions,
 * and nothing goes stale when a browser nudges a pixel. Only each browser's own controls differ, and
 * they're simplified to the ones a step points at. Colors are the app's tokens; the scenes carry no
 * real ESPN content, no personal bookmarks and no status bar.
 *
 * A scene is data (`Scene`), drawn by `BookmarkScene`. The thing to tap carries the callout: a
 * green ring and a tap mark, the only animated part, held still under reduced motion.
 */

export type Browser = "ios-safari" | "ios-chrome" | "android";

export type Scene =
  /** The setup page with its Copy button. */
  | { kind: "copy"; browser: Browser }
  /** Safari's share sheet, Add Bookmark picked. */
  | { kind: "share"; browser: "ios-safari" }
  /** A browser's own menu, one row picked. */
  | { kind: "menu"; browser: Browser; pick: string; rows: string[] }
  /** Android Chrome's menu, the star in its icon row picked. */
  | { kind: "star"; browser: "android" }
  /** Android's "Bookmarked" message, its Edit picked. */
  | { kind: "snackbar"; browser: "android" }
  /** The bookmarks list: Safari's Edit button, or one bookmark (and a held bookmark's Edit Bookmark). */
  | { kind: "bookmarks"; browser: Browser; pick: "edit" | "saved" | "held" | "draft-room"; page?: "setup" | "espn" }
  /** Editing the saved bookmark: named Draft Room, the code pasted as its address. */
  | { kind: "edit"; browser: Browser }
  /** Typing Draft Room in the address bar: the bookmark picked, not the search. */
  | { kind: "suggest"; browser: Browser; page: "setup" | "espn" }
  /** A computer: the button dragged to the bookmarks bar. */
  | { kind: "drag" }
  /** A computer: the bookmark clicked in the bookmarks bar. */
  | { kind: "click"; page: "setup" | "espn" };

const W = 240;
const H = 300;
/** The screen inside the phone. */
const S = { x: 30, y: 12, w: 180, h: 276 };
const C = {
  ink: "var(--color-text)",
  muted: "var(--color-muted)",
  dim: "var(--color-dim)",
  bg: "var(--color-bg)",
  panel: "var(--color-panel)",
  panel2: "var(--color-panel2)",
  line: "var(--color-line)",
  line2: "var(--color-line2)",
  mine: "var(--color-mine)",
  mineInk: "var(--color-mine-ink)",
  wash: "color-mix(in srgb, var(--color-mine) 16%, transparent)",
  scrim: "color-mix(in srgb, var(--color-bg) 70%, transparent)",
};
const FONT = { fontFamily: "var(--font-sans)" } as const;

/* ---------------- primitives ---------------- */

function Text({ x, y, size = 8, weight = 400, fill = C.ink, anchor = "start", children }: { x: number; y: number; size?: number; weight?: number; fill?: string; anchor?: "start" | "middle" | "end"; children: ReactNode }) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor} dominantBaseline="middle" style={FONT}>
      {children}
    </text>
  );
}

/** The callout: a ring around the thing to tap, washed green, and a tap mark on it. */
function Pick({ x, y, w, h, r = 5, tap = true }: { x: number; y: number; w: number; h: number; r?: number; tap?: boolean }) {
  return (
    <g>
      <rect x={x - 2} y={y - 2} width={w + 4} height={h + 4} rx={r + 2} fill={C.wash} stroke={C.mine} strokeWidth={1.75} />
      {tap && (
        <g transform={`translate(${x + w - 6} ${y + h - 2})`}>
          <circle r={9} fill={C.mine} opacity={0.22} className="origin-center [transform-box:fill-box] motion-safe:animate-[bookmark-tap_1.6s_cubic-bezier(0.16,1,0.3,1)_infinite]" />
          <circle r={4} fill={C.mine} stroke={C.bg} strokeWidth={1.5} />
        </g>
      )}
    </g>
  );
}

/** A line of placeholder text: what a page looks like from arm's length. */
const Bar = ({ x, y, w, h = 5, fill = C.line2 }: { x: number; y: number; w: number; h?: number; fill?: string }) => <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} />;

/* Icons, one stroke weight, drawn at 12×12 around (0,0) top-left. */
const stroke = { fill: "none", stroke: C.muted, strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Icon = {
  back: () => <path d="M8 2 3 6l5 4" {...stroke} />,
  forward: () => <path d="M4 2l5 4-5 4" {...stroke} />,
  share: () => (
    <g {...stroke}>
      <path d="M6 1v7M3.5 3.5 6 1l2.5 2.5" />
      <path d="M3.5 5.5H2.5v6h7v-6h-1" />
    </g>
  ),
  book: () => (
    <g {...stroke}>
      <path d="M6 3.2C4.7 2.2 3 2 1 2.2v7.6c2-.2 3.7 0 5 1 1.3-1 3-1.2 5-1V2.2c-2-.2-3.7 0-5 1Z" />
      <path d="M6 3.2v7.6" />
    </g>
  ),
  tabs: () => (
    <g {...stroke}>
      <rect x={1.5} y={3.5} width={7} height={7} rx={1.5} />
      <path d="M4 1.5h5a1.5 1.5 0 0 1 1.5 1.5v5" />
    </g>
  ),
  plus: () => <path d="M6 1.5v9M1.5 6h9" {...stroke} />,
  dotsH: () => (
    <g fill={C.muted}>
      <circle cx={2} cy={6} r={1.2} />
      <circle cx={6} cy={6} r={1.2} />
      <circle cx={10} cy={6} r={1.2} />
    </g>
  ),
  dotsV: () => (
    <g fill={C.muted}>
      <circle cx={6} cy={2} r={1.2} />
      <circle cx={6} cy={6} r={1.2} />
      <circle cx={6} cy={10} r={1.2} />
    </g>
  ),
  star: ({ on = false }: { on?: boolean }) => (
    <path d="M6 1.2l1.45 3 3.3.42-2.42 2.27.62 3.27L6 8.58 3.05 10.16l.62-3.27L1.25 4.62l3.3-.42Z" {...stroke} stroke={on ? C.mine : C.muted} fill={on ? C.wash : "none"} />
  ),
  search: () => (
    <g {...stroke}>
      <circle cx={5} cy={5} r={3.5} />
      <path d="m7.6 7.6 3 3" />
    </g>
  ),
  download: () => <path d="M6 1.5v7M3 5.5l3 3 3-3M2 10.5h8" {...stroke} />,
  info: () => (
    <g {...stroke}>
      <circle cx={6} cy={6} r={4.6} />
      <path d="M6 5.5v3M6 3.6v.1" />
    </g>
  ),
  reload: () => <path d="M10 6a4 4 0 1 1-1.2-2.85M10 1.5v2.4H7.6" {...stroke} />,
  copy: () => (
    <g {...stroke}>
      <rect x={3.5} y={3.5} width={7} height={7} rx={1.5} />
      <path d="M8.5 1.5h-6a1 1 0 0 0-1 1v6" />
    </g>
  ),
  folder: () => <path d="M1.5 3a1 1 0 0 1 1-1h2.5l1.2 1.4h3.8a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1Z" {...stroke} />,
  bookmark: () => <path d="M3 1.5h6v9L6 8.3 3 10.5Z" {...stroke} />,
  code: () => <path d="M4 3 1.5 6 4 9M8 3l2.5 3L8 9" {...stroke} />,
};
const At = ({ x, y, children }: { x: number; y: number; children: ReactNode }) => <g transform={`translate(${x} ${y})`}>{children}</g>;

/* ---------------- pages ---------------- */

/** Which page a scene happens on: the setup page here, or an ESPN league page. */
function Page({ page, top }: { page: "setup" | "espn"; top: number }) {
  const x = S.x + 14;
  if (page === "espn")
    return (
      <g>
        <rect x={S.x} y={top} width={S.w} height={22} fill={C.panel2} />
        <Text x={x} y={top + 11} size={8.5} weight={700}>
          Fantasy Football
        </Text>
        <Text x={x} y={top + 38} size={10} weight={700}>
          Standings
        </Text>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <g key={i}>
            <Bar x={x} y={top + 54 + i * 15} w={12} fill={C.line} />
            <Bar x={x + 18} y={top + 54 + i * 15} w={70 - i * 6} />
            <Bar x={S.x + S.w - 38} y={top + 54 + i * 15} w={24} fill={C.line} />
          </g>
        ))}
      </g>
    );
  return (
    <g>
      <Text x={x} y={top + 18} size={10.5} weight={700}>
        Add the Draft Room
      </Text>
      <Text x={x} y={top + 31} size={10.5} weight={700}>
        bookmark
      </Text>
      <Bar x={x} y={top + 44} w={128} fill={C.line} />
      <Bar x={x} y={top + 54} w={96} fill={C.line} />
      <rect x={x} y={top + 70} width={S.w - 28} height={20} rx={5} fill={C.mine} />
      <Text x={S.x + S.w / 2} y={top + 80} size={8} weight={700} fill={C.mineInk} anchor="middle">
        Copy bookmark code
      </Text>
    </g>
  );
}

/* ---------------- browser chrome ---------------- */

/** Where each browser keeps its address bar and toolbar, and where its menu button sits. */
const LAYOUT: Record<Browser, { address: number; toolbar: number | null; content: number; menu: { x: number; y: number } }> = {
  // Safari: address bar and toolbar both at the bottom.
  "ios-safari": { address: S.y + S.h - 50, toolbar: S.y + S.h - 24, content: S.y + 10, menu: { x: 0, y: 0 } },
  // Chrome on iPhone: address bar on top, toolbar (with ⋯) at the bottom.
  "ios-chrome": { address: S.y + 10, toolbar: S.y + S.h - 24, content: S.y + 32, menu: { x: S.x + 150, y: S.y + S.h - 24 } },
  // Chrome on Android: address bar on top, ⋮ beside it, no bottom toolbar.
  android: { address: S.y + 10, toolbar: null, content: S.y + 32, menu: { x: S.x + S.w - 18, y: S.y + 12 } },
};

function AddressBar({ browser, url, typed }: { browser: Browser; url: string; typed?: string }) {
  const y = LAYOUT[browser].address;
  const right = browser === "android" ? 26 : 10;
  return (
    <g>
      <rect x={S.x + 10} y={y} width={S.w - 10 - right} height={18} rx={9} fill={typed ? C.panel : C.panel2} stroke={typed ? C.line2 : "none"} />
      {typed ? (
        <>
          <Text x={S.x + 20} y={y + 9} size={8} weight={600}>
            {typed}
          </Text>
          <rect x={S.x + 20 + typed.length * 4.3} y={y + 4} width={1} height={10} fill={C.mine} />
        </>
      ) : (
        <Text x={S.x + (S.w - right + 10) / 2} y={y + 9} size={7.5} fill={C.muted} anchor="middle">
          {url}
        </Text>
      )}
      {browser === "android" && (
        <At x={S.x + S.w - 18} y={y + 3}>
          <Icon.dotsV />
        </At>
      )}
    </g>
  );
}

function Toolbar({ browser, pick }: { browser: Browser; pick?: "share" | "book" | "menu" }) {
  const y = LAYOUT[browser].toolbar;
  if (y === null) return null;
  const icons =
    browser === "ios-safari"
      ? ([
          ["back", Icon.back],
          ["forward", Icon.forward],
          ["share", Icon.share],
          ["book", Icon.book],
          ["tabs", Icon.tabs],
        ] as const)
      : ([
          ["back", Icon.back],
          ["forward", Icon.forward],
          ["plus", Icon.plus],
          ["tabs", Icon.tabs],
          ["menu", Icon.dotsH],
        ] as const);
  const step = (S.w - 20) / icons.length;
  return (
    <g>
      {icons.map(([name, Draw], i) => {
        const cx = S.x + 10 + step * i + step / 2;
        return (
          <g key={name}>
            <At x={cx - 6} y={y + 6}>
              <Draw />
            </At>
            {pick === name && <Pick x={cx - 9} y={y + 3} w={18} h={18} r={6} />}
          </g>
        );
      })}
    </g>
  );
}

/** A sheet or menu: a panel of rows, one of them picked. */
function Rows({ x, y, w, rows, pick, icon }: { x: number; y: number; w: number; rows: string[]; pick?: string; icon?: (row: string, i: number) => ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={rows.length * 19 + 6} rx={8} fill={C.panel2} stroke={C.line2} />
      {rows.map((row, i) => {
        const ry = y + 3 + i * 19;
        return (
          <g key={row}>
            {i > 0 && <rect x={x + 8} y={ry} width={w - 16} height={0.75} fill={C.line2} />}
            {icon && <At x={x + 9} y={ry + 3.5}>{icon(row, i)}</At>}
            <Text x={x + (icon ? 27 : 10)} y={ry + 9.5} size={8} weight={row === pick ? 700 : 400}>
              {row}
            </Text>
            {row === pick && <Pick x={x + 4} y={ry + 1.5} w={w - 8} h={16} />}
          </g>
        );
      })}
    </g>
  );
}

const Scrim = () => <rect x={S.x} y={S.y} width={S.w} height={S.h} fill={C.scrim} />;

/** A field in an edit form: its label and value, the address one picked. */
function Field({ y, label, value, picked = false, mono = false }: { y: number; label: string; value: string; picked?: boolean; mono?: boolean }) {
  return (
    <g>
      <Text x={S.x + 14} y={y} size={7} fill={C.muted}>
        {label}
      </Text>
      <rect x={S.x + 12} y={y + 6} width={S.w - 24} height={20} rx={5} fill={C.panel2} stroke={C.line2} />
      <Text x={S.x + 20} y={y + 16} size={mono ? 7 : 8.5} weight={mono ? 400 : 600} fill={mono ? C.muted : C.ink}>
        {value}
      </Text>
      {picked && <Pick x={S.x + 12} y={y + 6} w={S.w - 24} h={20} />}
    </g>
  );
}

/** The keyboard that's up while a field is edited: rows of keys, enough to read as typing. */
function Keyboard() {
  const top = S.y + S.h - 92;
  const rows = [10, 9, 7];
  const key = (S.w - 16) / 10;
  return (
    <g>
      <rect x={S.x} y={top} width={S.w} height={92} fill={C.panel2} />
      {rows.map((n, r) =>
        Array.from({ length: n }, (_, i) => (
          <rect key={`${r}-${i}`} x={S.x + 8 + (S.w - 16 - n * key) / 2 + i * key + 1.5} y={top + 8 + r * 20} width={key - 3} height={15} rx={3} fill={C.line2} />
        )),
      )}
      <rect x={S.x + 8 + key * 2} y={top + 68} width={key * 6} height={15} rx={3} fill={C.line2} />
    </g>
  );
}

/* ---------------- scenes ---------------- */

const SETUP_URL = "draftroom.online";
const ESPN_URL = "fantasy.espn.com";

function PhoneScene({ scene }: { scene: Exclude<Scene, { kind: "drag" } | { kind: "click" }> }) {
  const browser = scene.browser;
  const layout = LAYOUT[browser];
  const page = "page" in scene && scene.page ? scene.page : "setup";
  const url = page === "espn" ? ESPN_URL : SETUP_URL;
  const base = (pick?: "share" | "book" | "menu") => (
    <>
      <Page page={page} top={layout.content} />
      <AddressBar browser={browser} url={url} />
      <Toolbar browser={browser} pick={pick} />
    </>
  );

  switch (scene.kind) {
    case "copy":
      return (
        <>
          {base()}
          <Pick x={S.x + 14} y={layout.content + 70} w={S.w - 28} h={20} />
        </>
      );
    case "share":
      return (
        <>
          {base()}
          <Scrim />
          <rect x={S.x} y={S.y + 96} width={S.w} height={S.h - 96} rx={14} fill={C.panel} />
          <Bar x={S.x + S.w / 2 - 14} y={S.y + 102} w={28} h={3} fill={C.line2} />
          <Rows
            x={S.x + 10}
            y={S.y + 116}
            w={S.w - 20}
            rows={["Copy", "Add to Reading List", "Add Bookmark", "Add to Favorites"]}
            pick="Add Bookmark"
            icon={(row) => (row === "Copy" ? <Icon.copy /> : row === "Add Bookmark" ? <Icon.book /> : row === "Add to Favorites" ? <Icon.star /> : <Icon.bookmark />)}
          />
        </>
      );
    case "menu": {
      const above = layout.toolbar !== null;
      const w = 120;
      const h = scene.rows.length * 19 + 6;
      const x = S.x + S.w - w - 8;
      const y = above ? (layout.toolbar as number) - h - 6 : S.y + 32;
      return (
        <>
          {base()}
          <Scrim />
          <Rows x={x} y={y} w={w} rows={scene.rows} pick={scene.pick} />
        </>
      );
    }
    case "star": {
      const x = S.x + S.w - 128;
      const y = S.y + 30;
      const icons = [Icon.forward, Icon.star, Icon.download, Icon.info, Icon.reload];
      return (
        <>
          {base()}
          <Scrim />
          <rect x={x} y={y} width={120} height={104} rx={8} fill={C.panel2} stroke={C.line2} />
          {icons.map((Draw, i) => (
            <g key={i}>
              <At x={x + 10 + i * 22} y={y + 8}>
                <Draw />
              </At>
              {i === 1 && <Pick x={x + 6 + i * 22} y={y + 4} w={20} h={20} r={6} />}
            </g>
          ))}
          {["New tab", "Bookmarks", "History"].map((row, i) => (
            <Text key={row} x={x + 10} y={y + 42 + i * 20} size={8}>
              {row}
            </Text>
          ))}
        </>
      );
    }
    case "snackbar":
      return (
        <>
          {base()}
          <rect x={S.x + 10} y={S.y + S.h - 40} width={S.w - 20} height={26} rx={6} fill={C.panel2} stroke={C.line2} />
          <Text x={S.x + 20} y={S.y + S.h - 27} size={8}>
            Bookmarked
          </Text>
          <Text x={S.x + S.w - 26} y={S.y + S.h - 27} size={8} weight={700} fill={C.mine} anchor="end">
            Edit
          </Text>
          <Pick x={S.x + S.w - 50} y={S.y + S.h - 36} w={28} h={18} />
        </>
      );
    case "bookmarks": {
      const top = S.y + 26;
      // The page's own title is what a fresh bookmark is called; the finished one is Draft Room.
      const saved = scene.pick === "draft-room" ? "Draft Room" : "Your ESPN bookmark · Dr…";
      const rows = ["Favorites", "Reading List", saved];
      const editPicked = scene.pick === "edit";
      return (
        <>
          {base()}
          <Scrim />
          <rect x={S.x} y={top} width={S.w} height={S.h - (top - S.y)} rx={14} fill={C.panel} />
          <Text x={S.x + S.w / 2} y={top + 14} size={9} weight={700} anchor="middle">
            Bookmarks
          </Text>
          <Rows
            x={S.x + 10}
            y={top + 28}
            w={S.w - 20}
            rows={rows}
            pick={scene.pick === "saved" || scene.pick === "held" || scene.pick === "draft-room" ? saved : undefined}
            icon={(row) => (row === "Favorites" ? <Icon.star /> : row === "Reading List" ? <Icon.folder /> : <Icon.bookmark />)}
          />
          {scene.pick === "held" && <Rows x={S.x + S.w - 128} y={top + 96} w={118} rows={["Edit Bookmark", "Copy Link", "Delete"]} pick="Edit Bookmark" />}
          {browser === "ios-safari" && (
            <>
              <Text x={S.x + S.w - 18} y={S.y + S.h - 16} size={8.5} weight={editPicked ? 700 : 400} fill={editPicked ? C.ink : C.muted} anchor="end">
                Edit
              </Text>
              {editPicked && <Pick x={S.x + S.w - 40} y={S.y + S.h - 24} w={26} h={16} />}
            </>
          )}
        </>
      );
    }
    case "edit": {
      const done = browser === "android" ? null : "Done";
      return (
        <>
          <rect x={S.x} y={S.y} width={S.w} height={S.h} fill={C.panel} />
          {browser === "android" ? (
            <At x={S.x + 12} y={S.y + 14}>
              <Icon.back />
            </At>
          ) : null}
          <Text x={S.x + S.w / 2} y={S.y + 20} size={9} weight={700} anchor="middle">
            Edit Bookmark
          </Text>
          {done && (
            <>
              <Text x={S.x + S.w - 16} y={S.y + 20} size={8.5} weight={700} fill={C.mine} anchor="end">
                {done}
              </Text>
            </>
          )}
          <Field y={S.y + 50} label="Name" value="Draft Room" />
          <Field y={S.y + 92} label={browser === "ios-safari" ? "Address" : "URL"} value="javascript:(()=>{const s=…" picked mono />
          <At x={S.x + S.w - 30} y={S.y + 104}>
            <Icon.code />
          </At>
          <Keyboard />
          {browser === "android" && <Pick x={S.x + 8} y={S.y + 10} w={16} h={16} tap={false} />}
          {done && <Pick x={S.x + S.w - 40} y={S.y + 12} w={26} h={16} tap={false} />}
        </>
      );
    }
    case "suggest": {
      const y = layout.address;
      const dropY = browser === "ios-safari" ? y - 50 : y + 24;
      return (
        <>
          <Page page={page} top={layout.content} />
          <Scrim />
          <AddressBar browser={browser} url={url} typed="Draft Room" />
          <Toolbar browser={browser} />
          <rect x={S.x + 8} y={dropY} width={S.w - 16} height={44} rx={8} fill={C.panel2} stroke={C.line2} />
          <At x={S.x + 16} y={dropY + 5}>
            <Icon.star on />
          </At>
          <Text x={S.x + 34} y={dropY + 11} size={8} weight={700}>
            Draft Room
          </Text>
          <Pick x={S.x + 11} y={dropY + 3} w={S.w - 22} h={17} />
          <rect x={S.x + 16} y={dropY + 22} width={S.w - 32} height={0.75} fill={C.line2} />
          <At x={S.x + 16} y={dropY + 27}>
            <Icon.search />
          </At>
          <Text x={S.x + 34} y={dropY + 33} size={8} fill={C.dim}>
            draft room — search
          </Text>
        </>
      );
    }
  }
}

/** A computer's browser window: tab, address bar and bookmarks bar. */
function DesktopScene({ scene }: { scene: Extract<Scene, { kind: "drag" } | { kind: "click" }> }) {
  const x = 8;
  const y = 40;
  const w = W - 16;
  const page = scene.kind === "click" ? scene.page : "setup";
  return (
    <g>
      <rect x={x} y={y} width={w} height={210} rx={10} fill={C.bg} stroke={C.line2} strokeWidth={1.5} />
      <path d={`M${x} ${y + 10}a10 10 0 0 1 10-10h${w - 20}a10 10 0 0 1 10 10v24H${x}Z`} fill={C.panel} />
      <rect x={x + 14} y={y + 9} width={w - 28} height={16} rx={8} fill={C.panel2} />
      <Text x={x + w / 2} y={y + 17} size={7.5} fill={C.muted} anchor="middle">
        {page === "espn" ? ESPN_URL : SETUP_URL}
      </Text>
      <rect x={x} y={y + 34} width={w} height={18} fill={C.panel} />
      <rect x={x} y={y + 52} width={w} height={0.75} fill={C.line2} />
      {scene.kind === "click" ? (
        <>
          <At x={x + 12} y={y + 37}>
            <Icon.bookmark />
          </At>
          <Text x={x + 28} y={y + 43} size={8} weight={700}>
            Draft Room
          </Text>
          <Pick x={x + 9} y={y + 36} w={64} h={14} />
        </>
      ) : (
        <>
          <rect x={x + 10} y={y + 37} width={56} height={12} rx={4} fill="none" stroke={C.mine} strokeDasharray="3 2" />
          <Text x={x + 76} y={y + 43} size={7} fill={C.dim}>
            Bookmarks bar
          </Text>
        </>
      )}
      <g transform={`translate(${x + 44} ${y + 66})`}>
        {page === "espn" ? (
          <>
            <Text x={0} y={10} size={10} weight={700}>
              Standings
            </Text>
            {[0, 1, 2, 3, 4].map((i) => (
              <Bar key={i} x={0} y={24 + i * 14} w={120 - i * 10} />
            ))}
          </>
        ) : (
          <>
            <Text x={0} y={10} size={10.5} weight={700}>
              Add the Draft Room bookmark
            </Text>
            <Bar x={0} y={22} w={140} fill={C.line} />
            <Bar x={0} y={32} w={110} fill={C.line} />
          </>
        )}
      </g>
      {scene.kind === "drag" && (
        <>
          <path d={`M${x + 58} ${y + 157} C ${x + 18} ${y + 150}, ${x + 14} ${y + 96}, ${x + 30} ${y + 56}`} fill="none" stroke={C.mine} strokeWidth={1.5} strokeDasharray="4 3" />
          <path d={`M${x + 24} ${y + 61} l6 -6 4 8`} fill="none" stroke={C.mine} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          <rect x={x + 60} y={y + 146} width={72} height={22} rx={6} fill={C.mine} />
          <Text x={x + 96} y={y + 157} size={8.5} weight={700} fill={C.mineInk} anchor="middle">
            Draft Room
          </Text>
          <g transform={`translate(${x + 124} ${y + 164})`}>
            <circle r={9} fill={C.mine} opacity={0.22} className="origin-center [transform-box:fill-box] motion-safe:animate-[bookmark-tap_1.6s_cubic-bezier(0.16,1,0.3,1)_infinite]" />
            <circle r={4} fill={C.mine} stroke={C.bg} strokeWidth={1.5} />
          </g>
        </>
      )}
    </g>
  );
}

/** One step, drawn. `label` is the step's own words, read out in its place. */
export function BookmarkScene({ scene, label, className }: { scene: Scene; label: string; className?: string }) {
  const clip = useId();
  const desktop = scene.kind === "drag" || scene.kind === "click";
  return (
    // A computer's window is wider than it is tall: its scene is cropped to it.
    <svg viewBox={desktop ? `0 34 ${W} 222` : `0 0 ${W} ${H}`} role="img" aria-label={label} className={className}>
      {desktop ? (
        <DesktopScene scene={scene} />
      ) : (
        <>
          <rect x={S.x - 8} y={S.y - 8} width={S.w + 16} height={S.h + 16} rx={28} fill={C.panel} stroke={C.line2} strokeWidth={1.5} />
          <clipPath id={clip}>
            <rect x={S.x} y={S.y} width={S.w} height={S.h} rx={20} />
          </clipPath>
          <g clipPath={`url(#${clip})`}>
            <rect x={S.x} y={S.y} width={S.w} height={S.h} fill={C.bg} />
            <PhoneScene scene={scene} />
          </g>
        </>
      )}
    </svg>
  );
}
