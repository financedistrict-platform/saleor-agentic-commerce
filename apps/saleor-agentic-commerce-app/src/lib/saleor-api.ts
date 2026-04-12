/**
 * Lightweight GraphQL client for Saleor API calls.
 *
 * Used by the App to read/write metadata and query channels.
 * No external GraphQL client dependency — uses fetch directly.
 */

type GraphQLResponse<T = unknown> = {
  data?: T
  errors?: Array<{ message: string; path?: string[] }>
}

export class SaleorApiClient {
  constructor(
    private readonly apiUrl: string,
    private readonly token: string
  ) {}

  async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ query, variables }),
    })

    if (!response.ok) {
      throw new Error(`Saleor API error: ${response.status} ${response.statusText}`)
    }

    const json = (await response.json()) as GraphQLResponse<T>

    if (json.errors?.length) {
      throw new Error(`Saleor GraphQL error: ${json.errors.map((e) => e.message).join(", ")}`)
    }

    return json.data as T
  }
}

// ─── Queries ────────────────────────────────────────────────

export const QUERIES = {
  GET_APP_METADATA: `
    query GetAppMetadata {
      app {
        id
        privateMetadata {
          key
          value
        }
      }
    }
  `,

  GET_CHANNELS: `
    query GetChannels {
      channels {
        id
        slug
        name
        currencyCode
        isActive
      }
    }
  `,

  GET_ORDER: `
    query GetOrder($id: ID!) {
      order(id: $id) {
        id
        number
        status
        channel { slug }
        total { gross { amount currency } }
        privateMetadata { key value }
        fulfillments {
          id
          status
          trackingNumber
          lines { id quantity orderLine { id } }
        }
      }
    }
  `,
}

export const MUTATIONS = {
  UPDATE_APP_METADATA: `
    mutation UpdateAppMetadata($id: ID!, $input: [MetadataInput!]!) {
      updatePrivateMetadata(id: $id, input: $input) {
        errors {
          field
          message
        }
        item {
          privateMetadata {
            key
            value
          }
        }
      }
    }
  `,

  DELETE_APP_METADATA: `
    mutation DeleteAppMetadata($id: ID!, $keys: [String!]!) {
      deletePrivateMetadata(id: $id, keys: $keys) {
        errors {
          field
          message
        }
      }
    }
  `,

  UPDATE_ORDER_METADATA: `
    mutation UpdateOrderMetadata($id: ID!, $input: [MetadataInput!]!) {
      updatePrivateMetadata(id: $id, input: $input) {
        errors {
          field
          message
        }
      }
    }
  `,
}
