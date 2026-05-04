import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "prism-payment",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
