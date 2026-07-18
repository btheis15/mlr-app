import type { NextConfig } from "next";
import { writeFileSync } from "fs";
import { join } from "path";

/**
 * One version string per build — used both as the id baked into the client
 * bundle (`NEXT_PUBLIC_BUILD_ID`) and as the contents of the published
 * `public/version.json` the running app polls to notice a newer deploy (see
 * components/UpdateBanner.tsx). Sourced from the commit SHA so it's *stable
 * across Next's build workers* (a timestamp could differ between the client
 * bundle and version.json and trip a false "update available"); a timestamp is
 * only a local-dev fallback, where the banner never matters.
 */
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  String(Date.now());

// Publish version.json here so it shares BUILD_ID's single source and lands in
// public/ before the build copies static files. Best-effort: a missing file
// just means the banner never shows (fetch 404 → no-op), never a broken build.
try {
  writeFileSync(
    join(process.cwd(), "public", "version.json"),
    JSON.stringify({ version: BUILD_ID }) + "\n",
  );
} catch {
  /* ignore — non-fatal */
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  // Always revalidate so a fresh deploy is picked up immediately on the PWA.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
