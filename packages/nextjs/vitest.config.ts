import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "nextjs",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
