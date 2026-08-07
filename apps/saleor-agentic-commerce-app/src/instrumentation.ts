/**
 * Next.js server-startup hook. Runs the APL boot canary so a misconfigured or
 * unreachable token store fails the deploy immediately, rather than silently at
 * the next restart when the install token is already lost (GH-62).
 *
 * Requires `experimental.instrumentationHook: true` in next.config.js (Next 14).
 */
export async function register(): Promise<void> {
  // Node-only: the token store isn't reachable from the edge runtime. The
  // positive `NEXT_RUNTIME === "nodejs"` guard is Next's documented pattern —
  // Next statically replaces NEXT_RUNTIME per bundle, so this block (and the
  // node-only APL deps it imports) is dead-code-eliminated from the edge build.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getApl, assertAplReady } = await import("./lib/saleor-app")
    const backend = process.env.APL ?? "(unset)"
    try {
      await assertAplReady(await getApl())
      console.log(`[apl] boot canary OK — APL=${backend}`)
    } catch (err) {
      console.error(
        `[apl] BOOT CANARY FAILED — APL=${backend}: ${err instanceof Error ? err.message : String(err)}`,
      )
      throw err
    }
  }
}
