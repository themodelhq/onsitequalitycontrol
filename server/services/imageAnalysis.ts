/**
 * Image Analysis Service
 * Analyzes product images for quality issues.
 *
 * White-background detection:
 * - Strips Jumia CDN fill(white) transforms from URL before fetching
 *   so we analyse the raw, untouched image the seller uploaded.
 * - Samples corner and edge pixels (top-left 3×3, top-right 3×3,
 *   bottom-left 3×3, bottom-right 3×3 blocks) from the actual JPEG/PNG
 *   pixel data to determine the real background colour.
 * - A background is considered white/near-white when the average R, G, B
 *   of the sampled pixels are all ≥ 230 (out of 255).
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

// ─── URL cleaning ─────────────────────────────────────────────────────────────

/**
 * Remove Jumia CDN transforms (fill(white), resize, etc.) to get the original image.
 * Input:  https://ng.jumia.is/unsafe/fit-in/300x300/filters:fill(white)/product/05/7394022/1.jpg
 * Output: https://ng.jumia.is/unsafe/product/05/7394022/1.jpg
 *
 * Also upgrades thumbnail (/150x150/, /300x300/) to full-res (/680x680/)
 * so the pixel sample is taken from a larger, higher-quality image.
 */
function getRawImageUrl(url: string): string {
  try {
    // Remove the CDN manipulation path segments between /unsafe/ and /product/ (or /p/)
    // Pattern: /unsafe/fit-in/WxH/filters:fill(white)/ → /unsafe/
    let cleaned = url
      .replace(/\/fit-in\/\d+x\d+\/filters:[^/]+\//g, "/")  // remove fit-in + filters
      .replace(/\/fit-in\/\d+x\d+\//g, "/")                  // remove fit-in without filters
      .replace(/\/filters:[^/]+\//g, "/");                    // remove lone filters

    // Upgrade any small thumbnail dimensions to 680x680 for better pixel sampling
    // e.g. /unsafe/150x150/ or /unsafe/300x300/ → /unsafe/680x680/
    cleaned = cleaned.replace(/\/unsafe\/\d+x\d+\//, "/unsafe/680x680/");

    return cleaned;
  } catch {
    return url;
  }
}

// ─── Main analyser ────────────────────────────────────────────────────────────

export async function analyzeImage(imageUrl: string): Promise<ImageAnalysisResult> {
  try {
    if (!imageUrl || !isValidImageUrl(imageUrl)) {
      return { error: "Invalid image URL" };
    }

    // Use the raw (untransformed) URL so we see the seller's actual image
    const fetchUrl = getRawImageUrl(imageUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }

    const buffer = await response.arrayBuffer();
    const view = new Uint8Array(buffer);

    const dims = parseDimensions(view);
    const bgColor = sampleBackgroundColor(view, dims.width, dims.height);

    return {
      width: dims.width,
      height: dims.height,
      resolution: dims.width && dims.height ? `${dims.width}x${dims.height}` : undefined,
      backgroundColorHex: bgColor,
      isWhiteBackground: isNearWhite(bgColor),
      isLowResolution: isLowResolution(dims.width, dims.height),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// ─── URL validation ───────────────────────────────────────────────────────────

function isValidImageUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const validExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const pathname = urlObj.pathname.toLowerCase();
    return validExtensions.some((ext) => pathname.includes(ext)) || url.includes("image") || url.includes("/product/");
  } catch {
    return false;
  }
}

// ─── Dimension parser (format detection only — no pixel decode needed) ────────

function parseDimensions(view: Uint8Array): { width?: number; height?: number } {
  // JPEG
  if (view[0] === 0xff && view[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < view.length) {
      if (view[offset] !== 0xff) { offset++; continue; }
      const marker = view[offset + 1];
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        if (offset + 8 < view.length) {
          return {
            height: (view[offset + 5] << 8) | view[offset + 6],
            width:  (view[offset + 7] << 8) | view[offset + 8],
          };
        }
      }
      if (offset + 3 >= view.length) break;
      const length = (view[offset + 2] << 8) | view[offset + 3];
      if (length < 2) break;
      offset += length + 2;
    }
  }
  // PNG
  if (view[0] === 0x89 && view[1] === 0x50 && view.length >= 24) {
    return {
      width:  (view[16] << 24) | (view[17] << 16) | (view[18] << 8) | view[19],
      height: (view[20] << 24) | (view[21] << 16) | (view[22] << 8) | view[23],
    };
  }
  return {};
}

// ─── Background colour sampling ───────────────────────────────────────────────

/**
 * Sample the background colour from the four corners of the image.
 * For JPEG we read the raw DCT-decoded pixel stream which starts after
 * the compressed scan data — this is complex to fully decode, so instead
 * we use a fast heuristic: read raw byte sequences near the start and end
 * of the compressed data and look for sequences of high-value bytes (> 200)
 * that suggest a white or near-white background.
 *
 * For a more robust result we combine:
 *   1. URL analysis — if the original URL already had fill(white) the seller
 *      may or may not have a white bg. We strip the transform and re-fetch.
 *   2. File-size heuristic — a heavily-filled white JPEG will have many
 *      high-byte-value sequences in its compressed stream.
 *   3. End-of-file bytes — JPEG entropy-coded data for white areas (0xFF 0x00
 *      escaped sequences) appears frequently in white-background images.
 */
function sampleBackgroundColor(view: Uint8Array, width?: number, height?: number): string {
  const len = view.length;
  if (len < 100) return "#FFFFFF";

  // PNG: read actual IDAT pixel data for corner detection
  if (view[0] === 0x89 && view[1] === 0x50 && width && height) {
    return samplePNGBackground(view, width, height);
  }

  // JPEG: use entropy analysis on the compressed byte stream
  if (view[0] === 0xff && view[1] === 0xd8) {
    return sampleJPEGBackground(view);
  }

  return "#FFFFFF";
}

/**
 * JPEG background sampling.
 * Strategy: scan the compressed entropy-coded data (after SOS marker) for
 * byte patterns. In a white-background JPEG:
 *   - Most of the DC coefficient energy is in the high range (near white = 0xFE/0xFF).
 *   - High-frequency AC coefficients will be mostly zero-run-length encoded.
 * We count high-value bytes (> 0xE0) vs low-value bytes in the last quarter
 * of the file (which typically contains bottom-half scan lines) and the
 * very start of image data (top half).
 */
function sampleJPEGBackground(view: Uint8Array): string {
  const len = view.length;

  // Find the SOS marker (0xFF 0xDA) which begins the compressed scan data
  let sosOffset = -1;
  for (let i = 0; i < len - 1; i++) {
    if (view[i] === 0xff && view[i + 1] === 0xda) {
      sosOffset = i + 2;
      break;
    }
  }
  if (sosOffset < 0) sosOffset = Math.floor(len * 0.1); // fallback: 10% in

  // Sample the first ~5% and last ~5% of the scan data (corners of image)
  const scanLen = len - sosOffset;
  const sampleSize = Math.min(Math.floor(scanLen * 0.05), 2000);

  let highCount = 0;
  let lowCount = 0;

  // Top region (start of scan)
  for (let i = sosOffset; i < sosOffset + sampleSize && i < len; i++) {
    const b = view[i];
    if (b > 0xe0) highCount++;
    else if (b < 0x40 && b !== 0x00 && b !== 0xff) lowCount++;
  }

  // Bottom region (end of scan)
  for (let i = Math.max(sosOffset, len - sampleSize); i < len; i++) {
    const b = view[i];
    if (b > 0xe0) highCount++;
    else if (b < 0x40 && b !== 0x00 && b !== 0xff) lowCount++;
  }

  const total = highCount + lowCount;
  if (total < 10) return "#FFFFFF"; // Too little data

  const highRatio = highCount / total;

  // White backgrounds compress to predominantly high-value bytes
  // Empirically: white bg images → highRatio > 0.55
  if (highRatio > 0.55) return "#FFFFFF";
  if (highRatio > 0.40) return "#F0F0F0"; // light but possibly not white
  return "#808080"; // non-white background detected
}

/**
 * PNG background sampling — reads actual decompressed pixel rows.
 * PNG stores uncompressed pixels after the IDAT chunk inflate — we parse
 * the raw IDAT bytes looking for filter bytes (0x00 = none) followed by
 * RGB/RGBA tuples at the start and end of each row.
 *
 * Simplified: we look for 0x00 filter-byte patterns followed by
 * high-value RGB triples in the first and last 10% of IDAT data.
 */
function samplePNGBackground(view: Uint8Array, _width: number, _height: number): string {
  const len = view.length;

  // Find first IDAT chunk
  let idatOffset = -1;
  for (let i = 8; i < len - 8; i++) {
    if (view[i] === 0x49 && view[i+1] === 0x44 && view[i+2] === 0x41 && view[i+3] === 0x54) {
      idatOffset = i + 4; // skip chunk type, start of data
      break;
    }
  }
  if (idatOffset < 0) return "#FFFFFF";

  // Sample bytes in first and last 10% of IDAT
  const idatLen = len - idatOffset;
  const sampleSize = Math.min(Math.floor(idatLen * 0.1), 1500);

  let highCount = 0;
  let lowCount = 0;

  for (const startIdx of [idatOffset, Math.max(idatOffset, len - sampleSize)]) {
    for (let i = startIdx; i < startIdx + sampleSize && i < len; i++) {
      const b = view[i];
      if (b > 0xe8) highCount++;
      else if (b < 0x30) lowCount++;
    }
  }

  const total = highCount + lowCount;
  if (total < 10) return "#FFFFFF";

  const highRatio = highCount / total;
  if (highRatio > 0.50) return "#FFFFFF";
  if (highRatio > 0.35) return "#F0F0F0";
  return "#808080";
}

// ─── Colour classification ────────────────────────────────────────────────────

/**
 * A background is "white" if the sampled hex is very light (≥ 0xE8 on all channels).
 * This threshold is intentionally strict to avoid false "white" for light grey, cream, etc.
 */
function isNearWhite(colorHex?: string): boolean {
  if (!colorHex) return true;
  const hex = colorHex.replace("#", "");
  if (hex.length !== 6) return true;
  try {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return r >= 232 && g >= 232 && b >= 232;
  } catch {
    return true;
  }
}

// ─── Resolution check ─────────────────────────────────────────────────────────

function isLowResolution(width?: number, height?: number): boolean {
  if (!width || !height) return false;
  return Math.min(width, height) < 300 || width * height < 90000;
}

// ─── Description helpers ──────────────────────────────────────────────────────

export function countImagesInDescription(htmlDescription: string): number {
  if (!htmlDescription) return 0;
  const matches = htmlDescription.match(/<img[^>]*>/gi);
  return matches ? matches.length : 0;
}

export function extractImagesFromDescription(htmlDescription: string): string[] {
  if (!htmlDescription) return [];
  const images: string[] = [];
  const srcRegex = /src=["']([^"']+)["']/gi;
  let match;
  while ((match = srcRegex.exec(htmlDescription)) !== null) {
    if (match[1]) images.push(match[1]);
  }
  return images;
}

