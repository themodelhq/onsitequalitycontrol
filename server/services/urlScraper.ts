/**
 * URL Scraper Service
 *
 * Fetches a live Jumia product detail page by URL and extracts structured
 * product data using the same window.__STORE__ approach as the testfinder
 * jumia-scraper.ts, with the same anti-blocking measures (random user-agents,
 * random delay, abort timeout).
 *
 * The returned ScrapedProduct is shaped to feed directly into the existing
 * analysisEngine pipeline without any database writes.
 */

import { load } from "cheerio";

// ─── Anti-blocking user-agents (same pool as testfinder) ─────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
];

// ─── Domain → country map (same as testfinder) ───────────────────────────────

const JUMIA_DOMAINS: Record<string, string> = {
  NG: "https://www.jumia.com.ng",
  KE: "https://www.jumia.co.ke",
  UG: "https://www.jumia.ug",
  EG: "https://www.jumia.com.eg",
  GH: "https://www.jumia.com.gh",
  CI: "https://www.jumia.ci",
  MA: "https://www.jumia.ma",
  TN: "https://www.jumia.com.tn",
  ZA: "https://www.zando.co.za",
  SN: "https://www.jumia.sn",
  DZ: "https://www.jumia.com.dz",
  IC: "https://www.jumia.is",
};

const COUNTRY_CURRENCY: Record<string, string> = {
  NG: "NGN", KE: "KES", UG: "UGX", EG: "EGP",
  GH: "GHS", CI: "XOF", MA: "MAD", TN: "TND",
  ZA: "ZAR", SN: "XOF", DZ: "DZD", IC: "EUR",
};

// ─── Suspicious-price heuristics for high-value brands ───────────────────────

// Approximate USD conversion rates (rough — used only for price-floor heuristic)
const APPROX_USD_RATE: Record<string, number> = {
  NGN: 1600, KES: 130, UGX: 3750, EGP: 50,
  GHS: 15, XOF: 600, MAD: 10, TND: 3,
  ZAR: 18, DZD: 135, EUR: 0.92,
};

// Minimum genuine market price (USD) for each luxury / high-value brand key
const HIGH_VALUE_BRAND_FLOORS: Record<string, number> = {
  "rolex": 4000,
  "omega": 2000,
  "cartier": 1500,
  "patek": 10000,
  "hublot": 3000,
  "audemars piguet": 8000,
  "louis vuitton": 300,
  "gucci": 200,
  "prada": 300,
  "hermes": 500,
  "chanel": 400,
  "dior": 300,
  "iphone": 300,
  "apple": 80,
};

// ─── Public types ─────────────────────────────────────────────────────────────

/** Suspicious-price metadata attached to a scraped product */
export interface SuspiciousPriceInfo {
  brandMatched: string;
  listedPriceLocal: number;
  currency: string;
  listedPriceUSD: number;
  floorPriceUSD: number;
  /** Ratio: listedPriceUSD / floorPriceUSD — values < 0.4 are critical */
  ratioToFloor: number;
}

/** A fully scraped product page ready for the analysis engine */
export interface ScrapedProduct {
  sku: string;
  name: string;
  brand: string;
  /** e.g. "Electronics > Phones > Smartphones" */
  category: string;
  country: string;
  price: number;
  currency: string;
  /** Raw HTML of the description section — needed for img-in-description check */
  descriptionHtml: string;
  /** Plain-text version for length / keyword checks */
  description: string;
  /** Full-resolution gallery URLs */
  images: string[];
  /** First / main image used for thumbnail display in UI */
  thumbnailImage: string;
  keyFeatures: string[];
  specifications: Record<string, string>;
  seller: string;
  rating: number;
  totalRatings: number;
  url: string;
  /** true when the description HTML contains at least one <img> tag */
  hasDescriptionImages: boolean;
  /** Non-null when the price is suspiciously below the genuine market floor */
  suspiciousPrice: SuspiciousPriceInfo | null;
}

