import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import { PACKAGE_VERSION } from "./package-version.js"

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const manifestVersion = (pkg: string) => JSON.parse(readFileSync(join(PACKAGES, pkg, "package.json"), "utf8")).version

describe("generated package version", () => {
  it("matches the core package.json", () => {
    expect(PACKAGE_VERSION).toBe(manifestVersion("core"))
  })
})
