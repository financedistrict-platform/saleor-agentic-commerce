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

export function createLatestUcpWire(version: string): UcpWire {
  return {
    version,

    profile(input: UcpProfileInput) {
      const ucp = {
        version,
        services: shoppingService(version, input.endpoint),
        capabilities: {
          "dev.ucp.shopping.checkout": capability(version, "checkout/", "checkout.json"),
          "dev.ucp.shopping.order": capability(version, "order/", "order.json"),
          "dev.ucp.shopping.catalog.search": capability(version, "catalog/", "catalog_search.json"),
          "dev.ucp.shopping.catalog.lookup": capability(version, "catalog/", "catalog_lookup.json"),
        },
        payment_handlers: input.handlers,
      }
      return { ucp: withSupportedVersions(ucp, input.supportedVersions) }
    },

    envelopeCapabilities() {
      return checkoutAndOrderCapabilities(version)
    },

    checkoutHandlers(handlers: Record<string, unknown[]>) {
      return handlers
    },

    error(input: UcpWireErrorInput) {
      return formatUcpError({ ucpVersion: version, ...input })
    },

    supports(_capability: UcpWireCapability) {
      return true
    },
  }
}

export const wire20260825: UcpWire = createLatestUcpWire("2026-08-25")
