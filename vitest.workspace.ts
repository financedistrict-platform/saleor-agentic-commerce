import { defineWorkspace } from "vitest/config"

export default defineWorkspace([
  "packages/core",
  "packages/nextjs",
  "packages/prism-payment",
  "packages/dummy-payment",
  {
    // The control-plane App's pure logic (APL selection — GH-62). Scoped to the
    // one test file so the suite doesn't boot Next or the heavy AWS/Redis deps.
    test: {
      name: "app",
      root: "./apps/saleor-agentic-commerce-app",
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  },
])
