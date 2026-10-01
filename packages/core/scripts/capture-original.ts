import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const [origDir, inputsDir, outDir, lane, recorded] = process.argv.slice(2)
if (!origDir || !inputsDir || !outDir || (lane !== "empty" && lane !== "prism") || (lane === "prism" && !recorded)) {
  console.error("usage: capture-original.ts <orig-dir> <inputs-dir> <out-dir> <empty|prism> [recorded-prism-json]")
  process.exit(1)
}

const load = (path: string) => import(pathToFileURL(resolve(origDir, path)).href)
const core = await load("packages/core/dist/index.js")
const prism = await load("packages/prism-payment/dist/index.js")

const input = (name: string) => JSON.parse(readFileSync(join(inputsDir, name), "utf8"))
const write = (name: string, value: unknown) => writeFileSync(join(outDir, name), JSON.stringify(value, null, 2))

const paymentHandlers = new core.PaymentHandlerRegistry()
if (lane === "prism") {
  const body = readFileSync(resolve(recorded), "utf8")
  globalThis.fetch = async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } })
  paymentHandlers.registerAdapter(new prism.PrismPaymentHandler({ apiUrl: "https://gw.example", apiKey: "test-key" }))
}

const ctx = { storeName: "Demo Store", storefrontUrl: "https://store.test", ucpVersion: "2026-04-08", acpVersion: "2026-01-30", paymentHandlers }
const checkout = input("checkout.json")
const errors = input("errors.json")

mkdirSync(outDir, { recursive: true })
write("profile.json", await core.formatUcpProfile(ctx, "https://store.test/api/ucp"))
write("checkout__create.json", core.formatUcpCheckoutSession(ctx, checkout))
write("checkout__complete.json", core.formatUcpCompleteResponse(ctx, checkout, input("order-confirmation.json")))
write("error__invalid_instrument.json", core.formatUcpError({ ucpVersion: ctx.ucpVersion, ...errors.invalid_instrument }))
