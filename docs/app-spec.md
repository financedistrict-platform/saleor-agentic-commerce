# Saleor Agentic Commerce App — Specification

## Overview

A Saleor App that acts as the **control plane** for the Saleor Agentic Commerce SDK. Merchants install the App from the Saleor Dashboard to configure, manage, and monitor AI agent commerce without editing code or environment variables.

The App does not replace the SDK — it configures it. The SDK remains the runtime that serves protocol endpoints from the storefront. The App provides the Dashboard UI, stores configuration in Saleor metadata, provisions auth tokens, and receives webhooks to keep order lifecycle data flowing to agents.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Saleor Dashboard                                           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Agentic Commerce App (iframe)                        │  │
│  │  - Enable/disable per channel                         │  │
│  │  - Configure payment handlers                         │  │
│  │  - View agent activity                                │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────┬───────────────────────────────────────────────┘
              │ App Metadata (config)
              │ Webhooks (order lifecycle)
              ▼
┌─────────────────────────┐        ┌──────────────────────────┐
│  Saleor Backend         │◄──────►│  Agentic Commerce App    │
│  (GraphQL API)          │        │  (Next.js service)       │
└─────────┬───────────────┘        └──────────────────────────┘
          │
          │ GraphQL (same API)
          ▼
┌─────────────────────────────────────────────────────────────┐
│  Merchant Storefront (Next.js)                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  SDK reads config from App Metadata at runtime        │  │
│  │  - @financedistrict/saleor-agentic-commerce-core      │  │
│  │  - @financedistrict/saleor-agentic-commerce-nextjs    │  │
│  │  - @financedistrict/saleor-prism-payment              │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  UCP/ACP Endpoints ◄──── AI Agents                    │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## App Identity

| Field | Value |
|-------|-------|
| **Name** | Agentic Commerce |
| **ID** | `xyz.fd.saleor-agentic-commerce` |
| **Author** | Finance District |
| **Category** | Sales channels |

## Permissions

| Permission | Reason |
|------------|--------|
| `MANAGE_CHECKOUTS` | Read/write checkout sessions for agent transactions |
| `MANAGE_ORDERS` | Read order data, update order metadata with agent tracking |
| `MANAGE_CHANNELS` | List available channels for per-channel configuration |
| `MANAGE_PRODUCTS` | Future: catalog discovery for UCP catalog search |
| `MANAGE_SHIPPING` | Read shipping methods for fulfillment option formatting |

## Configuration Storage

All configuration stored in Saleor's **App privateMetadata** using the EncryptedMetadataManager from `@saleor/app-sdk`. This means config lives in the Saleor database, not in the App's own storage.

### Metadata Keys

Prefix: `agentic_commerce__`

#### Global Settings

| Key | Type | Description |
|-----|------|-------------|
| `agentic_commerce__enabled` | `boolean` | Master kill switch |
| `agentic_commerce__store_name` | `string` | Store name for UCP/ACP discovery profiles |
| `agentic_commerce__store_description` | `string?` | Store description for discovery profiles |
| `agentic_commerce__ucp_enabled` | `boolean` | Enable UCP protocol |
| `agentic_commerce__acp_enabled` | `boolean` | Enable ACP protocol |
| `agentic_commerce__acp_api_key` | `string` | Auto-generated API key for ACP Bearer auth |

#### Per-Channel Settings

Stored as JSON under channel-scoped keys:

| Key | Type | Description |
|-----|------|-------------|
| `agentic_commerce__channel__{slug}` | `ChannelConfig` | Per-channel configuration |

```ts
type ChannelConfig = {
  enabled: boolean
  // Which protocols are active for this channel
  protocols: ("ucp" | "acp")[]
  // Payment handlers enabled for this channel
  payment_handlers: PaymentHandlerConfig[]
}
```

#### Payment Handler Settings

```ts
type PaymentHandlerConfig = {
  handler_id: string            // e.g., "xyz.fd.prism_payment"
  enabled: boolean
  config: Record<string, unknown>
}

// Prism-specific config
type PrismConfig = {
  api_url: string               // Prism Gateway URL
  api_key: string               // Prism API key (encrypted)
  webhook_secret: string        // HMAC signing secret (encrypted)
  accepted_tokens: string[]     // e.g., ["USDC", "FDUSD"]
  accepted_chains: string[]     // e.g., ["base", "bsc"]
  merchant_wallet: string       // Settlement wallet address
}
```

