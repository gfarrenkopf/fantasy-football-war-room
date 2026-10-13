import { redirect } from "next/navigation";

/**
 * The destination of magic links asked for in the iPhone app (/api/v1/auth/email/start). With the
 * app installed, the link opens the app instead. Opened in a browser, Auth.js has already signed
 * that browser in, so it carries on to the war room like any other sign-in.
 */
export default function AppSignedIn() {
  redirect("/draft?welcome=1");
}
