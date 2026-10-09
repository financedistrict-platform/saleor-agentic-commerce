import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      "packages/core",
      "packages/nextjs",
      "packages/prism-payment",
      "packages/dummy-payment",
      {
        test: {
          name: "app",
          root: "./apps/saleor-agentic-commerce-app",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./apps/saleor-agentic-commerce-app/src", import.meta.url)),
          },
        },
      },
    ],
  },
})
