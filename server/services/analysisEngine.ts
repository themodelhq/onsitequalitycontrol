/**
 * Analysis Engine
 * Orchestrates all product quality checks
 */

import {
  analyzeImage,
  countImagesInDescription,
  extractImagesFromDescription,
} from "./imageAnalysis";
import {
  validateProductName,
  validateDescription,
  checkProhibitedItems,
  detectCounterfeitIndicators,
  validateCategory,
} from "./validationService";
import {
  createAnalysisResult,
  getProductImages,
  createProductImage,
  updateProductImage,
} from "../db";

export interface AnalysisIssue {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  details?: Record<string, any>;
}

export interface ProductAnalysisResult {
  productId: number;
  issues: AnalysisIssue[];
  summary: {
    totalIssues: number;
    criticalIssues: number;
    highIssues: number;
    mediumIssues: number;
    lowIssues: number;
  };
}

/**
 * Analyze a single product for all quality issues
 */
export async function analyzeProduct(
  productId: number,
  product: any,
  country: string
): Promise<ProductAnalysisResult> {
  const issues: AnalysisIssue[] = [];

  // 1. Analyze images
  const imageIssues = await analyzeProductImages(productId, product);
  issues.push(...imageIssues);

  // 2. Validate description
  const descriptionIssues = validateProductDescription(product);
  issues.push(...descriptionIssues);

  // 3. Validate product name
  const nameIssues = await validateProductNameFormat(product);
  issues.push(...nameIssues);

  // 4. Check for prohibited items
  const prohibitedIssues = await checkProductProhibited(product, country);
  issues.push(...prohibitedIssues);

  // 5. Detect counterfeit indicators
  const counterFeitIssues = detectProductCounterfeit(product);
  issues.push(...counterFeitIssues);

  // 6. Validate category
  const categoryIssues = await validateProductCategory(product);
  issues.push(...categoryIssues);

  // Calculate summary
  const summary = {
    totalIssues: issues.length,
    criticalIssues: issues.filter((i) => i.severity === "critical").length,
    highIssues: issues.filter((i) => i.severity === "high").length,
    mediumIssues: issues.filter((i) => i.severity === "medium").length,
    lowIssues: issues.filter((i) => i.severity === "low").length,
  };

  // Save issues to database
  for (const issue of issues) {
    await createAnalysisResult({
      productId,
      issueType: issue.type,
      severity: issue.severity,
      country,
      details: issue.details,
      recommendation: generateRecommendation(issue.type),
    });
  }

  return {
    productId,
    issues,
    summary,
  };
}

/**
 * Analyze product images
 */
async function analyzeProductImages(productId: number, product: any): Promise<AnalysisIssue[]> {
  const issues: AnalysisIssue[] = [];

  // Get image URLs from product
  const imageUrls = product.images || [];

  if (imageUrls.length === 0) {
    issues.push({
      type: "insufficient_images",
      severity: "critical",
      message: "Product has no images",
      details: { imageCount: 0 },
    });
    return issues;
  }

  // Flag if less than 5 images
  if (imageUrls.length < 5) {
    issues.push({
      type: "insufficient_images",
      severity: imageUrls.length === 1 ? "high" : "medium",
      message: `Product has only ${imageUrls.length} image(s), minimum recommended is 5`,
      details: { imageCount: imageUrls.length },
    });
  }

  // Analyze each image
  let nonWhiteBackgroundCount = 0;
  let lowResolutionCount = 0;

  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];

    // Create product image record
    await createProductImage(productId, imageUrl, i + 1);

    // Analyze image
    const analysis = await analyzeImage(imageUrl);

    if (analysis.error) {
      issues.push({
        type: "poor_image_quality",
        severity: "medium",
        message: `Failed to analyze image ${i + 1}: ${analysis.error}`,
        details: { imagePosition: i + 1, error: analysis.error },
      });
      continue;
    }

    // Update product image with analysis results
    const images = await getProductImages(productId);
    const imageRecord = images.find((img) => img.imageUrl === imageUrl);

    if (imageRecord) {
      await updateProductImage(imageRecord.id, {
        width: analysis.width,
        height: analysis.height,
        resolution: analysis.resolution,
        backgroundColorHex: analysis.backgroundColorHex,
        isWhiteBackground: analysis.isWhiteBackground,
        isLowResolution: analysis.isLowResolution,
        analysisStatus: "completed",
      });
    }

    // Check for non-white background
    if (!analysis.isWhiteBackground) {
      nonWhiteBackgroundCount++;
      issues.push({
        type: "non_white_background",
        severity: "medium",
        message: `Image ${i + 1} does not have a white background`,
        details: {
          imagePosition: i + 1,
          backgroundColor: analysis.backgroundColorHex,
        },
      });
    }

    // Check for low resolution
    if (analysis.isLowResolution) {
      lowResolutionCount++;
      issues.push({
        type: "poor_image_quality",
        severity: "medium",
        message: `Image ${i + 1} has low resolution (${analysis.resolution})`,
        details: {
          imagePosition: i + 1,
          resolution: analysis.resolution,
        },
      });
    }
  }

  return issues;
}

