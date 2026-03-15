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

// ─── Structural patterns (used by both exact-match and inferred checks) ────────

const PAT_BRAND_NAME   = { test: (name: string) => { const w = name.trim().split(/\s+/)[0] || ""; return w.length >= 2 && /[A-Z]/.test(w[0]); }};
const PAT_MODEL_NUM    = /\([A-Za-z0-9][A-Za-z0-9\-_./ ]{1,20}\)/;
const PAT_CAPACITY     = /\d+(\.\d+)?\s*(kg|g\b|l\b|litres?|liters?|ml\b|hp\b|kva\b|kw\b|btu\b|ch\b|cl\b|w\b|watt|mah\b|kwh\b|ton\b|tonne\b|oz\b|fl\b|pack\b|pcs\b|piece)/i;
const PAT_SCREEN_SIZE  = /\d+(\.\d+)?["″'']\s*(inch(es)?)?|\d+(\.\d+)?\s*inch(es)?/i;
const PAT_MEMORY       = /\d+\s*gb\s*(ram|rom|storage|memory|ssd|hdd)/i;
const PAT_OS           = /\b(android|ios|windows|linux|ubuntu|macos|harmony)\b/i;
const PAT_COLOUR       = /[-–]\s*\w[\w\s]*$/i;
const PAT_SIZE_X_CNT   = /size\s*\d|\d+\s*[×x]\s*\d+|\(\s*\d{2,}\s*\)/i;
const PAT_NUM_PRODUCTS = /\b(x|×|\d+\s*pack)\b/i;

/**
 * Check one named component label against the product name.
 * Returns the human-readable label if it is missing, or null if present/skipped.
 */
function checkComponent(name: string, cl: string): string | null {
  // Components that cannot be structurally verified are always skipped
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
    cl.includes("what") ||
    cl.includes("version")    // OS version — too varied
  ) return null;

  if (cl.includes("brand name") || cl === "brand") {
    return PAT_BRAND_NAME.test(name) ? null : "Brand Name";
  }
  if (cl.includes("model") || cl.includes("model number")) {
    return PAT_MODEL_NUM.test(name) ? null : "Model Number";
  }
  if (cl.includes("capacity")) {
    return PAT_CAPACITY.test(name) ? null : "Capacity";
  }
  if (cl.includes("screen size") || cl.includes("display size")) {
    return PAT_SCREEN_SIZE.test(name) ? null : "Display/Screen Size";
  }
  if (cl.includes("memory") || (cl.includes("ram") && !cl.includes("programme"))) {
    return PAT_MEMORY.test(name) ? null : "Memory (RAM/ROM)";
  }
  if (cl === "os" || cl.includes("operating system")) {
    return PAT_OS.test(name) ? null : "OS";
  }
  if (cl.includes("colour") || cl.includes("color")) {
    return PAT_COLOUR.test(name) ? null : "Colour";
  }
  if (cl.includes("size x") || cl.includes("product count") || cl.includes("x product")) {
    return PAT_SIZE_X_CNT.test(name) ? null : "Size x Count";
  }
  if (cl.includes("number of product")) {
    return PAT_NUM_PRODUCTS.test(name) ? null : "Number of products";
  }
  return null;
}

/**
 * Check all components from a format string against a product name.
 * Returns the list of missing component labels.
 */
function checkStructuralComponents(name: string, components: string[]): string[] {
  return components
    .map((comp) => checkComponent(name, comp.toLowerCase().trim()))
    .filter((r): r is string => r !== null);
}

// ─── Structural family inference ─────────────────────────────────────────────
//
// The 38 named formats in ProductNaming.xlsx fall into 6 structural families.
// For categories not in the named list, we infer the best-matching family from
// keywords in the category breadcrumb and product name, then apply that family's
// required component checks.
//
// Family → Inferred from → Required components
// ──────────────────────────────────────────────────────────────────────────────
// ELECTRONICS_DISPLAY  → phones, tablets, laptops, TVs, monitors
//                      → Brand + Screen/Display Size [+ Memory + OS + Model]
// ELECTRONICS_CAPACITY → appliances with a rated capacity or power output
//                      → Brand + Capacity [+ Model Number]
// ELECTRONICS_MODEL    → electronics identified by model code (no capacity)
//                      → Brand + Model Number
// FASHION_GARMENT      → clothing, apparel, footwear, fashion accessories
//                      → Colour at end (after dash)
// PACKAGED_GOODS       → food, beverages, household consumables, health & beauty
//                      → Brand + Capacity/Weight
// BABY_CONSUMABLES     → baby / infant products (diapers, formula, wipes)
//                      → Brand + Size or Count
// GENERAL_BRANDED      → everything else that should at minimum have brand + model
//                      → Brand Name

