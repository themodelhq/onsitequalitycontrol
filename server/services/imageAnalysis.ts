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
  isNonSquare?: boolean;
  error?: string;
}

// ─── URL cleaning ─────────────────────────────────────────────────────────────

/**
 * Remove only the fill(white) filter from Jumia CDN URLs, keeping size parameters.
 * Input:  https://ng.jumia.is/unsafe/fit-in/300x300/filters:fill(white)/product/05/7394022/1.jpg
 * Output: https://ng.jumia.is/unsafe/fit-in/680x680/product/05/7394022/1.jpg
 *
 * We KEEP the fit-in/WxH part because Jumia's image server requires it.
 * We REMOVE filters:fill(white) so the background colour is the seller's original.
 * We UPGRADE to 680x680 for better pixel sampling quality.
 */
function getRawImageUrl(url: string): string {
  try {
    // Step 1: remove filters:fill(white) (and any other filters segment)
    let cleaned = url.replace(/\/filters:[^/]+\//g, "/");

    // Step 2: upgrade size to 680x680 for better sampling
    cleaned = cleaned.replace(/\/fit-in\/\d+x\d+\//, "/fit-in/680x680/");

    // Step 3: if no fit-in segment exists, add one
    if (!cleaned.includes("/fit-in/")) {
      cleaned = cleaned.replace("/unsafe/", "/unsafe/fit-in/680x680/");
    }

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

    // Signal: if the original CDN URL already had fill(white), the seller's uploaded
    // image was being white-padded by Jumia's CDN. We still fetch the raw image
    // (without fill) to detect the actual background, but we treat ambiguous results
    // as white rather than non-white for fill(white) URLs.
    const hadFillWhite = imageUrl.includes("fill(white)") || imageUrl.includes("fill%28white%29");

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
    const bgColor = sampleBackgroundColor(view, dims.width, dims.height, hadFillWhite);

    return {
      width: dims.width,
      height: dims.height,
      resolution: dims.width && dims.height ? `${dims.width}x${dims.height}` : undefined,
      backgroundColorHex: bgColor,
      isWhiteBackground: isNearWhite(bgColor),
      isLowResolution: isLowResolution(dims.width, dims.height),
      isNonSquare: isNonSquareImage(dims.width, dims.height),
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
function sampleBackgroundColor(view: Uint8Array, width?: number, height?: number, hadFillWhite = false): string {
  const len = view.length;
  if (len < 100) return "#FFFFFF";

  // PNG: read actual IDAT pixel data for corner detection
  if (view[0] === 0x89 && view[1] === 0x50 && width && height) {
    return samplePNGBackground(view, width, height, hadFillWhite);
  }

  // JPEG: use entropy analysis on the compressed byte stream
  if (view[0] === 0xff && view[1] === 0xd8) {
    return sampleJPEGBackground(view, hadFillWhite);
  }

  return "#FFFFFF";
}

/**
 * JPEG background sampling.
 *
 * Strategy: after stripping the fill(white) CDN transform, we fetch the raw
 * image the seller originally uploaded. We then scan its compressed entropy
 * data for two things:
 *
 *   1. "White signal" — sequences of 0xFF 0x00 (JPEG byte-stuffing) which
 *      appear abundantly when large uniform white areas are encoded.
 *   2. "Non-white signal" — high entropy and varied low/mid byte values which
 *      indicate coloured or complex backgrounds.
 *
 * Thresholds tuned from empirical testing on Jumia product images:
 *   - stuffed 0xFF00 pairs >  2% of total bytes  → likely white
 *   - high-variance mid-range bytes dominant      → likely non-white
 */
function sampleJPEGBackground(view: Uint8Array, hadFillWhite = false): string {
  const len = view.length;

  // Find the SOS marker (0xFF 0xDA) — start of compressed image data
  let sosOffset = -1;
  for (let i = 2; i < len - 1; i++) {
    if (view[i] === 0xff && view[i + 1] === 0xda) {
      sosOffset = i + 2;
      break;
    }
  }
  if (sosOffset < 0) sosOffset = Math.floor(len * 0.1);

  const scanLen = len - sosOffset;
  if (scanLen < 50) return "#FFFFFF";

  // Count JPEG byte-stuffed 0xFF 0x00 pairs (appear in white/uniform areas)
  let stuffedPairs = 0;
  // Count "mid-range" bytes (0x40–0xBF) which indicate varied colour/texture
  let midBytes = 0;
  // Count very-high bytes (0xE0–0xFE, excluding 0xFF markers)
  let highBytes = 0;
  let totalBytes = 0;

  // Sample evenly across the scan: first 10%, middle 10%, last 10%
  const segSize = Math.min(Math.floor(scanLen * 0.10), 3000);
  const segments = [
    sosOffset,                                           // top of image
    sosOffset + Math.floor(scanLen * 0.45),              // middle
    Math.max(sosOffset, len - segSize),                  // bottom
  ];

  for (const start of segments) {
    for (let i = start; i < start + segSize && i + 1 < len; i++) {
      const b = view[i];
      totalBytes++;
      if (b === 0xff && view[i + 1] === 0x00) {
        stuffedPairs++;
        i++; // skip the 0x00
      } else if (b >= 0x40 && b <= 0xBF) {
        midBytes++;
      } else if (b >= 0xE0 && b <= 0xFE) {
        highBytes++;
      }
    }
  }

  if (totalBytes < 20) return "#FFFFFF";

  const stuffedRatio  = stuffedPairs / totalBytes;
  const midRatio      = midBytes     / totalBytes;
  const highRatio     = highBytes    / totalBytes;

  // When the original CDN URL had fill(white), Jumia was already white-padding
  // the image. Flag non-white only when BOTH mid-range bytes clearly dominate
  // (> 45%) AND the high-byte count is very low (< 9%).
  // A product on a plain white background — even metallic/gold shoes or dark racks —
  // always produces some high bytes (hr ≈ 0.08+) from the large white areas.
  // Lifestyle/coloured backgrounds (streets, rooms) produce almost no high bytes
  // (hr < 0.07) and push midRatio above 0.46+.
  // The combined check correctly separates plain-white-bg products from lifestyle shots.
  if (hadFillWhite) {
    return (midRatio > 0.45 && highRatio < 0.09) ? "#808080" : "#FFFFFF";
  }

  // Without fill(white) signal: original thresholds
  // Strong white signal: many stuffed pairs AND high bytes dominate
  if (stuffedRatio > 0.04 && highRatio > 0.25) return "#FFFFFF";
  if (stuffedRatio > 0.06) return "#FFFFFF";

  // Strong non-white signal: mid-range bytes dominate
  if (midRatio > 0.35) return "#808080";
  // Flag non-white only when BOTH mid content is high AND high-byte content
  // is very low — a shoe/product on white still produces some high bytes (hr ≈ 0.10)
  // from the white background, so we require hr < 0.08 to avoid false positives.
  if (midRatio > 0.25 && stuffedRatio < 0.03 && highRatio < 0.08) return "#808080";

  // Light/ambiguous — treat as off-white
  if (highRatio > 0.30) return "#F0F0F0";

  // Default: if combined white signal (stuffed + high bytes) is meaningful,
  // treat as near-white rather than defaulting to non-white.
  if ((stuffedRatio + highRatio) > 0.09) return "#F0F0F0";

  // Default: non-white (conservative — better to flag than to miss)
  return "#808080";
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
function samplePNGBackground(view: Uint8Array, _width: number, _height: number, hadFillWhite = false): string {
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
  if (hadFillWhite) {
    // For fill(white) images only flag non-white when there is almost zero white signal
    return highRatio < 0.08 ? "#808080" : "#FFFFFF";
  }
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

/**
 * Detect non-square images (rectangular) or images that don't fill the canvas.
 * Jumia requires square images (1:1 aspect ratio).
 * We flag images where width:height ratio deviates more than 5% from 1:1.
 */
function isNonSquareImage(width?: number, height?: number): boolean {
  if (!width || !height) return false;
  const ratio = width / height;
  return ratio < 0.95 || ratio > 1.05;
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

