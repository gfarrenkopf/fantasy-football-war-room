import { ArrowRight } from "@/components/season/Icons";
import { cx } from "./cx";

/**
 * The season page's one action, wherever it appears: connect an ESPN league. It goes to the
 * connect page, which signs the visitor in first when they need it, so this is a link rather than
 * a form. Filled Signal Green, the season's color and the product's "yours": the one filled
 * primary on the hosted site (DESIGN.md, the Season Door Exception).
 */
export function ConnectEspn({ className }: { className?: string }) {
  return (
    <div className={className}>
      <a className={cx("connect")} href="/espn?for=season">
        <span className={cx("connectSweep")} aria-hidden="true" />
        Connect your ESPN league
        <ArrowRight className={cx("connectArrow")} />
      </a>
      <p className={cx("connectNote")}>ESPN leagues only, for now.</p>
    </div>
  );
}
