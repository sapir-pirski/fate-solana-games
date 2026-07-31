"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Coins,
  Copy,
  Crown,
  ExternalLink,
  Flame,
  Gift,
  History,
  Menu,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type View = "jackpot" | "coinflip" | "daily" | "history";
type Toast = { title: string; text: string } | null;

type LogInput = {
  eventType: string;
  category: "navigation" | "wallet" | "gameplay" | "transaction" | "system";
  status?: "info" | "pending" | "success" | "failure";
  gameType?: View;
  gameId?: string;
  amountLamports?: number;
  transactionSignature?: string;
  metadata?: Record<string, string | number | boolean>;
};

function getSessionId() {
  const key = "fate_session_id";
  let value = sessionStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    sessionStorage.setItem(key, value);
  }
  return value;
}

function writeLog(input: LogInput) {
  const body = JSON.stringify({ ...input, sessionId: getSessionId() });
  void fetch("/api/logs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

const entrants = [
  { wallet: "7cXq...2Kp9", amount: 3.42, color: "#c8ff4d", ago: "just now" },
  { wallet: "F4te...91sL", amount: 1.8, color: "#8b5cf6", ago: "8s ago" },
  { wallet: "9zUa...Cq31", amount: 0.75, color: "#ff6bd6", ago: "19s ago" },
  { wallet: "Hh2m...8VxA", amount: 0.52, color: "#53e7ff", ago: "31s ago" },
];

const flips = [
  { id: "#8492", wallet: "AK7d...mP21", amount: 2.5, side: "Heads", age: "12s" },
  { id: "#8491", wallet: "5Krx...nF04", amount: 1.0, side: "Tails", age: "34s" },
  { id: "#8488", wallet: "pL91...7aZx", amount: 0.5, side: "Heads", age: "1m" },
];

const historyRows = [
  { game: "Jackpot", id: "#1,294", result: "Won", amount: "+12.84", date: "2 min ago", win: true },
  { game: "Coinflip", id: "#8,467", result: "Lost", amount: "−1.00", date: "18 min ago", win: false },
  { game: "Daily Case", id: "#31,082", result: "Claimed", amount: "+0.05", date: "Yesterday", win: true },
  { game: "Coinflip", id: "#8,401", result: "Won", amount: "+3.84", date: "Yesterday", win: true },
  { game: "Jackpot", id: "#1,287", result: "Lost", amount: "−0.50", date: "2 days ago", win: false },
];

function Mark({ small = false }: { small?: boolean }) {
  return <div className={`mark ${small ? "mark-small" : ""}`}><span>F</span></div>;
}

function SolIcon() {
  return <span className="sol-icon">◎</span>;
}

function Header({ view, setView, connected, connect }: { view: View; setView: (v: View) => void; connected: boolean; connect: () => void }) {
  const [mobile, setMobile] = useState(false);
  const nav: { key: View; label: string }[] = [
    { key: "jackpot", label: "Jackpot" }, { key: "coinflip", label: "Coinflip" },
    { key: "daily", label: "Daily Case" }, { key: "history", label: "History" },
  ];
  return <header className="header">
    <button className="brand" onClick={() => setView("jackpot")}><Mark /><span>FATE</span></button>
    <nav className="desktop-nav">
      {nav.map(n => <button key={n.key} className={view === n.key ? "active" : ""} onClick={() => setView(n.key)}>{n.label}{n.key === "daily" && <span className="free-dot">FREE</span>}</button>)}
    </nav>
    <div className="wallet-area">
      {connected && <div className="balance"><span>Balance</span><strong><SolIcon /> 24.82 SOL</strong></div>}
      <button className={`connect ${connected ? "connected" : ""}`} onClick={connect}>{connected ? <><span className="online" /> 7cXq...2Kp9</> : <><Wallet size={17} /> Connect wallet</>}</button>
      <button className="menu" onClick={() => setMobile(!mobile)} aria-label="Toggle navigation">{mobile ? <X /> : <Menu />}</button>
    </div>
    <AnimatePresence>{mobile && <motion.div className="mobile-nav" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      {nav.map(n => <button key={n.key} onClick={() => { setView(n.key); setMobile(false); }}>{n.label}<ChevronRight size={18} /></button>)}
    </motion.div>}</AnimatePresence>
  </header>;
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return <div className="stat"><div className={accent ? "stat-icon accent" : "stat-icon"}>{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>;
}

function Fairness({ hash = "A7f3...9c2B" }: { hash?: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="fairness">
    <div className="fairness-title"><ShieldCheck size={18} /><span>Provably fair</span><small>ON-CHAIN</small></div>
    <p>Every outcome is generated and verified on Solana. No hidden odds. No trust required.</p>
    <div className="hash"><code>{hash}</code><button onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }} aria-label="Copy hash">{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>
    <button className="text-link">How fairness works <ArrowUpRight size={14} /></button>
  </div>;
}

function Jackpot({ connected, onConnect, notify }: { connected: boolean; onConnect: () => void; notify: (t: Toast) => void }) {
  const [amount, setAmount] = useState("0.50");
  const [seconds, setSeconds] = useState(18);
  useEffect(() => { const timer = setInterval(() => setSeconds(s => s > 0 ? s - 1 : 30), 1000); return () => clearInterval(timer); }, []);
  const chance = Math.min(100, ((Number(amount) || 0) / (8.49 + (Number(amount) || 0))) * 100);
  const enter = () => {
    if (!connected) return onConnect();
    if (!Number(amount)) return notify({ title: "Enter an amount", text: "Choose how much SOL you want to add." });
    notify({ title: "Entry ready", text: `${amount} SOL transaction prepared for your wallet.` });
  };
  return <motion.main key="jackpot" className="page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <section className="jackpot-hero">
      <div className="eyebrow"><span className="pulse" /> LIVE ROUND <span>#1,295</span></div>
      <h1>One pot.<br/><em>One winner.</em></h1>
      <p className="hero-sub">Every entry raises your odds. Winner takes the pot — provably, transparently, on-chain.</p>
      <div className="hero-stats">
        <Stat icon={<Coins size={20} />} label="Total pot" value="8.49 SOL" accent />
        <Stat icon={<Users size={20} />} label="Players" value="12" />
        <Stat icon={<Clock3 size={20} />} label="Drawing in" value={`00:${String(seconds).padStart(2, "0")}`} />
      </div>
    </section>

    <section className="jackpot-grid">
      <div className="card pot-card">
        <div className="card-head"><div><span className="kicker">CURRENT POT</span><h2><SolIcon /> 8.49 <small>SOL</small></h2></div><div className="chance-ring" style={{ "--chance": `${chance * 3.6}deg` } as React.CSSProperties}><div><strong>{chance.toFixed(1)}%</strong><span>YOUR CHANCE</span></div></div></div>
        <div className="pot-line">{entrants.map((e, i) => <span key={e.wallet} style={{ width: `${[40, 27, 19, 14][i]}%`, background: e.color }} />)}</div>
        <div className="entry-label"><span>Your entry</span><span>Available: {connected ? "24.82" : "—"} SOL</span></div>
        <div className="amount-input"><SolIcon /><input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-label="Entry amount"/><span>SOL</span><button onClick={() => setAmount(connected ? "24.82" : "1.00")}>MAX</button></div>
        <div className="presets">{["0.10", "0.25", "0.50", "1.00"].map(v => <button className={amount === v ? "selected" : ""} key={v} onClick={() => setAmount(v)}>{v}</button>)}</div>
        <button className="primary" onClick={enter}>{connected ? <><Zap size={18} fill="currentColor" /> Enter jackpot · {amount || "0"} SOL</> : <><Wallet size={18} /> Connect wallet to enter</>}</button>
        <div className="fee-note"><ShieldCheck size={14} /> Secured by Solana <span>•</span> 3% winner fee</div>
      </div>

      <div className="card live-card">
        <div className="card-title"><div><Flame size={18} /><strong>Live entries</strong></div><span><i /> Updating live</span></div>
        <div className="entries">
          {entrants.map((e, i) => <motion.div className="entry" key={e.wallet} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .08 }}>
            <div className="avatar" style={{ "--avatar": e.color } as React.CSSProperties}>{e.wallet[0]}</div>
            <div><strong>{e.wallet}</strong><span>{e.ago}</span></div><b><SolIcon /> {e.amount.toFixed(2)}</b>
          </motion.div>)}
        </div>
        <div className="whale"><Crown size={17} /><span>Top entry</span><strong>7cXq...2Kp9</strong><b>40.3%</b></div>
      </div>
    </section>

    <section className="bottom-grid">
      <Fairness />
      <div className="previous card"><div className="card-title"><div><Trophy size={18}/><strong>Previous winner</strong></div><span>Round #1,294</span></div><div className="winner"><div className="winner-mark">7c</div><div><strong>7cXq...2Kp9</strong><span>Won with a 6.8% chance</span></div><b><SolIcon /> 12.84 SOL</b></div><button className="text-link">View transaction <ExternalLink size={14}/></button></div>
    </section>
  </motion.main>;
}

function Coinflip({ connected, onConnect, notify }: { connected: boolean; onConnect: () => void; notify: (t: Toast) => void }) {
  const [side, setSide] = useState<"Heads" | "Tails">("Heads");
  const [amount, setAmount] = useState("1.00");
  const action = (text: string) => connected ? notify({ title: text, text: "Transaction prepared for wallet approval." }) : onConnect();
  return <motion.main key="coinflip" className="page subpage" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
    <div className="page-heading"><div><div className="eyebrow"><Swords size={14}/> PLAYER VS PLAYER</div><h1>Call it.<br/><em>Double it.</em></h1><p>Pick a side, set the stakes, and challenge another player. One flip. Winner takes all.</p></div><div className="big-coin"><div className={side === "Heads" ? "coin-face heads" : "coin-face tails"}><Mark small /></div><span className="orbit one"/><span className="orbit two"/></div></div>
    <div className="coin-grid">
      <div className="card create-card"><div className="card-title"><div><Sparkles size={18}/><strong>Create a flip</strong></div><span>1v1</span></div><label>Choose your side</label><div className="side-picker"><button className={side === "Heads" ? "active" : ""} onClick={() => setSide("Heads")}><div className="mini-coin">F</div><strong>Heads</strong><span>Violet side</span></button><button className={side === "Tails" ? "active tails" : ""} onClick={() => setSide("Tails")}><div className="mini-coin lime">◎</div><strong>Tails</strong><span>Lime side</span></button></div><label>Wager amount</label><div className="amount-input"><SolIcon/><input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}/><span>SOL</span></div><div className="presets">{["0.25","0.50","1.00","2.50"].map(v=><button key={v} className={amount===v?"selected":""} onClick={()=>setAmount(v)}>{v}</button>)}</div><button className="primary" onClick={()=>action("Coinflip created")}>{connected ? <><Swords size={18}/> Create {side.toLowerCase()} flip · {amount} SOL</> : <><Wallet size={18}/> Connect wallet to play</>}</button></div>
      <div className="card active-flips"><div className="card-title"><div><Flame size={18}/><strong>Open challenges</strong></div><span><i/> {flips.length} live</span></div>{flips.map((f,i)=><motion.div className="flip-row" key={f.id} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:i*.08}}><div className={`mini-coin ${f.side === "Tails" ? "lime":""}`}>{f.side === "Heads" ? "F":"◎"}</div><div><strong>{f.wallet}</strong><span>{f.id} · {f.age} ago</span></div><b><SolIcon/> {f.amount.toFixed(2)}</b><button onClick={()=>action(`Joining ${f.id}`)}>Join</button></motion.div>)}<div className="active-footer"><ShieldCheck size={15}/> Funds escrowed on-chain until the flip settles</div></div>
    </div>
    <section className="bottom-grid"><Fairness hash="Cf92...D81e"/><div className="card recent-results"><div className="card-title"><div><History size={18}/><strong>Recent flips</strong></div><button className="text-link">View all</button></div><div className="result-row"><span className="win-tag">W</span><strong>3Qm8...pL0f</strong><span>beat</span><strong>Bm72...3kAi</strong><b>+4.85 SOL</b></div><div className="result-row"><span className="loss-tag">L</span><strong>9cV1...Sa2z</strong><span>lost to</span><strong>Rr44...Uo19</strong><b>−0.50 SOL</b></div></div></section>
  </motion.main>;
}