### How the SDK Reads Config

The SDK already receives a Saleor App Token during storefront setup. At runtime, the SDK's `createAgenticCommerce()` gains an optional `configFromMetadata: true` flag. When set, the SDK calls Saleor's `app.privateMetadata` query on startup to load all `agentic_commerce__*` keys, instead of reading from environment variables.

```ts
// Before (env-based config)
const agenticCommerce = createAgenticCommerce({
  saleorApiUrl: process.env.NEXT_PUBLIC_SALEOR_API_URL!,
  saleorAuthToken: process.env.SALEOR_AGENTIC_AUTH_TOKEN!,
  storefrontUrl: process.env.NEXT_PUBLIC_STOREFRONT_URL!,
  storeName: process.env.SALEOR_AGENTIC_STORE_NAME!,
  paymentHandlers: [new PrismPaymentHandler({ ... })],
})

// After (App-managed config)
const agenticCommerce = await createAgenticCommerce({
  saleorApiUrl: process.env.NEXT_PUBLIC_SALEOR_API_URL!,
  saleorAuthToken: process.env.SALEOR_AGENTIC_AUTH_TOKEN!,
  storefrontUrl: process.env.NEXT_PUBLIC_STOREFRONT_URL!,
  configFromApp: true,  // Load everything else from App metadata
})
```

The `configFromApp` path:
1. Queries `app { privateMetadata { key value } }` via Saleor GraphQL
2. Decrypts and parses all `agentic_commerce__*` keys
3. Constructs the `AgenticCommerceConfig` from the metadata
4. Instantiates payment handlers based on `payment_handlers` config
5. Caches the config with a configurable TTL (default: 60s)

Env-based config continues to work as a fallback and for development.

## Dashboard UI

### Extension Mount Points

| Mount | Target | Purpose |
|-------|--------|---------|
| `APP_PAGE` (nav item) | `APP_PAGE` | Main configuration page |
| `ORDER_DETAILS_WIDGETS` | `WIDGET` | Agent attribution on order detail page |

### Main Configuration Page

Accessible from Dashboard sidebar under "Apps > Agentic Commerce."

#### Tabs

**1. General**
- Master enable/disable toggle
- Store name and description
- Protocol toggles (UCP / ACP)
- ACP API key display (with regenerate button)
- SDK installation instructions (read-only, links to npm packages)

**2. Channels**
- List of all Saleor channels
- Per-channel toggle: enabled/disabled
- Per-channel protocol selection
- Per-channel payment handler assignment

**3. Payment Handlers**
- List of configured payment handlers
- "Add Payment Handler" button
- Prism configuration form:
  - API URL (text input, pre-filled with `https://prism-gw.fd.xyz`)
  - API Key (secret input)
  - Webhook Secret (secret input)
  - Accepted tokens (multi-select: USDC, FDUSD)
  - Accepted chains (multi-select: Base, BSC, Ethereum)
  - Merchant wallet address (text input with format validation)
  - "Test Connection" button — calls Prism `/api/v2/merchant/payment-profile` to verify credentials

**4. Activity**
- Recent agent checkout sessions (last 7 days)
- Table: session ID, agent profile, status, amount, created at
- Filterable by channel, status, date range
- Links to Saleor order (if completed)

### Order Details Widget

Embedded in the order detail page. Shows:
- Whether the order was created by an AI agent
- Agent profile URL (from UCP-Agent header)
- Protocol used (UCP or ACP)
- Payment handler used
- Settlement transaction hash (for Prism: links to block explorer)

Data source: order `privateMetadata` written by the SDK during checkout completion.

## Webhooks

### Subscriptions

| Event | Purpose |
|-------|---------|
| `ORDER_CREATED` | Log agent-created orders, update activity dashboard |
| `ORDER_UPDATED` | Track status transitions for agent order queries |
| `ORDER_FULFILLED` | Update fulfillment events in cached order data |
| `ORDER_CANCELLED` | Update status for agent order queries |
| `FULFILLMENT_CREATED` | Write fulfillment expectations/events to order metadata |
| `CHECKOUT_CREATED` | Track agent checkout sessions for activity dashboard |

