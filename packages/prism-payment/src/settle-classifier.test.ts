import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import {
  classifySettleReply,
  DECLINED_PREFIXES,
  DECLINED_REASONS,
  HTTP_PENDING_STATUSES,
  PENDING_REASONS,
  REVIEW_REASONS,
} from "./settle-classifier.js"
import type { SettleClass } from "./settle-classifier.js"

type SettleRow = { name: string; http: number; body: unknown; first: SettleClass; resume: SettleClass }

type SettleFixture = {
  pendingReasons: string[]
  reviewReasons: string[]
  declinedReasons: string[]
  declinedPrefixes: string[]
  httpPendingStatuses: number[]
  rows: SettleRow[]
}

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture: SettleFixture = JSON.parse(readFileSync(join(HERE, "__fixtures__", "settle-replies.json"), "utf8"))
const rows = fixture.rows.map((row) => [row.name, row] as const)

describe("classifySettleReply", () => {
  it.each(rows)("settle contract: %s first", (_name, row) => {
    expect(classifySettleReply(row.http, row.body, false)).toBe(row.first)
  })

  it.each(rows)("settle contract: %s resume", (_name, row) => {
    expect(classifySettleReply(row.http, row.body, true)).toBe(row.resume)
  })

  it("settle contract: reason lists equal the fixture", () => {
    expect(new Set(PENDING_REASONS)).toEqual(new Set(fixture.pendingReasons))
    expect(new Set(REVIEW_REASONS)).toEqual(new Set(fixture.reviewReasons))
    expect(new Set(DECLINED_REASONS)).toEqual(new Set(fixture.declinedReasons))
    expect(new Set(DECLINED_PREFIXES)).toEqual(new Set(fixture.declinedPrefixes))
    expect(new Set(HTTP_PENDING_STATUSES)).toEqual(new Set(fixture.httpPendingStatuses))
  })

  it.each([
    ["a success with a transaction", 200, { success: true, transaction: "0x1" }, false, "settled"],
    ["a success without a transaction", 200, { success: true }, false, "pending"],
    ["no body", 200, null, false, "pending"],
    ["no answer", 0, null, false, "pending"],
    ["an HTTP 503", 503, null, false, "pending"],
    ["an HTTP 400 on the first attempt", 400, null, false, "declined"],
    ["an HTTP 400 on a resume", 400, null, true, "review"],
    ["a failure without a reason", 200, { success: false }, false, "pending"],
  ] as const)("classifies %s", (_case, status, body, resumed, expected) => {
    expect(classifySettleReply(status, body, resumed)).toBe(expected)
  })
})
