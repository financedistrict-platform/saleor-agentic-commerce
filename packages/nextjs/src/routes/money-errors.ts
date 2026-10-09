import { AmountPrecisionError, UnsupportedCurrencyError } from "@financedistrict/saleor-agentic-commerce-core"

type RouteMethod = (...args: never[]) => Promise<Response>

export function rejectMoneyErrors<T extends object>(routes: T, respond: (code: string, message: string) => Response): T {
  const guard = (handler: RouteMethod) => async (...args: never[]) => {
    try {
      return await handler(...args)
    } catch (error) {
      if (error instanceof UnsupportedCurrencyError || error instanceof AmountPrecisionError) return respond(error.code, error.message)
      throw error
    }
  }
  return Object.fromEntries(
    Object.entries(routes).map(([name, methods]) => [
      name,
      Object.fromEntries(Object.entries(methods as Record<string, RouteMethod>).map(([verb, handler]) => [verb, guard(handler)])),
    ]),
  ) as T
}
