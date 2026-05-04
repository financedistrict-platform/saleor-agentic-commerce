# Contributing

Thanks for considering a contribution. This project is MIT-licensed and built to be open: anyone can build a handler, anyone can fork the App, anyone can run their own deployment.

## Getting oriented

- **[Wiki](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki)** — architecture, integration guides, handler authoring
- **[Quick Start](https://github.com/financedistrict-platform/saleor-agentic-commerce/wiki/Quick-Start)** — get running locally
- **[Design doc](docs/handler-registry-design.md)** — the handler-registry architecture and the framing decisions behind it
- **[TODO](docs/TODO.md)** — current backlog and known gaps

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
- **Don't bump versions in your PR.** Releases are batched (today: manual `pnpm -r publish`; eventually automated). Maintainers handle version bumps.

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

The project is built for eventual handover to a neutral steward (e.g. Saleor, a protocol foundation). Finance District operates the hosted App today and ships the Prism handler — but the SDK and protocol surface are deliberately neutral. The design doc ([§1](docs/handler-registry-design.md#1-framing--neutral-protocol-gateway), [§13](docs/handler-registry-design.md#13-the-app-is-a-convenience-layer-not-a-runtime-dependency)) explains the framing.

If you're interested in helping shape the project's direction, the highest-leverage contributions today are:
- **New handler packages** (Stripe, Klarna, etc.) shipped from your own repos
- **Reference implementations on platforms other than Saleor** — the protocol gateway pattern generalizes
- **Documentation** — wiki pages on edge cases, troubleshooting, integration patterns