function DailyCase({ connected, onConnect, notify }: { connected: boolean; onConnect: () => void; notify: (t: Toast) => void }) {
  const [opening, setOpening] = useState(false); const [opened, setOpened] = useState(false);
  const open = () => { if (!connected) return onConnect(); setOpening(true); setTimeout(() => { setOpening(false); setOpened(true); notify({title:"Reward unlocked",text:"0.25 SOL was credited to your wallet."});}, 1800); };
  return <motion.main key="daily" className="page subpage" initial={{opacity:0}} animate={{opacity:1}}><div className="case-layout"><section className="case-copy"><div className="eyebrow"><Gift size={14}/> ONE FREE OPEN EVERY 24H</div><h1>Your daily<br/><em>shot at SOL.</em></h1><p>Open your free case. Your reward is generated on-chain and lands directly in your connected wallet.</p><div className="cooldown"><Clock3 size={18}/><div><span>NEXT FREE OPEN</span><strong>{opened ? "23:59:59" : "READY NOW"}</strong></div></div><div className="reward-list"><span>Possible rewards</span>{[0.01,0.05,0.10,0.25,1.00].map(v=><b key={v}><SolIcon/> {v.toFixed(2)}</b>)}</div></section><section className="case-stage"><div className={`case-box ${opening?"opening":""} ${opened?"opened":""}`}><div className="case-glow"/><div className="case-lid"><span>FATE</span></div><div className="case-body"><Gift size={56}/><span>DAILY</span></div>{opened&&<motion.div className="reward-pop" initial={{scale:.4,opacity:0}} animate={{scale:1,opacity:1}}><small>YOU UNLOCKED</small><strong><SolIcon/> 0.25 SOL</strong><span>Credited to wallet</span></motion.div>}</div><button className="primary case-button" disabled={opening||opened} onClick={open}>{opening?<><Sparkles size={18}/> Revealing on-chain...</>:opened?<><Check size={18}/> Come back tomorrow</>:connected?<><Gift size={18}/> Open free case</>:<><Wallet size={18}/> Connect wallet to open</>}</button><p className="case-note"><ShieldCheck size={14}/> No deposit required · Provably fair</p></section></div><section className="bottom-grid"><Fairness hash="Dc10...F44a"/><div className="card recent-results"><div className="card-title"><div><Clock3 size={18}/><strong>Your recent opens</strong></div><span>Last 3</span></div>{[["Yesterday","0.05"],["Jul 29","0.10"],["Jul 28","0.01"]].map(r=><div className="claim-row" key={r[0]}><div className="mini-case"><Gift size={16}/></div><strong>{r[0]}</strong><span>Daily case</span><b>+{r[1]} SOL</b></div>)}</div></section></motion.main>;
}

