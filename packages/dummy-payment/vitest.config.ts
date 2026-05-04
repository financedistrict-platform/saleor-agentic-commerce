import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    name: "dummy-payment",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
