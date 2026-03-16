/**
 * Chat API Handler
 *
 * Express endpoint for AI SDK streaming chat with tool calling support.
 * Uses Google Gemini (free tier available at ai.google.dev).
 */

import { generateText, stepCountIs } from "ai";
import { tool } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Express } from "express";
import { z } from "zod";
import { ENV } from "./env";

/**
 * Creates a Google Gemini provider.
 * Get a free API key at https://ai.google.dev/
 */
function createLLMProvider() {
  return createGoogleGenerativeAI({
    apiKey: ENV.googleAiApiKey || "AIzaSyCAXo485SKTfBLEhiETWqnSIPPE0kTusNE",
  });
}

/**
 * Example tool registry - customize these for your app.
 */
const tools = {
  getWeather: tool({
    description: "Get the current weather for a location",
    parameters: z.object({
      location: z
        .string()
        .describe("The city and country, e.g. 'Tokyo, Japan'"),
      unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius"),
    }),
    execute: async ({ location, unit }) => {
      // Simulate weather API call
      const temp = Math.floor(Math.random() * 30) + 5;
      const conditions = ["sunny", "cloudy", "rainy", "partly cloudy"][
        Math.floor(Math.random() * 4)
      ] as string;
      return {
        location,
        temperature: unit === "fahrenheit" ? Math.round(temp * 1.8 + 32) : temp,
        unit,
        conditions,
        humidity: Math.floor(Math.random() * 50) + 30,
      };
    },
  }),

  calculate: tool({
    description: "Perform a mathematical calculation",
    parameters: z.object({
      expression: z
        .string()
        .describe("The math expression to evaluate, e.g. '2 + 2'"),
    }),
    execute: async ({ expression }) => {
      try {
        const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, "");
        const result = Function(
          `"use strict"; return (${sanitized})`
        )() as number;
        return { expression, result };
      } catch {
        return { expression, error: "Invalid expression" };
      }
    },
  }),
};

/**
 * Convert an AI SDK UIMessage (parts-based) to a CoreMessage (content-based)
 * that streamText understands. UIMessage uses `parts: [{type:'text',text:'...'}]`
 * while CoreMessage uses `content: string`.
 */
function toCoreMessage(msg: any): { role: string; content: string } {
  // Already in CoreMessage format (has content string)
  if (typeof msg.content === "string") return { role: msg.role, content: msg.content };
  // UIMessage format: extract text from parts array
  if (Array.isArray(msg.parts)) {
    const text = msg.parts
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text || "")
      .join("");
    return { role: msg.role, content: text };
  }
  // CoreMessage with content array
  if (Array.isArray(msg.content)) {
    const text = msg.content
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text || "")
      .join("");
    return { role: msg.role, content: text };
  }
  return { role: msg.role, content: String(msg.content ?? "") };
}

/**
 * Registers the /api/chat endpoint for streaming AI responses.
 */
