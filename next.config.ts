import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The server-side ESPN client (Epic 9) uses `ws`, which loads its optional native addons with a
  // runtime require; bundling it breaks that, so it's required from node_modules as-is.
  serverExternalPackages: ["ws"],
};

export default nextConfig;
