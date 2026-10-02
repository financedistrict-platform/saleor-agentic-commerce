import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import * as core from "../index.js"
import * as prism from "../../../prism-payment/src/index.js"
import * as dummy from "../../../dummy-payment/src/index.js"
import * as headers from "../../../nextjs/src/middleware/ucp-headers.js"

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

const CORE_VALUES = [
  "PaymentHandlerRegistry", "SaleorClient", "evaluateReadiness", "classifyCompleteErrors", "PAYMENT_PENDING_CODE",
  "UCP_VERSION", "isWellFormedInstrument", "formatUcpProfile", "formatUcpCheckoutSession", "formatUcpCompleteResponse",
  "formatUcpOrder", "formatUcpCatalogSearch", "formatUcpCatalogLookup", "formatAcpCheckoutSession", "formatAcpCompleteResponse",
  "toMinor", "saleorToUcpAddress", "ucpToSaleorAddress", "saleorToAcpAddress", "acpToSaleorAddress", "planCartReplacement",
  "resolveUcpCheckoutStatus", "resolveAcpCheckoutStatus", "normalizeOrderStatus", "formatAcpError", "formatUcpError",
  "httpStatusToAcpType", "saleorErrorsToUcpMessages", "metadataToRecord", "recordToMetadataInput", "getMetadataValue",
  "loadConfigFromApp", "loadConfigFromAppCached", "clearAppConfigCache", "registerHandler", "extractSignedSummary",
  "readStoredPrismAccepts", "validateSignedAgainstStored",
]
const CORE_TYPES = [
  "PaymentHandlerAdapter", "CheckoutPrepareInput", "PaymentSettleInput", "PaymentSettleResult", "UcpProfile",
  "UcpCheckoutSession", "UcpOrder", "UcpOrderConfirmation", "UcpEnvelope", "UcpBuyer", "UcpLineItem", "UcpOrderLineItem",
  "UcpAddress", "UcpTotal", "UcpTotalType", "UcpFulfillment", "UcpFulfillmentMethod", "UcpFulfillmentGroup",
  "UcpFulfillmentOption", "UcpFulfillmentDestination", "UcpPayment", "UcpPaymentInstrument", "UcpMessage",
  "UcpErrorMessage", "UcpWarningMessage", "UcpInfoMessage", "UcpLink", "UcpCheckoutStatus", "UcpErrorSeverity",
  "UcpOrderFulfillment", "UcpAdjustment", "UcpCatalogProduct", "UcpCatalogProductVariant", "UcpCatalogProductMedia",
  "UcpCatalogSearchResponse", "UcpCatalogLookupResponse", "UcpDescription", "UcpInputCorrelation", "UcpLookupProduct",
  "UcpLookupVariant", "AcpCheckoutSession", "AcpCompleteResponse", "AcpOrder", "AcpAddress", "AcpBuyer", "AcpItem",
  "AcpLineItem", "AcpTotal", "AcpTotalType", "AcpFulfillmentOption", "AcpFulfillmentOptionShipping",
  "AcpFulfillmentDetails", "AcpSelectedFulfillmentOption", "AcpFulfillmentGroup", "AcpCapabilities", "AcpPayment",
  "AcpPaymentHandler", "AcpPaymentData", "AcpMessage", "AcpInfoMessage", "AcpWarningMessage", "AcpErrorMessage",
  "AcpMessageSeverity", "AcpLink", "AcpLinkType", "AcpCheckoutStatus", "SaleorCheckout", "SaleorOrder", "SaleorAddress",
  "SaleorCheckoutLine", "SaleorOrderLine", "SaleorMoney", "SaleorTaxedMoney", "SaleorMetadataItem", "SaleorShippingMethod",
  "SaleorProduct", "SaleorProductVariant", "SaleorProductConnection", "SaleorLookupVariant", "SaleorFulfillment",
  "SaleorClientOptions", "SaleorResult", "SaleorAddressInput", "CheckoutReadiness", "FormatterContext", "CurrentCartLine",
  "DesiredCartLine", "CartReplacementPlan", "AcpErrorResponse", "AcpErrorType", "UcpErrorResponse", "UcpErrorMessageInput",
  "AppConfig", "AppChannelConfig", "AppPaymentHandlerConfig", "LoadConfigOptions", "HandlerManifest",
  "RegisterHandlerOptions", "RegisterHandlerResult", "SignedPaymentSummary", "StoredAcceptEntry", "ValidationResult",
  "ValidationErrorCode",
]
const NEXTJS_NAMES = ["createAgenticCommerce", "createUcpRoutes", "createAcpRoutes", "AgenticCommerceConfig", "AgenticCommerceInstance"]
const HEADER_VALUES = ["parseUcpHeaders", "validateUcpHeaders", "ucpResponseHeaders"]
const PRISM_VALUES = ["PrismPaymentHandler", "PRISM_HANDLER_ID", "PRISM_CHECKOUT_CONFIG_KEY", "PRISM_INSTRUMENT_TYPE", "PrismClient", "manifest"]
const PRISM_TYPES = [
  "PrismPaymentHandlerOptions", "PrismClientOptions", "PreparePaymentInput", "UcpHandlerDiscoveryEntry",
  "UcpHandlersDiscoveryResponse", "UcpCheckoutHandlerEntry", "UcpCheckoutPrepareResponse", "AcpHandler",
  "PaymentHandlerConfig", "X402AcceptEntry", "SettleInput", "SettleResult",
]
const DUMMY_VALUES = ["DummyPaymentHandler", "DUMMY_HANDLER_ID", "DUMMY_CHECKOUT_CONFIG_KEY", "DUMMY_VERSION", "manifest"]
const DUMMY_TYPES = ["DummyMode", "DummyPaymentHandlerOptions"]