function HistoryPage() {
  const [filter,setFilter]=useState("All games");
  const shown=useMemo(()=>historyRows.filter(r=>filter==="All games"||r.game===filter),[filter]);
  return <motion.main key="history" className="page subpage" initial={{opacity:0}} animate={{opacity:1}}><div className="history-head"><div><div className="eyebrow"><History size={14}/> ON-CHAIN ACTIVITY</div><h1>Your game<br/><em>history.</em></h1></div><div className="history-total"><span>All-time P&L</span><strong>+15.22 SOL</strong><small><ArrowUpRight size={13}/> 18.4% return</small></div></div><div className="history-summary"><Stat icon={<Trophy size={20}/>} label="Total won" value="29.14 SOL" accent/><Stat icon={<Swords size={20}/>} label="Games played" value="48"/><Stat icon={<Zap size={20}/>} label="Win rate" value="54.2%"/></div><section className="card history-table"><div className="history-toolbar"><div><strong>Recent activity</strong><span>Verified transactions from your connected wallet</span></div><div className="filters">{["All games","Jackpot","Coinflip","Daily Case"].map(f=><button key={f} className={filter===f?"active":""} onClick={()=>setFilter(f)}>{f}</button>)}</div></div><div className="table-head"><span>GAME</span><span>RESULT</span><span>AMOUNT</span><span>DATE</span><span/></div>{shown.map((r,i)=><motion.div className="table-row" key={r.game+r.id} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} transition={{delay:i*.04}}><div><div className={`game-icon ${r.game.includes("Daily")?"daily":r.game.toLowerCase()}`}>{r.game==="Jackpot"?<Crown size={17}/>:r.game==="Coinflip"?<Swords size={17}/>:<Gift size={17}/>}</div><p><strong>{r.game}</strong><span>{r.id}</span></p></div><span className={r.win?"status win":"status loss"}>{r.result}</span><b className={r.win?"amount-win":""}>{r.amount} SOL</b><span>{r.date}</span><button aria-label="View transaction"><ArrowUpRight size={16}/></button></motion.div>)}</section></motion.main>;
}

