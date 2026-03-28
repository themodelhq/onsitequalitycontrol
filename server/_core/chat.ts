/**
 * Chat API Handler
 *
 * Calls the Groq REST API directly via fetch (OpenAI-compatible format).
 * No ai-sdk version compatibility issues — pure HTTP.
 * Free tier: https://console.groq.com
 *
 * Falls back to a fully data-driven built-in responder when Groq is
 * unavailable (revoked key, rate-limit, network error, etc.).
 * The fallback uses the actual reference data from referenceData.ts so every
 * answer is specific, accurate, and cites real rules — never generic.
 */

import type { Express } from "express";
import { ENV } from "./env";
import {
  getInMemoryProhibitedItems,
  getInMemoryBlacklistedKeywords,
  getInMemoryRestrictedBrands,
  getInMemoryNamingFormats,
  getNGSellerRules,
  getMAForbiddenBrands,
  getMAFragranceOnlyBrands,
  getMASellerRules,
  getMAProhibitedBookSellers,
} from "../referenceData";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL   = "llama-3.3-70b-versatile";
const GROQ_API_KEY = () => ENV.groqApiKey;

const SYSTEM_PROMPT = `You are an expert Jumia marketplace Quality Control (QC) assistant. You help QC teams, sellers, and analysts understand and apply Jumia's product listing policies across all African markets.

## Your Expertise

**Prohibited Items** — Products completely blocked from listing on Jumia:
- Health & Beauty: Prescription drugs, skin-lightening creams with mercury/hydroquinone >2%, anabolic steroids
- Electronics: Signal blockers, jammers, counterfeit electronics
- Weapons & Dangerous Goods: Firearms, explosives, fireworks, tasers, handcuffs, lockpicking devices
- Substances: Tobacco, cigarettes, e-cigarettes, CBD/cannabis products, alcohol (select countries)
- Others: Live animals, military uniforms, camouflage clothing (NG/DZ/SN/UG), currency, human organs
- Country-specific: e.g. alcohol prohibited in Algeria (DZ) and Senegal (SN)

**Blacklisted Keywords** — Banned from product names and descriptions (5,600+ keywords):
- Off-platform contact: WhatsApp numbers, phone numbers, Konga references, competitor links
- Misleading claims: "100% Original", "0RIGINAL", "Best in Nigeria", "Cheapest", "Government approved"
- Profanity, offensive terms, fake/counterfeit signals: "Replica", "Clone", "First copy", "AAA grade"
- Dangerous claims: False medical/health claims, unapproved drug references

**Restricted Brands** — Two levels:
1. BLOCKED (9 brands): Bösendorfer, Chanel, Harman Kardon, Leica, Phase One, Rolex, Forever Living, ORIFLAME, Aneeza
2. VERIFIED SELLERS ONLY (426 brands): Adidas, Nike, Apple, Samsung, Gucci, Louis Vuitton, Sony, Bose, Dyson, Ralph Lauren, etc.

**Nigeria (NG) Specific Rules:**
- Apple: 238 Apple Authorized Sellers only
- LG & Samsung appliances/TVs: 154 approved sellers only
- Hisense: 200+ approved sellers only
- Polystar: 48 approved sellers only
- Gift Cards: SPHYKE GAMING PLANET (SGP) only
- Groceries/Food: 18 approved grocery sellers only
- Power Banks ≥20,000mAh: 12 approved brands (Anker, Baseus, Oraimo, Romoss, Itel, etc.)
- Refurbished Phones: 16 approved sellers only
- HP Ink/Toner: 400+ HP Authorized Sellers only

**Morocco (MA) Specific Rules:**
- 60 brands completely forbidden (Louis Vuitton, Versace, Lacoste, MAC, Diesel, Beats, etc.)
- Fragrance-only brands: certain brands (Olaplex, The Ordinary, Nike, Victoria's Secret, etc.) allowed only under Fragrances
- 175 brands restricted to approved sellers only (Nike, Gucci, Dior, Armani, Ikea, Xiaomi, HP, etc.)
- Prohibited book sellers: Expresse Shop and Shopear cannot list books

**Quality Score:** Critical −25pts, High −12pts, Medium −6pts, Low −2pts (max 100)

**Image Requirements:** Min 5 images, plain white background on first image, min 300×300px, square (1:1 ratio)

**Naming Formats:** Category-specific e.g. Mobile Phones: Brand + Product name + Screen size + Memory + OS - Colour

**Counterfeit Signals:** Replica/fake/knockoff language, brand misspellings, price < 30% of genuine floor

Always be specific, practical, and cite the relevant rule when answering.`;

/**
 * Convert a UIMessage or CoreMessage to a simple {role, content} object
 * that the Groq API understands.
 */
