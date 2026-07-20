/**
 * @financedistrict/saleor-agentic-commerce-core
 *
 * Framework-agnostic UCP/ACP protocol support for Saleor.
 * Provides types, Saleor GraphQL mappings, payment handler registry,
 * and protocol formatters.
 */

// Types — Payment Handler
export type {
  PaymentHandlerAdapter,
  CheckoutPrepareInput,
  PaymentSettleInput,
  PaymentSettleResult,
} from "./types/payment-handler-adapter.js"

// Types — UCP Protocol
export type {
  UcpProfile,
  UcpCheckoutSession,
  UcpOrder,
  UcpOrderConfirmation,
  UcpEnvelope,
  UcpBuyer,
  UcpLineItem,
  UcpOrderLineItem,
  UcpAddress,
  UcpTotal,
  UcpTotalType,
  UcpFulfillment,
  UcpFulfillmentMethod,
  UcpFulfillmentGroup,
  UcpFulfillmentOption,
  UcpFulfillmentDestination,
  UcpPayment,
  UcpPaymentInstrument,
  UcpMessage,
  UcpErrorMessage,
  UcpWarningMessage,
  UcpInfoMessage,
  UcpLink,
  UcpCheckoutStatus,
  UcpErrorSeverity,
  UcpOrderFulfillment,
  UcpAdjustment,
  UcpCatalogProduct,
  UcpCatalogProductVariant,
  UcpCatalogProductMedia,
  UcpCatalogSearchResponse,
  UcpCatalogLookupResponse,
} from "./types/ucp.js"

// Types — ACP Protocol
export type {
  AcpCheckoutSession,
  AcpCompleteResponse,
  AcpOrder,
  AcpAddress,
  AcpBuyer,
  AcpItem,
  AcpLineItem,
  AcpTotal,
  AcpTotalType,
  AcpFulfillmentOption,
  AcpFulfillmentOptionShipping,
  AcpFulfillmentDetails,
  AcpSelectedFulfillmentOption,
  AcpFulfillmentGroup,
  AcpCapabilities,
  AcpPayment,
  AcpPaymentHandler,
  AcpPaymentData,
  AcpMessage,
  AcpInfoMessage,
  AcpWarningMessage,
  AcpErrorMessage,
  AcpMessageSeverity,
  AcpLink,
  AcpLinkType,
  AcpCheckoutStatus,
} from "./types/acp.js"

// Types — Saleor
export type {
  SaleorCheckout,
  SaleorOrder,
  SaleorAddress,
  SaleorCheckoutLine,
  SaleorOrderLine,
  SaleorMoney,
  SaleorTaxedMoney,
  SaleorMetadataItem,
  SaleorShippingMethod,
  SaleorProduct,
  SaleorProductVariant,
  SaleorProductConnection,
} from "./types/saleor.js"

// Payment Handler Registry
export { PaymentHandlerRegistry } from "./lib/payment-handler-registry.js"

// Saleor GraphQL Client
export { SaleorClient } from "./lib/saleor-client.js"
export type { SaleorClientOptions, SaleorResult, SaleorAddressInput } from "./lib/saleor-client.js"

// Formatters — UCP
export { formatUcpProfile, formatUcpCheckoutSession, formatUcpCompleteResponse, formatUcpOrder, formatUcpCatalogSearch, formatUcpCatalogLookup } from "./lib/formatters/ucp.js"

// Formatters — ACP
export { formatAcpCheckoutSession, formatAcpCompleteResponse } from "./lib/formatters/acp.js"

// Formatter Types
export type { FormatterContext } from "./lib/formatters/types.js"
export { toMinor } from "./lib/formatters/types.js"

// Address Translation
export {
  saleorToUcpAddress,
  ucpToSaleorAddress,
  saleorToAcpAddress,
  acpToSaleorAddress,
} from "./lib/address-translator.js"

// Status Maps
export {
  resolveUcpCheckoutStatus,
  resolveAcpCheckoutStatus,
  normalizeOrderStatus,
} from "./lib/status-maps.js"

// Error Formatters
export {
  formatAcpError,
  formatUcpError,
  httpStatusToAcpType,
} from "./lib/error-formatters.js"
export type { AcpErrorResponse, AcpErrorType, UcpErrorResponse } from "./lib/error-formatters.js"

// Metadata Utilities
export {
  metadataToRecord,
  recordToMetadataInput,
  getMetadataValue,
} from "./lib/metadata.js"

// App Config Loader
export {
  loadConfigFromApp,
  loadConfigFromAppCached,
  clearAppConfigCache,
} from "./lib/app-config-loader.js"
export type {
  AppConfig,
  AppChannelConfig,
  AppPaymentHandlerConfig,
  LoadConfigOptions,
} from "./lib/app-config-loader.js"

// Handler Self-Registration
export { registerHandler } from "./lib/register-handler.js"
export type {
  HandlerManifest,
  RegisterHandlerOptions,
  RegisterHandlerResult,
} from "./lib/register-handler.js"

// Signed-amount validation (Prism x402)
export {
  extractSignedSummary,
  readStoredPrismAccepts,
  validateSignedAgainstStored,
} from "./lib/validate-signed-amount.js"
export type {
  SignedPaymentSummary,
  StoredAcceptEntry,
  ValidationResult,
  ValidationErrorCode,
} from "./lib/validate-signed-amount.js"
