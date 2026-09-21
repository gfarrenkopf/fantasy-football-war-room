import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Set so OpenGraph images and canonical URLs resolve on the hosted deployment. It is the one
 * place outside config.ts that needs the public origin, and it falls back to the production
 * domain rather than throwing, because the app must boot with no environment at all.
 */
const SITE = "https://draftroom.online";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Fantasy War Room", template: "%s" },
  description: "Know who to pick in your fantasy football draft.",
  openGraph: {
    type: "website",
    siteName: "Fantasy War Room",
    title: "Fantasy War Room",
    description: "Know who to pick. Practice drafts of your league show who will still be there at your next turn.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fantasy War Room",
    description: "Know who to pick. Practice drafts of your league show who will still be there at your next turn.",
  },
};

/**
 * `viewport-fit=cover` lets the layout reach under the notch and home indicator; the war room
 * pays the insets back with env(safe-area-inset-*) on the header and the mobile action bar.
 * Zoom is deliberately not capped — a draft room read in a dim room needs it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1a1e25",
};

/**
 * The direction contract for this build, emitted as a real HTML comment so it survives the
 * production build and can be audited against the render. Hidden, inert, and greppable by seed key.
 */
const DIRECTION_CONTRACT = `<!--
THESIS: A dim room with one lit board. The landing page is a war room already running - a real
mock draft of the visitor's own league - with one translucent panel over it holding the entire
decision. It refuses the category default: a centred headline above a screenshot in a browser
frame. Here the screenshot is the room, and you are already in it.
OWN-WORLD: DESIGN.md's Situation Room, unchanged. #1a1e25 ground, #22272f panels, 1px hairlines
instead of shadows, six position hues as 3px card rails, tabular numerals, outlined sky-tinted
primary. The floating panel is the only lift on the page, because it floats.
STORY: A manager arrives minutes before a draft, sees a real board being drafted and real survival
odds resolving for their slot, and either signs in or starts drafting in seconds.
FIRST VIEWPORT: Full-bleed six-column board at 100dvh, one pick logged every 1.4s. Over it, left,
one panel: brand, thesis, the compact league setup, the outlined primary "Open the war room", then
a hairline and the sign-in block. Sample-data label bottom right.
FORM: The Lit Board - ranked 1 of 7 on the grounded list, locked by the user over the dealt lead.
Seed key 94984e6d. Signature interaction: editing teams / slot / scoring re-simulates the board
behind the panel, so the proof is always this visitor's own draft.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <div hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        {children}
      </body>
    </html>
  );
}