function exportedNames(relativeIndex: string): Set<string> {
  const source = readFileSync(join(PACKAGES, relativeIndex), "utf8")
  const names = new Set<string>()
  for (const block of source.matchAll(/export (?:type )?\{([^}]*)\}/g)) {
    for (const part of block[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, "")
      if (name) names.add(name)
    }
  }
  for (const match of source.matchAll(/export (?:const|function|class|async function) (\w+)/g)) names.add(match[1])
  return names
}

describe.each([
  ["saleor-agentic-commerce-core 0.7.1 and 1.0.0", core, "core/src/index.ts", CORE_VALUES, CORE_TYPES],
  ["saleor-prism-payment 1.0.0 and 2.0.0", prism, "prism-payment/src/index.ts", PRISM_VALUES, PRISM_TYPES],
  ["saleor-dummy-payment 1.0.0 and 2.0.0", dummy, "dummy-payment/src/index.ts", DUMMY_VALUES, DUMMY_TYPES],
  ["saleor-agentic-commerce-nextjs middleware/ucp-headers", headers, "nextjs/src/middleware/ucp-headers.ts", HEADER_VALUES, []],
])("public API of %s", (_label, module, index, values, types) => {
  it.each(values)("still exports %s", (name) => {
    expect((module as Record<string, unknown>)[name]).toBeDefined()
  })

  it("still declares every value and type export", () => {
    const names = exportedNames(index)
    for (const name of [...values, ...types]) expect(names.has(name), name).toBe(true)
  })
})

describe("public API of saleor-agentic-commerce-nextjs 1.0.0 and 2.0.0", () => {
  it("still declares every value and type export", () => {
    const names = exportedNames("nextjs/src/index.ts")
    for (const name of NEXTJS_NAMES) expect(names.has(name), name).toBe(true)
  })
})

describe("additive exports", () => {
  it("adds the version registry defaulting to the latest known version", () => {
    expect(typeof core.createUcpVersionRegistry).toBe("function")
    expect(core.DEFAULT_CURRENT_UCP_VERSION).toBe("2026-08-25")
    expect(core.UCP_VERSION).toBe(core.DEFAULT_CURRENT_UCP_VERSION)
  })
})
