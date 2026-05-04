# Contributing

Thanks for considering a contribution. This project is MIT-licensed and built to be open: anyone can build a handler, anyone can fork the App, anyone can run their own deployment.

## Getting oriented

- **[Wiki](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki)** — architecture, integration guides, handler authoring
- **[Quick Start](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Quick-Start)** — get running locally
- **[Architecture](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Architecture)** — the gateway pattern and design framing

## Reporting issues

[File an issue](https://github.com/financedistrict-platform/saleor-agentic-commerce/issues). Useful info:
- What you ran (Path A / B / C? which packages, which versions?)
- What you expected
- What happened (logs, response bodies, screenshots)
- Whether it reproduces consistently

If you're hitting an SDK bug that's clearly the SDK's fault and you have a fix, a PR is welcome — see below.

## Pull requests

Small + focused is best. Some guidance:

- **One concern per PR.** A PR that fixes a bug *and* refactors three files is hard to review and risky to land.
- **Tests.** If you're changing behavior, exercise the new code path. The repo currently has lighter test coverage than ideal — adding tests around your change is a good complement.
- **Run the build.** `pnpm -r build` should pass. CI will catch this anyway, but locally is faster.
- **Add a changeset.** If your PR changes any published package, run `pnpm changeset` and commit the generated `.changeset/*.md` file. Pick the bump type (patch/minor/major) per package and write a one-line summary — that summary lands in the CHANGELOG. Don't edit `package.json` versions directly; the release workflow does that.

### Release flow (automated)

Releases run via [Changesets](https://github.com/changesets/changesets) and the GitHub Action in `.github/workflows/release.yml`:

1. Each PR that changes a published package adds a changeset.
2. On merge to `main`, the workflow opens (or updates) a `chore: version packages` PR that consumes the changesets, bumps versions, and updates CHANGELOGs.
3. Merging that PR triggers `changeset publish` and the packages go to npm.

If you're a maintainer and need to release manually (rare), run `pnpm version` then `pnpm release` locally with a valid `NPM_TOKEN`.

### Protocol-bump policy

When changing a UCP/ACP protocol type that ripples through `core`, `nextjs`, and the handler packages, write a changeset that bumps **all** affected packages together (typically `minor` while pre-1.0). The changeset CLI lets you select multiple packages in one entry — use that.

For larger changes, open an issue first to discuss the direction. Saves both sides time.

## Building a handler package

If you're shipping your own payment handler (Stripe, Klarna, anything), it doesn't go in this repo — it lives in your own. See the **[Build a Handler](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Build-a-Handler)** wiki page for the conventions, the `PaymentHandlerAdapter` interface, and the manifest format.

The `@financedistrict/saleor-prism-payment` and `@financedistrict/saleor-dummy-payment` packages in this repo are reference implementations. Handlers built outside this repo work the same way — register with the App via `registerHandler()`, dispatch in the storefront's `paymentHandlerFactory`, no SDK changes needed.

## Local development

```bash
pnpm install
pnpm -r build
```

To work on the App + an SDK package together, use `pnpm link` or workspace protocol references. The `fd-grocery-store` reference storefront (separate repo) is a useful integration test target.

## Code of Conduct

By participating, you agree to abide by the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Report concerns to `developers@fd.xyz`.

## Roadmap & strategic direction

The project is built for eventual handover to a neutral steward (e.g. Saleor, a protocol foundation). Finance District operates the hosted App today and ships the Prism handler — but the SDK and protocol surface are deliberately neutral. See [Architecture: The gateway pattern](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Architecture) and [The App is Optional](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/The-App-is-Optional) on the wiki for the framing.

If you're interested in helping shape the project's direction, the highest-leverage contributions today are:
- **New handler packages** (Stripe, Klarna, etc.) shipped from your own repos
- **Reference implementations on platforms other than Saleor** — the protocol gateway pattern generalizes
- **Documentation** — wiki pages on edge cases, troubleshooting, integration patterns
