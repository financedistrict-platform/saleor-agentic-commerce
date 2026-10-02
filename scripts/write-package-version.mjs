import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"))
writeFileSync(join(process.cwd(), "src", "package-version.ts"), `export const PACKAGE_VERSION = "${version}"\n`)
