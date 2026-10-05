import localFont from "next/font/local";

/**
 * The broadcast face for the one night a year this product is allowed to shout, and game day's win
 * (APE-230). Big Shoulders (SIL OFL 1.1, see fonts/OFL.txt) is committed rather than fetched, so a
 * build never needs the network — the app still has to boot with zero configuration.
 */
export const stage = localFont({
  src: "./fonts/BigShoulders-latin.woff2",
  weight: "700 900",
  display: "swap",
  variable: "--font-stage",
});
