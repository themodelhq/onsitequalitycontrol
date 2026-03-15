/**
 * Product Validation Service
 * Validates product names, descriptions, and checks for prohibited items
 */

import { getBlacklistedKeywords, getProhibitedItems, getRestrictedBrands, getNamingFormatByCategory } from "../db";

interface ValidationResult {
  isValid: boolean;
  issues: string[];
  details?: Record<string, any>;
}

/**
 * Validate product name against category naming format.
 *
 * Instead of checking whether label strings like "Brand Name" appear literally
 * in the title, we check for structural signals that correspond to each
 * component type:
 *
 *   Brand Name      → product name starts with a capitalised word (the brand)
 *   Capacity        → contains a number + unit (kg, L, Litres, HP, kVA, kW, ch, cl...)
 *   Model Number    → contains a parenthesised alphanumeric code  e.g. (HRF-185)
 *   Screen size     → contains inches pattern e.g. 6.7" or 43 Inches
 *   Memory          → contains RAM/ROM pattern e.g. 8GB RAM / 128GB ROM
 *   OS              → contains an OS keyword (Android, iOS, Windows, Linux)
 *   Colour          → contains a colour word at the end after a dash/–
 *   Display size    → same as Screen size
 *   USP             → free-form — we skip this (too hard to validate structurally)
 *   Product Name    → always present (it IS the name) — skip
 *   Warranty        → skip (optional)
 *   Size x Count    → contains a number x number pattern (e.g. Size 4 x 192)
 */
