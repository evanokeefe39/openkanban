import type { NextConfig } from "next";

/**
 * `output: "export"` is not a deployment convenience — it is the constraint that
 * keeps a server out of a product that has none. It makes route handlers,
 * middleware and Server Actions unavailable at build time, so the rule that a
 * board never leaves the device enforces itself rather than relying on review.
 *
 * `trailingSlash` emits `out/<route>/index.html`, which is what makes a static
 * host resolve a path without a rewrite rule.
 *
 * Known and accepted: the export emits absolute `/_next/...` asset paths, so the
 * built app does not open from `file://`. The vanilla app still does. See
 * `tasks/plans/react-port-validation.md` — capability `file-protocol`.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