### Webhook Payloads

Each webhook subscription includes a GraphQL query that selects the fields needed:

```graphql
# ORDER_CREATED subscription
subscription {
  event {
    ... on OrderCreated {
      order {
        id
        number
        status
        channel { slug }
        total { gross { amount currency } }
        shippingAddress { firstName lastName city country { code } }
        privateMetadata { key value }
        fulfillments {
          id
          status
          trackingNumber
          lines { id quantity orderLine { id } }
        }
      }
    }
  }
}
```

### Webhook Processing

**ORDER_CREATED / ORDER_UPDATED:**
1. Check `privateMetadata` for `agentic_commerce__agent_session` key
2. If present → this is an agent-created order
3. Write/update `agentic_commerce__order_events` metadata with UCP-format fulfillment events
4. Log to activity tracking

**FULFILLMENT_CREATED:**
1. Read the associated order's `privateMetadata`
2. If agent order → append fulfillment event to `agentic_commerce__order_events`:
   ```json
   {
     "id": "evt_fulfillment_abc",
     "type": "fulfillment_created",
     "timestamp": "2026-04-12T10:30:00Z",
     "fulfillment_id": "abc",
     "tracking_number": "1Z999AA10123456784",
     "status": "shipped",
     "line_items": [{"id": "line_1", "quantity": 2}]
   }
   ```
3. The SDK reads these events when formatting `GET /orders/{id}` responses, populating the UCP `fulfillment.events[]` array

## Manifest

