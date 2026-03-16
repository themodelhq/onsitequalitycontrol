import { useState } from "react";
import { useLocation } from "wouter";
import { AIChatBox } from "@/components/AIChatBox";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ShieldAlert, MessageSquare } from "lucide-react";
import type { UIMessage } from "ai";

const SUGGESTED_PROMPTS = [
  "What products are prohibited in Nigeria?",
  "Which brands are restricted on Jumia?",
  "What keywords are blacklisted in Kenya?",
  "How can I improve my product quality score?",
  "What are the naming format rules for electronics?",
  "What makes a product listing get flagged as counterfeit?",
  "Which sellers are approved to sell Apple products in NG?",
  "What are the image requirements for Jumia listings?",
];

export default function ChatPage() {
  const [, navigate] = useLocation();
  const [messages, setMessages] = useState<UIMessage[]>([]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate("/")}
              className="gap-1.5 text-gray-500 hover:text-gray-900"
            >
              <ArrowLeft size={14} /> Back
            </Button>
            <div className="w-px h-5 bg-gray-200" />
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <ShieldAlert size={16} className="text-white" />
            </div>
            <div>
              <span className="font-bold text-gray-900">Jumia QC Assistant</span>
              <span className="ml-2 text-xs text-gray-400 font-normal">Powered by Gemini</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMessages([])}
              className="text-xs text-gray-500"
            >
              Clear chat
            </Button>
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col max-w-5xl w-full mx-auto px-4 py-0 min-h-0">
        <div className="flex-1 flex flex-col min-h-0 bg-white rounded-xl border border-gray-200 my-4 overflow-hidden shadow-sm">
          <AIChatBox
            api="/api/chat"
            chatId="jumia-qc-assistant"
            initialMessages={messages}
            onFinish={(msgs) => setMessages(msgs)}
            placeholder="Ask about prohibited products, blacklisted keywords, restricted brands, naming rules…"
            emptyStateMessage="Ask me anything about Jumia quality control — prohibited items, restricted brands, blacklisted keywords, naming formats, seller rules, and more."
            suggestedPrompts={SUGGESTED_PROMPTS}
            className="h-full"
          />
        </div>
      </div>
    </div>
  );
}
