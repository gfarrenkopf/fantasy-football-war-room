import type { Metadata } from "next";

export const metadata: Metadata = { title: "Back to the app · Draft Room", robots: { index: false } };

/**
 * Where Google sign-in hands back to the iPhone app (/api/v1/auth/handoff). With the app installed,
 * iOS opens the app on this link before the page ever loads. This is what shows if it didn't.
 */
export default function AppCallback() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-6 text-text">
      <div className="max-w-sm text-center">
        <h1 className="mb-2 text-[17px] font-semibold">Almost there</h1>
        <p className="text-muted">Go back to the Draft Room app to finish signing in. If it didn&apos;t open, start the sign-in again from the app.</p>
      </div>
    </main>
  );
}