function toGroqMessage(msg: any): { role: string; content: string } {
  if (typeof msg.content === "string") return { role: msg.role, content: msg.content };
  if (Array.isArray(msg.parts)) {
    const text = msg.parts.filter((p: any) => p.type === "text").map((p: any) => p.text || "").join("");
    return { role: msg.role, content: text };
  }
  if (Array.isArray(msg.content)) {
    const text = msg.content.filter((p: any) => p.type === "text").map((p: any) => p.text || "").join("");
    return { role: msg.role, content: text };
  }
  return { role: msg.role, content: String(msg.content ?? "") };
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA-DRIVEN FALLBACK RESPONDER
//
// Uses the actual in-memory reference data (prohibited items, blacklisted
// keywords, restricted brands, naming formats, NG rules, MA rules) to give
// precise, accurate answers — not generic placeholders.
// ─────────────────────────────────────────────────────────────────────────────

function buildFallbackResponse(userMessage: string): string {
  const q = userMessage.toLowerCase().trim();

  // ── Greetings ──────────────────────────────────────────────────────────────
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|howdy|greetings|what('s| is) up)[\s!?.]*$/.test(q)) {
    return `Hi! I'm your Jumia QC Assistant. I can help with quality checks, product listing rules, prohibited items, blacklisted keywords, restricted brands, naming formats, and country-specific policies for NG, MA, EG, KE, GH, and more. What would you like to know?`;
  }

  // ── Quality Score ─────────────────────────────────────────────────────────
  if (/quality.?score|score.?calculat|how.?score|scoring|points|deduct|100 points/.test(q)) {
    return `The quality score starts at **100** and deductions are applied for every issue found:

- **Critical** → −25 pts each (prohibited items, hard-banned brands, empty descriptions)
- **High** → −12 pts each (seller restriction violations, blacklisted keywords in title, MA/NG rule breaches)
- **Medium** → −6 pts each (non-white background, non-square images, naming format violations, wrong category)
- **Low** → −2 pts each (thin descriptions, minor image quality issues)

A score of **80+** is healthy. **60–79** needs attention. **Below 60** means the listing is unlikely to be approved. Products with critical issues (score ≤ 50) are typically taken down immediately.`;
  }

  // ── Images ────────────────────────────────────────────────────────────────
  if (/image|photo|picture|white.?background|non.?white|resolution|square|aspect.?ratio|how many image/.test(q)) {
    return `Jumia's image requirements are:

- **Minimum 5 images** — fewer images triggers an "insufficient images" flag (Critical if 0, High if 1, Medium if 2–4)
- **White background on the main image** — any non-white, grey, or busy background on image 1 triggers a medium flag. Other images may have lifestyle backgrounds.
- **Minimum 300×300px resolution** — images below this are flagged as low resolution (medium severity)
- **Square (1:1) ratio** — images where width/height ratio deviates more than 5% from 1:1 are flagged. Jumia's catalog displays all images square, so rectangular images are cropped or displayed incorrectly.

For best results: use 1000×1000px white background shots, show multiple product angles, and include a lifestyle or in-use shot among the extras.`;
  }

  // ── Descriptions ──────────────────────────────────────────────────────────
  if (/description|describ|thin.?desc|short.?desc|muddl|repeated.?desc|desc.?require|word.?count/.test(q)) {
    return `Description quality checks:

- **Empty description** → Critical issue (−25 pts)
- **Too short (< 10 words)** → High issue (−12 pts)
- **Thin (10–49 words)** → Medium issue (−6 pts). Aim for at least 50 words.
- **Muddled/garbled text** → Medium — triggers when over 15% of characters are special chars or encoding errors
- **Repeated sentences** → Low — the checker detects duplicate sentences within the description
- **No images in description** → Medium — Jumia expects at least one image embedded in the HTML description

A strong description covers: what the product is, key features and specs, what's in the box, size/compatibility information, and any relevant usage instructions. Avoid copying the product name verbatim into the description body.`;
  }

  // ── Naming Format ─────────────────────────────────────────────────────────
  if (/naming|product.?name|name.?format|title.?format|how.?name|format.?for/.test(q)) {
    const formats = getInMemoryNamingFormats();
    // Check if they asked about a specific category
    const matchedFormat = formats.find(f =>
      q.includes(f.categoryName.toLowerCase()) ||
      f.categoryName.toLowerCase().split(/[\s/]+/).some(w => w.length > 3 && q.includes(w))
    );
    if (matchedFormat) {
      return `For **${matchedFormat.categoryName}**, the naming format is:\n\n**${matchedFormat.format}**\n\nExample: *${matchedFormat.example}*\n\nThe checker validates that each component is structurally present in the product name. Missing any required component triggers a naming format violation (Medium severity, −6 pts).`;
    }
    // General naming response with actual format list
    const sampleFormats = formats.slice(0, 8).map(f => `- **${f.categoryName}**: ${f.format}`).join("\n");
    return `Jumia uses category-specific naming formats. Here are some examples from the ${formats.length} defined formats:\n\n${sampleFormats}\n\nAsk me about a specific category (e.g. "what's the naming format for mobile phones?") and I'll give you the exact format and an example.`;
  }

  // ── Prohibited Items ──────────────────────────────────────────────────────
  if (/prohibit|banned.?item|blocked.?item|cannot.?list|not.?allow|forbidden.?item|what.?can.?i.?not.?sell|what.?is.?banned/.test(q)) {
    const items = getInMemoryProhibitedItems();
    const country = q.includes("nigeria") || q.includes(" ng ") ? "NG"
      : q.includes("egypt") || q.includes(" eg ") ? "EG"
      : q.includes("morocco") || q.includes(" ma ") ? "MA"
      : q.includes("kenya") || q.includes(" ke ") ? "KE"
      : q.includes("ghana") || q.includes(" gh ") ? "GH"
      : q.includes("algeria") || q.includes(" dz ") ? "DZ"
      : q.includes("senegal") || q.includes(" sn ") ? "SN"
      : null;

    const relevant = country
      ? items.filter(i => {
          const countries: string[] = i.countries ? JSON.parse(i.countries) : [];
          return countries.length === 0 || countries.includes(country);
        })
      : items.filter(i => {
          const countries: string[] = i.countries ? JSON.parse(i.countries) : [];
          return countries.length === 0;
        });

    const blocked = relevant.filter(i => i.status === "blocked").slice(0, 18);
    const itemList = blocked.map(i => `- ${i.keyword}`).join("\n");

    if (country) {
      return `Prohibited items for **${country}** (${blocked.length} blocked categories shown):\n\n${itemList}\n\nThese trigger a Critical issue (−25 pts) and will typically result in the listing being rejected or removed. Some additional items may be restricted in ${country} specifically — ask me about a specific product if you're unsure.`;
    }
    return `Globally prohibited items across Jumia markets include:\n\n${itemList}\n\nAdditional country-specific prohibitions apply — for example, alcohol is blocked in Algeria (DZ) and Senegal (SN), and adult content is blocked in Egypt (EG), Morocco (MA), and Algeria (DZ). Ask me about a specific country or product type for more detail.`;
  }

  // ── Blacklisted Keywords ──────────────────────────────────────────────────
  if (/blacklist|keyword|banned.?word|blacklisted.?word|title.?issue|keyword.?flag|what.?word/.test(q)) {
    const keywords = getInMemoryBlacklistedKeywords();
    const country = q.includes("nigeria") || q.includes(" ng ") ? "NG"
      : q.includes("ghana") || q.includes(" gh ") ? "GH"
      : q.includes("kenya") || q.includes(" ke ") ? "KE"
      : q.includes("egypt") || q.includes(" eg ") ? "EG"
      : null;

    const relevant = country
      ? keywords.filter(k => {
          const countries: string[] = k.countries ? JSON.parse(k.countries) : [];
          return countries.length === 0 || countries.includes(country);
        })
      : keywords;

    // Categorise by type
    const fakeSignals = relevant.filter(k =>
      /replica|clone|fake|first.?copy|aaa.?grade|non.?original|0riginal|inspired.?by/i.test(k.keyword)
    ).slice(0, 8).map(k => k.keyword);

    const misleading = relevant.filter(k =>
      /100%.?original|cheapest|best.?in|government.?approved|no\.?1.?in|certified.?by/i.test(k.keyword)
    ).slice(0, 6).map(k => k.keyword);

    const mahClaims = relevant.filter(k =>
      /\d{5,}[\s]?mah/i.test(k.keyword)
    ).slice(0, 4).map(k => k.keyword);

    return `The system checks ${relevant.length.toLocaleString()}${country ? ` ${country}-applicable` : ""} blacklisted keywords across product titles and descriptions. Key categories:

**Counterfeit/fake signals**: ${fakeSignals.join(", ")}

**Misleading claims**: ${misleading.join(", ")}

**Fake battery capacity claims**: ${mahClaims.join(", ")} (and 40+ more inflated mAh values)

**Other common triggers**: competitor platform names (Konga, Tonaton), off-platform contact info (phone numbers, WhatsApp), adult content terms, drug/controlled substance references, and profanity.

Any match triggers a High severity issue (−12 pts). The check uses whole-word matching for short keywords (≤5 chars) to avoid false positives on innocent words.`;
  }

  // ── Restricted Brands ─────────────────────────────────────────────────────
  if (/restrict.?brand|brand.?restrict|verified.?seller|brand.?policy|approved.?brand|block.?brand|which.?brand/.test(q)) {
    const brands = getInMemoryRestrictedBrands();
    const blocked = brands.filter(b => b.restrictionType === "blocked").map(b => b.brand);
    const verifiedOnly = brands.filter(b => b.restrictionType === "verified_sellers_only");

    // Check if they asked about a specific brand
    const mentionedBrand = verifiedOnly.find(b =>
      q.includes(b.brand.toLowerCase()) ||
      q.includes(b.brand.toLowerCase().replace(/[^a-z0-9]/g, ""))
    );
    if (mentionedBrand) {
      return `**${mentionedBrand.brand}** is on Jumia's **Verified Sellers Only** list. This means only sellers who have been formally approved to sell this brand can list it. Listing this brand without verified seller status triggers a High issue (−12 pts) and the listing may be rejected.\n\nTo get approved, you typically need to contact Jumia's brand management team and provide proof of authorized distributorship or official partnership with the brand.`;
    }

    const verifiedSample = verifiedOnly.slice(0, 20).map(b => b.brand).join(", ");
    return `Restricted brands fall into two categories:

**Completely blocked (${blocked.length} brands):**
${blocked.join(", ")}
These cannot be listed by any seller under any circumstances. Listing them triggers a Critical issue.

**Verified sellers only (${verifiedOnly.length} brands) — sample:**
${verifiedSample}, and ${verifiedOnly.length - 20} more.
These brands require formal Jumia approval before you can list them. Unauthorized listings trigger a High issue (−12 pts).

Ask me about a specific brand (e.g. "is Nike restricted?") and I'll tell you its exact restriction status.`;
  }

  // ── Specific brand lookup ─────────────────────────────────────────────────
  if (/is\s+\w+\s+(restricted|blocked|allowed|banned|forbidden)|can\s+i\s+(sell|list)\s+\w+/.test(q) || /\w+\s+(brand|seller)/.test(q)) {
    const brands = getInMemoryRestrictedBrands();
    const maForbidden = getMAForbiddenBrands();
    const maFragranceOnly = getMAFragranceOnlyBrands();
    const maSellerRules = getMASellerRules();

    // Try to extract the brand being asked about
    const stopWords = new Set(["is","the","can","sell","list","brand","seller","i","a","in","on","for","this","that","and","or","are","was","does","my","our","their"]);
    const words = q.replace(/[?.,!]/g,"").split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));

    for (const word of words) {
      const globalMatch = brands.find(b => b.brand.toLowerCase() === word || b.brand.toLowerCase().replace(/[^a-z0-9]/g,"") === word);
      const maForbiddenMatch = maForbidden.find(b => b.toLowerCase() === word || b.toLowerCase().replace(/[^a-z0-9]/g,"") === word);
      const maFragranceMatch = maFragranceOnly.find(b => b.toLowerCase() === word || b.toLowerCase().replace(/[^a-z0-9]/g,"") === word);
      const maSellerMatch = maSellerRules.find(r => r.brand.toLowerCase() === word || r.brand.toLowerCase().replace(/[^a-z0-9]/g,"") === word);

      if (globalMatch || maForbiddenMatch || maFragranceMatch || maSellerMatch) {
        const brandName = globalMatch?.brand ?? maForbiddenMatch ?? maFragranceMatch ?? maSellerMatch?.brand;
        const parts: string[] = [];

        if (globalMatch?.restrictionType === "blocked") {
          parts.push(`**${brandName}** is **globally blocked** on Jumia — it cannot be listed by any seller in any market. Listing it triggers a Critical issue.`);
        } else if (globalMatch?.restrictionType === "verified_sellers_only") {
          parts.push(`**${brandName}** requires **verified seller status** globally — only formally approved sellers can list it. Unauthorized listings trigger a High issue (−12 pts).`);
        }
        if (maForbiddenMatch) {
          parts.push(`In **Morocco (MA)**, ${brandName} is **completely forbidden** — even approved sellers cannot list it.`);
        }
        if (maFragranceMatch && !maForbiddenMatch) {
          parts.push(`In **Morocco (MA)**, ${brandName} is restricted to the **Fragrances category only**. Listing it under any other category triggers a High issue.`);
        }
        if (maSellerMatch && !maForbiddenMatch) {
          const sellerCount = maSellerMatch.approvedSellers.length;
          parts.push(`In **Morocco (MA)**, ${brandName} can only be sold by ${sellerCount} approved seller${sellerCount !== 1 ? "s" : ""}. Unlisted sellers trigger a High issue.`);
        }
        if (parts.length > 0) return parts.join("\n\n");
      }
    }
  }

  // ── Nigeria Specific ──────────────────────────────────────────────────────
  if (/nigeria|ng\b|ng\s+rule|ng\s+seller|apple.?(nigeria|ng)|samsung.?(nigeria|ng)|hisense|polystar|gift.?card|grocery.?seller|power.?bank.?(ng|nigeria|20k|20,000)|refurbish|hp.?ink|hp.?toner/.test(q)) {
    const ngRules = getNGSellerRules();

    // Check for a specific NG rule
    for (const rule of ngRules) {
      const brandMatch = rule.brands.some(b => q.includes(b.toLowerCase()));
      const categoryMatch = rule.categoryKeywords.some(k => q.includes(k.toLowerCase()));
      const nameMatch = rule.productKeywords.some(k => q.includes(k.toLowerCase()));
      if (brandMatch || categoryMatch || nameMatch) {
        const sellerCount = rule.approvedSellers.length;
        const sampleSellers = rule.approvedSellers.slice(0, 5).join(", ");
        return `**NG Rule — ${rule.description}**\n\nThis rule requires products to be sold by one of **${sellerCount} approved seller${sellerCount !== 1 ? "s" : ""}**. Sample approved sellers: ${sampleSellers}${sellerCount > 5 ? `, and ${sellerCount - 5} more` : ""}.\n\nIf the seller is not on the approved list, the product gets flagged with a High severity issue (−12 pts). To get added to the approved list, the seller needs to work with Jumia's category management team.`;
      }
    }

    // General NG overview
    return `Nigeria (NG) has ${ngRules.length} brand and product-category specific seller restrictions:

${ngRules.map(r => `- **${r.brands.length > 0 ? r.brands.join("/") : r.categoryKeywords[0] || r.ruleId}**: ${r.description} (${r.approvedSellers.length} approved sellers)`).join("\n")}

All violations trigger High severity issues (−12 pts). Sellers need to be formally added to the approved list by Jumia's category management team. Ask me about a specific rule (e.g. "Apple NG" or "power banks Nigeria") for the full list of approved sellers.`;
  }

  // ── Morocco Specific ──────────────────────────────────────────────────────
  if (/morocco|ma\b|ma\s+rule|ma\s+seller|forbidden.?brand.?morocco|fragrance.?only|book.?seller|prohibited.?book|expresse.?shop|shopear/.test(q)) {
    const maForbidden = getMAForbiddenBrands();
    const maFragranceOnly = getMAFragranceOnlyBrands();
    const maSellerRules = getMASellerRules();
    const maBookSellers = getMAProhibitedBookSellers();

    // Specific sub-topic checks
    if (/forbidden|blocked|completely banned/.test(q)) {
      const sample = maForbidden.slice(0, 20).join(", ");
      return `**MA Forbidden Brands (${maForbidden.length} total)**\n\nThese brands cannot be listed in Morocco by any seller:\n\n${sample}, and ${maForbidden.length - 20} more.\n\nListing any of these triggers a High severity issue. Note that Rolex is also blocked globally so it appears in the global restricted brands list rather than this Morocco-specific one.`;
    }

    if (/fragrance|fragrance.?only|perfume.?only/.test(q)) {
      const sample = maFragranceOnly.slice(0, 15).join(", ");
      return `**MA Fragrance-Only Brands (${maFragranceOnly.length} brands)**\n\nThese brands are allowed in Morocco **only when listed under the Fragrances category**:\n\n${sample}, and more.\n\nListing any of these under any other category (Health & Beauty, Fashion, Electronics, etc.) triggers a High severity issue (−12 pts). The check compares the product category against a list of Fragrance-related category keywords.`;
    }

    if (/seller.?restrict|approved.?seller/.test(q)) {
      const sample = maSellerRules.slice(0, 10).map(r => `${r.brand} (${r.approvedSellers.length} sellers)`).join(", ");
      return `**MA Seller-Restricted Brands (${maSellerRules.length} brands)**\n\nThese brands can only be sold by specific approved sellers in Morocco:\n\n${sample}, and more.\n\nIf the product's seller is not on the approved list for that brand, it triggers a High severity issue. Ask me about a specific brand (e.g. "who can sell Nike in Morocco?") and I'll tell you the exact approved sellers.`;
    }

    if (/book|expresse|shopear/.test(q)) {
      return `**MA Prohibited Book Sellers**\n\nThe sellers **${maBookSellers.join(" and ")}** are not permitted to list books on Jumia Morocco. If either of these sellers lists a product in a book category (or with a product name that indicates it's a book), it triggers a High severity issue.`;
    }

    // General MA overview
    return `Morocco (MA) has four layers of country-specific listing rules on top of the global policies:

1. **Completely forbidden brands** (${maForbidden.length} brands) — e.g. ${maForbidden.slice(0,6).join(", ")} — cannot be listed by anyone.

2. **Fragrance-only brands** (${maFragranceOnly.length} brands) — e.g. ${maFragranceOnly.slice(0,5).join(", ")} — only allowed under the Fragrances category.

3. **Seller-restricted brands** (${maSellerRules.length} brands) — e.g. ${maSellerRules.slice(0,5).map(r=>r.brand).join(", ")} — can only be listed by specific approved sellers.

4. **Prohibited book sellers** — ${maBookSellers.join(" and ")} cannot list books in MA.

Ask me about any of these layers specifically for more detail.`;
  }

  // ── Counterfeit / Suspicious Price ────────────────────────────────────────
  if (/counterfeit|fake.?product|replica|knockoff|suspicious.?price|price.?too.?low|fake.?flag/.test(q)) {
    return `The quality checker runs four counterfeit detection checks:

1. **Explicit counterfeit language** — keywords like "replica", "clone", "first copy", "AAA grade", "inspired by", "non-original", "0RIGINAL" in the title or description trigger a High issue immediately.

2. **Brand name misspellings** — common evasion tactics like "Adiddas", "Nikee", "Addidas", "Samsng" are detected and flagged as likely counterfeits.

3. **Suspicious pricing** — if a product claims to be a premium brand but the price is below ~30% of the known genuine floor price, it triggers a suspicious price flag. For example: a product titled "Rolex Watch" at ₦5,000 or a "MacBook Pro" at ₦15,000.

4. **Listing pattern signals** — phrases like "7 days return", "no brand", "inspired version", or generic seller names combined with luxury brand claims raise the counterfeit risk score.

All counterfeit flags are High severity (−12 pts). If the product is genuinely lower-priced (e.g. an accessory that shares a brand name), ensure the title clearly describes what it actually is.`;
  }

  // ── Category / Wrong Category ─────────────────────────────────────────────
  if (/wrong.?categ|categ.?issue|categor|which.?categ|miscategor/.test(q)) {
    return `The wrong category check compares the product name against the assigned category using keyword inference. It works in two stages:

1. **Named format match** — if the category exactly matches one of the 38 defined naming formats (Blenders, Mobile Phones, TVs, etc.), the product name is checked against that format's required components.

2. **Family inference** — for other categories, the system infers the structural family (Electronics Display, Electronics Capacity, Fashion Garment, Packaged Goods, Baby Consumables, etc.) from keywords in both the category and the product name, then checks the appropriate components.

A wrong category flag triggers a Medium issue (−6 pts). If you're seeing this flag but believe the category is correct, it usually means the product name is too generic for the system to confirm the match — adding the key product type word to the name resolves it.`;
  }

  // ── Variations / Simples ──────────────────────────────────────────────────
  if (/variation|simples|size.?variation|colou?r.?variation|invalid.?variation|parent.?sku/.test(q)) {
    return `Jumia allows size and colour variations (called "simples") only for **Fashion category products** — clothing, shoes, bags, accessories, jewellery, sportswear, and similar items.

If a non-Fashion product has variations attached (e.g. a phone charger with Red/Blue/Green simples, or a kitchen gadget with Small/Medium/Large options), it triggers an **Invalid Variation** flag — High severity (−12 pts).

The fix is either to remove the variations and list the product as a single SKU, or to re-list each variant as a separate product. The Fashion category check uses these keywords: fashion, clothing, apparel, shoes, footwear, bags, accessories, jewelry, jewellery, watches, men, women, kids, baby wear, sportswear.`;
  }

  // ── Image Analysis Detail ─────────────────────────────────────────────────
  if (/non.?square|image.?ratio|aspect.?ratio|square.?image|1:1/.test(q)) {
    return `The non-square image check flags images where the width-to-height ratio deviates more than **5%** from a perfect 1:1 square. For example:
- 1000×950px → ratio 1.05 → borderline (just over the 5% threshold, flagged)
- 1200×800px → ratio 1.5 → clearly flagged
- 1000×1000px → ratio 1.0 → perfect, not flagged

This is a **Medium severity** issue (−6 pts). Jumia's product catalog displays all images in square frames, so rectangular images either get cropped (cutting off part of the product) or displayed with whitespace padding — both hurt presentation quality.

The fix is to re-export the image at a square resolution, either by cropping or by adding a white canvas border to reach 1:1.`;
  }

  // ── How to fix / Improve ──────────────────────────────────────────────────
  if (/how.?to.?fix|how.?do.?i.?fix|what.?should.?i.?do|how.?to.?improve|improve.?score|fix.?issue|resolve.?issue|how.?to.?pass/.test(q)) {
    return `Here's how to fix the most common QC issues:

**Images (most impactful):**
- Add more photos until you have at least 5
- Replace the main image with a clean white background shot (pure white, no shadows)
- Re-export images at 1000×1000px (square, 1:1 ratio)

**Description:**
- Write at least 50 words of original content covering features, specs, and what's in the box
- Include at least one image embedded in the description HTML
- Avoid copy-pasting the product name into the description body

**Product name:**
- Follow the format for your category (ask me "what's the naming format for [category]?")
- Remove any blacklisted terms like "100% Original", "Cheapest", or competitor names
- Add key missing components: brand, model, size, capacity, or colour as required

**Brand/seller flags:**
- Verify your seller account is approved for the brand with Jumia's category team
- For MA-specific seller restrictions, check if your store is on the approved list for that brand

**Category:**
- Move the product to the most specific matching category
- Add the product type keyword to the name so the system can confirm the category match`;
  }

  // ── Generic product check question ─────────────────────────────────────────
  if (/can i (sell|list)|is .+ allowed|is .+ permitted|is .+ ok to/.test(q)) {
    const prohibited = getInMemoryProhibitedItems();
    const brands = getInMemoryRestrictedBrands();
    const maForbidden = getMAForbiddenBrands();

    // Try to extract product/brand being asked about
    const words = q.replace(/[?.,!]/g,"").split(/\s+/);
    const stopWords = new Set(["can","i","sell","list","is","the","a","an","in","on","for","this","that","and","or","are","was","does","allowed","permitted","ok","to","be"]);
    const candidates = words.filter(w => w.length > 2 && !stopWords.has(w));

    for (const candidate of candidates) {
      // Check prohibited
      const prohibitedMatch = prohibited.find(p => p.keyword.toLowerCase().includes(candidate) || candidate.includes(p.keyword.toLowerCase().replace(/\s+/g,"")));
      if (prohibitedMatch) {
        const countries: string[] = prohibitedMatch.countries ? JSON.parse(prohibitedMatch.countries) : [];
        const countryNote = countries.length > 0 ? ` in ${countries.join(", ")}` : " across all markets";
        return `**${prohibitedMatch.keyword}** is a **prohibited item**${countryNote} on Jumia with status "${prohibitedMatch.status}". Listing it triggers a Critical issue (−25 pts) and the listing will be rejected. If you're selling something related but different, make sure the product name clearly describes what it actually is.`;
      }

      // Check globally blocked brands
      const blockedBrand = brands.find(b => b.restrictionType === "blocked" && (b.brand.toLowerCase() === candidate || b.brand.toLowerCase().replace(/[^a-z]/g,"") === candidate));
      if (blockedBrand) {
        return `**${blockedBrand.brand}** is one of Jumia's **completely blocked brands** and cannot be listed on the platform by any seller in any market. This triggers a Critical issue.`;
      }

      // Check MA forbidden
      const maForbiddenMatch = maForbidden.find(b => b.toLowerCase() === candidate || b.toLowerCase().replace(/[^a-z]/g,"") === candidate);
      if (maForbiddenMatch) {
        return `**${maForbiddenMatch}** is **forbidden in Morocco (MA)**. While it may not be globally blocked, it cannot be listed on Jumia.ma. Attempting to list it triggers a High severity issue.`;
      }

      // Check verified-only brands
      const verifiedBrand = brands.find(b => b.restrictionType === "verified_sellers_only" && (b.brand.toLowerCase() === candidate || b.brand.toLowerCase().replace(/[^a-z]/g,"") === candidate));
      if (verifiedBrand) {
        return `**${verifiedBrand.brand}** requires **verified seller status** on Jumia. You can list it, but only if your seller account has been formally approved for this brand. Without approval, it triggers a High severity issue (−12 pts). Contact Jumia's brand management team to apply for verified seller status.`;
      }
    }
  }

  // ── Country-specific questions ────────────────────────────────────────────
  if (/egypt|kenya|ghana|uganda|senegal|algeria|ivory.?coast|c[oô]te.?d'ivoire|tunisia|canary|dz\b|ke\b|gh\b|ug\b|sn\b|ci\b|tn\b|ic\b/.test(q)) {
    const countryMap: Record<string, { code: string; name: string; notes: string[] }> = {
      egypt:    { code:"EG", name:"Egypt", notes:["Sex toys and adult content are restricted","Medical devices (nebulizers, defibrillators, ventilators) require documentation","Prescription medications are blocked","Signal blockers, tobacco, and handcuffs are blocked"] },
      kenya:    { code:"KE", name:"Kenya", notes:["Medical devices require registration documentation","Standard global prohibited items apply","No alcohol restrictions (unlike DZ/SN)"] },
      ghana:    { code:"GH", name:"Ghana", notes:["Follows standard global policies","Camouflage clothing is allowed (unlike NG, DZ, SN, UG)","Standard prohibited items (tobacco, drugs, weapons) apply"] },
      uganda:   { code:"UG", name:"Uganda", notes:["Military uniforms and camouflage clothing are blocked","Standard global prohibited items apply"] },
      senegal:  { code:"SN", name:"Senegal", notes:["Alcohol is prohibited (same as Algeria)","Camouflage/military clothing is blocked","Standard prohibited items apply"] },
      algeria:  { code:"DZ", name:"Algeria", notes:["Alcohol is prohibited","Adult content and sex toys are blocked","Medical devices require registration","CD software and PC games are restricted"] },
      "ivory coast": { code:"CI", name:"Côte d'Ivoire", notes:["Follows standard global policies","No major country-specific additions beyond global rules"] },
      tunisia:  { code:"TN", name:"Tunisia", notes:["0RIGINAL and similar fake signals are blacklisted specifically for TN","Standard global prohibited items apply"] },
    };

    const matched = Object.entries(countryMap).find(([key]) => q.includes(key));
    if (matched) {
      const [, info] = matched;
      return `**${info.name} (${info.code}) specific rules:**\n\n${info.notes.map(n => `- ${n}`).join("\n")}\n\nAll standard global rules also apply in ${info.name} — prohibited items, blacklisted keywords, and restricted brands are all checked. Ask me about a specific product type or rule for ${info.name} for more detail.`;
    }
  }

  // ── What is this tool / how does it work ──────────────────────────────────
  if (/what.?is.?(this|jumia|qc|quality|tool|app|system|checker)|how.?does.?(this|it|the.?tool|the.?checker).?work|about.?(this|the.?tool)|what.?can.?you/.test(q)) {
    const prohibited = getInMemoryProhibitedItems();
    const keywords = getInMemoryBlacklistedKeywords();
    const brands = getInMemoryRestrictedBrands();
    const ngRules = getNGSellerRules();
    return `This is the **Jumia QC Analyzer** — it automatically checks product listings across Jumia's African markets for quality and compliance issues.

**What it checks:**
- **${prohibited.length} prohibited item rules** — products that are blocked from listing
- **${keywords.length.toLocaleString()} blacklisted keywords** — terms banned from titles and descriptions
- **${brands.filter(b=>b.restrictionType==="blocked").length} globally blocked brands** and **${brands.filter(b=>b.restrictionType==="verified_sellers_only").length} verified-sellers-only brands**
- **${ngRules.length} Nigeria-specific seller rules** for high-value product categories
- **Morocco-specific rules**: ${getMAForbiddenBrands().length} forbidden brands, ${getMASellerRules().length} seller-gated brands, ${getMAFragranceOnlyBrands().length} fragrance-only brands
- Image quality (count, resolution, white background, square ratio)
- Description quality (length, structure, repetition)
- Product naming format (38 category-specific formats)
- Category validation and variation rules

It works by scraping live Jumia listings or analysing uploaded product files, then running all checks and producing a quality score (0–100) with specific issue flags and recommendations. What would you like to know more about?`;
  }

  // ── Fallback — still helpful, cites what the tool knows ───────────────────
  const prohibited = getInMemoryProhibitedItems();
  const keywords = getInMemoryBlacklistedKeywords();
  const brands = getInMemoryRestrictedBrands();

  return `I can help with that. To give you the most accurate answer, could you be a bit more specific? For example:

- Are you asking about a **specific product or brand**? (I can check against ${prohibited.length} prohibited items, ${keywords.length.toLocaleString()} blacklisted keywords, and ${brands.length} restricted brands)
- Is this about a **specific country**? (NG, MA, EG, KE, GH, UG, SN, DZ, CI, TN, IC each have their own rules)
- Are you looking to **fix a QC flag** on a specific listing?
- Do you want to understand a **specific check** — images, descriptions, naming, categories, or variations?

The more detail you share about the product, category, and market, the more precisely I can answer.`;
}

