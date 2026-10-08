"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SignIn } from "@/components/landing/SignIn";
import type { PublicFlags } from "@/lib/config";
import { bookmarkletFor } from "@/lib/espn/bookmarklet";
import { listenForEspnPaired } from "@/lib/espn/channel";
import { ESPN_FANTASY_HOME } from "@/lib/espn/pages";
import { hasWorkingBookmark, readSetupStep, setWorkingBookmark, writeSetupStep } from "@/lib/storage/bookmark";
import { BookmarkScene, type Browser } from "./BookmarkScenes";
import { DESKTOP, detectBrowser, GUIDES, type Step } from "./bookmarkSteps";
import { EspnLeagueCards, type EspnLeagueLink } from "./EspnLeagueCards";

/**
 * Connecting ESPN, a step at a time (APE-333). The bookmark is the hard part, above all on a phone,
 * so a first-timer is walked through it one screen per step with a drawing of each (APE-334), and
 * tries it on this page before leaving for ESPN: a bookmark that doesn't work is found here, where
 * there's help, not on ESPN, where it would just do nothing. Someone whose bookmark has worked on
 * this device goes straight to connecting.
 *
 * Only the steps for this device show (a "different browser?" switch covers a wrong guess), and only
 * the flow the user came for, the season or a draft, with the other a tap away.
 */

type Intent = "season" | "draft";
type Platform = Browser | "desktop";

/** The Draft Room league whose ESPN draft this is, and its ESPN draft page when it's connected. */
export interface DraftTarget {
  name: string;
  url: string | null;
}

/** How long the test waits for the bookmark before offering help. */
const TEST_PATIENCE_MS = 10_000;

const TOUCH = "(pointer: coarse)";

/** The steps for a platform, in order. "save-N" are its bookmark-saving steps. */
function stepsFor(platform: Platform, signedIn: boolean): string[] {
  const save = platform === "desktop" ? ["drag"] : ["copy", ...GUIDES[platform].save.map((_, i) => `save-${i}`)];
  return [...(signedIn ? [] : ["sign-in"]), ...save, "test", "connect"];
}

/** Which part of the setup a step belongs to, for the progress bar: a phone's save steps are one stage. */
const stageOf = (step: string) => (step.startsWith("save-") ? "save" : step);

