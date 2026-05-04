import { describe, it, expect } from "vitest"
import {
  saleorToUcpAddress,
  ucpToSaleorAddress,
  saleorToAcpAddress,
  acpToSaleorAddress,
} from "./address-translator.js"
import type { SaleorAddress } from "../types/saleor.js"
import type { UcpAddress } from "../types/ucp.js"
import type { AcpAddress } from "../types/acp.js"

const fullSaleorAddress: SaleorAddress = {
  firstName: "Ada",
  lastName: "Lovelace",
  streetAddress1: "1 Analytical Engine Way",
  streetAddress2: "Apt 1837",
  city: "London",
  countryArea: "Greater London",
  postalCode: "SW1A 1AA",
  country: { code: "GB", country: "United Kingdom" },
  phone: "+44 20 7946 0958",
}

describe("saleorToUcpAddress", () => {
  it("maps every field for a fully populated address", () => {
    const ucp = saleorToUcpAddress(fullSaleorAddress)
    expect(ucp).toEqual({
      first_name: "Ada",
      last_name: "Lovelace",
      street_address: "1 Analytical Engine Way",
      extended_address: "Apt 1837",
      address_locality: "London",
      address_region: "Greater London",
      postal_code: "SW1A 1AA",
      address_country: "GB",
      phone_number: "+44 20 7946 0958",
    })
  })

  it("converts empty strings to undefined", () => {
    const ucp = saleorToUcpAddress({
      ...fullSaleorAddress,
      streetAddress2: "",
      countryArea: "",
    })
    expect(ucp.extended_address).toBeUndefined()
    expect(ucp.address_region).toBeUndefined()
  })

  it("handles missing country gracefully", () => {
    const { country, ...withoutCountry } = fullSaleorAddress
    const ucp = saleorToUcpAddress(withoutCountry as SaleorAddress)
    expect(ucp.address_country).toBeUndefined()
  })
})

describe("ucpToSaleorAddress", () => {
  it("round-trips a Saleor address through UCP form", () => {
    const ucp = saleorToUcpAddress(fullSaleorAddress)
    const back = ucpToSaleorAddress(ucp)
    expect(back).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      streetAddress1: "1 Analytical Engine Way",
      streetAddress2: "Apt 1837",
      city: "London",
      countryArea: "Greater London",
      postalCode: "SW1A 1AA",
      country: "GB",
      phone: "+44 20 7946 0958",
    })
  })
})

describe("saleorToAcpAddress", () => {
  it("joins first and last name into ACP's single name field", () => {
    const acp = saleorToAcpAddress(fullSaleorAddress)
    expect(acp.name).toBe("Ada Lovelace")
  })

  it("omits line_two when streetAddress2 is missing", () => {
    const { streetAddress2, ...withoutLine2 } = fullSaleorAddress
    const acp = saleorToAcpAddress(withoutLine2 as SaleorAddress)
    expect(acp).not.toHaveProperty("line_two")
  })

  it("uses empty strings for required fields when source is missing", () => {
    const acp = saleorToAcpAddress({} as SaleorAddress)
    expect(acp).toEqual({
      name: "",
      line_one: "",
      city: "",
      state: "",
      country: "",
      postal_code: "",
    })
  })
})

describe("acpToSaleorAddress", () => {
  it("splits a single name field into firstName + lastName", () => {
    const acp: AcpAddress = {
      name: "Grace Hopper",
      line_one: "1 Compiler Lane",
      city: "Arlington",
      state: "VA",
      country: "US",
      postal_code: "22202",
    }
    const saleor = acpToSaleorAddress(acp)
    expect(saleor.firstName).toBe("Grace")
    expect(saleor.lastName).toBe("Hopper")
  })

  it("groups middle and last names into lastName", () => {
    const acp: AcpAddress = {
      name: "Mary Jackson Smith",
      line_one: "x",
      city: "x",
      state: "x",
      country: "US",
      postal_code: "00000",
    }
    const saleor = acpToSaleorAddress(acp)
    expect(saleor.firstName).toBe("Mary")
    expect(saleor.lastName).toBe("Jackson Smith")
  })

  it("handles a single-word name (firstName only)", () => {
    const acp: AcpAddress = {
      name: "Ada",
      line_one: "x",
      city: "x",
      state: "x",
      country: "US",
      postal_code: "00000",
    }
    const saleor = acpToSaleorAddress(acp)
    expect(saleor.firstName).toBe("Ada")
    expect(saleor.lastName).toBeUndefined()
  })
})