export function registerChatRoutes(app: Express) {

  // Health check — visit /api/chat/test in browser to verify Groq connectivity
  app.get("/api/chat/test", async (_req, res) => {
    try {
      const resp = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY()}` },
        body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: "user", content: "Reply with just the word: OK" }], max_tokens: 10 }),
      });
      const data = await resp.json() as any;
      if (!resp.ok) return res.status(500).json({ ok: false, error: data });
      res.json({ ok: true, response: data.choices?.[0]?.message?.content });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      // Accept { message } (single UIMessage from AIChatBox) or { messages } (array)
      let rawMessages: any[];
      if (req.body.messages && Array.isArray(req.body.messages)) {
        rawMessages = req.body.messages;
      } else if (req.body.message) {
        rawMessages = [req.body.message];
      } else {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      const messages = rawMessages.map(toGroqMessage).filter(m => m.content.trim());

      // ── Attempt Groq API ──────────────────────────────────────────────────
      let groqFailed = false;
      try {
        const groqRes = await fetch(GROQ_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${GROQ_API_KEY()}`,
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
            max_tokens: 1024,
            temperature: 0.7,
          }),
        });

        const data = await groqRes.json() as any;

        if (groqRes.ok) {
          const reply: string = data.choices?.[0]?.message?.content || "";
          res.json({ ok: true, reply });
          return;
        }

        // Non-ok HTTP status (401 revoked key, 429 rate-limit, 503 outage, etc.)
        console.warn(`[/api/chat] Groq returned ${groqRes.status} — falling back to built-in responder. Detail: ${data?.error?.message || JSON.stringify(data)}`);
        groqFailed = true;

      } catch (fetchErr) {
        // Network error, timeout, or DNS failure
        console.warn("[/api/chat] Groq fetch failed — falling back to built-in responder:", fetchErr instanceof Error ? fetchErr.message : fetchErr);
        groqFailed = true;
      }

      // ── Fallback: data-driven built-in responder ───────────────────────────
      if (groqFailed) {
        const lastUserMessage = [...messages].reverse().find(m => m.role === "user")?.content || "";
        const reply = buildFallbackResponse(lastUserMessage);
        res.json({ ok: true, reply });
        return;
      }

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("[/api/chat] Error:", errMsg);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error", detail: errMsg });
      }
    }
  });
}

export {};
