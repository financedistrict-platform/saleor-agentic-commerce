import { formatUcpError } from "../error-formatters.js"
import {
  capability,
  checkoutAndOrderCapabilities,
  shoppingService,
  withoutHandlerFields,
  type UcpProfileInput,
  type UcpWire,
  type UcpWireCapability,
  type UcpWireErrorInput,
} from "./types.js"

const VERSION = "2026-01-23"
const LATER_HANDLER_FIELDS: readonly string[] = ["available_instruments"]
const SUPPORTED_CAPABILITIES: readonly UcpWireCapability[] = ["checkout", "order"]

export const wire20260123: UcpWire = {
  version: VERSION,

  profile(input: UcpProfileInput) {
    return {
      ucp: {
        version: VERSION,
        services: shoppingService(VERSION, input.endpoint),
        capabilities: {
          "dev.ucp.shopping.checkout": capability(VERSION, "checkout/", "checkout.json"),
          "dev.ucp.shopping.order": capability(VERSION, "order/", "order.json"),
        },
        payment_handlers: withoutHandlerFields(input.handlers, LATER_HANDLER_FIELDS),
      },
      signing_keys: [],
    }
  },

  envelopeCapabilities() {
    return checkoutAndOrderCapabilities(VERSION)
  },

  checkoutHandlers(handlers: Record<string, unknown[]>) {
    return withoutHandlerFields(handlers, LATER_HANDLER_FIELDS)
  },

  error(input: UcpWireErrorInput) {
    const { messages } = formatUcpError({ ucpVersion: VERSION, ...input })
    return {
      ucp: { version: VERSION },
      status: "requires_escalation",
      messages: messages.map((message) => ({
        ...message,
        severity: message.severity === "unrecoverable" ? "requires_buyer_input" : message.severity,
      })),
    }
  },

  supports(wireCapability: UcpWireCapability) {
    return SUPPORTED_CAPABILITIES.includes(wireCapability)
  },
}