type InferredFamily =
  | "ELECTRONICS_DISPLAY"
  | "ELECTRONICS_CAPACITY"
  | "ELECTRONICS_MODEL"
  | "FASHION_GARMENT"
  | "PACKAGED_GOODS"
  | "BABY_CONSUMABLES"
  | "GENERAL_BRANDED"
  | null;

// All signals are multi-word or unambiguous single words to avoid substring collisions
// (e.g. "pant" appears in "Anti-Dandruff" — so we use "trouser" / "pant " with space)
const FAMILY_SIGNALS: Record<Exclude<InferredFamily, null>, string[]> = {
  ELECTRONICS_DISPLAY: [
    "mobile phone", "smartphone", "android phone", "ios phone", "iphone", "ipad",
    "tablet", "laptop", "notebook", "chromebook", "desktop computer",
    "television", "smart tv", "led tv", "oled tv", "qled tv",
    "computer monitor", "windows laptop",
  ],
  ELECTRONICS_CAPACITY: [
    "blender", "juicer", "food processor",
    "air fryer", "microwave", "rice cooker", "slow cooker",
    "chest freezer", "deep freezer", "refrigerator", "double door fridge",
    "air conditioner", "split unit", "window unit",
    "generator", "inverter generator",
    "washing machine", "tumble dryer", "spin dryer",
    "home theater", "subwoofer", "sound bar",
    "electric kettle", "water heater", "water dispenser", "water purifier",
    "ceiling fan", "standing fan", "pedestal fan",
    "steam iron", "vacuum cleaner", "air purifier",
    "solar panel", "power bank",
  ],
  ELECTRONICS_MODEL: [
    "voltage stabilizer", "surge protector",
    "gas cooker", "gas stove", "induction cooker",
    "inkjet printer", "laser printer", "photocopier",
    "wifi router", "broadband router", "network switch",
    "cctv camera", "security camera", "ip camera", "action camera",
    "dslr camera", "mirrorless camera",
    "projector", "smartwatch", "smart band", "fitness tracker",
    "bluetooth headphone", "wireless headphone", "earphone", "earbud", "headset",
    "beard trimmer", "hair trimmer", "electric shaver", "hair clipper",
    "electric drill", "angle grinder",
    "gaming console", "game controller",
    "external hard drive", "external ssd", "flash drive", "memory card",
    "wireless keyboard", "gaming keyboard",
  ],
  PACKAGED_GOODS: [
    // Beverages — unambiguous
    "fruit juice", "soft drink", "mineral water", "energy drink",
    "beer", "wine", "whisky", "rum", "gin", "vodka", "brandy",
    // Food — unambiguous
    "biscuit", "chocolate bar", "breakfast cereal", "instant noodle",
    "basmati rice", "wheat flour", "cooking oil", "olive oil", "palm oil",
    // Hygiene / personal care
    "shampoo", "hair conditioner", "body wash", "shower gel",
    "laundry detergent", "washing powder", "dishwashing liquid",
    "body lotion", "body cream", "face cream", "face wash", "moisturiser",
    "toothpaste", "mouthwash", "deodorant",
    "perfume", "cologne", "body spray",
    "sanitary pad", "tissue paper", "toilet paper",
    // Health
    "protein powder", "dietary supplement", "multivitamin",
    // Pet / grocery
    "dog food", "cat food", "pet food",
    "grocery", "supermarket",
  ],
  BABY_CONSUMABLES: [
    "baby diaper", "diaper", "nappy", "baby wipe",
    "baby food", "infant formula", "baby formula", "follow-on milk", "baby milk",
    "feeding bottle", "baby bottle", "baby pacifier",
    "baby lotion", "baby oil", "baby powder", "baby shampoo",
    "baby cereal",
  ],
  FASHION_GARMENT: [
    // Tops
    "polo shirt", "t-shirt", "tee shirt", "men's shirt", "women's shirt", "ladies shirt",
    "blouse", "crop top",
    // Bottoms
    "men's trouser", "women's trouser", "ladies trouser",
    "skinny jeans", "slim jeans", "denim jeans",
    "women's skirt", "pencil skirt", "maxi skirt", "mini skirt",
    "men's shorts", "women's shorts", "legging",
    // Dresses & jumpsuits
    "ladies dress", "women's dress", "maxi dress", "mini dress",
    "jumpsuit", "playsuit", "romper",
    // Outerwear
    "men's jacket", "women's jacket", "blazer", "overcoat", "trench coat", "puffer jacket",
    "hoodie", "sweatshirt", "cardigan", "sweater", "jumper",
    // Suits & formal
    "men's suit", "women's suit", "tuxedo",
    // Underwear / swimwear
    "men's boxer", "women's bra", "women's panty", "lingerie",
    "swimsuit", "bikini", "swim trunks",
    // Traditional
    "agbada", "kaftan", "ankara dress", "aso oke", "native wear", "traditional attire",
    // Footwear
    "women's shoe", "men's shoe", "ladies shoe",
    "high heel", "stiletto", "sneaker", "running shoe",
    "ankle boot", "knee boot", "sandal", "loafer", "oxford shoe", "moccasin",
    "footwear",
    // Bags & accessories
    "women's bag", "men's bag", "handbag", "clutch bag", "crossbody bag", "tote bag", "backpack",
    "leather belt", "silk scarf", "fashion hat", "baseball cap",
    "fashion watch", "wristwatch", "sunglasses",
    "human hair wig", "lace wig", "hair weave", "hair extension",
    // Generic category signals
    "men's fashion", "women's fashion", "fashion accessory", "clothing", "apparel",
  ],
  GENERAL_BRANDED: [],
};