export async function validateProductName(
  productName: string,
  category: string
): Promise<ValidationResult> {
  const issues: string[] = [];

  if (!productName || productName.trim().length === 0) {
    return { isValid: false, issues: ["Product name is empty"] };
  }

  // Get naming format for category
  const format = await getNamingFormatByCategory(category);

  if (!format) {
    // No format defined for this category — nothing to check
    return { isValid: true, issues: [] };
  }

  // Parse the format into component labels
  const rawComponents = format.format
    .split(/[+–-]/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const missingComponents = checkStructuralComponents(productName, rawComponents, format.example || "");

  if (missingComponents.length > 0) {
    issues.push(`Name does not follow format "${format.format}". Missing: ${missingComponents.join(", ")}`);
  }

  return {
    isValid: issues.length === 0,
    issues,
    details: {
      expectedFormat: format.format,
      example: format.example,
      missingComponents,
    },
  };
}

/**
 * Map each component label to a structural check.
 * Returns the list of components that appear to be missing.
 */
function checkStructuralComponents(
  productName: string,
  components: string[],
  _example: string
): string[] {
  const name   = productName.trim();
  const lower  = name.toLowerCase();
  const missing: string[] = [];

  // Patterns
  const HAS_MODEL_NUM   = /\([A-Za-z0-9][A-Za-z0-9\-_./ ]{1,20}\)/;       // (HRF-185), (AS09DK)
  const HAS_CAPACITY_KG = /\d+(\.\d+)?\s*(kg|g\b)/i;
  const HAS_CAPACITY_L  = /\d+(\.\d+)?\s*(l\b|litres?|liters?)/i;
  const HAS_CAPACITY_HP = /\d+(\.\d+)?\s*(hp|kva|kw|btu|ch\b|cl\b)/i;
  const HAS_SCREEN_SIZE = /\d+(\.\d+)?[""'']\s*(inch(es)?)?|\d+\s*inch(es)?|\d+"\s/i;
  const HAS_MEMORY      = /\d+\s*gb\s*(ram|rom|storage|memory|ssd|hdd)/i;
  const HAS_OS          = /\b(android|ios|windows|linux|ubuntu|macos|harmony)\b/i;
  const HAS_COLOUR      = /[-–]\s*\w+\s*$/i;   // ends with "- Colour"
  const HAS_SIZE_X_CNT  = /size\s*\d|\d+\s*[×x]\s*\d+|\(\s*\d{2,}\s*\)/i;

  // Brand Name: the name should start with a capitalised word that looks like a brand
  // (not a generic descriptor). We check the first word is capitalised.
  const firstWord = name.split(/\s+/)[0] || "";
  const brandPresent = firstWord.length >= 2 && firstWord[0] === firstWord[0].toUpperCase() && firstWord[0] !== firstWord[0].toLowerCase();

  for (const comp of components) {
    const cl = comp.toLowerCase().trim();

    // Skip components we can't structurally verify
    if (
      cl.includes("usp") ||
      cl.includes("product name") ||
      cl.includes("product line") ||
      cl.includes("warranty") ||
      cl.includes("detail") ||
      cl.includes("type") ||
      cl.includes("material") ||
      cl.includes("free gift") ||
      cl.includes("free earbuds") ||
      cl.includes("what")
    ) continue;

    if (cl.includes("brand name") || cl === "brand") {
      if (!brandPresent) missing.push("Brand Name");
    } else if (cl.includes("model") || cl.includes("model number")) {
      if (!HAS_MODEL_NUM.test(name)) missing.push("Model Number");
    } else if (cl.includes("capacity")) {
      const hasCapacity =
        HAS_CAPACITY_KG.test(name) ||
        HAS_CAPACITY_L.test(name)  ||
        HAS_CAPACITY_HP.test(name) ||
        /\d+(\.\d+)?\s*(hp|w\b|watt|mah|kwh|ton|tonne|piece|pack|ml|oz|fl)/i.test(name);
      if (!hasCapacity) missing.push("Capacity");
    } else if (cl.includes("screen size") || cl.includes("display size")) {
      if (!HAS_SCREEN_SIZE.test(name)) missing.push("Display/Screen Size");
    } else if (cl.includes("memory") || cl.includes("ram") || cl.includes("storage")) {
      if (!HAS_MEMORY.test(name)) missing.push("Memory (RAM/ROM)");
    } else if (cl.includes("os") || cl.includes("operating system")) {
      if (!HAS_OS.test(name)) missing.push("OS");
    } else if (cl.includes("colour") || cl.includes("color")) {
      if (!HAS_COLOUR.test(name)) missing.push("Colour");
    } else if (cl.includes("size x") || cl.includes("product count") || cl.includes("x product")) {
      if (!HAS_SIZE_X_CNT.test(name)) missing.push("Size x Count");
    }
    // "Number of products", "Capacity" (drinks) — check for pack/x/× patterns
    else if (cl.includes("number of product")) {
      if (!/\b(x|×|\d+\s*pack)\b/i.test(name)) missing.push("Number of products");
    }
  }

  return missing;
}

/**
 * Validate product description quality
 */
export function validateDescription(description: string): ValidationResult {
  const issues: string[] = [];

  if (!description || description.trim().length === 0) {
    return {
      isValid: false,
      issues: ["Description is empty"],
    };
  }

  const descLength = description.trim().length;

  // Check minimum length
  if (descLength < 50) {
    issues.push("Description is too short (minimum 50 characters)");
  }

  // Check for common formatting issues
  if (description.includes("  ")) {
    issues.push("Description contains excessive whitespace");
  }

  // Check if description has proper structure
  const sentences = description.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (sentences.length < 2) {
    issues.push("Description lacks proper sentence structure");
  }

  return {
    isValid: issues.length === 0,
    issues,
    details: {
      length: descLength,
      sentenceCount: sentences.length,
    },
  };
}

/**
 * Check product for prohibited items and blacklisted keywords
 */
export async function checkProhibitedItems(
  productName: string,
  productDescription: string,
  brand: string,
  country: string
): Promise<ValidationResult> {
  const issues: string[] = [];
  const details: Record<string, any> = {};

  // Get blacklisted keywords
  const blacklistedKeywords = await getBlacklistedKeywords();
  const prohibitedItems = await getProhibitedItems();
  const restrictedBrands = await getRestrictedBrands();

  const searchText = `${productName} ${productDescription} ${brand}`.toLowerCase();

  // Check blacklisted keywords
  for (const keyword of blacklistedKeywords) {
    const countries = keyword.countries ? JSON.parse(keyword.countries) : [];

    // Check if keyword applies to this country
    if (countries.length === 0 || countries.includes(country)) {
      if (searchText.includes(keyword.keyword.toLowerCase())) {
        issues.push(`Blacklisted keyword found: "${keyword.keyword}"`);
        if (!details.blacklistedKeywords) {
          details.blacklistedKeywords = [];
        }
        details.blacklistedKeywords.push({
          keyword: keyword.keyword,
          severity: keyword.severity,
        });
      }
    }
  }

  // Check prohibited items
  for (const item of prohibitedItems) {
    const countries = item.countries ? JSON.parse(item.countries) : [];

    // Check if item applies to this country
    if (countries.length === 0 || countries.includes(country)) {
      if (item.status === "blocked" && searchText.includes(item.keyword.toLowerCase())) {
        issues.push(`Prohibited item: "${item.keyword}"`);
        if (!details.prohibitedItems) {
          details.prohibitedItems = [];
        }
        details.prohibitedItems.push({
          keyword: item.keyword,
          status: item.status,
        });
      }
    }
  }

  // Check restricted brands
  for (const restrictedBrand of restrictedBrands) {
    const countries = restrictedBrand.countries ? JSON.parse(restrictedBrand.countries) : [];

    // Check if brand restriction applies to this country
    if (countries.length === 0 || countries.includes(country)) {
      if (
        restrictedBrand.restrictionType === "blocked" &&
        brand.toLowerCase() === restrictedBrand.brand.toLowerCase()
      ) {
        issues.push(`Restricted brand: "${restrictedBrand.brand}"`);
        if (!details.restrictedBrands) {
          details.restrictedBrands = [];
        }
        details.restrictedBrands.push({
          brand: restrictedBrand.brand,
          restrictionType: restrictedBrand.restrictionType,
        });
      }
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
    details,
  };
}

/**
 * Detect counterfeit indicators
 */
export function detectCounterfeitIndicators(productName: string, description: string): ValidationResult {
  const issues: string[] = [];
  const details: Record<string, any> = {
    indicators: [],
  };

  const searchText = `${productName} ${description}`.toLowerCase();

  // Common counterfeit indicators
  const counterFeitIndicators = [
    { pattern: /\b(replica|fake|knockoff|imitation|copy)\b/i, label: "Replica/Fake terminology" },
    { pattern: /\b(unbranded|no brand|generic)\b/i, label: "Unbranded product" },
    { pattern: /\b(first copy|first-copy)\b/i, label: "First copy terminology" },
    { pattern: /\b(inspired by|similar to|looks like)\b/i, label: "Similar/inspired by language" },
    { pattern: /\b(not original|non-original)\b/i, label: "Non-original claim" },
  ];

  for (const indicator of counterFeitIndicators) {
    if (indicator.pattern.test(searchText)) {
      issues.push(`Counterfeit indicator: ${indicator.label}`);
      details.indicators.push(indicator.label);
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
    details,
  };
}

/**
 * Validate category assignment
 */
export async function validateCategory(
  productName: string,
  category: string,
  assignedCategory: string
): Promise<ValidationResult> {
  const issues: string[] = [];

  // Check if assigned category matches product name hints
  const categoryKeywords = extractCategoryKeywords(productName);

  if (categoryKeywords.length > 0) {
    const assignedCategoryLower = assignedCategory.toLowerCase();

    // Check if any category keyword matches the assigned category
    const hasMatch = categoryKeywords.some((keyword) =>
      assignedCategoryLower.includes(keyword.toLowerCase())
    );

    if (!hasMatch) {
      issues.push(
        `Product name suggests different category: ${categoryKeywords.join(", ")}`
      );
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
    details: {
      suggestedCategories: categoryKeywords,
    },
  };
}

/**
 * Extract category keywords from product name
 */
function extractCategoryKeywords(productName: string): string[] {
  const keywords: string[] = [];

  // Common category patterns
  const categoryPatterns: Record<string, string[]> = {
    Electronics: ["phone", "laptop", "tablet", "computer", "tv", "speaker"],
    Fashion: ["shirt", "dress", "pants", "shoes", "jacket", "jeans"],
    "Home & Living": ["chair", "table", "bed", "lamp", "sofa", "kitchen"],
    "Beauty & Health": ["cream", "lotion", "shampoo", "soap", "makeup"],
    "Sports & Outdoors": ["ball", "racket", "bike", "tent", "bag"],
  };

  const nameLower = productName.toLowerCase();

  for (const [category, patterns] of Object.entries(categoryPatterns)) {
    for (const pattern of patterns) {
      if (nameLower.includes(pattern)) {
        keywords.push(category);
        break;
      }
    }
  }

  return Array.from(new Set(keywords));
}
