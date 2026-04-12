/**
 * Bidirectional address translation between Saleor internal format
 * and protocol-specific formats (ACP, UCP).
 *
 * Saleor uses: firstName, lastName, streetAddress1, streetAddress2,
 *              city, countryArea, postalCode, country.code, phone
 *
 * UCP uses:    name, line1, line2, city, state, postal_code, country, phone
 * ACP uses:    name, line_one, line_two, city, state, postal_code, country, phone_number
 */

import type { SaleorAddress } from "../types/saleor.js"
import type { UcpAddress } from "../types/ucp.js"
import type { AcpAddress } from "../types/acp.js"
import type { SaleorAddressInput } from "./saleor-client.js"

// --- Saleor -> UCP ---

export function saleorToUcpAddress(addr: SaleorAddress): UcpAddress {
  return {
    first_name: addr.firstName || undefined,
    last_name: addr.lastName || undefined,
    street_address: addr.streetAddress1 || undefined,
    extended_address: addr.streetAddress2 || undefined,
    address_locality: addr.city || undefined,
    address_region: addr.countryArea || undefined,
    postal_code: addr.postalCode || undefined,
    address_country: addr.country?.code || undefined,
    phone_number: addr.phone || undefined,
  }
}

// --- UCP -> Saleor ---

export function ucpToSaleorAddress(addr: UcpAddress): SaleorAddressInput {
  return {
    firstName: addr.first_name,
    lastName: addr.last_name,
    streetAddress1: addr.street_address,
    streetAddress2: addr.extended_address,
    city: addr.address_locality,
    countryArea: addr.address_region,
    postalCode: addr.postal_code,
    country: addr.address_country,
    phone: addr.phone_number,
  }
}

// --- Saleor -> ACP ---

export function saleorToAcpAddress(addr: SaleorAddress): AcpAddress {
  const nameParts = [addr.firstName, addr.lastName].filter(Boolean)
  return {
    name: nameParts.length > 0 ? nameParts.join(" ") : "",
    line_one: addr.streetAddress1 || "",
    city: addr.city || "",
    state: addr.countryArea || "",
    country: addr.country?.code || "",
    postal_code: addr.postalCode || "",
    ...(addr.streetAddress2 ? { line_two: addr.streetAddress2 } : {}),
  }
}

// --- ACP -> Saleor ---

export function acpToSaleorAddress(addr: AcpAddress): SaleorAddressInput {
  const { firstName, lastName } = splitName(addr.name)
  return {
    firstName,
    lastName,
    streetAddress1: addr.line_one,
    streetAddress2: addr.line_two,
    city: addr.city,
    countryArea: addr.state,
    postalCode: addr.postal_code,
    country: addr.country,
  }
}

// --- Helpers ---

function splitName(name?: string): { firstName?: string; lastName?: string } {
  if (!name) return {}
  const parts = name.trim().split(/\s+/)
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
  }
}
