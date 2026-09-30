import type { AcpHandler, PaymentHandlerConfig } from "../prism-client.js"

export const samplePaymentHandlerConfig: PaymentHandlerConfig = {
  x402Version: 2,
  resource: { url: "https://store.test/checkout/abc" },
  accepts: [
    {
      scheme: "exact",
      network: "base-sepolia",
      payTo: "0xabc",
      maxTimeoutSeconds: 600,
      asset: "USDC",
      amount: "1000000",
    },
  ],
}

export const sampleAcpHandler: AcpHandler = {
  id: "x402",
  name: "xyz.fd.prism_payment",
  version: "2026-01-15",
  spec: "https://test.example/acp/spec.md",
  requires_delegate_payment: false,
  requires_pci_compliance: false,
  psp: "prism",
  config_schema: "https://test.example/acp/config_schema.json",
  instrument_schemas: ["https://test.example/acp/instrument_schema.json"],
  config: samplePaymentHandlerConfig,
}
