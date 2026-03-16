/**
 * Chat API Handler
 *
 * Express endpoint for AI SDK streaming chat with tool calling support.
 * Uses Google Gemini (free tier available at ai.google.dev).
 */

import { streamText, stepCountIs } from "ai";
import { tool } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Express } from "express";
import { z } from "zod/v4";
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
    inputSchema: z.object({
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
    inputSchema: z.object({
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
 * Registers the /api/chat endpoint for streaming AI responses.
 */
export function registerChatRoutes(app: Express) {
  const google = createLLMProvider();

  app.post("/api/chat", async (req, res) => {
    try {
      const { messages } = req.body;

      if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      const result = streamText({
        // gemini-2.0-flash is fast, capable, and free-tier eligible
        model: google("gemini-2.0-flash"),
        system:
          "You are an expert Jumia marketplace quality control assistant. " +
          "You help sellers and QC teams understand product listing quality issues, " +
          "interpret quality scores, explain naming format requirements, identify " +
          "prohibited or blacklisted items, flag counterfeit indicators, and advise " +
          "on how to improve product listings to meet Jumia's quality standards. " +
          "You are knowledgeable about Jumia's policies across Nigeria (NG), Kenya (KE), " +
          "Ghana (GH), Egypt (EG), Morocco (MA), Algeria (DZ), Ivory Coast (CI), " +
          "Tunisia (TN), Senegal (SN), and Uganda (UG). " +
          "Be concise, practical, and specific in your guidance.",
        messages,
        tools,
        stopWhen: stepCountIs(5),
      });

      result.pipeUIMessageStreamToResponse(res);
    } catch (error) {
      console.error("[/api/chat] Error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });
}

export { tools };
