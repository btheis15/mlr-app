import type { NextConfig } from "next";
import { writeFileSync } from "fs";
import { join } from "path";

/**
 * Two build modes:
 *  - Default (e.g. Vercel): served at the root, with cache headers.
 *  - GitHub Pages: the deploy workflow sets PAGES_BASE_PATH="/mlr-app", which
 *    switches Next.js to a static export under that subpath. (Custom headers
 *    aren't supported by `output: export`, so they're dropped in that mode —
 *    they don't apply to static hosting anyway.)
 */
const basePath = process.env.PAGES_BASE_PATH ?? "";
const isPages = basePath !== "";

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

// Inlined into the bundle (client + server). BASE_PATH lets the client fetch
// version.json at the right path under the Pages subpath.
const env = {
  NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  NEXT_PUBLIC_BASE_PATH: basePath,
};

const nextConfig: NextConfig = isPages
  ? {
      output: "export",
      basePath,
      assetPrefix: basePath,
      trailingSlash: true,
      images: { unoptimized: true },
      env,
    }
  : {
      env,
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