export function SetupWizard({
  flags,
  signedIn,
  season,
  intent: asked,
  leagues,
  draft,
}: {
  flags: PublicFlags;
  signedIn: boolean;
  /** In-season help is on for this user, so there's a season to connect. */
  season: boolean;
  intent: Intent;
  leagues: EspnLeagueLink[];
  draft: DraftTarget | null;
}) {
  /** Null until mounted: the platform, and whether the bookmark already works here, are this device's. */
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [step, setStep] = useState<string>("connect");
  const [intent, setIntent] = useState<Intent>(asked);
  const [returning, setReturning] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    const touch = window.matchMedia(TOUCH).matches;
    const p: Platform = touch ? detectBrowser(navigator.userAgent) : "desktop";
    const works = hasWorkingBookmark();
    const steps = stepsFor(p, signedIn);
    const saved = readSetupStep(p);
    // A page reload mid-setup (Chrome leaves the page to edit a bookmark) picks up where it was.
    const start = saved && steps.includes(saved) ? saved : works ? "connect" : steps[0];
    // Mount-time read of this device's own facts, which the server can't know.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(p);
    setReturning(works);
    setStep(start);
  }, [signedIn]);

  const go = useCallback(
    (next: string) => {
      moved.current = true;
      setStep(next);
      if (platform) writeSetupStep(platform, next === "connect" ? null : next);
    },
    [platform],
  );

  // A new step is announced by moving focus to its heading, not just by redrawing.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [step]);

  if (!platform) return <Shell />;

  const steps = stepsFor(platform, signedIn);
  const at = Math.max(0, steps.indexOf(step));
  const next = () => go(steps[Math.min(at + 1, steps.length - 1)]);
  const back = at > 0 && !(returning && step === "connect") ? () => go(steps[at - 1]) : null;
  const stages = [...new Set(steps.map(stageOf))];
  const stage = stages.indexOf(stageOf(step));
  const setup = (from = platform === "desktop" ? "drag" : "copy") => {
    setWorkingBookmark(false);
    setReturning(false);
    go(from);
  };

  const progress =
    returning && step === "connect" ? null : (
      <Progress
        stage={stage}
        stages={stages.length}
        label={STAGE_LABEL[stageOf(step)] ?? ""}
        detail={step.startsWith("save-") && platform !== "desktop" ? `${Number(step.slice(5)) + 1} of ${GUIDES[platform].save.length}` : null}
      />
    );

  let body: ReactNode;
  if (step === "sign-in") {
    body = (
      <Screen
        heading={heading}
        title="Sign in first"
        lead="Connecting puts your ESPN league in your Draft Room account, so you'll need to be signed in when you connect. Signing in now saves a trip later."
        progress={progress}
        back={back}
        actions={<TextButton onClick={next}>Set up the bookmark first</TextButton>}
      >
        <div className="rounded-card border border-line bg-panel p-4">
          <SignIn flags={flags} title={null} fine="The link brings you back here, on whichever device you open it." next={`/espn?for=${intent}`} autoFocus primary />
        </div>
      </Screen>
    );
  } else if (step === "drag") {
    body = (
      <Screen
        heading={heading}
        title="Add the Draft Room bookmark"
        lead="One bookmark connects your ESPN league to Draft Room. Add it once, on this computer."
        progress={progress}
        back={back}
        actions={<PrimaryButton onClick={next}>It&apos;s in my bookmarks bar</PrimaryButton>}
      >
        <Figure step={DESKTOP.save} />
        <DragButton />
        <p className="text-muted">No bookmarks bar? Show it with Ctrl+Shift+B, or ⌘+Shift+B on a Mac.</p>
      </Screen>
    );
  } else if (step === "copy" && platform !== "desktop") {
    body = <CopyStep heading={heading} platform={platform} progress={progress} back={back} onCopied={next} />;
  } else if (step.startsWith("save-") && platform !== "desktop") {
    const i = Number(step.slice(5));
    const guide = GUIDES[platform];
    body = (
      <Screen
        heading={heading}
        title="Save it as a bookmark"
        progress={progress}
        back={back}
        actions={
          <PrimaryButton onClick={next}>{i === guide.save.length - 1 ? "Done. Try it out" : "Next"}</PrimaryButton>
        }
        foot={
          <BrowserSwitch
            platform={platform}
            onSwitch={(p) => {
              moved.current = true;
              setPlatform(p);
              setStep("save-0");
              writeSetupStep(p, "save-0");
            }}
          />
        }
      >
        <Figure step={guide.save[i]} />
      </Screen>
    );
  } else if (step === "test") {
    body = (
      <TestStep
        key={platform}
        heading={heading}
        platform={platform}
        progress={progress}
        back={back}
        onWorked={() => {
          setWorkingBookmark(true);
          next();
        }}
        onSkip={next}
        onStartOver={() => setup()}
      />
    );
  } else {
    body = (
      <ConnectStep
        heading={heading}
        platform={platform}
        intent={intent}
        season={season}
        leagues={leagues}
        draft={draft}
        progress={progress}
        back={back}
        onIntent={setIntent}
        onSetUpAgain={returning ? () => setup() : null}
      />
    );
  }

  return <Shell>{body}</Shell>;
}

const STAGE_LABEL: Record<string, string> = {
  "sign-in": "Sign in",
  drag: "Add the bookmark",
  copy: "Copy the code",
  save: "Save the bookmark",
  test: "Try it here",
  connect: "Connect on ESPN",
};

/* ---------------- frame ---------------- */

function Shell({ children }: { children?: ReactNode }) {
  return (
    <main className="min-h-dvh bg-bg font-sans text-[14px] text-text selection:bg-mine/30">
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
    </main>
  );
}