function ToastView({ toast, close }: { toast: Toast; close: () => void }) { return <AnimatePresence>{toast&&<motion.div className="toast" initial={{opacity:0,y:20,scale:.96}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:10}}><div><Check size={18}/></div><p><strong>{toast.title}</strong><span>{toast.text}</span></p><button onClick={close}><X size={16}/></button></motion.div>}</AnimatePresence>; }

export default function Home() {
  const [view,setView]=useState<View>("jackpot"); const [connected,setConnected]=useState(false); const [toast,setToast]=useState<Toast>(null);
  useEffect(() => {
    writeLog({ eventType: "page_view", category: "navigation", gameType: view, status: "info" });
  }, [view]);
  const notify=(t:Toast)=>{setToast(t);if(t)writeLog({eventType:"game_interaction",category:"gameplay",gameType:view,status:"success",metadata:{action:t.title}});setTimeout(()=>setToast(null),3200)};
  const connect=()=>{const next=!connected;setConnected(next);writeLog({eventType:next?"wallet_connected":"wallet_disconnected",category:"wallet",status:"success",metadata:{provider:"demo_wallet"}});notify(next?{title:"Wallet connected",text:"7cXq...2Kp9 · 24.82 SOL available"}:{title:"Wallet disconnected",text:"Connect again whenever you’re ready."});};
  return <div className="app-shell"><div className="noise"/><div className="ambient a1"/><div className="ambient a2"/><Header view={view} setView={setView} connected={connected} connect={connect}/><AnimatePresence mode="wait">{view==="jackpot"?<Jackpot connected={connected} onConnect={connect} notify={notify}/>:view==="coinflip"?<Coinflip connected={connected} onConnect={connect} notify={notify}/>:view==="daily"?<DailyCase connected={connected} onConnect={connect} notify={notify}/>:<HistoryPage/>}</AnimatePresence><footer><div className="brand"><Mark small/><span>FATE</span></div><p>Provably fair games. Built on Solana.</p><div><button>Fairness</button><button>Terms</button><button>Support</button><span className="network"><i/> Mainnet</span></div></footer><ToastView toast={toast} close={()=>setToast(null)}/></div>;
}
