"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bot, ChevronRight, Gauge, RotateCcw, Send, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type Message = { id: string; serverId?: string; role: "user" | "assistant"; content: string; rating?: number; retryPrompt?: string };
type Tab = "copilot" | "limits";
const WELCOME: Message = { id: "welcome", role: "assistant", content: "I can explain game rules, inspect indexed fairness evidence, diagnose tracked transactions, summarize activity, and prepare unsigned devnet drafts." };

function errorMessage(code?: string, fallback?: string) {
  const messages: Record<string, string> = { AI_NOT_CONFIGURED: "Copilot is not configured.", AI_RATE_LIMITED: "Too many requests. Please try again later.", RATE_LIMITED: "Too many requests. Please try again later.", AI_TOKEN_BUDGET_EXCEEDED: "Your daily Copilot allowance has been reached.", AI_SERVICE_BUDGET_EXCEEDED: "Copilot has reached its service budget.", WALLET_AUTH_REQUIRED: "Authenticate your connected wallet to access wallet-specific information.", SENSITIVE_INPUT: "Remove secrets or private information and try again.", UNSAFE_INSTRUCTION: "That instruction cannot be processed safely.", AI_UNAVAILABLE: "Copilot is temporarily unavailable. Please retry." };
  return (code && messages[code]) ?? fallback ?? "Copilot unavailable";
}

