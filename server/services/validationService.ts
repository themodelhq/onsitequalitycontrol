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
 * Validate product name against category naming format
 */
export async function validateProductName(
  productName: string,
  category: string
): Promise<ValidationResult> {
  const issues: string[] = [];

  if (!productName || productName.trim().length === 0) {
    return {
      isValid: false,
      issues: ["Product name is empty"],
    };
  }

  // Get naming format for category
  const format = await getNamingFormatByCategory(category);

  if (!format) {
    // No specific format defined for this category
    return {
      isValid: true,
      issues: [],
    };
  }

  // Parse format string to extract required components
  const requiredComponents = parseNamingFormat(format.format);

  // Check if product name contains expected components
  const missingComponents = checkMissingComponents(productName, requiredComponents);

  if (missingComponents.length > 0) {
    issues.push(`Missing components: ${missingComponents.join(", ")}`);
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
 * Parse naming format to extract required components
 */
function parseNamingFormat(format: string): string[] {
  // Split by + and extract component names
  const components = format
    .split("+")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  return components;
}

/**
 * Check for missing components in product name
 */
function checkMissingComponents(productName: string, requiredComponents: string[]): string[] {
  const missing: string[] = [];
  const nameLower = productName.toLowerCase();

  for (const component of requiredComponents) {
    const componentLower = component.toLowerCase();

    // Simple check: see if component keywords appear in name
    if (!nameLower.includes(componentLower)) {
      // Skip generic components that might not always be present
      if (!["colour", "color", "warranty"].includes(componentLower)) {
        missing.push(component);
      }
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
