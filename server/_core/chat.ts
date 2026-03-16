/**
 * Chat API Handler
 *
 * Calls the Groq REST API directly via fetch (OpenAI-compatible format).
 * No ai-sdk version compatibility issues — pure HTTP.
 * Free tier: https://console.groq.com
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

      if (!groqRes.ok) {
        console.error("[/api/chat] Groq API error:", data);
        res.status(500).json({ error: "Internal server error", detail: data?.error?.message || JSON.stringify(data) });
        return;
      }

      const text: string = data.choices?.[0]?.message?.content || "";
      const msgId = `msg-${Date.now()}`;

      // Return in AI SDK data stream format so DefaultChatTransport can parse it
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("X-Vercel-AI-Data-Stream", "v1");
      const lines = [
        `f:${JSON.stringify({ messageId: msgId })}`,
        `0:${JSON.stringify(text)}`,
        `e:${JSON.stringify({ finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0 }, isContinued: false })}`,
        `d:${JSON.stringify({ finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0 } })}`,
      ];
      res.end(lines.join("\n") + "\n");

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
