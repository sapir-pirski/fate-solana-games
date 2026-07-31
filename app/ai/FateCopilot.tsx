"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bot, ChevronRight, Gauge, Send, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, Trophy, X } from "lucide-react";
import { FormEvent, useState } from "react";

type Message = { id: string; serverId?: string; role: "user" | "assistant"; content: string; rating?: number };
type Tab = "copilot" | "limits" | "arena";

export default function FateCopilot({ walletAddress }: { walletAddress: string | null }) {
  const [open, setOpen] = useState(false); const [tab, setTab] = useState<Tab>("copilot"); const [input, setInput] = useState(""); const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([{ id: "welcome", role: "assistant", content: "I can explain game rules, inspect indexed fairness evidence, diagnose tracked transactions, summarize activity, and prepare unsigned devnet drafts." }]);
  const [daily, setDaily] = useState("1"); const [weekly, setWeekly] = useState("5"); const [limitStatus, setLimitStatus] = useState("");
  const [arenaResult, setArenaResult] = useState<string>("");

  async function send(message = input) {
    const clean = message.trim(); if (!clean || busy) return; setBusy(true); setInput("");
    const user: Message = { id: crypto.randomUUID(), role: "user", content: clean }; const assistantId = crypto.randomUUID();
    setMessages(current => [...current, user, { id: assistantId, role: "assistant", content: "" }]);
    try {
      const response = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: clean, conversationId, walletAddress }) });
      if (!response.ok || !response.body) { const error = await response.json().catch(() => ({})) as { message?: string; code?: string }; throw new Error(error.message ?? error.code ?? "Copilot unavailable"); }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
        for (const event of events) { const type = event.match(/^event: (.+)$/m)?.[1]; const data = event.match(/^data: (.+)$/m)?.[1]; if (!data) continue; const parsed = JSON.parse(data) as { delta?: string; conversationId?: string; messageId?: string }; if (type === "meta") { if (parsed.conversationId) setConversationId(parsed.conversationId); if (parsed.messageId) setMessages(current => current.map(item => item.id === assistantId ? { ...item, serverId: parsed.messageId } : item)); } if (type === "delta" && parsed.delta) setMessages(current => current.map(item => item.id === assistantId ? { ...item, content: item.content + parsed.delta } : item)); }
      }
    } catch (error) { setMessages(current => current.map(item => item.id === assistantId ? { ...item, content: error instanceof Error ? error.message : "Copilot unavailable" } : item)); }
    finally { setBusy(false); }
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

  async function runArena() {
    setArenaResult("Running devnet simulation..."); const response = await fetch("/api/ai/arena", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rounds: 5, agents: [{ name: "Aegis", style: "cautious", budgetLamports: 1e9 }, { name: "Vector", style: "balanced", budgetLamports: 1e9 }, { name: "Nova", style: "bold", budgetLamports: 1e9 }] }) });
    const result = await response.json() as { code?: string; leaderboard?: Array<{ name: string; balanceLamports: number }> };
    setArenaResult(response.ok ? result.leaderboard!.map((entry, index) => `${index + 1}. ${entry.name} — ${(entry.balanceLamports / 1e9).toFixed(3)} test SOL`).join("\n") : result.code === "ARENA_DISABLED" ? "Arena is implemented but disabled. Set AI_AGENT_ARENA_ENABLED=true for local devnet simulations." : result.code ?? "Arena unavailable");
  }

  const prompts = ["Explain Jackpot fairness", "How are timeout refunds handled?", walletAddress ? "Summarize my indexed activity" : "What can you verify?"];
  return <><button className="copilot-launcher" onClick={() => setOpen(true)}><Sparkles size={17}/><span>FATE Copilot</span></button><AnimatePresence>{open&&<motion.aside className="copilot-panel" initial={{opacity:0,x:25,y:10}} animate={{opacity:1,x:0,y:0}} exit={{opacity:0,x:20}}><header><div><span className="ai-orb"><Bot size={18}/></span><p><strong>FATE AI</strong><small>Grounded · Read-only · Devnet</small></p></div><button onClick={()=>setOpen(false)} aria-label="Close Copilot"><X size={18}/></button></header><nav>{(["copilot","limits","arena"] as Tab[]).map(item=><button key={item} className={tab===item?"active":""} onClick={()=>setTab(item)}>{item==="copilot"?<Bot size={14}/>:item==="limits"?<Gauge size={14}/>:<Trophy size={14}/>} {item}</button>)}</nav>
    {tab==="copilot"&&<><div className="copilot-messages">{messages.map(message=><div key={message.id} className={`ai-message ${message.role}`}><span>{message.content||<i className="typing">•••</i>}</span>{message.role==="assistant"&&message.id!=="welcome"&&<div><button className={message.rating===1?"rated":""} onClick={()=>void rateMessage(message,1)} aria-label="Helpful"><ThumbsUp size={12}/></button><button className={message.rating===-1?"rated":""} onClick={()=>void rateMessage(message,-1)} aria-label="Not helpful"><ThumbsDown size={12}/></button></div>}</div>)}</div><div className="ai-prompts">{prompts.map(prompt=><button key={prompt} onClick={()=>void send(prompt)}>{prompt}<ChevronRight size={13}/></button>)}</div><form className="copilot-input" onSubmit={event=>{event.preventDefault();void send();}}><input value={input} onChange={event=>setInput(event.target.value)} maxLength={2000} placeholder="Ask about a game or transaction..."/><button disabled={busy||!input.trim()}><Send size={16}/></button></form><p className="ai-disclaimer"><ShieldCheck size={12}/> Never shares keys, signs transactions, or controls outcomes.</p></>}
    {tab==="limits"&&<form className="ai-settings" onSubmit={saveLimits}><div className="ai-section-icon"><Gauge/></div><h3>Responsible-play controls</h3><p>These deterministic limits block AI-created transaction drafts. They do not depend on an LLM decision.</p><label>Daily draft limit<input type="number" min="0" step="0.01" value={daily} onChange={event=>setDaily(event.target.value)}/><span>SOL</span></label><label>Weekly draft limit<input type="number" min="0" step="0.01" value={weekly} onChange={event=>setWeekly(event.target.value)}/><span>SOL</span></label><button className="ai-action">Save limits</button>{limitStatus&&<output>{limitStatus}</output>}</form>}
    {tab==="arena"&&<section className="ai-settings"><div className="ai-section-icon arena"><Trophy/></div><h3>Devnet Agent Arena</h3><p>Three transparent fixed-policy agents compete with test balances. Outcomes are simulated independently of the LLM and never use real funds.</p><ul><li>Aegis · cautious</li><li>Vector · balanced</li><li>Nova · bold</li></ul><button className="ai-action" onClick={()=>void runArena()}>Run five rounds</button>{arenaResult&&<pre>{arenaResult}</pre>}</section>}
    </motion.aside>}</AnimatePresence></>;
}
