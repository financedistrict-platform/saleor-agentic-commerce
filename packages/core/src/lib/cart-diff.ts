/**
 * Full-replacement cart planning for UCP `PUT` checkout updates.
 *
 * UCP defines Update Checkout (PUT) as a full replacement of the checkout
 * resource (checkout.md → Update Checkout), so `line_items` in the body is the
 * complete desired cart — not a partial merge. Given the current cart lines and
 * the desired set, this computes which lines to delete (variants the agent
 * omitted), add (new variants), and update (changed quantity).
 *
 * Pure — no I/O. The caller applies the plan via the Saleor client. Fixes U-2,
 * where omitted lines were silently retained (the cart was append/modify-only).
 */

export type CurrentCartLine = { id: string; variantId: string; quantity: number }
export type DesiredCartLine = { variantId: string; quantity: number }

export type CartReplacementPlan = {
  toDelete: string[]
  toAdd: { variantId: string; quantity: number }[]
  toUpdate: { lineId: string; quantity: number }[]
}

export function planCartReplacement(
  current: CurrentCartLine[],
  desired: DesiredCartLine[],
): CartReplacementPlan {
  const desiredByVariant = new Map<string, number>()
  for (const d of desired) {
    if (!d.variantId) continue
    // Duplicate variants in the desired set accumulate into one quantity.
    desiredByVariant.set(d.variantId, (desiredByVariant.get(d.variantId) ?? 0) + (d.quantity ?? 1))
  }

  const currentByVariant = new Map(current.map((l) => [l.variantId, l]))

  const toDelete = current
    .filter((l) => !desiredByVariant.has(l.variantId))
    .map((l) => l.id)

  const toAdd: { variantId: string; quantity: number }[] = []
  const toUpdate: { lineId: string; quantity: number }[] = []
  for (const [variantId, quantity] of desiredByVariant) {
    const existing = currentByVariant.get(variantId)
    if (!existing) {
      toAdd.push({ variantId, quantity })
    } else if (existing.quantity !== quantity) {
      toUpdate.push({ lineId: existing.id, quantity })
    }
  }

  return { toDelete, toAdd, toUpdate }
}
