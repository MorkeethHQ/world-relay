"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";

const BOT_ADDRESS = "0x1101158041fd96f21cbcbb0e752a9a2303e6d70e";

type ChatMessage = {
  role: "user" | "bot";
  text: string;
  timestamp: number;
};

const INITIAL_SUGGESTIONS = [
  "What's the daily challenge?",
  "Any tasks near me?",
  "How do I earn points?",
  "What's available right now?",
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button onClick={handleCopy} className="ml-2 shrink-0 text-gray-400 hover:text-gray-600 transition-colors" title="Copy">
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

export default function XmtpPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "bot",
      text: "Hey! I'm the RELAY FAVOURS assistant. Ask me anything — what tasks are available, how to earn, or just say hi.",
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [statusConnected, setStatusConnected] = useState<boolean | null>(null);
  const [conversationCount, setConversationCount] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/xmtp-status")
      .then((r) => r.json())
      .then((d) => {
        setStatusConnected(d.connected ?? false);
        setConversationCount(d.conversationCount ?? 0);
      })
      .catch(() => setStatusConnected(false));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || sending) return;
    const userMsg: ChatMessage = { role: "user", text: text.trim(), timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      const history = messages.slice(-6).map(m => ({
        role: m.role === "user" ? "user" as const : "assistant" as const,
        content: m.text,
      }));

      const res = await fetch("/api/xmtp-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text.trim(), history }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      const responseText = typeof data.response === "string" ? data.response : String(data.response || "No response");
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: responseText, timestamp: Date.now() },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: "Sorry, I couldn't process that. Try again.", timestamp: Date.now() },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] max-w-lg mx-auto w-full bg-[#FAFAFA]">
      {/* Header */}
      <div className="shrink-0 bg-white/95 backdrop-blur-xl border-b border-gray-100">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-900 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div>
              <span className="text-sm font-bold text-gray-900">RELAY FAVOURS Bot</span>
              <div className="flex items-center gap-1">
                {statusConnected === null ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-600 animate-pulse" />
                ) : statusConnected ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                )}
                <span className="text-[9px] text-gray-400">
                  {statusConnected ? "XMTP Production" : "In-app mode"}
                  {conversationCount !== null && ` · ${conversationCount} convos`}
                </span>
              </div>
            </div>
          </div>
          <div className="w-8" />
        </div>
      </div>


      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 flex flex-col gap-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`} style={{ animation: `fadeUp 0.3s ease-out ${Math.min(i * 0.05, 0.5)}s both` }}>
            <div
              className={`max-w-[85%] px-4 py-3 ${
                msg.role === "user"
                  ? "bg-black text-white rounded-2xl rounded-br-md"
                  : "bg-white border border-gray-100 text-gray-800 shadow-sm rounded-2xl rounded-bl-md"
              }`}
            >
              <p className="text-[15px] leading-relaxed whitespace-pre-line">{msg.text}</p>
              <p className={`text-[11px] mt-1.5 ${msg.role === "user" ? "text-white/60" : "text-gray-400"}`}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex gap-2">
            <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-md px-5 py-3.5">
              <div className="flex gap-1.5">
                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions (show when few messages) */}
      {messages.length <= 2 && !sending && (
        <div className="shrink-0 px-4 pb-2">
          <p className="text-xs text-gray-400 mb-2">Try asking:</p>
          <div className="flex flex-wrap gap-2">
            {INITIAL_SUGGESTIONS.map((q, i) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                className="text-sm text-gray-700 bg-gray-50 border border-gray-200 px-4 py-2 rounded-xl hover:bg-gray-100 transition-colors active:scale-95"
                style={{ animation: `fadeUp 0.3s ease-out ${i * 0.05}s both` }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 px-4 py-3 border-t border-gray-100 bg-white">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(input);
          }}
          className="flex items-center gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the RELAY FAVOURS bot..."
            disabled={sending}
            className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-300 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="w-10 h-10 rounded-xl bg-black hover:bg-gray-800 disabled:bg-gray-300 flex items-center justify-center transition-colors active:scale-95 shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
