/**
 * Chat API Handler
 *
 * Calls the Groq REST API directly via fetch (OpenAI-compatible format).
 * No ai-sdk version compatibility issues — pure HTTP.
 * Free tier: https://console.groq.com
 *
 * Falls back to a built-in natural language responder when Groq is
 * unavailable (revoked key, rate-limit, network error, etc.).
 */

import type { Express } from "express";
import { ENV } from "./env";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL   = "llama-3.3-70b-versatile";
const GROQ_API_KEY = () => ENV.groqApiKey || "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";

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
2. VERIFIED SELLERS ONLY (428 brands): Adidas, Nike, Apple, Samsung, Gucci, Louis Vuitton, Sony, Bose, Dyson, Ralph Lauren, etc.

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

**Quality Score:** Critical −25pts, High −12pts, Medium −6pts, Low −2pts (max 100)

**Image Requirements:** Min 5 images, plain white background on first image, min 300×300px

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
// BUILT-IN FALLBACK RESPONDER
// Activates automatically when Groq is unavailable (revoked key, rate-limit,
// network timeout, etc.). Produces human, conversational answers based on
// keyword matching against the user's question.
// ─────────────────────────────────────────────────────────────────────────────

const FALLBACK_RESPONSES: Array<{ patterns: string[]; response: string }> = [
  {
    patterns: ["hello", "hi ", "hey", "good morning", "good afternoon", "good evening", "how are you", "what can you do", "what do you do"],
    response: `Hi there! I'm your Jumia QC Assistant. I can help you with things like understanding why a product failed a quality check, figuring out which items are prohibited on Jumia, checking whether a brand needs verified seller status, or understanding the image and description requirements. What would you like to know?`,
  },
  {
    patterns: ["quality score", "score", "how is score calculated", "scoring", "points", "deduct"],
    response: `The quality score starts at 100 and deductions are applied per issue found:\n\n- **Critical issues** deduct 25 points each — things like prohibited items, hard banned brands, or blacklisted keywords in the title\n- **High issues** deduct 12 points each — restricted brand violations, seller restriction failures, Morocco-specific rule breaches\n- **Medium issues** deduct 6 points — non-white background, non-square images, naming format violations, wrong category\n- **Low issues** deduct 2 points — thin descriptions, minor image quality problems\n\nA score of 80+ is generally considered healthy. Below 60 usually means the listing needs significant work before it should go live.`,
  },
  {
    patterns: ["image", "photo", "picture", "background", "white background", "resolution", "square", "how many image"],
    response: `Jumia's image requirements are pretty specific:\n\n- **Minimum 5 images** per product — listings with fewer will fail the image check\n- **First image must have a plain white background** — lifestyle shots, grey backgrounds, or busy backgrounds on the main image will trigger a non-white background flag\n- **Minimum resolution of 300×300 pixels** — anything below that is considered low quality\n- **Images should be square (1:1 ratio)** — images that are significantly wider or taller than they are square get flagged as non-square\n\nFor best results, aim for 1000×1000px white background shots as your main image, and use additional angles, lifestyle shots, and detail shots for the remaining images.`,
  },
  {
    patterns: ["description", "describe", "thin description", "short description", "muddled", "repeated description", "description requirement"],
    response: `A good product description needs to do a few things:\n\n- It should be **at least a few meaningful sentences** — very short or near-empty descriptions get flagged as "thin"\n- It shouldn't just **repeat the product name** over and over — that triggers the repeated description flag\n- It should be **coherent and organised** — jumbled bullet points, random keyword stuffing, or copy-pasted fragments get flagged as "muddled"\n- Avoid including images directly in the description HTML unless they're properly hosted — the system checks for broken image references too\n\nA solid description covers: what the product is, key features and specifications, what's included in the box, and any relevant size/compatibility information.`,
  },
  {
    patterns: ["prohibited", "banned", "blocked item", "cannot list", "not allowed", "forbidden item"],
    response: `There's quite a list of prohibited items across Jumia markets, but the most common categories are:\n\n- **Prescription or controlled drugs** — no medication that requires a prescription\n- **Tobacco and cigarettes** — including e-cigarettes and vaping products in most markets\n- **Weapons** — firearms, replica guns, tasers, handcuffs, lockpicking kits, explosives\n- **Skin lightening creams** containing mercury or hydroquinone above 2%\n- **Signal blockers or jammers**\n- **Live animals**\n- **Military uniforms and camouflage** in NG, DZ, SN, and UG\n- **Currency** (fake notes, replica coins, etc.)\n- **Adult content** in EG, MA, and DZ\n\nSome items are country-specific — for example, alcohol is blocked in Algeria (DZ) and Senegal (SN), while it may be allowed with restrictions elsewhere. If you're unsure about a specific product, let me know what it is and which market you're listing in.`,
  },
  {
    patterns: ["blacklist", "keyword", "banned word", "blacklisted word", "title issue", "name issue", "naming", "product name"],
    response: `Blacklisted keywords cover a wide range of things that Jumia doesn't allow in product titles or descriptions:\n\n- **Competitor references** — mentioning Konga, Jumia (in certain ways), Amazon, or other platforms\n- **Off-platform contact** — phone numbers, WhatsApp numbers, email addresses in listings\n- **Fake authenticity claims** — "100% Original", "0RIGINAL", "Authentic", "Best in Nigeria", "Cheapest in Nigeria", "Government approved"\n- **Counterfeit signals** — "Replica", "Clone", "First copy", "AAA grade", "Grade A fake"\n- **False health claims** — unapproved medical benefits, cure claims\n- **Profanity or offensive terms**\n\nThe system checks over 5,600 keywords across all listings. If a product is flagged for a blacklisted keyword, you'll need to edit the title or description to remove the offending term.`,
  },
  {
    patterns: ["restricted brand", "brand restriction", "verified seller", "brand policy", "which brands", "approved brand"],
    response: `Restricted brands fall into two categories on Jumia:\n\n**Completely blocked brands (9 total):**\nBösendorfer, Chanel, Harman Kardon, Leica, Phase One (cameras), Rolex, Forever Living, ORIFLAME, and Aneeza. These cannot be listed by anyone under any circumstances.\n\n**Verified sellers only (428+ brands):**\nThis is a much larger list that includes well-known names like Adidas, Nike, Apple, Samsung, Gucci, Louis Vuitton, Sony, Bose, Dyson, Ralph Lauren, and many more. You need to be an approved/verified seller for that brand in order to list products under it.\n\nIf a brand you're trying to list shows a restricted brand flag, it means either the brand is fully blocked or your seller account isn't on the approved list for that brand.`,
  },
  {
    patterns: ["nigeria", "ng rule", "ng seller", "apple seller", "samsung seller", "hisense seller", "polystar", "gift card", "grocery seller", "power bank", "refurbished", "hp ink", "hp toner"],
    response: `Nigeria has several brand and product-category specific seller restrictions:\n\n- **Apple products** — must be sold by one of the 238 Apple Authorized Sellers on Jumia NG\n- **LG and Samsung** appliances and TVs — restricted to 154 approved sellers\n- **Hisense** — 200+ approved sellers only\n- **Polystar** — 48 approved sellers only\n- **Gift Cards** — only SPHYKE GAMING PLANET (SGP) can list them\n- **Grocery/Food products** — limited to 18 approved grocery sellers\n- **Power banks 20,000mAh and above** — only 12 approved brands allowed (Anker, Baseus, Oraimo, Romoss, Itel, and a few others)\n- **Refurbished phones** — 16 approved sellers only\n- **HP ink, toner, and cartridges** — 400+ HP Authorized Sellers only\n\nIf a product is flagged with an NG seller restriction, the seller's account needs to be added to the relevant approved list before the listing can go live.`,
  },
  {
    patterns: ["morocco", "ma rule", "ma seller", "forbidden brand morocco", "fragrance only", "book seller", "prohibited book", "expresse shop", "shopear"],
    response: `Morocco (MA) has its own set of listing restrictions beyond the standard global rules:\n\n**Completely forbidden brands in MA** — 60 brands including Louis Vuitton, Prada, Fendi, Versace, Lacoste, MAC, Diesel, Beats By Dre, Huda Beauty, Rimmel, Timberland, and others. These cannot be listed by any seller.\n\n**Fragrance-only brands** — A set of brands (like Olaplex, The Ordinary, Eucerin, La Roche Posay, Nike, Victoria's Secret, and others) are only permitted under the Fragrances category in MA. Listing them under any other category will fail the check.\n\n**Seller-restricted brands** — 175 brands (including Gucci, Dior, Nike, Armani, Xiaomi, HP, Ikea, La Roche Posay, Calvin Klein, and many more) can only be sold by specific approved sellers. If the seller isn't on the approved list for that brand, the listing will be flagged.\n\n**Prohibited book sellers** — Sellers "Expresse Shop" and "Shopear" are not permitted to list books on Jumia Morocco.`,
  },
  {
    patterns: ["counterfeit", "fake", "replica", "knockoff", "suspicious price", "price too low", "fake product", "original"],
    response: `The quality checker looks for a few signals that might indicate counterfeit or suspicious products:\n\n- **Counterfeit language in the listing** — words like "replica", "clone", "first copy", "AAA grade", "inspired by", or brand misspellings that are clearly intentional (like "N1KE" or "Ad1das")\n- **Suspicious pricing** — if the price is less than about 30% of the expected floor price for a genuine version of that brand's product, it gets flagged. A "Rolex" selling for ₦5,000 is an obvious example.\n- **Brand + low price combination** — even without explicit counterfeit language, an unusually low price for a high-value brand triggers the suspicious price check\n\nIf a product has been flagged for counterfeit indicators, it usually means the listing title, description, or price needs to be reviewed to make sure it accurately represents what's being sold.`,
  },
  {
    patterns: ["category", "wrong category", "category issue", "categorize", "which category"],
    response: `The wrong category flag gets raised when the product name doesn't match the category it's been listed under. For example, listing a phone charger under "Home & Living" instead of "Electronics Accessories", or a dress under "Sporting Goods".\n\nThe checker uses keywords from the product name to infer the most likely category, and then compares that against the actual assigned category. It's not always perfect — some products genuinely have names that could fit multiple categories — but it catches the more obvious mismatches.\n\nIf you see this flag and you believe the category is actually correct, it may just be that the product name is generic enough that the system couldn't determine the category from the name alone. You can usually ignore it in those cases, but it's worth double-checking.`,
  },
  {
    patterns: ["variation", "invalid variation", "simples", "size variation", "colour variation", "color variation"],
    response: `Variations (or "simples" in Jumia's catalog system) are size and colour options attached to a parent product. The rule is that variations are only permitted for Fashion category products — things like clothing, shoes, bags, accessories, jewellery, and sportswear.\n\nIf a product outside the Fashion category has variations attached to it (like a phone case with "Red, Blue, Green" simples, or a kitchen gadget with size options), it will get flagged as an invalid variation. In those cases, the variations either need to be removed or the product should be re-listed as separate SKUs.`,
  },
  {
    patterns: ["egypt", "eg rule", "egypt rule"],
    response: `Egypt (EG) follows most of the standard Jumia policies, with a few country-specific additions. Adult content and sex toys are restricted in Egypt. Medical devices like nebulizers, defibrillators, and ventilators require registration/documentation before listing. Prescription medications are blocked. Signal blockers, tobacco, and handcuffs are also blocked.\n\nIf you have a specific product or issue in the Egypt market you'd like me to look into, just let me know.`,
  },
  {
    patterns: ["kenya", "ke rule", "uganda", "ug rule", "ghana", "gh rule", "senegal", "sn rule", "algeria", "dz rule", "ivory coast", "ci rule", "tunisia", "tn rule"],
    response: `Each Jumia market has its own specific rules layered on top of the global policies. Some common country-specific restrictions to be aware of:\n\n- **Algeria (DZ) and Senegal (SN)** — alcohol is prohibited\n- **Uganda (UG) and Senegal (SN)** — camouflage/military clothing is blocked\n- **Kenya (KE)** — medical devices require documentation\n- **Ghana (GH)** — follows standard global policies with minimal additions\n\nIf you have a specific product or country combination you'd like me to check, just describe the product and which market you're listing in — I'll give you the most relevant rules.`,
  },
  {
    patterns: ["how to fix", "how do i fix", "what should i do", "resolve", "fix the issue", "fix this", "improve", "improve score"],
    response: `The best way to improve a product's quality score depends on which issues were flagged:\n\n- **Image issues** — add more photos (aim for 5+), ensure the main image has a clean white background, use high-resolution shots (1000×1000px recommended)\n- **Description issues** — write a proper, original description of at least 3-4 sentences covering features, specs, and what's included\n- **Naming issues** — follow the format: Brand + Model/Type + Key Feature + Size/Colour (where applicable). Remove any blacklisted words from the title\n- **Category issues** — double-check the product is listed in the most accurate category\n- **Brand/seller issues** — verify that your seller account is approved for that brand, or work with the brand's account manager\n- **Counterfeit flags** — remove any language that could be interpreted as fake/replica, and make sure the price is realistic for a genuine product\n\nIf a specific product was flagged and you'd like more targeted advice, share the product details and I'll walk through it with you.`,
  },
  {
    patterns: ["what is jumia", "about jumia", "jumia marketplace", "what is qc", "what is quality control"],
    response: `Jumia is Africa's largest e-commerce marketplace, operating across multiple countries including Nigeria, Kenya, Ghana, Egypt, Morocco, Algeria, Uganda, Ivory Coast, Senegal, and Tunisia.\n\nQuality Control (QC) on Jumia is the process of reviewing product listings to make sure they meet Jumia's standards before they go live — or to identify listings that need to be corrected or removed. QC checks cover things like image quality, description completeness, naming format, prohibited items, restricted brands, counterfeit indicators, and country-specific rules.\n\nThis tool automates much of that process by scraping live listings and running them through all the relevant checks automatically.`,
  },
];

