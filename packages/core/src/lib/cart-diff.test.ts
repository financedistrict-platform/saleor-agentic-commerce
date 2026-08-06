import { describe, it, expect } from "vitest"
import { planCartReplacement } from "./cart-diff.js"

describe("planCartReplacement — full-replacement PUT semantics (U-2)", () => {
  it("deletes lines whose variant is omitted from the desired set", () => {
    const plan = planCartReplacement(
      [
        { id: "line-a", variantId: "var-a", quantity: 1 },
        { id: "line-b", variantId: "var-b", quantity: 1 },
      ],
      [{ variantId: "var-a", quantity: 1 }],
    )
    expect(plan.toDelete).toEqual(["line-b"])
    expect(plan.toAdd).toEqual([])
    expect(plan.toUpdate).toEqual([])
  })

  it("adds variants not currently in the cart", () => {
    const plan = planCartReplacement(
      [{ id: "line-a", variantId: "var-a", quantity: 1 }],
      [
        { variantId: "var-a", quantity: 1 },
        { variantId: "var-c", quantity: 3 },
      ],
    )
    expect(plan.toAdd).toEqual([{ variantId: "var-c", quantity: 3 }])
    expect(plan.toDelete).toEqual([])
    expect(plan.toUpdate).toEqual([])
  })

  it("updates quantity for existing variants that changed", () => {
    const plan = planCartReplacement(
      [{ id: "line-a", variantId: "var-a", quantity: 1 }],
      [{ variantId: "var-a", quantity: 5 }],
    )
    expect(plan.toUpdate).toEqual([{ lineId: "line-a", quantity: 5 }])
    expect(plan.toAdd).toEqual([])
    expect(plan.toDelete).toEqual([])
  })

  it("leaves unchanged lines alone", () => {
    const plan = planCartReplacement(
      [{ id: "line-a", variantId: "var-a", quantity: 2 }],
      [{ variantId: "var-a", quantity: 2 }],
    )
    expect(plan).toEqual({ toDelete: [], toAdd: [], toUpdate: [] })
  })

  it("empties the cart when the desired set is empty", () => {
    const plan = planCartReplacement(
      [
        { id: "line-a", variantId: "var-a", quantity: 1 },
        { id: "line-b", variantId: "var-b", quantity: 1 },
      ],
      [],
    )
    expect(plan.toDelete.sort()).toEqual(["line-a", "line-b"])
  })

  it("accumulates duplicate desired variants into one quantity", () => {
    const plan = planCartReplacement(
      [],
      [
        { variantId: "var-a", quantity: 1 },
        { variantId: "var-a", quantity: 2 },
      ],
    )
    expect(plan.toAdd).toEqual([{ variantId: "var-a", quantity: 3 }])
  })
})
