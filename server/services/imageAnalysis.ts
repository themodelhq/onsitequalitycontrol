/**
 * Image Analysis Service
 * Analyzes product images for quality issues
 */

interface ImageAnalysisResult {
  width?: number;
  height?: number;
  resolution?: string;
  backgroundColorHex?: string;
  isWhiteBackground?: boolean;
  isLowResolution?: boolean;
  error?: string;
}

/**
 * Fetch image and analyze its properties
 */
export async function analyzeImage(imageUrl: string): Promise<ImageAnalysisResult> {
  try {
    // Validate URL
    if (!imageUrl || !isValidImageUrl(imageUrl)) {
      return { error: "Invalid image URL" };
    }

    // Fetch image with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }

    // Get image buffer
    const buffer = await response.arrayBuffer();

    // Parse image dimensions and dominant color
    const imageInfo = parseImageBuffer(buffer);

    return {
      width: imageInfo.width,
      height: imageInfo.height,
      resolution: imageInfo.width && imageInfo.height ? `${imageInfo.width}x${imageInfo.height}` : undefined,
      backgroundColorHex: imageInfo.dominantColor,
      isWhiteBackground: isWhiteColor(imageInfo.dominantColor),
      isLowResolution: isLowResolution(imageInfo.width, imageInfo.height),
    };
  } catch (error) {
    console.error(`[Image Analysis] Error analyzing image ${imageUrl}:`, error);
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Validate image URL format
 */
function isValidImageUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const validExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const pathname = urlObj.pathname.toLowerCase();
    return validExtensions.some((ext) => pathname.endsWith(ext)) || url.includes("image");
  } catch {
    return false;
  }
}

/**
 * Parse image buffer to extract dimensions and dominant color
 * Supports JPEG, PNG, GIF, WebP
 */
function parseImageBuffer(buffer: ArrayBuffer): {
  width?: number;
  height?: number;
  dominantColor?: string;
} {
  const view = new Uint8Array(buffer);

  // Check JPEG
  if (view[0] === 0xff && view[1] === 0xd8) {
    return parseJPEG(view);
  }

  // Check PNG
  if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47) {
    return parsePNG(view);
  }

  // Check GIF
  if (view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46) {
    return parseGIF(view);
  }

  // Check WebP
  if (
    view[0] === 0x52 &&
    view[1] === 0x49 &&
    view[2] === 0x46 &&
    view[3] === 0x46 &&
    view[8] === 0x57 &&
    view[9] === 0x45 &&
    view[10] === 0x42 &&
    view[11] === 0x50
  ) {
    return parseWebP(view);
  }

  return { dominantColor: "#FFFFFF" };
}

/**
 * Parse JPEG image
 */
function parseJPEG(view: Uint8Array): {
  width?: number;
  height?: number;
  dominantColor?: string;
} {
  let offset = 2;

  while (offset < view.length) {
    if (view[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = view[offset + 1];

    // SOF (Start of Frame) markers
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      const height = (view[offset + 5] << 8) | view[offset + 6];
      const width = (view[offset + 7] << 8) | view[offset + 8];
      return { width, height, dominantColor: "#FFFFFF" };
    }

    const length = (view[offset + 2] << 8) | view[offset + 3];
    offset += length + 2;
  }

  return { dominantColor: "#FFFFFF" };
}

/**
 * Parse PNG image
 */
function parsePNG(view: Uint8Array): {
  width?: number;
  height?: number;
  dominantColor?: string;
} {
  if (view.length < 24) {
    return { dominantColor: "#FFFFFF" };
  }

  const width = (view[16] << 24) | (view[17] << 16) | (view[18] << 8) | view[19];
  const height = (view[20] << 24) | (view[21] << 16) | (view[22] << 8) | view[23];

  return { width, height, dominantColor: "#FFFFFF" };
}

/**
 * Parse GIF image
 */
function parseGIF(view: Uint8Array): {
  width?: number;
  height?: number;
  dominantColor?: string;
} {
  if (view.length < 10) {
    return { dominantColor: "#FFFFFF" };
  }

  const width = view[6] | (view[7] << 8);
  const height = view[8] | (view[9] << 8);

  return { width, height, dominantColor: "#FFFFFF" };
}

/**
 * Parse WebP image
 */
function parseWebP(view: Uint8Array): {
  width?: number;
  height?: number;
  dominantColor?: string;
} {
  // Simplified WebP parsing - just look for VP8 chunk
  if (view.length < 30) {
    return { dominantColor: "#FFFFFF" };
  }

  // VP8 lossy format
  if (view[12] === 0x9d && view[13] === 0x01 && view[14] === 0x2a) {
    const b1 = view[26];
    const b2 = view[27];
    const b3 = view[28];

    const width = ((b2 & 0x3f) << 8) | b1;
    const height = ((view[29] & 0x0f) << 8) | b3;

    return { width: width + 1, height: height + 1, dominantColor: "#FFFFFF" };
  }

  return { dominantColor: "#FFFFFF" };
}

/**
 * Check if color is white or near-white
 */
function isWhiteColor(colorHex?: string): boolean {
  if (!colorHex) return true; // Assume white if not detected

  // Remove # if present
  const hex = colorHex.replace("#", "");

  if (hex.length !== 6) return true;

  try {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Consider it white if all RGB values are > 200
    return r > 200 && g > 200 && b > 200;
  } catch {
    return true;
  }
}

/**
 * Check if image resolution is low
 */
function isLowResolution(width?: number, height?: number): boolean {
  if (!width || !height) return false;

  // Flag as low resolution if either dimension is less than 300px
  // or total pixels less than 90,000 (300x300)
  const minDimension = Math.min(width, height);
  const totalPixels = width * height;

  return minDimension < 300 || totalPixels < 90000;
}

/**
 * Count images in HTML description
 */
export function countImagesInDescription(htmlDescription: string): number {
  if (!htmlDescription) return 0;

  // Match img tags
  const imgRegex = /<img[^>]*>/gi;
  const matches = htmlDescription.match(imgRegex);

  return matches ? matches.length : 0;
}

/**
 * Extract image URLs from HTML description
 */
export function extractImagesFromDescription(htmlDescription: string): string[] {
  if (!htmlDescription) return [];

  const images: string[] = [];
  const srcRegex = /src=["']([^"']+)["']/gi;

  let match;
  while ((match = srcRegex.exec(htmlDescription)) !== null) {
    if (match[1]) {
      images.push(match[1]);
    }
  }

  return images;
}