/**
 * Given the full category breadcrumb and product name, infer the structural
 * family. Uses multi-word signals to avoid substring collisions.
 *
 * Priority order (most specific first):
 *   BABY_CONSUMABLES → ELECTRONICS_DISPLAY → ELECTRONICS_CAPACITY →
 *   ELECTRONICS_MODEL → PACKAGED_GOODS → FASHION_GARMENT → GENERAL_BRANDED
 *
 * PACKAGED_GOODS is checked before FASHION_GARMENT because health/beauty
 * products should be classified as consumables, not fashion garments.
 */
function inferFamily(category: string, productName: string): InferredFamily {
  const haystack = `${category} ${productName}`.toLowerCase();

  const order: Array<Exclude<InferredFamily, null>> = [
    "BABY_CONSUMABLES",
    "ELECTRONICS_DISPLAY",
    "ELECTRONICS_CAPACITY",
    "ELECTRONICS_MODEL",
    "PACKAGED_GOODS",      // ← before FASHION_GARMENT (H&B, food, grocery)
    "FASHION_GARMENT",
  ];

  for (const family of order) {
    if (FAMILY_SIGNALS[family].some((signal) => haystack.includes(signal))) {
      return family;
    }
  }

  // Broad category-level fallback
  if (/\belectronics\b|\bhome appliance|\bcomputing\b|\bgaming\b|\bgadget|\bdevices?\b/i.test(haystack)) {
    return "ELECTRONICS_MODEL";
  }
  if (/\bhealth\b.*\bbeauty\b|\bbeauty\b|\bpersonal care\b|\bgrocery\b|\bsupermarket\b/i.test(haystack)) {
    return "PACKAGED_GOODS";
  }
  if (/\bfashion\b|\bclothing\b|\bapparel\b|\bwear\b|\bfootwear\b|\bshoes?\b|\bbag\b/i.test(haystack)) {
    return "FASHION_GARMENT";
  }

  return "GENERAL_BRANDED";
}

/**
 * For a given inferred family, return:
 *   - inferredFormat: human-readable expected format string
 *   - missing: list of missing components
 */
