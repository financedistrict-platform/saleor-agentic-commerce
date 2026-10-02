import type {
  AcpErrorResponse,
  AcpErrorType,
  PaymentSettleInput,
  UcpErrorResponse,
  UcpProfile,
} from "../src/index.js"

export const settleWithoutProtocol: PaymentSettleInput = {
  checkoutId: "checkout-1",
  handlerId: "xyz.fd.prism_payment",
  credential: { type: "x402" },
}

export const settleAcp: PaymentSettleInput = {
  checkoutId: "checkout-1",
  handlerId: "xyz.fd.prism_payment",
  credential: { type: "x402" },
  protocol: "acp",
}

export const settleUcpWithoutInstrumentType: PaymentSettleInput = {
  checkoutId: "checkout-1",
  handlerId: "xyz.fd.prism_payment",
  credential: { type: "x402" },
  protocol: "ucp",
}

export const profileWithSigningKeys: UcpProfile = {
  ucp: { version: "1", services: {}, capabilities: {} },
  signing_keys: [],
}

export type ErrorTypesStillExported = [AcpErrorResponse, AcpErrorType, UcpErrorResponse]
