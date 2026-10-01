import { formatUcpError } from "../error-formatters.js"
import {
  capability,
  checkoutAndOrderCapabilities,
  shoppingService,
  withSupportedVersions,
  type UcpProfileInput,
  type UcpWire,
  type UcpWireCapability,
  type UcpWireErrorInput,
} from "./types.js"

const VERSION = "2026-04-08"

export const wire20260408: UcpWire = {
  version: VERSION,

  profile(input: UcpProfileInput) {
    const ucp = {
      version: VERSION,
      services: shoppingService(VERSION, input.endpoint),
      capabilities: {
        "dev.ucp.shopping.checkout": capability(VERSION, "checkout/", "checkout.json"),
        "dev.ucp.shopping.order": capability(VERSION, "order/", "order.json"),
        "dev.ucp.shopping.catalog.search": capability(VERSION, "catalog/", "catalog.json"),
        "dev.ucp.shopping.catalog.lookup": capability(VERSION, "catalog/", "catalog.json"),
      },
      payment_handlers: input.handlers,
    }
    return { ucp: withSupportedVersions(ucp, input.supportedVersions), signing_keys: [] }
  },

  envelopeCapabilities() {
    return checkoutAndOrderCapabilities(VERSION)
  },

  checkoutHandlers(handlers: Record<string, unknown[]>) {
    return handlers
  },

  error(input: UcpWireErrorInput) {
    return formatUcpError({ ucpVersion: VERSION, ...input })
  },

  supports(_capability: UcpWireCapability) {
    return true
  },
}
