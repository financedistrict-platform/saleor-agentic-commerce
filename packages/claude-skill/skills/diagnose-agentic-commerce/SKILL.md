---
name: diagnose-agentic-commerce
description: Diagnose and fix issues with Saleor Agentic Commerce SDK setup. Use when UCP endpoints return errors, agents can't discover the store, checkouts fail, or payment handlers don't work.
allowed-tools: Read Bash Glob Grep
---

# Diagnose Agentic Commerce Issues

You are helping a developer troubleshoot their Saleor Agentic Commerce integration. Run through the diagnostic checks systematically and report what's wrong.

## Diagnostic Checklist

### 1. Package Installation

Check `package.json` for:
- `@financedistrict/saleor-agentic-commerce-core` — required
- `@financedistrict/saleor-agentic-commerce-nextjs` — required for Next.js
- `@financedistrict/saleor-prism-payment` — required only if using Prism payments

Verify they're actually installed:
```bash
ls node_modules/@financedistrict/ 2>/dev/null || echo "Packages not installed — run npm install"
```

Check for version mismatches between core and nextjs (they should be the same minor version).

### 2. Configuration File

Search for the `createAgenticCommerce()` call:
```
Grep for "createAgenticCommerce" across .ts and .tsx files
```

Check the config for:
- ✅ `saleorApiUrl` — must be set (usually from env var)
- ✅ `saleorAuthToken` — must be set (Saleor App Token, not user token)
- ✅ `storefrontUrl` — must be set (public URL)
- ✅ `storeName` — must be set (unless using `configFromApp: true`)
- ⚠️ `paymentHandlers` — empty array means no payment methods for agents

### 3. Environment Variables

Read `.env.local`, `.env`, and `.env.development` to check:
- `NEXT_PUBLIC_SALEOR_API_URL` or `SALEOR_API_URL` — Saleor GraphQL endpoint
- `SALEOR_AGENTIC_AUTH_TOKEN` — non-empty, starts with expected format
- `NEXT_PUBLIC_STOREFRONT_URL` — valid URL, no trailing slash
- `SALEOR_AGENTIC_STORE_NAME` — non-empty

If using Prism:
- `PRISM_API_URL` — defaults to `https://prism-gw.fd.xyz` if empty
- `PRISM_API_KEY` — must be set

**Never show env var values in output.** Only report whether they're set/unset.

### 4. Route Handlers

Check for UCP route handlers. Search for files matching these paths:
- `app/api/ucp/route.ts` or `src/app/api/ucp/route.ts`
- `app/api/ucp/checkout/route.ts`
- `app/api/ucp/checkout/[id]/route.ts`
- `app/api/ucp/checkout/[id]/complete/route.ts`
- `app/api/ucp/orders/[id]/route.ts`

For each file found, verify:
- It imports from the correct packages
- It exports the correct HTTP method handlers (GET, POST)
- It uses the shared `agenticCommerce` instance

### 5. Live Endpoint Test

If the dev server is running, test the discovery endpoint:

```bash
curl -s http://localhost:3000/api/ucp 2>/dev/null | head -50
```

Check the response for:
- Valid JSON response (not HTML error page)
- `store_name` present and non-empty
- `payment_handlers` array present (even if empty)
- `ucp_version` field present
- No error objects in response

### 6. Common Issues and Fixes

**"Module not found" errors:**
- Check `tsconfig.json` for path aliases — `@/` should map to `./src/` or `./`
- Verify the import path matches: `@/lib/agentic-commerce` vs actual file location

**Discovery endpoint returns 500:**
- Usually means env vars are missing. Check the server console for the actual error.
- `saleorAuthToken is required` → `SALEOR_AGENTIC_AUTH_TOKEN` not set
- `storeName is required` → `SALEOR_AGENTIC_STORE_NAME` not set

**Checkout creation returns 400:**
- Saleor API URL might be wrong or unreachable
- Auth token might lack `MANAGE_CHECKOUTS` permission
- Channel might not exist — check `channel` config or Saleor Dashboard

**Payment handler not appearing in discovery:**
- `paymentHandlers` array is empty in the config
- Prism package not installed
- Handler constructor is failing silently (check for missing env vars)

**"Checkout not found" on GET:**
- Checkout IDs in Saleor are UUIDs — check the ID format
- Checkout might have expired (Saleor has configurable checkout TTL)

**CORS errors when agents call endpoints:**
- Next.js doesn't add CORS headers by default
- Add a middleware or headers to the route handlers:
  ```typescript
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, UCP-Agent",
  }
  ```

## Report Format

After running diagnostics, present a summary:

```
## Agentic Commerce Diagnostic Report

### Status: [✅ Healthy | ⚠️ Issues Found | ❌ Not Working]

### Packages
- core: [version] ✅
- nextjs: [version] ✅
- prism-payment: [not installed | version] ⚠️

### Configuration
- saleorApiUrl: ✅ set
- saleorAuthToken: ✅ set
- storefrontUrl: ✅ set
- storeName: ✅ set
- paymentHandlers: ⚠️ none configured

### Route Handlers
- GET  /api/ucp: ✅
- POST /api/ucp/checkout: ✅
- GET  /api/ucp/checkout/[id]: ❌ missing
- POST /api/ucp/checkout/[id]/complete: ❌ missing
- GET  /api/ucp/orders/[id]: ✅

### Issues
1. [Description of issue and how to fix it]
2. [Description of issue and how to fix it]
```
