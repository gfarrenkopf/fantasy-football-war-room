import { ArrowRight } from "@/components/season/Icons";
import { cx } from "./cx";

/**
 * The season page's one action, wherever it appears: connect an ESPN league. It goes to the
 * connect page, which signs the visitor in first when they need it, so this is a link rather than
 * a form. Filled Signal Green, the season's color and the product's "yours": the one filled
 * primary on the hosted site (DESIGN.md, the Season Door Exception).
 *
 * While the beta is invite-only (SEASON_ACCESS closed, APE-341) the same button is for members, who
 * still sign in through it, and the note says how everyone else gets in.
 */
export function ConnectEspn({ className, open }: { className?: string; open: boolean }) {
  return (
    <div className={className}>
      <a className={cx("connect")} href="/espn?for=season">
        <span className={cx("connectSweep")} aria-hidden="true" />
        {open ? "Connect your ESPN league" : "Member? Connect your ESPN league"}
        <ArrowRight className={cx("connectArrow")} />
      </a>
      <p className={cx("connectNote")}>{open ? "ESPN leagues only, for now." : "Invite-only beta. Ask a member for an invite."}</p>
    </div>
  );
}
