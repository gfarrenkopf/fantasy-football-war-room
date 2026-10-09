import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The server-side ESPN client (Epic 9) uses `ws`, which loads its optional native addons with a
  // runtime require; bundling it breaks that, so it's required from node_modules as-is.
  serverExternalPackages: ["ws"],
  // The ESPN bookmark imports the bridge as a module from ESPN's page (APE-339), which needs CORS.
  // It's a public script, so any origin may load it.
  async headers() {
    return [{ source: "/espn-bridge.js", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] }];
  },
};

export default nextConfig;
