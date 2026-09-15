import { connection } from "next/server";
import { WarRoom } from "@/components/draft/WarRoom";
import { publicFlags } from "@/lib/config";

export default async function Home() {
  // Render per request so feature flags reflect the runtime environment, not build-time env.
  await connection();

  return <WarRoom flags={publicFlags} />;
}
