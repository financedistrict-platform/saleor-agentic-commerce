import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import { PACKAGE_VERSION } from "./package-version.js"
import { PACKAGE_VERSION as PRISM_PACKAGE_VERSION } from "../../prism-payment/src/package-version.js"

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const manifestVersion = (pkg: string) => JSON.parse(readFileSync(join(PACKAGES, pkg, "package.json"), "utf8")).version

describe("generated package versions", () => {
  it.each([
    ["core", PACKAGE_VERSION],
    ["prism-payment", PRISM_PACKAGE_VERSION],
  ])("match the %s package.json", (pkg, version) => {
    expect(version).toBe(manifestVersion(pkg))
  })
})