/**
 * Generates a natural language fallback response when Groq is unavailable.
 * Matches the last user message against known topic patterns and returns
 * a helpful, human-sounding answer. Falls back to a generic helpful message
 * if no pattern matches.
 */
function getFallbackResponse(userMessage: string): string {
  const msgLower = userMessage.toLowerCase();

  for (const entry of FALLBACK_RESPONSES) {
    if (entry.patterns.some(p => msgLower.includes(p))) {
      return entry.response;
    }
  }

  // Generic fallback — still helpful and human
  return `That's a good question. I'm running in offline mode right now so I can't give you a fully tailored answer, but here's what I can tell you generally:\n\nThis QC tool checks products against Jumia's listing policies — covering image quality, descriptions, naming formats, prohibited items, blacklisted keywords, restricted brands, and country-specific rules (including NG, MA, EG, and others). Each issue found reduces the quality score, with critical issues having the biggest impact.\n\nIf you can give me a bit more detail about what you're trying to figure out — like a specific product type, a flagged issue you're seeing, or a country market — I'll do my best to point you in the right direction.`;
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

      // ── Fallback: built-in natural language responder ─────────────────────
      if (groqFailed) {
        const lastUserMessage = [...messages].reverse().find(m => m.role === "user")?.content || "";
        const reply = getFallbackResponse(lastUserMessage);
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
