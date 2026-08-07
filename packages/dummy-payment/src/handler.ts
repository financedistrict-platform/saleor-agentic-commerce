/**
 * Dummy Payment Handler — for integration testing and as a reference impl.
 *
 * Implements `PaymentHandlerAdapter` from `@financedistrict/saleor-agentic-commerce-core`
 * with deterministic, always-local behavior:
 * - No remote API calls
 * - Settlement returns synthetic transaction IDs
 * - Configurable mode (always-succeed / always-fail / random) for exercising
 *   error paths in tests
 *
 * Don't use this in production. It does not move money.
 */

import type {
  PaymentHandlerAdapter,
  CheckoutPrepareInput,
  PaymentSettleInput,
  PaymentSettleResult,
} from "@financedistrict/saleor-agentic-commerce-core"

// =====================================================
// Constants
// =====================================================

export const DUMMY_HANDLER_ID = "xyz.fd.dummy_payment"

/**
 * Legacy metadata key. The registry stores prepared config under the adapter
 * id (DUMMY_HANDLER_ID), NOT this key, so reads must use the adapter id — the
 * mismatch was U-1 (checkout advertised nothing yet still settled). Kept only
 * for back-compat with readers of older checkout metadata.
 */
export const DUMMY_CHECKOUT_CONFIG_KEY = "dummy_checkout_config"

/** Stable version stamp for the dummy spec — bump when the wire shape changes. */
export const DUMMY_VERSION = "2026-05-03"

// Synthetic spec/schema URLs. ACP requires these fields, so we provide
// stable placeholders that point at the package's GitHub README. Real
// handlers should host actual spec docs.
const DUMMY_SPEC_URL =
  "https://github.com/financedistrict-platform/saleor-agentic-commerce/blob/main/packages/dummy-payment/README.md"
const DUMMY_CONFIG_SCHEMA_URL =
  "https://github.com/financedistrict-platform/saleor-agentic-commerce/blob/main/packages/dummy-payment/README.md#config-schema"
const DUMMY_INSTRUMENT_SCHEMA_URL =
  "https://github.com/financedistrict-platform/saleor-agentic-commerce/blob/main/packages/dummy-payment/README.md#instrument-schema"

// =====================================================
// Options + types
// =====================================================

/**
 * Settlement behavior. Per design doc §13, env vars take precedence over
 * passed options:
 *   `DUMMY_PAYMENT_MODE` — overrides `mode`
 *   `DUMMY_PAYMENT_DELAY_MS` — overrides `delayMs`
 */
export type DummyMode = "always_succeed" | "always_fail" | "random"

export type DummyPaymentHandlerOptions = {
  /** Settlement mode (default: always_succeed). */
  mode?: DummyMode
  /** Artificial latency before settlement responds, in ms (default: 0). */
  delayMs?: number
}

// =====================================================
// Handler
// =====================================================

export class DummyPaymentHandler implements PaymentHandlerAdapter {
  readonly id = DUMMY_HANDLER_ID
  readonly name = "Dummy Payment (Test)"

  private mode: DummyMode
  private delayMs: number

  constructor(opts: DummyPaymentHandlerOptions = {}) {
    // Env wins over passed config (Path A/B/C convention).
    const envMode = process.env.DUMMY_PAYMENT_MODE
    this.mode =
      envMode === "always_succeed" ||
      envMode === "always_fail" ||
      envMode === "random"
        ? envMode
        : (opts.mode ?? "always_succeed")
    const envDelay = parseInt(process.env.DUMMY_PAYMENT_DELAY_MS ?? "", 10)
    this.delayMs = Number.isFinite(envDelay) && envDelay >= 0
      ? envDelay
      : (opts.delayMs ?? 0)
  }

  // -------------------------------------------------
  // Discovery
  // -------------------------------------------------