/**
 * Validate product description
 */
function validateProductDescription(product: any): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];

  const description = product.description || "";

  // Check if description is empty
  if (!description || description.trim().length === 0) {
    issues.push({
      type: "poor_description",
      severity: "critical",
      message: "Product description is empty",
    });
    return issues;
  }

  // Check description length
  if (description.length < 50) {
    issues.push({
      type: "poor_description",
      severity: "high",
      message: "Product description is too short (minimum 50 characters)",
      details: { length: description.length },
    });
  }

  // Check for images in description
  const imageCount = countImagesInDescription(description);
  if (imageCount === 0) {
    issues.push({
      type: "missing_description_images",
      severity: "medium",
      message: "Product description does not contain any images",
      details: { imageCount },
    });
  }

  // Check for proper formatting
  if (description.includes("  ")) {
    issues.push({
      type: "poor_description",
      severity: "low",
      message: "Description contains excessive whitespace or formatting issues",
    });
  }

  return issues;
}

/**
 * Validate product name format
 */
async function validateProductNameFormat(product: any): Promise<AnalysisIssue[]> {
  const issues: AnalysisIssue[] = [];

  const validation = await validateProductName(product.name, product.category);

  if (!validation.isValid) {
    for (const issue of validation.issues) {
      issues.push({
        type: "naming_format_violation",
        severity: "medium",
        message: `Product name does not follow naming format: ${issue}`,
        details: validation.details,
      });
    }
  }

  return issues;
}

/**
 * Check for prohibited items
 */
async function checkProductProhibited(product: any, country: string): Promise<AnalysisIssue[]> {
  const issues: AnalysisIssue[] = [];

  const validation = await checkProhibitedItems(
    product.name,
    product.description || "",
    product.brand || "",
    country
  );

  if (!validation.isValid) {
    for (const issue of validation.issues) {
      // Determine severity based on issue type
      let severity: "low" | "medium" | "high" | "critical" = "high";

      if (issue.includes("Prohibited item")) {
        severity = "critical";
      } else if (issue.includes("Restricted brand")) {
        severity = "high";
      } else if (issue.includes("Blacklisted keyword")) {
        severity = "high";
      }

      issues.push({
        type: issue.includes("Prohibited")
          ? "prohibited_item"
          : issue.includes("Blacklisted")
            ? "blacklisted_keyword"
            : "restricted_brand",
        severity,
        message: issue,
        details: validation.details,
      });
    }
  }

  return issues;
}

/**
 * Detect counterfeit indicators
 */
function detectProductCounterfeit(product: any): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];

  const validation = detectCounterfeitIndicators(
    product.name,
    product.description || ""
  );

  if (!validation.isValid) {
    for (const issue of validation.issues) {
      issues.push({
        type: "counterfeit_indicator",
        severity: "high",
        message: issue,
        details: validation.details,
      });
    }
  }

  return issues;
}

/**
 * Validate product category
 */