export function registerChatRoutes(app: Express) {
  const google = createLLMProvider();

  app.post("/api/chat", async (req, res) => {
    try {
      // AIChatBox sends { message, chatId, userId } (single latest message)
      // Direct API callers may send { messages: [...] } (full array)
      // Normalise both into a messages array for streamText.
      let messages: any[];
      if (req.body.messages && Array.isArray(req.body.messages)) {
        messages = req.body.messages;
      } else if (req.body.message) {
        messages = [req.body.message];
      } else {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      const result = await generateText({
        model: google("gemini-1.5-flash"),
        system: `You are an expert Jumia marketplace Quality Control (QC) assistant. You help QC teams, sellers, and analysts understand and apply Jumia's product listing policies across all African markets.

## Your Expertise

**Prohibited Items** — Products that are completely blocked from listing on Jumia. Examples by category:
- Health & Beauty: Prescription drugs, skin-lightening creams with mercury/hydroquinone >2%, anabolic steroids, counterfeit cosmetics
- Electronics: Signal blockers, jammers, counterfeit electronics
- Weapons & Dangerous Goods: Firearms, explosives, fireworks, tasers, handcuffs, lockpicking devices
- Substances: Tobacco, cigarettes, e-cigarettes, CBD/cannabis products, alcohol (in select countries)
- Others: Live animals, military uniforms, camouflage clothing (NG/DZ/SN/UG), currency, human organs, recalled products
- Country-specific: Items blocked per country — e.g. alcohol is prohibited in Algeria (DZ) and Senegal (SN)

**Blacklisted Keywords** — Words and phrases banned from product names and descriptions (5,600+ keywords). Key categories:
- Off-platform contact: WhatsApp numbers, phone numbers, Konga references, competitor links
- Misleading claims: "100% Original", "0RIGINAL", "Best in Nigeria", "Cheapest", "Government approved"
- Profanity and offensive terms: Any obscene, racist, or discriminatory language
- Fake/counterfeit signals: "Replica", "Clone", "First copy", "AAA grade" (for electronics)
- Dangerous claims: False medical/health claims, unapproved drug references
- Specific country blacklists: Each country (NG, EG, KE, GH, MA, DZ, SN, etc.) has its own extended blacklist

**Restricted Brands** — Two restriction levels:
1. BLOCKED (9 brands globally): Bösendorfer, Chanel, Harman Kardon, Leica, Phase One (Cameras), Rolex, Forever Living, ORIFLAME, Aneeza — cannot be listed at all
2. VERIFIED SELLERS ONLY (428 brands): Premium/luxury brands including Adidas, Nike, Apple, Samsung, Gucci, Louis Vuitton, Sony, Bose, Dyson, Ralph Lauren, Calvin Klein, Tommy Hilfiger, Lacoste, Hugo Boss, Armani, Versace, Prada, Hermes, Dior, Valentino, Fendi, Balenciaga, Burberry, Off-White, Supreme, and hundreds more — can only be sold by verified/authorised sellers

**Nigeria (NG) Specific Rules:**
- Apple products: Only 238 Apple Authorized Sellers can list iPhones, iPads, MacBooks, AirPods
- LG & Samsung appliances/TVs: Only approved sellers (154 sellers)
- Hisense products: Only approved sellers (200+ sellers)
- Polystar products: Only approved sellers (48 sellers)
- Gift Cards: Only SPHYKE GAMING PLANET (SGP)
- Groceries/Food: Only 18 approved grocery sellers (TGI Distribution, CWAY, Rite Foods, Coca-Cola, Golden Penny Foods, etc.)
- Power Banks ≥20,000mAh: Only 12 approved brands (Anker, Baseus, Oraimo, Romoss, Itel, New Age, KUHL, Ace Elec, etc.)
- Refurbished/Renewed Phones: Only 16 approved sellers (Alisa-COD, coopershop-COD, BuyGoodPhones-COD, etc.)
- HP Ink/Toner/Cartridges: Only 400+ HP Authorized Sellers

**Quality Score Calculation:**
- Critical issues: -25 points each
- High issues: -12 points each
- Medium issues: -6 points each
- Low issues: -2 points each
- Score = MAX(0, MIN(100, 100 - deductions))

**Image Requirements:**
- Minimum 5 images per product
- First/main image MUST have plain white background (no lifestyle shots, no room settings, no streets)
- Minimum resolution: 300x300 pixels (300px minimum on shortest side)
- No watermarks, no text overlays, no borders on main image
- Product description must include at least 1 image

**Naming Format Rules:**
- Must follow category-specific naming formats (Brand + Model + Key Specs + Colour/Variant)
- No promotional language in titles ("Best", "Cheap", "Sale", "Free shipping")
- No seller contact info in titles

**Counterfeit Detection Signals:**
- Explicit terms: Replica, fake, knockoff, first copy, clone, 1:1 copy
- Brand misspellings: Adiddas, Nikee, Samsong, etc.
- Price anomalies: Price below 30% of genuine product floor price
- Brand-field mismatch: Product name says "Nike" but brand field says "Generic"

Always be specific, practical, and cite the relevant rule or policy when answering.`,
        messages: messages.map(toCoreMessage) as any,
        maxTokens: 1024,
      });

      // Return response in AI SDK data stream format so DefaultChatTransport can parse it.
      // This avoids HTTP/2 streaming issues with the Netlify proxy.
      const text = result.text || "";
      const msgId = `msg-${Date.now()}`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("X-Vercel-AI-Data-Stream", "v1");

      // AI SDK data stream protocol:
      // f:{...}  = message start metadata
      // 0:"..."  = text delta chunk
      // e:{...}  = step finish
      // d:{...}  = stream done
      const lines = [
        `f:${JSON.stringify({ messageId: msgId })}`,
        `0:${JSON.stringify(text)}`,
        `e:${JSON.stringify({ finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0 }, isContinued: false })}`,
        `d:${JSON.stringify({ finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0 } })}`,
      ];
      res.end(lines.join("\n") + "\n");
    } catch (error) {
      console.error("[/api/chat] Error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });
}

export { tools };
