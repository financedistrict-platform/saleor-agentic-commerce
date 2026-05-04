import { defineWorkspace } from "vitest/config"

export default defineWorkspace([
  "packages/core",
  "packages/nextjs",
  "packages/prism-payment",
  "packages/dummy-payment",
])