```json
{
  "id": "xyz.fd.saleor-agentic-commerce",
  "version": "0.1.0",
  "requiredSaleorVersion": "^3.13",
  "name": "Agentic Commerce",
  "author": "Finance District",
  "about": "Make your store shoppable by AI agents. Adds UCP and ACP protocol support with configurable payment handlers.",
  "permissions": [
    "MANAGE_CHECKOUTS",
    "MANAGE_ORDERS",
    "MANAGE_CHANNELS",
    "MANAGE_PRODUCTS",
    "MANAGE_SHIPPING"
  ],
  "appUrl": "{APP_URL}",
  "tokenTargetUrl": "{APP_URL}/api/register",
  "brand": {
    "logo": {
      "default": "{APP_URL}/logo.png"
    }
  },
  "webhooks": [
    {
      "name": "Order Created",
      "asyncEvents": ["ORDER_CREATED"],
      "query": "subscription { event { ... on OrderCreated { order { id number status channel { slug } total { gross { amount currency } } privateMetadata { key value } fulfillments { id status trackingNumber lines { id quantity orderLine { id } } } } } } }",
      "targetUrl": "{APP_URL}/api/webhooks/order-created",
      "isActive": true
    },
    {
      "name": "Order Updated",
      "asyncEvents": ["ORDER_UPDATED"],
      "query": "subscription { event { ... on OrderUpdated { order { id number status privateMetadata { key value } } } } }",
      "targetUrl": "{APP_URL}/api/webhooks/order-updated",
      "isActive": true
    },
    {
      "name": "Fulfillment Created",
      "asyncEvents": ["FULFILLMENT_CREATED"],
      "query": "subscription { event { ... on FulfillmentCreated { fulfillment { id status trackingNumber order { id privateMetadata { key value } } lines { id quantity orderLine { id } } } } } }",
      "targetUrl": "{APP_URL}/api/webhooks/fulfillment-created",
      "isActive": true
    },
    {
      "name": "Order Cancelled",
      "asyncEvents": ["ORDER_CANCELLED"],
      "query": "subscription { event { ... on OrderCancelled { order { id number status privateMetadata { key value } } } } }",
      "targetUrl": "{APP_URL}/api/webhooks/order-cancelled",
      "isActive": true
    }
  ],
  "extensions": [
    {
      "label": "Agentic Commerce",
      "mount": "NAVIGATION_CATALOG",
      "target": "APP_PAGE",
      "permissions": ["MANAGE_ORDERS"],
      "url": "/configuration"
    },
    {
      "label": "Agent Info",
      "mount": "ORDER_DETAILS_WIDGETS",
      "target": "WIDGET",
      "permissions": ["MANAGE_ORDERS"],
      "url": "/widgets/order-agent-info"
    }
  ]
}
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 14+ (App Router) |
| Saleor SDK | `@saleor/app-sdk` |
| UI | `@saleor/macaw-ui` (Dashboard design system) |
| Config Storage | `EncryptedMetadataManager` from app-sdk |
| Auth | Saleor JWKS verification for webhooks, App Token for API calls |
| Hosting | Any Node.js host (Vercel, Railway, self-hosted) |

## Project Structure

```
apps/saleor-agentic-commerce-app/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── manifest/route.ts          # App manifest endpoint
│   │   │   ├── register/route.ts          # Token registration
│   │   │   └── webhooks/
│   │   │       ├── order-created/route.ts
│   │   │       ├── order-updated/route.ts
│   │   │       ├── order-cancelled/route.ts
│   │   │       └── fulfillment-created/route.ts
│   │   ├── configuration/
│   │   │   └── page.tsx                   # Main config page (4 tabs)
│   │   └── widgets/
│   │       └── order-agent-info/
│   │           └── page.tsx               # Order detail widget
│   ├── lib/
│   │   ├── metadata-keys.ts              # Key constants and types
│   │   ├── config-manager.ts             # Read/write App config
│   │   ├── activity-tracker.ts           # Agent activity logging
│   │   └── saleor-api.ts                 # GraphQL client wrapper
│   └── components/
│       ├── GeneralSettings.tsx
│       ├── ChannelSettings.tsx
│       ├── PaymentHandlerSettings.tsx
│       ├── ActivityDashboard.tsx
│       └── OrderAgentWidget.tsx
├── package.json
├── next.config.js
└── tsconfig.json
```

## SDK Changes Required

### `@financedistrict/saleor-agentic-commerce-core`

1. **New: `loadConfigFromApp(saleorClient)`** — Fetches and parses App metadata into `AgenticCommerceConfig`
2. **New: `AgentSessionMetadata` type** — Structure written to checkout/order metadata to tag agent sessions
3. **Updated: `formatUcpOrder`** — Reads `agentic_commerce__order_events` from order metadata to populate `fulfillment.events[]`

### `@financedistrict/saleor-agentic-commerce-nextjs`

1. **Updated: `createAgenticCommerce`** — Accepts `configFromApp: true`, becomes async, loads config from metadata with caching
2. **New: Agent attribution middleware** — Writes `agentic_commerce__agent_session` to checkout metadata on first request (agent profile URL, protocol, timestamp)

### `@financedistrict/saleor-prism-payment`

1. **Updated: `PrismPaymentHandler` constructor** — Accepts config from metadata (structured `PrismConfig`) instead of only env vars
2. **New: Prism webhook handler** — Receives `payment.completed` / `settlement.completed` from Prism, updates order metadata with tx hash

## Implementation Phases

### Phase 1: Core App + Config UI
- App scaffold (manifest, registration, JWKS auth)
- Configuration page: General + Channels tabs
- Metadata read/write for global and per-channel settings
- SDK `configFromApp` support in core and nextjs packages
- **Milestone:** Merchant can install App, configure store name/channels, SDK reads config from Dashboard

### Phase 2: Payment Handler Management
- Payment Handlers tab with Prism configuration form
- Test Connection flow
- SDK auto-instantiates PrismPaymentHandler from metadata config
- **Milestone:** Merchant configures Prism entirely from Dashboard, no env vars for payment config

### Phase 3: Webhooks + Order Lifecycle
- Webhook handlers for ORDER_CREATED, ORDER_UPDATED, FULFILLMENT_CREATED, ORDER_CANCELLED
- Agent session attribution on checkouts
- Fulfillment events written to order metadata
- SDK reads events for UCP order responses
- **Milestone:** `GET /orders/{id}` returns real fulfillment tracking from Saleor events

### Phase 4: Activity Dashboard + Order Widget
- Activity tab with recent agent sessions
- Order details widget showing agent attribution
- Agent analytics (checkout count, conversion rate, GMV)
- **Milestone:** Full visibility into agent commerce activity from the Dashboard

## Package

| Field | Value |
|-------|-------|
| **npm package** | `@financedistrict/saleor-agentic-commerce-app` |
| **Repository** | `saleor-agentic-commerce` monorepo, `apps/` directory |
| **License** | MIT |
