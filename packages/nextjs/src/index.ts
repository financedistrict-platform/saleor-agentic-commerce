/**
 * @financedistrict/saleor-agentic-commerce-nextjs
 *
 * Drop-in Next.js integration for Saleor agentic commerce.
 * Provides route handlers, middleware, and configuration.
 */

export { createAgenticCommerce } from "./config.js"
export type { AgenticCommerceConfig, AgenticCommerceInstance } from "./config.js"

export { createUcpRoutes } from "./routes/ucp-routes.js"
export { createAcpRoutes } from "./routes/acp-routes.js"
