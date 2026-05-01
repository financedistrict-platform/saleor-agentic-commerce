const path = require("node:path")

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@saleor/macaw-ui"],

  // Build mode toggle:
  //   NEXT_OUTPUT=standalone  → produces .next/standalone for Docker runner stage
  //   unset (default)         → normal `next build` for local dev / next dev / next start
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,

  // We're inside a pnpm workspace at ../../ (saleor-agentic-commerce repo root).
  // Without this hint, Next.js's standalone tracer treats this app dir as the
  // project root and misses workspace-hoisted node_modules — the resulting
  // .next/standalone would be missing dependencies at runtime. Pointing at the
  // monorepo root fixes the trace so all hoisted modules get copied.
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
}

module.exports = nextConfig