export default function FateCopilot({ walletAddress }: { walletAddress: string | null }) {
  const [open, setOpen] = useState(false); const [tab, setTab] = useState<Tab>("copilot"); const [input, setInput] = useState(""); const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [daily, setDaily] = useState("1"); const [weekly, setWeekly] = useState("5"); const [limitStatus, setLimitStatus] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null); const abortRef = useRef<AbortController | null>(null); const launcherRef = useRef<HTMLButtonElement>(null); const panelRef = useRef<HTMLElement>(null);

  const clearConversation = useCallback(() => { abortRef.current?.abort(); abortRef.current = null; setConversationId(""); setMessages([WELCOME]); setInput(""); setBusy(false); setTab("copilot"); sessionStorage.removeItem("fate.ai.conversation"); sessionStorage.removeItem("fate.ai.messages"); }, []);
  const closeCopilot = useCallback(() => { clearConversation(); setOpen(false); window.setTimeout(() => launcherRef.current?.focus(), 0); }, [clearConversation]);

  useEffect(() => { sessionStorage.removeItem("fate.ai.conversation"); sessionStorage.removeItem("fate.ai.messages"); void fetch("/api/ai/status").then(response => response.json()).then((value: { enabled?: boolean }) => setAvailable(Boolean(value.enabled))).catch(() => setAvailable(false)); return () => abortRef.current?.abort(); }, []);
  useEffect(() => { if (!open) return; const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); closeCopilot(); } }; document.addEventListener("keydown", onKeyDown); return () => document.removeEventListener("keydown", onKeyDown); }, [closeCopilot, open]);

  async function send(message = input, fresh = false) {
    const clean = message.trim(); if (!clean || busy) return; setBusy(true); setInput("");
    const user: Message = { id: crypto.randomUUID(), role: "user", content: clean }; const assistantId = crypto.randomUUID();
    if (fresh) setConversationId("");
    setMessages(current => [...(fresh ? [WELCOME] : current), user, { id: assistantId, role: "assistant", content: "" }]);
    try {
      const controller = new AbortController(); abortRef.current = controller;
      const response = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: clean, conversationId: fresh ? "" : conversationId, walletAddress }), signal: controller.signal });
      if (!response.ok || !response.body) { const error = await response.json().catch(() => ({})) as { message?: string; code?: string }; throw new Error(errorMessage(error.code, error.message)); }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
        for (const event of events) { const type = event.match(/^event: (.+)$/m)?.[1]; const data = event.match(/^data: (.+)$/m)?.[1]; if (!data) continue; const parsed = JSON.parse(data) as { delta?: string; conversationId?: string; messageId?: string }; if (type === "meta") { if (parsed.conversationId) setConversationId(parsed.conversationId); if (parsed.messageId) setMessages(current => current.map(item => item.id === assistantId ? { ...item, serverId: parsed.messageId } : item)); } if (type === "delta" && parsed.delta) setMessages(current => current.map(item => item.id === assistantId ? { ...item, content: item.content + parsed.delta } : item)); }
      }
    } catch (error) { const cancelled = error instanceof DOMException && error.name === "AbortError"; const failure = cancelled ? "Response cancelled." : error instanceof Error ? error.message : "Copilot unavailable"; setMessages(current => current.map(item => item.id === assistantId ? { ...item, content: failure, retryPrompt: cancelled ? undefined : clean } : item)); }
    finally { abortRef.current = null; setBusy(false); }
  }

  async function rateMessage(message: Message, rating: 1 | -1) {
    if (!message.serverId) return;
    const response = await fetch("/api/ai/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: message.serverId, walletAddress, rating }) });
    if (response.ok) setMessages(current => current.map(item => item.id === message.id ? { ...item, rating } : item));
  }

  async function saveLimits(event: FormEvent) {
    event.preventDefault(); if (!walletAddress) return setLimitStatus("Connect a wallet first.");
    const response = await fetch("/api/ai/limits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ walletAddress, dailyLamports: Math.round(Number(daily) * 1e9), weeklyLamports: Math.round(Number(weekly) * 1e9), cooldownUntil: null, selfExcludedUntil: null }) });
    setLimitStatus(response.ok ? "Limits saved and enforced for AI transaction drafts." : "Limits could not be saved.");
  }

  function resetConversation() { clearConversation(); }

  const prompts = ["Explain Jackpot fairness", "How are timeout refunds handled?", walletAddress ? "Summarize my indexed activity" : "What can you verify?"];
  if (available === false) return null;
  return <><button ref={launcherRef} className="copilot-launcher" onClick={() => setOpen(true)} disabled={available===null}><Sparkles size={17}/><span>FATE Copilot</span></button><AnimatePresence>{open&&<><motion.button type="button" className="copilot-backdrop" aria-label="Dismiss Copilot" onClick={closeCopilot} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}/><motion.aside ref={panelRef} className="copilot-panel" initial={{opacity:0,x:25,y:10}} animate={{opacity:1,x:0,y:0}} exit={{opacity:0,x:20}} role="dialog" aria-modal="true" aria-label="FATE Copilot"><header><div><span className="ai-orb"><Bot size={18}/></span><p><strong>FATE AI</strong><small>Grounded · Read-only · Devnet</small></p></div><div><button onClick={resetConversation} aria-label="New conversation"><RotateCcw size={16}/></button><button onClick={closeCopilot} aria-label="Close Copilot"><X size={18}/></button></div></header><nav>{(["copilot","limits"] as Tab[]).map(item=><button key={item} className={tab===item?"active":""} onClick={()=>setTab(item)}>{item==="copilot"?<Bot size={14}/>:<Gauge size={14}/>} {item}</button>)}</nav>
    {tab==="copilot"&&<><div className="copilot-messages">{messages.map(message=><div key={message.id} className={`ai-message ${message.role}`}><span>{message.content||<i className="typing">•••</i>}</span>{message.role==="assistant"&&message.id!=="welcome"&&<div><button className={message.rating===1?"rated":""} onClick={()=>void rateMessage(message,1)} aria-label="Helpful"><ThumbsUp size={12}/></button><button className={message.rating===-1?"rated":""} onClick={()=>void rateMessage(message,-1)} aria-label="Not helpful"><ThumbsDown size={12}/></button>{message.retryPrompt&&<button className="ai-retry" disabled={busy} onClick={()=>void send(message.retryPrompt,true)}>Retry</button>}</div>}</div>)}</div><div className="ai-prompts">{prompts.map(prompt=><button key={prompt} onClick={()=>void send(prompt)} disabled={busy}><span>{prompt}</span><ChevronRight size={13}/></button>)}</div><form className="copilot-input" onSubmit={event=>{event.preventDefault();void send();}}><input value={input} onChange={event=>setInput(event.target.value)} maxLength={2000} placeholder="Ask about a game or transaction..."/><button disabled={busy||!input.trim()}><Send size={16}/></button></form><p className="ai-disclaimer"><ShieldCheck size={12}/> Never shares keys, signs transactions, or controls outcomes.</p></>}
    {tab==="limits"&&<form className="ai-settings" onSubmit={saveLimits}><div className="ai-section-icon"><Gauge/></div><h3>Responsible-play controls</h3><p>These deterministic limits block AI-created transaction drafts. They do not depend on an LLM decision.</p><label>Daily draft limit<input type="number" min="0" step="0.01" value={daily} onChange={event=>setDaily(event.target.value)}/><span>SOL</span></label><label>Weekly draft limit<input type="number" min="0" step="0.01" value={weekly} onChange={event=>setWeekly(event.target.value)}/><span>SOL</span></label><button className="ai-action">Save limits</button>{limitStatus&&<output>{limitStatus}</output>}</form>}
    </motion.aside></>}</AnimatePresence></>;
}
