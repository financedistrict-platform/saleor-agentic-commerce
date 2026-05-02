import type { AppManifest } from "@saleor/app-sdk/types"

export function createManifest(appUrl: string): AppManifest {
  return {
    id: "xyz.fd.saleor-agentic-commerce",
    version: "0.1.0",
    requiredSaleorVersion: "^3.13",
    name: "Agentic Commerce",
    author: "Finance District",
    about:
      "Make your store shoppable by AI agents. Adds UCP and ACP protocol support with configurable payment handlers.",
    // Least-privilege permission set for the control-plane App:
    //   - MANAGE_ORDERS: required for the 4 webhook subscriptions
    //     (ORDER_CREATED, ORDER_UPDATED, ORDER_CANCELLED, FULFILLMENT_CREATED)
    //     and the ORDER_DETAILS_WIDGETS extension.
    //   - MANAGE_CHANNELS: required by ChannelSettings.tsx to list the
    //     merchant's channels and configure per-channel storefront URLs.
    //
    // Previously also requested MANAGE_CHECKOUTS, MANAGE_PRODUCTS,
    // MANAGE_SHIPPING — those aren't used by THIS App (the control plane).
    // The separate agentic-storefront service-account App holds the
    // checkout/order write permissions for the live storefront flow.
    // If a future feature needs broader access, expand here deliberately.
    permissions: [
      "MANAGE_ORDERS",
      "MANAGE_CHANNELS",
    ],
    appUrl,
    tokenTargetUrl: `${appUrl}/api/register`,
    brand: {
      logo: {
        default: `${appUrl}/logo.png`,
      },
    },
    webhooks: [
      {
        name: "Order Created",
        asyncEvents: ["ORDER_CREATED"],
        query: `subscription { event { ... on OrderCreated { order { id number status channel { slug } total { gross { amount currency } } privateMetadata { key value } fulfillments { id status trackingNumber lines { id quantity orderLine { id } } } } } } }`,
        targetUrl: `${appUrl}/api/webhooks/order-created`,
        isActive: true,
      },
      {
        name: "Order Updated",
        asyncEvents: ["ORDER_UPDATED"],
        query: `subscription { event { ... on OrderUpdated { order { id number status privateMetadata { key value } } } } }`,
        targetUrl: `${appUrl}/api/webhooks/order-updated`,
        isActive: true,
      },
      {
        name: "Fulfillment Created",
        asyncEvents: ["FULFILLMENT_CREATED"],
        query: `subscription { event { ... on FulfillmentCreated { fulfillment { id status trackingNumber lines { id quantity orderLine { id } } } order { id privateMetadata { key value } } } } }`,
        targetUrl: `${appUrl}/api/webhooks/fulfillment-created`,
        isActive: true,
      },
      {
        name: "Order Cancelled",
        asyncEvents: ["ORDER_CANCELLED"],
        query: `subscription { event { ... on OrderCancelled { order { id number status privateMetadata { key value } } } } }`,
        targetUrl: `${appUrl}/api/webhooks/order-cancelled`,
        isActive: true,
      },
    ],
    extensions: [
      {
        label: "Agentic Commerce",
        mount: "NAVIGATION_CATALOG",
        target: "APP_PAGE",
        permissions: ["MANAGE_ORDERS"],
        url: "/configuration",
      },
      {
        label: "Agent Info",
        mount: "ORDER_DETAILS_WIDGETS",
        target: "WIDGET",
        permissions: ["MANAGE_ORDERS"],
        url: "/widgets/order-agent-info",
      },
    ],
  } as AppManifest
}
