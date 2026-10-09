export type Money = {
  amount: number
  currency: string
}

export class UnsupportedCurrencyError extends Error {
  readonly code = "unsupported_currency"

  constructor(readonly currency: string) {
    super(`Currency '${currency}' is not supported for agentic checkout.`)
    this.name = "UnsupportedCurrencyError"
  }
}

export class AmountPrecisionError extends Error {
  readonly code = "amount_precision_invalid"

  constructor(readonly money: Money) {
    super(`Amount ${money.amount} ${money.currency} has more decimals than ${money.currency} allows.`)
    this.name = "AmountPrecisionError"
  }
}

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf("currency"))

export function isSupportedCurrency(currency: string): boolean {
  return SUPPORTED_CURRENCIES.has(currency.toUpperCase())
}

export function currencyExponent(currency: string): number {
  if (!isSupportedCurrency(currency)) throw new UnsupportedCurrencyError(currency)
  const digits = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).resolvedOptions().maximumFractionDigits
  if (digits === undefined) throw new UnsupportedCurrencyError(currency)
  return digits
}

export function toMinor(money: Money): number {
  const exponent = currencyExponent(money.currency)
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(money.amount))
  if (!match) throw new AmountPrecisionError(money)
  const [, sign, whole, fraction = ""] = match
  if (fraction.length > exponent) throw new AmountPrecisionError(money)
  const minor = Number(`${sign}${whole}${fraction.padEnd(exponent, "0")}`)
  if (!Number.isSafeInteger(minor)) throw new AmountPrecisionError(money)
  return minor === 0 ? 0 : minor
}

export function fromMinor(minor: number, currency: string): Money {
  return { amount: Number(minorToDecimalString(minor, currency)), currency }
}

export function minorToDecimalString(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor)) throw new AmountPrecisionError({ amount: minor, currency })
  const exponent = currencyExponent(currency)
  if (exponent === 0) return String(minor)
  const digits = Math.abs(minor).toString().padStart(exponent + 1, "0")
  return `${minor < 0 ? "-" : ""}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`
}