function checkByFamily(
  name: string,
  family: Exclude<InferredFamily, null>
): { inferredFormat: string; missing: string[] } {
  const missing: string[] = [];

  switch (family) {
    case "ELECTRONICS_DISPLAY": {
      // Based on: Mobile Phones / iPhone / iPad / Computing / TVs
      // TVs only need Brand + Display Size + Model Number (no memory/OS)
      // Phones/tablets/laptops need Brand + Screen Size + Memory or OS
      const isTv = /\btv\b|television|monitor\b/i.test(`${category} ${name}`);
      if (!PAT_BRAND_NAME.test(name))  missing.push("Brand Name");
      if (!PAT_SCREEN_SIZE.test(name)) missing.push("Display/Screen Size");
      if (isTv) {
        // TVs: model number strongly expected
        if (!PAT_MODEL_NUM.test(name)) missing.push("Model Number (e.g. (43A5100))");
      } else {
        // Phones / tablets / laptops: need Memory AND/OR OS
        const hasMemory = PAT_MEMORY.test(name);
        const hasOS     = PAT_OS.test(name);
        // Accept if either Memory or OS is present (some phones imply OS from brand)
        if (!hasMemory && !hasOS) {
          missing.push("Memory (e.g. 8GB RAM/128GB ROM) or OS (e.g. Android 13, iOS 16)");
        }
      }
      return {
        inferredFormat: isTv
          ? "Brand Name + Display Size + USP + Model Number – Colour"
          : "Brand Name + Screen Size + Memory + OS [+ Model Number] [– Colour]",
        missing,
      };
    }

    case "ELECTRONICS_CAPACITY": {
      // Based on: Blenders / AC / Washing Machines / Generators / Speakers etc.
      // Required: Brand Name + Capacity (number + unit)
      if (!PAT_BRAND_NAME.test(name)) missing.push("Brand Name");
      if (!PAT_CAPACITY.test(name))   missing.push("Capacity (e.g. 1.5 Litres, 1HP, 7kg, 3.5kVA)");
      return {
        inferredFormat: "Brand Name + Capacity + [USP +] Product Name [+ Model Number] [– Colour]",
        missing,
      };
    }

    case "ELECTRONICS_MODEL": {
      // Based on: Stabilizers / Gas Cookers / cameras / printers etc.
      // Required: Brand Name + Model Number in parentheses
      if (!PAT_BRAND_NAME.test(name)) missing.push("Brand Name");
      if (!PAT_MODEL_NUM.test(name))  missing.push("Model Number (e.g. (DVS-2001), (GGC-002))");
      return {
        inferredFormat: "Brand Name + Product Name + Model Number (e.g. ABC-123)",
        missing,
      };
    }

    case "FASHION_GARMENT": {
      // Based on: Women/Men Shirts, Dresses, Jeans, Suits, Traditional etc.
      // Required: Colour at the end (after a dash or –)
      // Note: Detail, Material and Type are too subjective to verify structurally
      if (!PAT_COLOUR.test(name)) missing.push("Colour at the end (e.g. – Red, - Blue/White)");
      return {
        inferredFormat: "[Garment Detail +] [Material +] Garment Type – Colour",
        missing,
      };
    }

    case "PACKAGED_GOODS": {
      // Based on: Drinks (Pack) / Soap (Pack)
      // Required: Brand Name + some form of Capacity/Weight/Volume
      if (!PAT_BRAND_NAME.test(name)) missing.push("Brand Name");
      if (!PAT_CAPACITY.test(name))   missing.push("Capacity or Weight (e.g. 75g, 70cl, 500ml)");
      return {
        inferredFormat: "Brand Name + Product Name + Capacity/Weight [– Number of units]",
        missing,
      };
    }

    case "BABY_CONSUMABLES": {
      // Based on: Diapering
      // Required: Brand Name + size or count indicator
      if (!PAT_BRAND_NAME.test(name))   missing.push("Brand Name");
      if (!PAT_SIZE_X_CNT.test(name) && !PAT_CAPACITY.test(name)) {
        missing.push("Size or Count (e.g. Size 4, x192, 50-count)");
      }
      return {
        inferredFormat: "Brand Name + Product Name + Size x Count",
        missing,
      };
    }

    case "GENERAL_BRANDED":
    default: {
      // Minimum baseline: name should start with a capitalised brand word
      if (!PAT_BRAND_NAME.test(name)) missing.push("Brand Name");
      return {
        inferredFormat: "Brand Name + Product Name [+ Key Attribute]",
        missing,
      };
    }
  }
}

/**
 * Validate product name against category naming format.
 *
 * Two-stage approach:
 *
 * Stage 1 — Exact/partial match against the 38 named formats in ProductNaming.xlsx.
 *            If a match is found, the named format's components are checked
 *            structurally (not literally).
 *
 * Stage 2 — If no named format matches, the category breadcrumb and product name
 *            are used to infer the closest structural family from the 6 families
 *            derived from the ProductNaming.xlsx data:
 *              • ELECTRONICS_DISPLAY  (phones, tablets, TVs, laptops)
 *              • ELECTRONICS_CAPACITY (appliances with a capacity rating)
 *              • ELECTRONICS_MODEL    (electronics identified by model code)
 *              • FASHION_GARMENT      (clothing, footwear, accessories)
 *              • PACKAGED_GOODS       (food, beverages, FMCG)
 *              • BABY_CONSUMABLES     (baby/infant products)
 *              • GENERAL_BRANDED      (catch-all — brand name at minimum)
 */
