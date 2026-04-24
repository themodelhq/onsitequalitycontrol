import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ShieldAlert, Send, Loader2, Sparkles } from "lucide-react";
import { Markdown } from "@/components/Markdown";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    setError(null);

    // Silent retry for Render cold-start / spin-down
    const RETRY_MAX = 3;
    const RETRY_DELAY = 8000;
    const isNetworkErr = (e: unknown) => {
      if (!(e instanceof Error)) return false;
      const m = e.message.toLowerCase();
      return m.includes("failed to fetch") || m.includes("network") ||
             m.includes("load failed") || m.includes("504") || m.includes("fetch");
    };

    try {
      let lastErr: unknown;
      let data: any = null;
      for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: next.map(m => ({ role: m.role, content: m.content })),
            }),
          });
          data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.detail || data.error || "Request failed");
          break; // success
        } catch (e) {
          lastErr = e;
          if (isNetworkErr(e) && attempt < RETRY_MAX) {
            await new Promise(r => setTimeout(r, RETRY_DELAY));
            continue;
          }
          throw e;
        }
      }

      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: data?.reply || "",
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" onClick={() => navigate("/")}
              className="gap-1.5 text-gray-500 hover:text-gray-900">
              <ArrowLeft size={14} /> Back
            </Button>
            <div className="w-px h-5 bg-gray-200" />
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <ShieldAlert size={16} className="text-white" />
            </div>
            <div>
              <span className="font-bold text-gray-900">Jumia QC Assistant</span>
              <span className="ml-2 text-xs text-gray-400 font-normal">Powered by Groq</span>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => { setMessages([]); setError(null); }}
            className="text-xs text-gray-500">
            Clear chat
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center gap-6 pt-12 text-muted-foreground">
              <Sparkles className="size-12 opacity-20" />
              <p className="text-center max-w-md text-sm">
                Ask me anything about Jumia quality control — prohibited items, restricted brands,
                blacklisted keywords, naming formats, seller rules, and more.
              </p>
              <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                {SUGGESTED_PROMPTS.map((p, i) => (
                  <button key={i} onClick={() => send(p)}
                    className="text-xs px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:border-orange-300 hover:text-orange-600 transition-colors">
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(m => (
            <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && (
                <div className="size-8 shrink-0 mt-1 rounded-full bg-orange-100 flex items-center justify-center">
                  <Sparkles className="size-4 text-orange-500" />
                </div>
              )}
              <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                m.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-white border border-gray-200 text-gray-900"
              }`}>
                {m.role === "assistant"
                  ? <Markdown>{m.content}</Markdown>
                  : <p>{m.content}</p>}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 justify-start">
              <div className="size-8 shrink-0 mt-1 rounded-full bg-orange-100 flex items-center justify-center">
                <Sparkles className="size-4 text-orange-500" />
              </div>
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="size-4 animate-spin" /> Thinking…
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t bg-white px-4 py-4 shrink-0">
        <div className="max-w-3xl mx-auto flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about prohibited products, restricted brands, blacklisted keywords…"
            className="min-h-[44px] max-h-32 resize-none"
            rows={1}
            disabled={loading}
          />
          <Button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            size="icon"
            className="shrink-0 h-[44px] w-[44px] bg-orange-500 hover:bg-orange-600"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
