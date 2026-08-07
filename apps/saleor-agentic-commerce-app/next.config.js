const path = require("node:path")

// APL backends are Node-only and use `node:` builtins (redis → node:crypto,
// AWS SDK, dynamodb-toolbox). They must never be webpack-parsed — required
// natively at runtime from node_modules instead.
const APL_NODE_ONLY = [
  "redis",
  "@redis/client",
  "dynamodb-toolbox",
  "@aws-sdk/client-dynamodb",
  "@aws-sdk/lib-dynamodb",
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@saleor/macaw-ui"],

  experimental: {
    // Run src/instrumentation.ts `register()` at server startup (the APL boot
    // canary — GH-62). Stable in Next 15+; needs this flag on Next 14.
    instrumentationHook: true,
    serverComponentsExternalPackages: APL_NODE_ONLY,
    // pnpm workspace root, so the standalone tracer picks up hoisted
    // node_modules (Next 14 nests this under experimental).
    outputFileTracingRoot: path.join(__dirname, "..", ".."),
  },

  // Belt-and-suspenders to the above: mark the node-only APL deps as externals
  // for the server AND edge compilations so webpack never parses their
  // `node:`-scheme imports (which the edge target can't handle). They're
  // dynamically imported only in the node runtime at request time.
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Map each to `commonjs <pkg>` so webpack emits `require("<pkg>")` rather
      // than treating the bare name as a global (which produced invalid JS).
      const externalize = Object.fromEntries(APL_NODE_ONLY.map((p) => [p, `commonjs ${p}`]))
      const existing = Array.isArray(config.externals)
        ? config.externals
        : [config.externals].filter(Boolean)
      config.externals = [externalize, ...existing]
    }
    return config
  },

  // Build mode toggle:
  //   NEXT_OUTPUT=standalone  → produces .next/standalone for Docker runner stage
  //   unset (default)         → normal `next build` for local dev / next dev / next start
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
}

module.exports = nextConfig