/** Where the user is: one bar per stage, done ones filled, this one brightest. */
function Progress({ stage, stages, label, detail }: { stage: number; stages: number; label: string; detail: string | null }) {
  return (
    <div className="flex-1 space-y-1.5" aria-label={`Step ${stage + 1} of ${stages}: ${label}`} role="group">
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: stages }, (_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i < stage ? "bg-mine/55" : i === stage ? "bg-mine" : "bg-line2"}`} />
        ))}
      </div>
      <p className="text-[12px] text-muted" aria-hidden>
        <span className="font-semibold text-text">{label}</span>
        {detail && <span> · {detail}</span>}
      </p>
    </div>
  );
}

/** One step's screen: back and progress on top, the step in the middle, its actions in thumb reach at the bottom. */
function Screen({
  heading,
  title,
  lead,
  progress,
  back,
  actions,
  foot,
  children,
}: {
  heading: React.RefObject<HTMLHeadingElement | null>;
  title: string;
  lead?: ReactNode;
  progress: ReactNode;
  back: (() => void) | null;
  actions?: ReactNode;
  foot?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="flex min-h-9 items-start gap-3">
        {back && (
          <button type="button" onClick={back} className="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-card text-muted hover:bg-panel hover:text-text" aria-label="Back">
            <svg viewBox="0 0 12 12" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M7.5 2.5 4 6l3.5 3.5" />
            </svg>
          </button>
        )}
        {progress}
      </div>
      <section key={title} className="mt-6 flex flex-1 flex-col motion-safe:animate-[setup-step_320ms_cubic-bezier(0.16,1,0.3,1)]">
        <h1 ref={heading} tabIndex={-1} className="text-[24px] leading-tight font-bold tracking-[-0.01em] text-balance outline-none">
          {title}
        </h1>
        {lead && <p className="mt-2 max-w-[60ch] text-[15px] leading-normal text-muted">{lead}</p>}
        <div className="mt-5 space-y-4 text-[15px] leading-normal">{children}</div>
        <div className="mt-auto space-y-2 pt-6">
          {actions}
          {foot}
        </div>
      </section>
    </>
  );
}

/** A step drawn above its own words. */
function Figure({ step }: { step: Step }) {
  return (
    <figure className="space-y-4">
      <BookmarkScene
        scene={step.scene}
        label={step.text}
        className={`mx-auto block h-auto w-full max-h-[42dvh] ${step.scene.kind === "drag" || step.scene.kind === "click" ? "max-w-[360px]" : "max-w-[240px]"}`}
      />
      <figcaption className="text-[15px] leading-normal text-balance">{step.text}</figcaption>
    </figure>
  );
}

const primary =
  "flex h-12 w-full items-center justify-center gap-2 rounded-card bg-mine px-4 text-[15px] font-bold text-mine-ink no-underline transition-[filter] hover:brightness-110 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

function PrimaryButton({ onClick, children, disabled }: { onClick(): void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className={primary} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function TextButton({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex h-11 w-full items-center justify-center rounded-card text-[14px] font-semibold text-muted hover:text-text">
      {children}
    </button>
  );
}

const Check = () => (
  <svg viewBox="0 0 12 12" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="m2.5 6.5 2.3 2.3 4.7-5" />
  </svg>
);

/* ---------------- steps ---------------- */

/** The bookmark itself, for a computer: dragged to the bookmarks bar. */
function DragButton() {
  const link = useRef<HTMLAnchorElement>(null);
  // React blocks javascript: URLs in href, so the dragged bookmark's href is set directly once mounted.
  useEffect(() => link.current?.setAttribute("href", bookmarkletFor(location.origin)), []);
  return (
    <div className="flex items-center gap-3 rounded-card border border-dashed border-mine/60 bg-mine/[0.07] p-4">
      <a
        ref={link}
        className="cursor-grab whitespace-nowrap rounded-card bg-mine px-4 py-2 font-bold text-mine-ink no-underline active:cursor-grabbing"
        onClick={(e) => e.preventDefault()}
        draggable
        title="Drag me to your bookmarks bar"
      >
        Draft Room
      </a>
      <span className="text-muted">Drag this to your bookmarks bar</span>
    </div>
  );
}

function CopyStep({
  heading,
  platform,
  progress,
  back,
  onCopied,
}: {
  heading: React.RefObject<HTMLHeadingElement | null>;
  platform: Browser;
  progress: ReactNode;
  back: (() => void) | null;
  onCopied(): void;
}) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const code = bookmarkletFor(location.origin);
  useEffect(() => {
    if (copied !== "done") return;
    const t = setTimeout(onCopied, 700);
    return () => clearTimeout(t);
  }, [copied, onCopied]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }
  return (
    <Screen
      heading={heading}
      title="Add the Draft Room bookmark"
      lead="One bookmark connects your ESPN league to Draft Room. It takes about two minutes, once on this phone."
      progress={progress}
      back={back}
      actions={
        copied === "failed" ? (
          <PrimaryButton onClick={onCopied}>I&apos;ve copied it</PrimaryButton>
        ) : (
          <PrimaryButton onClick={copy} disabled={copied === "done"}>
            {copied === "done" ? (
              <>
                <Check /> Copied
              </>
            ) : (
              "Copy bookmark code"
            )}
          </PrimaryButton>
        )
      }
    >
      <Figure step={{ text: `First, copy the code the bookmark runs. Next you'll save a bookmark in ${GUIDES[platform].label} and paste this in as its address.`, scene: { kind: "copy", browser: platform } }} />
      {copied === "failed" && (
        <div className="space-y-2">
          <p className="text-warn-ink" role="alert">
            Couldn&apos;t copy it for you. Select all of this and copy it:
          </p>
          <textarea readOnly className="h-24 w-full rounded-card border border-line2 bg-panel2 p-2 font-mono text-[12px]" value={code} onFocus={(e) => e.target.select()} />
        </div>
      )}
    </Screen>
  );
}

