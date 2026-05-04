/**
 * @financedistrict/saleor-dummy-payment
 *
 * Dummy/test payment handler for Saleor agentic commerce. Always-succeeds
 * (or fails on demand) simulator — for integration testing and as a
 * reference implementation for handler authors.
 *
 * **Do not use in production.** This handler does not move money.
 */

import type { HandlerManifest } from "@financedistrict/saleor-agentic-commerce-core"

export {
  DummyPaymentHandler,
  DUMMY_HANDLER_ID,
  DUMMY_CHECKOUT_CONFIG_KEY,
  DUMMY_VERSION,
} from "./handler.js"
export type {
  DummyMode,
  DummyPaymentHandlerOptions,
} from "./handler.js"

import { DUMMY_HANDLER_ID, DUMMY_VERSION } from "./handler.js"

/**
 * Manifest for self-registration with the Agentic Commerce App.
 *
 * The dashboard reads this when the storefront calls
 * `registerHandler({ manifest, ... })` at boot, then renders a config
 * form from `configSchema` so the merchant can pick the simulation
 * mode without redeploying.
 */
export const manifest: HandlerManifest = {
  id: DUMMY_HANDLER_ID,
  name: DUMMY_HANDLER_ID,
  version: DUMMY_VERSION,
  displayName: "Dummy Payment (Test)",
  description:
    "Always-succeeds simulator for integration testing. No remote calls. Do not use in production.",
  // No manageUrl — there's no remote dashboard for this handler.
  configSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["always_succeed", "always_fail", "random"],
        default: "always_succeed",
        title: "Settlement mode",
        description:
          "How the dummy handler responds to settlement attempts. Use 'random' to exercise both success and error paths in tests.",
      },
      delayMs: {
        type: "integer",
        minimum: 0,
        maximum: 30000,
        default: 0,
        title: "Simulated latency (ms)",
        description:
          "Artificial delay before settlement responds. Useful for testing timeout behavior in callers.",
      },
    },
    additionalProperties: false,
  },
}
