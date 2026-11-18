import { describe, expect, it } from "vitest";
import { searchDoctors, unresolvedQuestions } from "@/lib/doctor-search";
import { GLOSSARY_VERSION, normalizePharmaNote, PHARMA_GLOSSARY } from "@/lib/pharma-glossary";

const doctors = [
  { id: "DR-1001", name: "Dr. Anita Sharma", specialty: "Cardiology", clinic: "City Heart Clinic", city: "Pune" },
  { id: "DR-1002", name: "Dr. Anita Sharma", specialty: "Dermatology", clinic: "Skin Hospital", city: "Mumbai" },
];

describe("Phase 1 doctor selection", () => {
  it.each(["ANITA", "cardio", "HEART", "pUnE"])("matches name, specialty, clinic or city: %s", (query) => {
    expect(searchDoctors(doctors, query).map((d) => d.id)).toContain("DR-1001");
  });
  it("keeps ambiguous names for manual selection", () => {
    expect(searchDoctors(doctors, "Anita Sharma").map((d) => d.id)).toEqual(["DR-1001", "DR-1002"]);
  });
  it("allows replacement by clinic and city without inventing IDs", () => {
    expect(searchDoctors(doctors, "skin mumbai").map((d) => d.id)).toEqual(["DR-1002"]);
    expect(searchDoctors(doctors, "unknown")).toEqual([]);
  });
  it("clears only resolved doctor and optional time questions", () => {
    expect(unresolvedQuestions(["Which doctor did you visit?", "What time was the call?", "Which product?"], "DR-1002", true)).toEqual(["Which product?"]);
    expect(unresolvedQuestions(["Which doctor did you visit?"], null, true)).toEqual(["Which doctor did you visit?"]);
  });
});

describe("versioned pharma glossary", () => {
  it("contains the required initial meanings", () => {
    expect(Object.fromEntries(PHARMA_GLOSSARY.map((x) => [x.term, x.meaning]))).toEqual({ USP: "Unique Selling Proposition", Rx: "Prescription", RCPA: "Retail Chemist Prescription Audit", POB: "Product Order Booking", HCP: "Healthcare Professional", MR: "Medical Representative", SKU: "Stock Keeping Unit", MSL: "Medical Science Liaison", KOL: "Key Opinion Leader" });
  });
  it("normalizes contextual USB while preserving original input and version", () => {
    const original = "Discussed USB for product differentiation.";
    expect(normalizePharmaNote(original)).toEqual({ original, normalized: "Discussed USP for product differentiation.", version: GLOSSARY_VERSION, changes: [{ original: "USB", normalized: "USP" }] });
  });
  it.each(["Sent a USB drive.", "Discussed USB.", "USB cable explains product benefits.", "Discussed product differentiation. Sent USB drive."])("does not globally replace USB: %s", (original) => {
    expect(normalizePharmaNote(original).normalized).toBe(original);
  });
  it("canonicalizes common terms without expanding or adding facts", () => {
    expect(normalizePharmaNote("Discussed rx, rcpa, pob, hcp, sku, msl and kol with Mr. Rao.").normalized).toBe("Discussed Rx, RCPA, POB, HCP, SKU, MSL and KOL with Mr. Rao.");
  });
});