/** The guess at the browser was wrong: show another's steps. */
function BrowserSwitch({ platform, onSwitch }: { platform: Browser; onSwitch(p: Browser): void }) {
  const others = (Object.keys(GUIDES) as Browser[]).filter((b) => b !== platform);
  return (
    <p className="text-center text-[13px] text-muted">
      Not on {GUIDES[platform].label}?{" "}
      {others.map((b, i) => (
        <span key={b}>
          {i > 0 && " or "}
          <button type="button" className="font-semibold text-sky underline decoration-sky-line underline-offset-4 hover:decoration-sky" onClick={() => onSwitch(b)}>
            {GUIDES[b].label}
          </button>
        </span>
      ))}
    </p>
  );
}

/**
 * Running the bookmark here, where Draft Room can tell it worked: the bridge, run on Draft Room's own
 * page, says so with a message instead of looking for a draft (APE-331).
 */
function TestStep({
  heading,
  platform,
  progress,
  back,
  onWorked,
  onSkip,
  onStartOver,
}: {
  heading: React.RefObject<HTMLHeadingElement | null>;
  platform: Platform;
  progress: ReactNode;
  back: (() => void) | null;
  onWorked(): void;
  onSkip(): void;
  onStartOver(): void;
}) {
  const [state, setState] = useState<"waiting" | "slow" | "worked">("waiting");
  const run = platform === "desktop" ? DESKTOP.run("setup") : GUIDES[platform].run("setup");
  const causes = platform === "desktop" ? DESKTOP.causes : GUIDES[platform].causes;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.type === "warroom-bridge-ready") setState("worked");
    };
    window.addEventListener("message", onMessage);
    const t = setTimeout(() => setState((s) => (s === "waiting" ? "slow" : s)), TEST_PATIENCE_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (state !== "worked") return;
    const t = setTimeout(onWorked, 1600);
    return () => clearTimeout(t);
  }, [state, onWorked]);

  return (
    <Screen
      heading={heading}
      title={state === "worked" ? "It works" : "Try it here first"}
      lead={state === "worked" ? "Your bookmark is ready. Next, the real thing on ESPN." : "Run the bookmark on this page, the same way you will on ESPN. Draft Room will see it."}
      progress={progress}
      back={state === "worked" ? null : back}
      actions={
        state === "worked" ? (
          <PrimaryButton onClick={onWorked}>Connect on ESPN</PrimaryButton>
        ) : (
          <>
            {state === "slow" && <PrimaryButton onClick={onStartOver}>Copy the code again</PrimaryButton>}
            <TextButton onClick={onSkip}>Skip the test</TextButton>
          </>
        )
      }
    >
      {state === "worked" ? (
        <div className="flex items-center gap-3 rounded-card border border-mine/55 bg-mine/[0.12] p-4 text-mine" role="status">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-mine text-mine-ink">
            <Check />
          </span>
          <span className="font-semibold">The bookmark ran on this page.</span>
        </div>
      ) : (
        <>
          <Figure step={run} />
          <p className="flex items-center gap-2 text-[13px] text-muted" role="status">
            <span className="size-2 rounded-full bg-warn motion-safe:animate-pulse" aria-hidden />
            Waiting for your bookmark…
          </p>
          {state === "slow" && (
            <div className="space-y-2 rounded-card border border-line bg-panel p-4" role="alert">
              <p className="font-semibold">Nothing yet? Usually it&apos;s one of these:</p>
              <ul className="list-disc space-y-1.5 pl-5 text-muted">
                {causes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Screen>
  );
}

/** Off to ESPN: open the league or the draft, run the bookmark there, and Connect. */
function ConnectStep({
  heading,
  platform,
  intent,
  season,
  leagues,
  draft,
  progress,
  back,
  onIntent,
  onSetUpAgain,
}: {
  heading: React.RefObject<HTMLHeadingElement | null>;
  platform: Platform;
  intent: Intent;
  season: boolean;
  leagues: EspnLeagueLink[];
  draft: DraftTarget | null;
  progress: ReactNode;
  back: (() => void) | null;
  onIntent(i: Intent): void;
  onSetUpAgain: (() => void) | null;
}) {
  const [paired, setPaired] = useState(false);
  useEffect(() => (intent === "draft" ? listenForEspnPaired(() => setPaired(true)) : undefined), [intent]);
  const run = platform === "desktop" ? DESKTOP.run("espn") : GUIDES[platform].run("espn");
  const phone = platform !== "desktop";
  const otherIntent = season ? (
    <TextButton onClick={() => onIntent(intent === "season" ? "draft" : "season")}>
      {intent === "season" ? "Syncing a live draft instead?" : "Connecting your season instead?"}
    </TextButton>
  ) : null;
  const again = onSetUpAgain && <TextButton onClick={onSetUpAgain}>Bookmark not working? Set it up again</TextButton>;
  const appNote = phone && (
    <p className="text-[13px] text-muted">
      Open it in the browser, not the ESPN app: the bookmark only runs in the browser. If the app opens anyway, come back here, touch and hold the link, and choose
      Open in New Tab.
    </p>
  );

  if (paired)
    return (
      <Screen
        heading={heading}
        title="Your draft is connected"
        lead="Picks made in ESPN land on your Draft Room board as they happen. Keep the ESPN tab open; it can sit in the background."
        progress={progress}
        back={null}
        actions={
          <a className={primary} href="/draft">
            Go to your board
          </a>
        }
      />
    );

  if (intent === "draft")
    return (
      <Screen
        heading={heading}
        title={draft ? `Connect ${draft.name} to its ESPN draft` : "Connect your ESPN draft"}
        lead="ESPN opens your draft an hour before it starts. Open it, run the bookmark there, and tap Connect to Draft Room."
        progress={progress}
        back={back}
        actions={
          <>
            <a className={primary} href={draft?.url ?? ESPN_FANTASY_HOME}>
              {draft?.url ? "Open your ESPN draft" : "Open ESPN Fantasy"}
            </a>
            {otherIntent}
            {again}
          </>
        }
      >
        <Figure step={run} />
        {!draft?.url && <p className="text-muted">On ESPN, open your league, then Join Draft.</p>}
        {appNote}
        {season && <p className="text-muted">Your season connects along with the draft, so lineup and trade help are ready when it&apos;s done.</p>}
      </Screen>
    );

  return (
    <Screen
      heading={heading}
      title="Connect your season"
      lead="Open your league on ESPN, run the bookmark there, and tap Connect my season. Draft Room opens to finish."
      progress={progress}
      back={back}
      actions={
        <>
          {otherIntent}
          {again}
        </>
      }
    >
      <EspnLeagueCards leagues={leagues} />
      {appNote}
      <Figure step={run} />
      <p className="text-[13px] text-dim">
        Draft Room reads your leagues with your ESPN login cookies (not your password), stored encrypted. ESPN signs Draft Room out every so often; when it does,
        run the bookmark on your league page again.
      </p>
    </Screen>
  );
}