async function validateProductCategory(product: any): Promise<AnalysisIssue[]> {
  const issues: AnalysisIssue[] = [];

  const validation = await validateCategory(
    product.name,
    product.category,
    product.assignedCategory || product.category
  );

  if (!validation.isValid) {
    for (const issue of validation.issues) {
      issues.push({
        type: "wrong_category",
        severity: "medium",
        message: issue,
        details: validation.details,
      });
    }
  }

  return issues;
}

// ─── Quality-check runner that skips ALL database writes ─────────────────────
//
// Used by the URL-based quality checker feature. Accepts the same product
// shape that analyzeProduct() expects but performs zero DB reads/writes so it
// can be called for ad-hoc URL checks without creating batch/product records.

export interface QualityCheckResult {
  issues: AnalysisIssue[];
  summary: {
    totalIssues: number;
    criticalIssues: number;
    highIssues: number;
    mediumIssues: number;
    lowIssues: number;
  };
}

export async function runQualityChecksOnly(
  product: any,
  country: string
): Promise<QualityCheckResult> {
  const issues: AnalysisIssue[] = [];

  // 1. Image quantity checks (no DB writes)
  const imageUrls: string[] = product.images || [];

  if (imageUrls.length === 0) {
    issues.push({
      type: "insufficient_images",
      severity: "critical",
      message: "Product has no images",
      details: { imageCount: 0 },
    });
  } else if (imageUrls.length < 5) {
    issues.push({
      type: "insufficient_images",
      severity: imageUrls.length === 1 ? "high" : "medium",
      message: `Product has only ${imageUrls.length} image(s), minimum recommended is 5`,
      details: { imageCount: imageUrls.length },
    });
  }

  // 2. Image quality checks (read-only — no createProductImage / updateProductImage)
  for (let i = 0; i < imageUrls.length; i++) {
    const analysis = await analyzeImage(imageUrls[i]);
    if (analysis.error) continue; // skip — can't reach image, not a listing problem

    if (!analysis.isWhiteBackground) {
      issues.push({
        type: "non_white_background",
        severity: "medium",
        message: `Image ${i + 1} does not have a white background`,
        details: { imagePosition: i + 1, backgroundColor: analysis.backgroundColorHex },
      });
    }
    if (analysis.isLowResolution) {
      issues.push({
        type: "poor_image_quality",
        severity: "medium",
        message: `Image ${i + 1} has low resolution (${analysis.resolution})`,
        details: { imagePosition: i + 1, resolution: analysis.resolution },
      });
    }
  }

  // 3. Description checks
  //    product.description may be raw HTML — pass as-is so countImagesInDescription works
  const description: string = product.description || "";
  const plainText = description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  if (!plainText) {
    issues.push({
      type: "poor_description",
      severity: "critical",
      message: "Product description is empty",
    });
  } else {
    const wordCount = plainText.split(/\s+/).filter(Boolean).length;

    if (wordCount < 10) {
      issues.push({
        type: "poor_description",
        severity: "high",
        message: `Product description is too short (${wordCount} words — minimum recommended is 50)`,
        details: { wordCount },
      });
    } else if (wordCount < 50) {
      issues.push({
        type: "thin_description",
        severity: "medium",
        message: `Product description is thin (${wordCount} words — recommend at least 50 words)`,
        details: { wordCount },
      });
    }

    // Check for images in description HTML
    const imageCount = countImagesInDescription(description);
    if (imageCount === 0) {
      issues.push({
        type: "missing_description_images",
        severity: "medium",
        message: "Product description does not contain any images",
        details: { imageCount },
      });
    }

    // Detect muddled/garbled text — very high ratio of special chars or HTML entities
    const specialCharRatio = (plainText.match(/[^a-zA-Z0-9\s.,!?;:()\-'"]/g) || []).length / plainText.length;
    if (specialCharRatio > 0.15) {
      issues.push({
        type: "muddled_description",
        severity: "medium",
        message: "Product description appears to contain garbled or muddled text (unusual characters or encoding issues)",
        details: { specialCharRatio: Math.round(specialCharRatio * 100) + "%" },
      });
    }

    // Detect repeated information — check for duplicate sentences
    const sentences = plainText.split(/[.!?]+/).map(s => s.trim().toLowerCase()).filter(s => s.length > 20);
    const seen = new Set<string>();
    let repeatedCount = 0;
    for (const s of sentences) {
      if (seen.has(s)) repeatedCount++;
      seen.add(s);
    }
    if (repeatedCount > 0) {
      issues.push({
        type: "repeated_description",
        severity: "low",
        message: `Product description contains repeated information (${repeatedCount} repeated sentence${repeatedCount !== 1 ? "s" : ""} detected)`,
        details: { repeatedSentences: repeatedCount },
      });
    }

    if (description.includes("  ")) {
      issues.push({
        type: "poor_description",
        severity: "low",
        message: "Description contains excessive whitespace or formatting issues",
      });
    }
  }

  // 4. Name format
  const nameValidation = await validateProductName(product.name, product.category);
  if (!nameValidation.isValid) {
    for (const msg of nameValidation.issues) {
      issues.push({
        type: "naming_format_violation",
        severity: "medium",
        message: `Product name does not follow naming format: ${msg}`,
        details: nameValidation.details,
      });
    }
  }

  // 5. Prohibited / blacklisted / restricted brands
  const prohibitedValidation = await checkProhibitedItems(
    product.name,
    product.description || "",
    product.brand || "",
    country
  );
  if (!prohibitedValidation.isValid) {
    for (const msg of prohibitedValidation.issues) {
      const severity: AnalysisIssue["severity"] = msg.includes("Prohibited item")
        ? "critical"
        : "high";
      issues.push({
        type: msg.includes("Prohibited")
          ? "prohibited_item"
          : msg.includes("Blacklisted")
            ? "blacklisted_keyword"
            : "restricted_brand",
        severity,
        message: msg,
        details: prohibitedValidation.details,
      });
    }
  }

  // 6. Counterfeit indicators
  const counterfeitValidation = detectCounterfeitIndicators(
    product.name,
    product.description || ""
  );
  if (!counterfeitValidation.isValid) {
    for (const msg of counterfeitValidation.issues) {
      issues.push({
        type: "counterfeit_indicator",
        severity: "high",
        message: msg,
        details: counterfeitValidation.details,
      });
    }
  }

  // 7. Category validation
  const categoryValidation = await validateCategory(
    product.name,
    product.category,
    product.assignedCategory || product.category
  );
  if (!categoryValidation.isValid) {
    for (const msg of categoryValidation.issues) {
      issues.push({
        type: "wrong_category",
        severity: "medium",
        message: msg,
        details: categoryValidation.details,
      });
    }
  }

  const summary = {
    totalIssues: issues.length,
    criticalIssues: issues.filter((i) => i.severity === "critical").length,
    highIssues: issues.filter((i) => i.severity === "high").length,
    mediumIssues: issues.filter((i) => i.severity === "medium").length,
    lowIssues: issues.filter((i) => i.severity === "low").length,
  };

  return { issues, summary };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate recommendation based on issue type
 */
function generateRecommendation(issueType: string): string {
  const recommendations: Record<string, string> = {
    poor_image_quality:
      "Improve image quality by using high-resolution images (minimum 300x300px) with clear, professional photography",
    insufficient_images:
      "Add more product images (minimum 5 recommended) showing different angles, details, and use cases",
    non_white_background:
      "Use images with plain white backgrounds for consistency with marketplace standards",
    poor_description:
      "Write a detailed, well-formatted product description (minimum 50 characters) with key features and benefits",
    missing_description_images:
      "Add product images within the description HTML to showcase product features and details",
    naming_format_violation:
      "Rename product to follow the category-specific naming format guidelines",
    prohibited_item:
      "This product is prohibited in this market. Please remove the listing or contact support for approval",
    blacklisted_keyword:
      "Remove blacklisted keywords from product name and description",
    restricted_brand:
      "This brand is restricted in this market. Verify seller credentials or contact support",
    wrong_category:
      "Verify and correct the product category to match the actual product type",
    sensitive_category:
      "This product is in a sensitive category. Ensure compliance with local regulations",
    counterfeit_indicator:
      "Verify product authenticity and remove any counterfeit indicators from listing",
  };

  return (
    recommendations[issueType] ||
    "Review and improve this product listing to meet marketplace standards"
  );
}