export async function validateProductName(
  productName: string,
  category: string
): Promise<ValidationResult> {
  if (!productName || productName.trim().length === 0) {
    return { isValid: false, issues: ["Product name is empty"] };
  }

  const name = productName.trim();

  // ── Stage 1: named format lookup ──────────────────────────────────────────
  const format = await getNamingFormatByCategory(category);

  if (format) {
    const rawComponents = format.format
      .split(/[+–\-]/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    const missingComponents = checkStructuralComponents(name, rawComponents);

    return {
      isValid: missingComponents.length === 0,
      issues: missingComponents.length > 0
        ? [`Name does not follow the "${format.categoryName}" format "${format.format}". Missing: ${missingComponents.join(", ")}`]
        : [],
      details: {
        matchType: "exact",
        expectedFormat: format.format,
        example: format.example,
        missingComponents,
      },
    };
  }

  // ── Stage 2: structural family inference ──────────────────────────────────
  const family = inferFamily(category, name);
  if (!family) {
    return { isValid: true, issues: [] };
  }

  const { inferredFormat, missing } = checkByFamily(name, family);

  return {
    isValid: missing.length === 0,
    issues: missing.length > 0
      ? [`Name does not meet the expected naming structure for this product type (inferred: ${family.replace(/_/g, " ")}). Missing: ${missing.join(", ")}`]
      : [],
    details: {
      matchType: "inferred",
      inferredFamily: family,
      inferredFormat,
      missingComponents: missing,
    },
  };
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
 * Check product for prohibited items and blacklisted keywords.
 *
 * Matching strategy:
 *   - Keywords longer than 5 characters: plain substring match (fast, low false-positive risk)
 *   - Keywords 1–5 characters: word-boundary match (\bKEYWORD\b) to prevent short
 *     obscene/slang keywords (e.g. "ass", "sex", "cum") from matching innocent words
 *     like "class", "glasses", "classic", "passage", "document", etc.
 *   - Prohibited item keywords: always full-phrase substring match (they are long phrases)
 *   - Restricted brands: exact brand name match only (already correct)
 */
export async function checkProhibitedItems(
  productName: string,
  productDescription: string,
  brand: string,
  country: string
): Promise<ValidationResult> {
  const issues: string[] = [];
  const details: Record<string, any> = {};

  const blacklistedKeywords = await getBlacklistedKeywords();
  const prohibitedItems     = await getProhibitedItems();
  const restrictedBrands    = await getRestrictedBrands();

  const searchText = `${productName} ${productDescription} ${brand}`.toLowerCase();

  // ── Helper: match a single keyword against searchText ─────────────────────
  function keywordMatches(keyword: string): boolean {
    const kl = keyword.toLowerCase();
    if (kl.length <= 5) {
      // Short keywords must match as whole words to avoid substring false positives
      // e.g. "ass" should NOT match "class", "glasses", "ambassador"
      try {
        const pattern = new RegExp(`\\b${kl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        return pattern.test(searchText);
      } catch {
        return searchText.includes(kl);
      }
    }
    return searchText.includes(kl);
  }

  // ── Blacklisted keywords ───────────────────────────────────────────────────
  for (const keyword of blacklistedKeywords) {
    const countries = keyword.countries ? JSON.parse(keyword.countries) : [];
    if (countries.length === 0 || countries.includes(country)) {
      if (keywordMatches(keyword.keyword)) {
        issues.push(`Blacklisted keyword found: "${keyword.keyword}"`);
        if (!details.blacklistedKeywords) details.blacklistedKeywords = [];
        details.blacklistedKeywords.push({
          keyword: keyword.keyword,
          severity: keyword.severity,
        });
      }
    }
  }

  // ── Prohibited items ───────────────────────────────────────────────────────
  for (const item of prohibitedItems) {
    const countries = item.countries ? JSON.parse(item.countries) : [];
    if (countries.length === 0 || countries.includes(country)) {
      if (item.status === "blocked" && searchText.includes(item.keyword.toLowerCase())) {
        issues.push(`Prohibited item: "${item.keyword}"`);
        if (!details.prohibitedItems) details.prohibitedItems = [];
        details.prohibitedItems.push({
          keyword: item.keyword,
          status: item.status,
        });
      }
    }
  }

  // ── Restricted brands ──────────────────────────────────────────────────────
  for (const restrictedBrand of restrictedBrands) {
    const countries = restrictedBrand.countries ? JSON.parse(restrictedBrand.countries) : [];
    if (countries.length === 0 || countries.includes(country)) {
      if (
        restrictedBrand.restrictionType === "blocked" &&
        brand.toLowerCase() === restrictedBrand.brand.toLowerCase()
      ) {
        issues.push(`Restricted brand: "${restrictedBrand.brand}"`);
        if (!details.restrictedBrands) details.restrictedBrands = [];
        details.restrictedBrands.push({
          brand: restrictedBrand.brand,
          restrictionType: restrictedBrand.restrictionType,
        });
      }
    }
  }

  return { isValid: issues.length === 0, issues, details };
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
