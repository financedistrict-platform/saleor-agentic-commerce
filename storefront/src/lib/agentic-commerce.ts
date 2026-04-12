import { createAgenticCommerce, createUcpRoutes, createAcpRoutes } from "@financedistrict/saleor-agentic-commerce-nextjs"
import { PrismPaymentHandler } from "@financedistrict/saleor-prism-payment"

const saleorApiUrl = process.env.NEXT_PUBLIC_SALEOR_API_URL!
const authToken = process.env.SALEOR_AGENTIC_AUTH_TOKEN!
const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL || "http://localhost:3000"
const storeName = process.env.SALEOR_AGENTIC_STORE_NAME || "Saleor Store"
const channel = process.env.NEXT_PUBLIC_DEFAULT_CHANNEL || "default-channel"

const prismHandler = new PrismPaymentHandler({
  apiUrl: process.env.PRISM_API_URL,
  apiKey: process.env.PRISM_API_KEY,
})

export const agenticCommerce = createAgenticCommerce({
  saleorApiUrl,
  saleorAuthToken: authToken,
  storefrontUrl,
  storeName,
  channel,
  storeDescription: "Saleor e-commerce storefront with UCP agentic commerce support",
  paymentHandlers: [prismHandler],
})

export const ucpRoutes = createUcpRoutes(agenticCommerce)
export const acpRoutes = createAcpRoutes(agenticCommerce)
