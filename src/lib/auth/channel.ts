/**
 * Tabs telling each other about a sign-in. A magic link opens in a new tab, so the tab that asked
 * for it is left behind saying "check your inbox"; the tab that lands announces itself here and
 * the waiting one can say "you're in" instead. Browsers without BroadcastChannel just stay quiet.
 */
const NAME = "warroom-auth";
const SIGNED_IN = "signed-in";

export function announceSignedIn(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(NAME);
  channel.postMessage(SIGNED_IN);
  channel.close();
}

/** Calls `onSignedIn` when another tab finishes signing in. Returns the unsubscribe. */
export function listenForSignIn(onSignedIn: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(NAME);
  channel.onmessage = (e) => e.data === SIGNED_IN && onSignedIn();
  return () => channel.close();
}
