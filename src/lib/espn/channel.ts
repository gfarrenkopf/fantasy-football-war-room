/**
 * The pairing popup telling War Room tabs that a league was just connected to an ESPN draft, so the
 * war room can start listening for picks without a reload. Browsers without BroadcastChannel just
 * pick it up on their next load. Same pattern as src/lib/auth/channel.ts.
 */
const NAME = "warroom-espn";

interface PairedMessage {
  type: "paired";
  leagueId: string;
}

export function announceEspnPaired(leagueId: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(NAME);
  channel.postMessage({ type: "paired", leagueId } satisfies PairedMessage);
  channel.close();
}

/** Calls `onPaired` with the league id when another tab connects a league. Returns the unsubscribe. */
export function listenForEspnPaired(onPaired: (leagueId: string) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(NAME);
  channel.onmessage = (e: MessageEvent<PairedMessage>) => {
    if (e.data?.type === "paired" && typeof e.data.leagueId === "string") onPaired(e.data.leagueId);
  };
  return () => channel.close();
}
