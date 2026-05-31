import type { NextConfig } from "next";

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

const nextConfig: NextConfig = isPages
  ? {
      output: "export",
      basePath,
      assetPrefix: basePath,
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {
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