export type ScrapeResult =
  | { ok: true; product: ScrapedProduct }
  | { ok: false; errorCode: "FETCH_ERROR" | "BLOCKED" | "NOT_PRODUCT_PAGE" | "PARSE_ERROR"; errorMessage: string };

// ─── Private helpers ──────────────────────────────────────────────────────────

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** Random delay — polite scraping without hitting Render's 30s timeout */
function randomDelay(min = 200, max = 600): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.random() * (max - min) + min));
}

function detectCountryFromUrl(url: string): string {
  for (const [code, domain] of Object.entries(JUMIA_DOMAINS)) {
    if (url.startsWith(domain)) return code;
  }
  return "NG";
}

// ─── Page fetcher (same headers as testfinder fetchJumiaByUrl) ────────────────

async function fetchProductPage(url: string): Promise<{ html: string; status: number }> {
  await randomDelay();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": randomUserAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Cache-Control": "max-age=0",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const html = await response.text();
    return { html, status: response.status };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ─── Seller fetcher — mirrors testfinder fetchSellerFromProductPage exactly ────

const SELLER_JUNK = ["العربية", "Appliances", "Sign In", "Jumia"];

async function fetchSellerFromProductPage(productUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(productUrl, {
      method: "GET",
      headers: {
        "User-Agent": randomUserAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Cache-Control": "max-age=0",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) return null;

    const html = await response.text();

    // 1. window.__STORE__ — multiple paths (same as testfinder)
    const storeMatch = html.match(/window\.__STORE__\s*=\s*({[\s\S]*?});\s*<\/script>/);
    if (storeMatch) {
      try {
        const sd = JSON.parse(storeMatch[1]);
        if (sd.viewData?.seller?.name && !SELLER_JUNK.includes(sd.viewData.seller.name))
          return sd.viewData.seller.name;
        if (sd.googleAds?.targeting?.seller?.[0] && !SELLER_JUNK.includes(sd.googleAds.targeting.seller[0]))
          return sd.googleAds.targeting.seller[0];
        const p0 = Array.isArray(sd.products) ? sd.products[0] : sd.product;
        if (p0?.sellerEntity?.name && !SELLER_JUNK.includes(p0.sellerEntity.name))
          return p0.sellerEntity.name;
        if (p0?.sellerName && !SELLER_JUNK.includes(p0.sellerName))
          return p0.sellerName;
      } catch { /* fall through */ }
    }

    // 2. Cheerio HTML fallback
    const $$ = load(html);
    const sellerSection = $$('h2:contains("Seller Information"), h2:contains("Informations sur le vendeur")').closest(".card, section");
    if (sellerSection.length > 0) {
      const nameInLink = sellerSection.find('a[href*="/"]').first().text().trim();
      if (nameInLink && !SELLER_JUNK.includes(nameInLink) && nameInLink.length > 2)
        return nameInLink;
    }

    const jsonLd = $$('script[type="application/ld+json"]').html();
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd);
        if (data.seller?.name && !SELLER_JUNK.includes(data.seller.name))
          return data.seller.name;
      } catch { /* ignore */ }
    }

    return null;
  } catch {
    return null;
  }
}

// ─── window.__STORE__ parser ──────────────────────────────────────────────────