  async getUcpDiscoveryHandlers(): Promise<Record<string, unknown[]>> {
    return {
      [DUMMY_HANDLER_ID]: [
        {
          id: "v1",
          version: DUMMY_VERSION,
          spec: DUMMY_SPEC_URL,
          schema: DUMMY_CONFIG_SCHEMA_URL,
          config: {},
        },
      ],
    }
  }

  async getAcpDiscoveryHandlers(): Promise<unknown[]> {
    return [
      {
        id: "v1",
        name: DUMMY_HANDLER_ID,
        version: DUMMY_VERSION,
        spec: DUMMY_SPEC_URL,
        requires_delegate_payment: false,
        requires_pci_compliance: false,
        psp: "dummy",
        config_schema: DUMMY_CONFIG_SCHEMA_URL,
        instrument_schemas: [DUMMY_INSTRUMENT_SCHEMA_URL],
        config: {},
      },
    ]
  }

  // -------------------------------------------------
  // Checkout preparation
  // -------------------------------------------------

  async prepareCheckoutPayment(
    input: CheckoutPrepareInput,
  ): Promise<unknown> {
    if (this.delayMs > 0) await sleep(this.delayMs)

    const { checkoutId, total, currencyCode, checkoutMetadata } = input

    // Idempotency — return prior config if amount unchanged.
    const existing = checkoutMetadata?.[DUMMY_HANDLER_ID] as
      | { _prepared_amount?: number }
      | undefined
    if (existing && existing._prepared_amount === total) {
      return existing
    }

    return {
      id: "v1",
      version: DUMMY_VERSION,
      config: {
        intent_id: `dummy_intent_${checkoutId.slice(0, 8)}_${Date.now()}`,
        amount: String(total),
        currency: currencyCode,
        mode: this.mode,
      },
      _prepared_amount: total,
    }
  }

  // -------------------------------------------------
  // Settlement
  // -------------------------------------------------

  async settlePayment(
    input: PaymentSettleInput,
  ): Promise<PaymentSettleResult> {
    if (this.delayMs > 0) await sleep(this.delayMs)

    const succeed =
      this.mode === "always_succeed"
        ? true
        : this.mode === "always_fail"
          ? false
          : Math.random() >= 0.5

    if (!succeed) {
      return {
        success: false,
        error: `Dummy handler simulated failure (mode=${this.mode})`,
      }
    }

    const txRef = `dummy_tx_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`

    return {
      success: true,
      transactionReference: txRef,
    }
  }

  // -------------------------------------------------
  // Response formatting
  // -------------------------------------------------

  getUcpCheckoutHandlers(
    checkoutMetadata?: Record<string, unknown>,
  ): Record<string, unknown[]> {
    const stored = checkoutMetadata?.[DUMMY_HANDLER_ID] as
      | { id?: string; version?: string; config?: unknown }
      | undefined
    if (!stored?.config) return {}

    return {
      [DUMMY_HANDLER_ID]: [
        {
          id: stored.id ?? "v1",
          version: stored.version ?? DUMMY_VERSION,
          config: stored.config,
        },
      ],
    }
  }

  getAcpCheckoutHandlers(
    checkoutMetadata?: Record<string, unknown>,
  ): unknown[] {
    const stored = checkoutMetadata?.[DUMMY_HANDLER_ID] as
      | { id?: string; version?: string; config?: unknown }
      | undefined
    if (!stored?.config) return []

    return [
      {
        id: stored.id ?? "v1",
        name: DUMMY_HANDLER_ID,
        version: stored.version ?? DUMMY_VERSION,
        spec: DUMMY_SPEC_URL,
        requires_delegate_payment: false,
        requires_pci_compliance: false,
        psp: "dummy",
        config_schema: DUMMY_CONFIG_SCHEMA_URL,
        instrument_schemas: [DUMMY_INSTRUMENT_SCHEMA_URL],
        config: stored.config,
      },
    ]
  }
}

// =====================================================
// Internal
// =====================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
