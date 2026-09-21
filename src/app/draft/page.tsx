import type { Metadata } from "next";
import { connection } from "next/server";
import { WarRoom } from "@/components/draft/WarRoom";
import { getSessionUser } from "@/lib/auth";
import { publicFlags } from "@/lib/config";

export const metadata: Metadata = { title: "Fantasy War Room" };

export default async function Draft() {
  // Render per request so feature flags reflect the runtime environment, not build-time env.
  await connection();

  return <WarRoom flags={publicFlags} user={await getSessionUser()} />;
}