function parseStoreData(html: string): any | null {
  const match = html.match(/window\.__STORE__\s*=\s*({[\s\S]*?});\s*<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// ─── Product-page data extractor ─────────────────────────────────────────────

function extractFromPage(html: string, url: string, country: string): ScrapedProduct {
  const $ = load(html);
  const currency = COUNTRY_CURRENCY[country] || "NGN";
  const storeData = parseStoreData(html);

  // The __STORE__ JSON structure (confirmed from product page JSON):
  // Top level: { viewData: { product, description, shortDescription, specifications, images, seller, ... } }
  // sp: the product object — found at viewData.product OR storeData.product (older pages)
  const sp = storeData?.viewData?.product || storeData?.product || storeData?.products?.[0] || {};
  const viewData = storeData?.viewData || {};

  // ── SKU ──────────────────────────────────────────────────────────────────
  const sku =
    sp.sku ||
    $("meta[name='sku']").attr("content") ||
    (() => { const m = html.match(/"sku"\s*:\s*"([^"]+)"/); return m ? m[1] : ""; })() ||
    "";

  // ── Name ─────────────────────────────────────────────────────────────────
  const name =
    sp.displayName ||
    viewData.name ||
    $("h1.-fs20.-pts.-pbxs").text().trim() ||
    $("h1[data-qa='product-name']").text().trim() ||
    $("h1.name").text().trim() ||
    $("h1").first().text().trim() ||
    "";

  // ── Brand ────────────────────────────────────────────────────────────────
  const brand =
    sp.brand ||
    viewData.brand ||
    $("[data-qa='brand']").text().trim() ||
    $("a[href*='/brand/']").first().text().trim() ||
    (() => {
      try {
        const ld = $("script[type='application/ld+json']").html();
        return ld ? JSON.parse(ld).brand?.name || "" : "";
      } catch { return ""; }
    })() ||
    "";

  // ── Categories ───────────────────────────────────────────────────────────
  const rawCats: string[] = [];
  if (Array.isArray(sp.categories)) rawCats.push(...sp.categories);
  else if (Array.isArray(viewData.categories)) rawCats.push(...viewData.categories);
  else {
    // Breadcrumb fallback
    $(".-pvxs.-phs a, [data-qa='breadcrumb'] a, nav.breadcrumb a, .bc-list a").each((_, el) => {
      const t = $(el).text().trim();
      if (t && t.toLowerCase() !== "home") rawCats.push(t);
    });
  }
  const category = rawCats.filter(Boolean).join(" > ");

  // ── Price ────────────────────────────────────────────────────────────────
  const price =
    sp.prices?.rawPrice ||
    parseFloat(
      ($("span.-b.-ltr.-tal.-fs24, [data-qa='product-price'], .prc").first().text()
        .replace(/[^0-9.]/g, ""))
    ) || 0;

  // ── Images ───────────────────────────────────────────────────────────────
  // From the HTML source:
  //   <a href="ZOOM_URL" class="itm" ...> — zoom/full-res URL in href
  //   <img data-src="500x500 URL"> — medium res in data-src
  // viewData.images[] only exists on the ?json endpoint, not HTML __STORE__
  const images: string[] = [];

  if (Array.isArray(viewData?.images)) {
    for (const img of viewData.images) {
      const s = img?.zoom || img?.img || img?.src || img?.url || "";
      if (s && s.startsWith("http") && !images.includes(s)) images.push(s);
    }
  }

  if (images.length === 0) {
    // From HTML: zoom URLs are in anchor href inside the image slider
    $(".sldr .itm[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href && href.startsWith("http") && !images.includes(href)) images.push(href);
    });
  }

  if (images.length === 0 && Array.isArray(sp.images)) {
    const imgSrc = (img: any) =>
      typeof img === "string" ? img : img?.src || img?.url || "";
    for (const img of sp.images) {
      const s = imgSrc(img);
      if (s && s.startsWith("http")) images.push(s);
    }
  }

  if (images.length === 0) {
    // Fallback: data-src on img tags inside the slider
    $(".sldr img[data-src], .-mi-s img[data-src], img[data-lazy-slide]").each((_, el) => {
      const s = $(el).attr("data-src") || "";
      if (s && s.startsWith("http") && !images.includes(s)) images.push(s);
    });
  }

  const thumbnailImage =
    sp.image ||
    (Array.isArray(viewData?.images) && viewData.images[0]?.thumb) ||
    images[0] || "";

  // ── Description ──────────────────────────────────────────────────────────
  // From the actual page HTML:
  //   <div class="card aim -mtm">
  //     <div id="description" class="hook"></div>
  //     <header>Product details</header>
  //     <div class="markup -mhm -pvl -oxa -sc">...description paragraphs...</div>
  //   </div>
  //
  // The description card is the .aim card that contains a #description hook.
  // NOTE: viewData.description.text only exists on the ?json endpoint (not HTML __STORE__).
  let descriptionHtml = viewData?.description?.text || "";

  if (!descriptionHtml) {
    // Primary: the markup div inside the aim (description) card
    // Use attribute selector for id to find the hook, then navigate to sibling markup
    const aimCard = $(".card.aim, .aim").filter((_, el) =>
      $(el).find("#description, [id='description']").length > 0
    ).first();

    if (aimCard.length > 0) {
      descriptionHtml = aimCard.find("div.markup").first().html() || "";
    }

    // Fallback 1: any .markup div that contains paragraph text (not a spec list)
    if (!descriptionHtml) {
      $("div.markup").each((_, el) => {
        const html = $(el).html() || "";
        // The description contains <p> tags; spec/feature markups have <ul><li>
        if (html.includes("<p") && !descriptionHtml) {
          descriptionHtml = html;
        }
      });
    }

    // Fallback 2: legacy selectors
    if (!descriptionHtml) {
      descriptionHtml =
        $(".detail--overview").html() ||
        $(".pd-desc").html() ||
        $("[data-qa='description']").html() ||
        "";
    }
  }

  const hasDescriptionImages = /<img/i.test(descriptionHtml);
  const description = load(descriptionHtml).text().replace(/\s+/g, " ").trim();

  // ── Key features ─────────────────────────────────────────────────────────
  // From the HTML: <h2 class="hdr ...">Key Features</h2>
  //               <div class="markup -pam"><ul><li>...</li></ul></div>
  const keyFeatures: string[] = [];
  const shortDescHtml = viewData?.shortDescription?.text || "";
  if (shortDescHtml) {
    const $sd = load(shortDescHtml);
    $sd("li").each((_, el) => {
      const t = $sd(el).text().trim();
      if (t) keyFeatures.push(t);
    });
  }

  if (keyFeatures.length === 0) {
    // HTML fallback: find the Key Features card by its heading text
    $(".hdr, h2").each((_, el) => {
      if ($(el).text().trim().toLowerCase().includes("key feature")) {
        $(el).closest("article, div").find("li").each((_, li) => {
          const t = $(li).text().trim();
          if (t) keyFeatures.push(t);
        });
      }
    });
  }

  if (keyFeatures.length === 0) {
    const highlights = sp.highlights || viewData?.highlights;
    if (Array.isArray(highlights)) {
      keyFeatures.push(...highlights.filter(Boolean));
    }
  }

  // ── Specifications ───────────────────────────────────────────────────────
  // From HTML: <ul class="-pvs -mvxs -phm -lsn">
  //              <li><span class="-b">SKU</span>: AP044MP5XRWSCNAFAMZ</li>
  const specifications: Record<string, string> = {};

  // Try viewData.specifications first (works with ?json endpoint)
  const viewSpecs = viewData?.specifications;
  if (Array.isArray(viewSpecs)) {
    for (const group of viewSpecs) {
      if (Array.isArray(group?.attrs)) {
        for (const attr of group.attrs) {
          if (attr?.label && attr?.text) {
            specifications[attr.label] = attr.text;
          }
        }
      }
    }
  }

  if (Object.keys(specifications).length === 0) {
    // HTML fallback: parse <li><span>KEY</span>: VALUE</li> pattern
    $("ul.-lsn li, ul.-pvs li").each((_, el) => {
      const span = $(el).find("span.-b, span._b, b").first();
      if (span.length > 0) {
        const key = span.text().trim();
        // Remove the key span from text to get value
        const full = $(el).text().trim();
        const value = full.replace(key, "").replace(/^[\s:]+/, "").trim();
        if (key && value) specifications[key] = value;
      }
    });
  }

  if (Object.keys(specifications).length === 0) {
    // Final fallback: table rows
    const specs = sp.specifications;
    if (Array.isArray(specs)) {
      for (const s of specs) {
        if (s?.key && s?.value) specifications[s.key] = s.value;
      }
    } else if (specs && typeof specs === "object") {
      Object.assign(specifications, specs);
    }
  }

  // ── Seller ───────────────────────────────────────────────────────────────
  // Same multi-source resolution as testfinder extractProductData
  const JUNK = ["العربية", "Appliances", "Sign In"];
  let seller =
    viewData?.seller?.name ||                                                       // viewData.seller.name (primary per JSON)
    (!JUNK.includes(sp.sellerEntity?.name) && sp.sellerEntity?.name) ||
    (!JUNK.includes(sp.sellerName) && sp.sellerName) ||
    (!JUNK.includes(sp.seller) && sp.seller) ||
    storeData?.ads?.targeting?.seller?.[0] ||                                       // ads.targeting.seller (per JSON)
    (!JUNK.includes(storeData?.googleAds?.targeting?.seller?.[0]) && storeData?.googleAds?.targeting?.seller?.[0]) ||
    $("[data-qa='seller-name'], .sold-by a, .-plxs.-pbxs .-b").text().trim() ||
    "Jumia";

  if (!seller || JUNK.includes(seller)) seller = "Jumia";

  // ── Rating ───────────────────────────────────────────────────────────────
  const rating =
    sp.rating?.average ||
    parseFloat($("[data-qa='rating-score']").text()) || 0;
  const totalRatings =
    sp.rating?.totalRatings ||
    parseInt($("[data-qa='rating-count']").text().replace(/[^0-9]/g, ""), 10) || 0;

  // ── Suspicious-price heuristic ────────────────────────────────────────────
  const suspiciousPrice = computeSuspiciousPrice(name, brand, price, currency);

  return {
    sku, name, brand, category, country, price, currency,
    descriptionHtml, description, images, thumbnailImage,
    keyFeatures, specifications, seller, rating, totalRatings,
    url, hasDescriptionImages, suspiciousPrice,
  };
}

// ─── Suspicious-price check ───────────────────────────────────────────────────

function computeSuspiciousPrice(
  name: string,
  brand: string,
  price: number,
  currency: string,
): SuspiciousPriceInfo | null {
  if (price <= 0) return null;

  const usdRate = APPROX_USD_RATE[currency] || 1;
  const priceUSD = price / usdRate;
  const searchText = `${name} ${brand}`.toLowerCase();

  for (const [brandKey, floorUSD] of Object.entries(HIGH_VALUE_BRAND_FLOORS)) {
    if (searchText.includes(brandKey)) {
      const ratioToFloor = priceUSD / floorUSD;
      if (ratioToFloor < 0.7) {
        return {
          brandMatched: brandKey,
          listedPriceLocal: price,
          currency,
          listedPriceUSD: Math.round(priceUSD),
          floorPriceUSD: floorUSD,
          ratioToFloor,
        };
      }
    }
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scrape a single Jumia product-detail page and return a ScrapedProduct
 * ready to be passed into runQualityChecksOnly() without any DB writes.
 *
 * @param url     Full Jumia product URL
 * @param country Optional ISO country code — auto-detected from URL if omitted
 */
export async function scrapeProductUrl(
  url: string,
  country?: string,
): Promise<ScrapeResult> {
  const resolvedCountry = country || detectCountryFromUrl(url);

  let html: string;
  let status: number;

  try {
    ({ html, status } = await fetchProductPage(url));
  } catch (err) {
    return {
      ok: false,
      errorCode: "FETCH_ERROR",
      errorMessage: err instanceof Error ? err.message : "Network error fetching URL",
    };
  }

  if (status === 403 || status === 429 || status === 503) {
    return {
      ok: false,
      errorCode: "BLOCKED",
      errorMessage: `Jumia returned HTTP ${status} — request was rate-limited or blocked. Try again in a few seconds.`,
    };
  }

  if (status >= 400) {
    return {
      ok: false,
      errorCode: "FETCH_ERROR",
      errorMessage: `HTTP ${status} when fetching the product page`,
    };
  }

  // Must look like a Jumia product page
  const looksLikeProduct =
    html.includes("window.__STORE__") ||
    html.includes("data-qa=\"product-name\"") ||
    html.includes("class=\"name\"") ||
    (html.includes("<h1") && html.includes("price"));

  if (!looksLikeProduct) {
    return {
      ok: false,
      errorCode: "NOT_PRODUCT_PAGE",
      errorMessage: "The URL does not appear to be a Jumia product-detail page",
    };
  }

  try {
    const product = extractFromPage(html, url, resolvedCountry);

    if (!product.name) {
      return {
        ok: false,
        errorCode: "PARSE_ERROR",
        errorMessage: "Could not extract product name — the page structure may have changed or it is not a product page",
      };
    }

    return { ok: true, product };
  } catch (err) {
    return {
      ok: false,
      errorCode: "PARSE_ERROR",
      errorMessage: err instanceof Error ? err.message : "Failed to parse product page",
    };
  }
}

// ─── Catalog-page scraping (keyword / URL / SKU search) ───────────────────────
//
// These functions mirror testfinder's fetchJumiaPage / fetchJumiaByUrl /
// fetchProductsBySkuList. They return lightweight CatalogProduct objects
// (catalog-listing data, not full detail-page data) suitable for displaying
// in the search-results table and exporting to Excel.

export interface CatalogProduct {
  sku: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  oldPrice?: number;
  discount?: string;
  rating: number;
  totalRatings: number;
  image: string;
  url: string;
  seller: string;
  isJumiaExpress: boolean;
  isShopGlobal: boolean;
  stock: string;
  tags: string[];
  country: string;
}

/** Extract CatalogProduct[] from a Jumia catalog/search HTML page */
async function extractCatalogProducts(
  html: string,
  country: string,
): Promise<CatalogProduct[]> {
  const storeMatch = html.match(/window\.__STORE__\s*=\s*({[\s\S]*?});\s*<\/script>/);
  if (!storeMatch) return [];

  let storeData: any;
  try {
    storeData = JSON.parse(storeMatch[1]);
  } catch {
    return [];
  }

  const rawProducts: any[] = Array.isArray(storeData.products) ? storeData.products : [];
  const domain = JUMIA_DOMAINS[country] || JUMIA_DOMAINS.NG;
  const JUNK = ["العربية", "Appliances", "Sign In"];

  // ── Pass 1: build products from __STORE__ data only (no network) ──────────
  const products: CatalogProduct[] = [];
  const needsSellerFetch: number[] = []; // indices of products needing detail-page fetch

  for (const p of rawProducts) {
    if (!p.sku || !p.displayName) continue;

    let seller: string =
      (!JUNK.includes(p.sellerEntity?.name) && p.sellerEntity?.name) ||
      (!JUNK.includes(p.sellerName) && p.sellerName) ||
      (!JUNK.includes(p.seller) && p.seller) ||
      (!JUNK.includes(storeData?.googleAds?.targeting?.seller?.[0]) &&
        storeData?.googleAds?.targeting?.seller?.[0]) ||
      "";

    if (!seller || JUNK.includes(seller) || seller === "Jumia") seller = "";

    const idx = products.length;
    products.push({
      sku: p.sku,
      name: p.displayName || "",
      brand: p.brand || "Unknown",
      category: Array.isArray(p.categories) ? p.categories.join(" > ") : "",
      price:
        p.prices?.rawPrice ||
        (p.prices?.price ? parseFloat(String(p.prices.price).replace(/[^0-9.]/g, "")) : 0),
      oldPrice: p.prices?.rawOldPrice || undefined,
      discount: p.prices?.discount || undefined,
      rating: p.rating?.average || 0,
      totalRatings: p.rating?.totalRatings || 0,
      image: p.image || "",
      url: p.url ? `${domain}${p.url}` : "",
      seller: seller || "Jumia",
      isJumiaExpress: !!(p.isJumiaExpress || p.isShopExpress || p.shopExpress),
      isShopGlobal: !!p.isShopGlobal,
      stock: p.stockInfo?.text || "In Stock",
      tags: p.tags ? String(p.tags).split("|").filter(Boolean) : [],
      country,
    });

    if (!seller) needsSellerFetch.push(idx);
  }

  // ── Pass 2: fetch missing sellers concurrently (max 8 in parallel) ────────
  // Uses a concurrency pool so all fetches complete in ~3-5s instead of
  // 40-120s sequentially, staying well within Netlify/Render timeouts.
  if (needsSellerFetch.length > 0) {
    const CONCURRENCY = 8;
    const FETCH_TIMEOUT = 8000; // 8s per individual seller fetch

    async function fetchSellerWithTimeout(productUrl: string): Promise<string> {
      try {
        const result = await Promise.race([
          fetchSellerFromProductPage(productUrl),
          new Promise<null>((r) => setTimeout(() => r(null), FETCH_TIMEOUT)),
        ]);
        return (result && !JUNK.includes(result) && result !== "Jumia") ? result : "Jumia";
      } catch {
        return "Jumia";
      }
    }

    // Process in batches of CONCURRENCY
    for (let i = 0; i < needsSellerFetch.length; i += CONCURRENCY) {
      const batch = needsSellerFetch.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((idx) => {
          const url = products[idx].url;
          return url ? fetchSellerWithTimeout(url) : Promise.resolve("Jumia");
        })
      );
      results.forEach((seller, j) => {
        products[batch[j]].seller = seller;
      });
    }
  }

  return products;
}

/** Fetch a catalog / search URL and return products + hasMore */
export async function fetchCatalogByUrl(
  url: string,
  country?: string,
): Promise<{ products: CatalogProduct[]; hasMore: boolean }> {
  const resolvedCountry = country || detectCountryFromUrl(url);

  try {
    const { html, status } = await fetchProductPage(url);
    if (status === 403 || status === 429 || status === 503) {
      console.warn(`[Catalog Scraper] Blocked (${status}) on ${url}`);
      return { products: [], hasMore: false };
    }
    if (status >= 400) return { products: [], hasMore: false };

    const products = await extractCatalogProducts(html, resolvedCountry);
    // Jumia paginates; detect "next" link to indicate more pages available
    const hasMore = (html.includes('"next"') || html.includes("page=")) && products.length > 0;
    return { products, hasMore };
  } catch (err) {
    console.error("[Catalog Scraper] Error:", err);
    return { products: [], hasMore: false };
  }
}

/** Search Jumia catalog by keyword for ONE specific page */
export async function fetchCatalogByKeyword(
  keyword: string,
  country: string,
  _pages = 1,      // kept for backward compat, ignored
  page = 1,        // which page to fetch
): Promise<{ products: CatalogProduct[]; hasMore: boolean }> {
  const domain = JUMIA_DOMAINS[country] || JUMIA_DOMAINS.NG;
  const catalogUrl = `${domain}/catalog/?q=${encodeURIComponent(keyword)}&page=${page}`;
  return fetchCatalogByUrl(catalogUrl, country);
}

/** Search Jumia by SKU list — one search per SKU, returns matched products */
export async function fetchCatalogBySkuList(
  skus: string[],
  country: string,
): Promise<CatalogProduct[]> {
  const domain = JUMIA_DOMAINS[country] || JUMIA_DOMAINS.NG;
  const results: CatalogProduct[] = [];

  for (const sku of skus) {
    const trimmed = sku.trim();
    if (!trimmed) continue;
    try {
      const searchUrl = `${domain}/catalog/?q=${encodeURIComponent(trimmed)}`;
      const { products } = await fetchCatalogByUrl(searchUrl, country);
      if (products.length > 0) {
        const exact = products.find((p) => p.sku === trimmed);
        results.push(exact || products[0]);
      }
    } catch (err) {
      console.error(`[Catalog Scraper] SKU ${trimmed} failed:`, err);
    }
    await randomDelay(200, 400);
  }

  return results;
}
