/**
 * @financedistrict/saleor-prism-payment
 *
 * Prism x402 stablecoin payment handler for Saleor agentic commerce.
 */

import type { HandlerManifest } from "@financedistrict/saleor-agentic-commerce-core"

export {
  PrismPaymentHandler,
  PRISM_HANDLER_ID,
  PRISM_CHECKOUT_CONFIG_KEY,
} from "./handler.js"
export type { PrismPaymentHandlerOptions } from "./handler.js"
export { PrismClient } from "./prism-client.js"
export type {
  PrismClientOptions,
  PreparePaymentInput,
  UcpHandlerDiscoveryEntry,
  UcpHandlersDiscoveryResponse,
  UcpCheckoutHandlerEntry,
  UcpCheckoutPrepareResponse,
  AcpHandler,
  PaymentHandlerConfig,
  X402AcceptEntry,
  SettleInput,
  SettleResult,
} from "./prism-client.js"

/**
 * Manifest declared by this package. Storefronts call
 * `registerHandler({ manifest, ... })` from
 * `@financedistrict/saleor-agentic-commerce-core` at boot to surface
 * this in the Agentic Commerce App's dashboard.
 *
 * `configSchema` describes the merchant config the handler accepts —
 * for v1 just `apiUrl` + `apiKey`. The dashboard renders a form from
 * this schema.
 */
export const manifest: HandlerManifest = {
  id: "xyz.fd.prism_payment",
  name: "xyz.fd.prism_payment",
  version: "2026-01-15",
  displayName: "Finance District Prism",
  description:
    "Stablecoin payments via x402/EIP-3009. Configure chains, tokens, and settlement wallet in the Prism merchant dashboard.",
  manageUrl: "https://apps.fd.xyz/prism",
  configSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["apiKey"],
    properties: {
      apiUrl: {
        type: "string",
        format: "uri",
        title: "Prism Gateway URL",
        description:
          "Override only when pointing at a self-hosted or test Prism instance.",
        default: "https://prism-gw.fd.xyz",
      },
      apiKey: {
        type: "string",
        title: "API Key",
        description: "Generated in your Prism merchant dashboard.",
        format: "password",
      },
    },
    additionalProperties: false,
  },
}
