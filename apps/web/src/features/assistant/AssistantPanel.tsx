import React, { useState, useRef, useEffect } from "react";
import { X, Send, Trash2, Bot } from "lucide-react";
import { cn } from "@milly-maker/ui";
import { useUIStore } from "@/store/ui.store.js";
import { useAssistant } from "./useAssistant.js";
import { Link } from "@tanstack/react-router";

export function AssistantPanel() {
  const { toggleAssistant, pendingAssistantMessage, setPendingAssistantMessage } = useUIStore();
  const { messages, streaming, error, sendMessage, clearHistory } = useAssistant();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasApiKey = !!localStorage.getItem("anthropicApiKey");

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-fire any message queued from another page (e.g. Planning's "Review with Claude")
  useEffect(() => {
    if (pendingAssistantMessage && hasApiKey && !streaming) {
      const msg = pendingAssistantMessage;
      setPendingAssistantMessage(null);
      void sendMessage(msg);
    }
  }, [pendingAssistantMessage, hasApiKey, streaming, sendMessage, setPendingAssistantMessage]);

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    await sendMessage(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const SUGGESTIONS = [
    "What's my highest priority debt to pay off?",
    "At my current savings rate, when can I retire?",
    "Am I spending too much on dining?",
    "Should I pay off debt or invest more?",
  ];

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-[var(--color-border)] px-4">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-[var(--color-primary)]" />
          <span className="text-sm font-semibold">claude-opus-4-6</span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-muted)]"
              title="Clear conversation"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={toggleAssistant}
            className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-muted)]"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* No API key state */}
      {!hasApiKey && (
        <div className="m-4 rounded-[var(--radius-sm)] bg-[var(--color-warning)]/10 p-4 text-sm">
          <p className="mb-2 font-medium text-[var(--color-warning)]">API key required</p>
          <p className="mb-3 text-[var(--color-text-muted)]">
            Add your Anthropic API key in Settings to enable the financial assistant.
          </p>
          <Link
            to="/settings"
            className="text-[var(--color-primary)] underline underline-offset-2"
            onClick={toggleAssistant}
          >
            Go to Settings →
          </Link>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && hasApiKey && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--color-text-muted)]">
              Ask anything about your finances. I have access to your current debt, investments, and spending data.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-left text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text)] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-[var(--radius-sm)] px-3 py-2 text-sm",
                  msg.role === "user"
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-[var(--color-surface-raised)] text-[var(--color-text)]"
                )}
              >
                {msg.content || (streaming && i === messages.length - 1 ? (
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce">·</span>
                    <span className="animate-bounce [animation-delay:0.1s]">·</span>
                    <span className="animate-bounce [animation-delay:0.2s]">·</span>
                  </span>
                ) : "")}
              </div>
            </div>
          ))}
          {error && (
            <div className="rounded-[var(--radius-sm)] bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
              {error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      {hasApiKey && (
        <div className="border-t border-[var(--color-border)] p-3">
          <div className="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your finances…"
              disabled={streaming}
              className="flex-1 resize-none bg-transparent text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none disabled:opacity-50"
              style={{ maxHeight: "120px" }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || streaming}
              className="shrink-0 rounded-sm p-1 text-[var(--color-primary)] disabled:opacity-40 hover:bg-[var(--color-primary)]/10 transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-[var(--color-text-subtle)]">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      )}
    </aside>
  );
}
