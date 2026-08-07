# @financedistrict/saleor-agentic-commerce-app

Saleor Dashboard App — the **control plane** for Agentic Commerce. Configure AI-agent
access, payment handlers, and monitor order activity from the Saleor Dashboard.

> This App is the control plane only — it does **not** serve the UCP/ACP endpoints.
> Those come from the SDK packages (`-core`, `-nextjs`, `-prism-payment`) installed
> in your storefront. See the repo-root README, "Two things, not one".

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ffinancedistrict-platform%2Fsaleor-agentic-commerce&root-directory=apps%2Fsaleor-agentic-commerce-app&env=SALEOR_API_URL,SECRET_KEY,APL,UPSTASH_URL,UPSTASH_TOKEN&envDescription=SALEOR_API_URL%3A%20your%20Saleor%20GraphQL%20endpoint.%20SECRET_KEY%3A%20random%2032%2B%20chars.%20APL%3A%20set%20to%20upstash.%20UPSTASH_URL%2FUPSTASH_TOKEN%3A%20from%20a%20free%20Upstash%20Redis%20database.&project-name=saleor-agentic-commerce-app&repository-name=saleor-agentic-commerce-app)

### Quick deploy (Vercel / serverless)

1. Click the button.
2. `SALEOR_API_URL` — your Saleor instance's GraphQL endpoint.
3. `SECRET_KEY` — a random 32+ character string.
4. `APL=upstash`. Serverless has no persistent disk, so a durable token store is
   **required** (`file`/`env` lose the token on every redeploy). Create a free
   Upstash Redis database and set `UPSTASH_URL` + `UPSTASH_TOKEN`.
5. Deploy — Vercel provides the public URL automatically (used as `APP_URL`).
6. Saleor Dashboard → Apps → **Install from manifest URL**:
   `https://<your-vercel-url>/api/manifest`

### Self-hosted (Docker / VM)

Set `APL=redis` (a durable Redis/Valkey you run — most Saleor stacks already ship
one) or `APL=dynamodb` (on AWS). Full runbook, the APL backend table, and the
critical ordering rule are in [DEPLOYMENT.md](./DEPLOYMENT.md).

## The token store (APL) — read before deploying

The App receives its Saleor auth token **once**, at install, and stores it in the
backend named by the `APL` env var. That store **must be durable**: if a
restart/redeploy loses the token, the App goes dark until it's reinstalled
(GH-62). There is no default — pick one by what you already run:

| your situation | `APL` |
|---|---|
| Self-hosted, Redis/Valkey in the stack | `redis` (needs `REDIS_URL`) |
| On AWS (ECS/Lambda, IAM) | `dynamodb` (needs `DYNAMODB_TABLE`) |
| Serverless / Vercel | `upstash` (needs `UPSTASH_URL` + `UPSTASH_TOKEN`) |
| Local development only | `file` (refuses to run in production) |

An unknown or missing `APL` value makes the App refuse to start — it will never
silently fall back to a throwaway file. Set `APL` (and its connection env)
**before** installing: the token is issued only once, so the store must be
working when Saleor first POSTs it. See DEPLOYMENT.md for the caveats
(changing `APL` strands the token; Redis eviction policy).
