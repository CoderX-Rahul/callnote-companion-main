export const GLOSSARY_VERSION = "1.0.0";
export const PHARMA_GLOSSARY = [
  { term: "USP", meaning: "Unique Selling Proposition" },
  { term: "Rx", meaning: "Prescription" },
  { term: "RCPA", meaning: "Retail Chemist Prescription Audit" },
  { term: "POB", meaning: "Product Order Booking" },
  { term: "HCP", meaning: "Healthcare Professional" },
  { term: "MR", meaning: "Medical Representative" },
  { term: "SKU", meaning: "Stock Keeping Unit" },
  { term: "MSL", meaning: "Medical Science Liaison" },
  { term: "KOL", meaning: "Key Opinion Leader" },
] as const;

/** Conservative, sentence-local normalization; hardware context always wins. */
export function normalizePharmaNote(original: string) {
  const changes: { original: string; normalized: string }[] = [];
  const normalized = original.replace(/[^.!?\n]+[.!?]?/g, (sentence) => {
    const productContext = /\b(product differentiation|unique selling (?:point|proposition)|selling points?|competitive advantage|product benefits?|differentiators?)\b/i.test(sentence);
    const hardwareContext = /\b(drive|flash|port|cable|device|stick|storage|transfer|laptop|computer|charger|charging|pen drive)\b/i.test(sentence);
    return sentence.replace(/\bUSB\b/gi, (term) => {
      if (!productContext || hardwareContext) return term;
      changes.push({ original: term, normalized: "USP" });
      return "USP";
    }).replace(/\b(?:usp|rx|rcpa|pob|hcp|mr|sku|msl|kol)\b/gi, (term) => {
      // “Mr.” as an honorific is not a medical representative.
      if (term === "Mr" || term === "mr") return term;
      const entry = PHARMA_GLOSSARY.find((x) => x.term.toLowerCase() === term.toLowerCase());
      return entry?.term ?? term;
    });
  });
  return { original, normalized, version: GLOSSARY_VERSION, changes };
}