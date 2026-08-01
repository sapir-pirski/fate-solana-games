"use client";

import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from "framer-motion";
import Image from "next/image";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  Coins,
  Copy,
  Crown,
  ExternalLink,
  Flame,
  Gift,
  History,
  LoaderCircle,
  Menu,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { logEvent, startLogging } from "./logging-client";
import { useSolanaWallet } from "./solana/useWallet";
import { useGames } from "./solana/useGames";
import { createCoinflipTransaction, enterJackpotTransaction, solToLamports } from "../lib/solana/fate-client";
import FateCopilot from "./ai/FateCopilot";

type View = "jackpot" | "coinflip" | "daily" | "history";
type Toast = { title: string; text: string } | null;
type WalletOption = { name: string; icon: string };
type WalletClient = ReturnType<typeof useSolanaWallet>;

const GameCoin3D = lazy(() => import("./animations/GameCoin3D"));
const DailyCase3D = lazy(() => import("./animations/DailyCase3D"));
const PROGRAM_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_FATE_PROGRAM_ID);

const subscribeHydration = () => () => {};
function useHydrated() {
  return useSyncExternalStore(subscribeHydration, () => true, () => false);
}

const short = (address: string | null) => address ? `${address.slice(0,4)}...${address.slice(-4)}` : "—";
const sol = (lamports: string) => Number(lamports) / 1_000_000_000;

function Mark({ small = false }: { small?: boolean }) {
  return <div className={`mark ${small ? "mark-small" : ""}`}><span>F</span></div>;
}

function SolIcon() {
  return <span className="sol-icon">◎</span>;
}

function AnimatedNumber({ value, decimals = 2 }: { value: number; decimals?: number }) {
  const source = useSpring(0, { stiffness: 65, damping: 18, mass: 0.8 });
  const display = useTransform(source, current => current.toFixed(decimals));
  useEffect(() => { source.set(value); }, [source, value]);
  return <motion.span>{display}</motion.span>;
}

function ParticleField() {
  const particles = useMemo(() => Array.from({ length: 22 }, (_, i) => ({
    left: `${(i * 43) % 97}%`, top: `${18 + (i * 29) % 72}%`, delay: (i % 8) * 0.33,
    size: 2 + (i % 3), color: i % 4 === 0 ? "#c8ff4d" : i % 3 === 0 ? "#53e7ff" : "#8b5cf6",
  })), []);
  return <div className="particle-field" aria-hidden="true">{particles.map((p, i) => <motion.i key={i} style={{ left: p.left, top: p.top, width: p.size, height: p.size, background: p.color }} animate={{ y: [0, -18, 0], opacity: [.08, .75, .08], scale: [.7, 1.4, .7] }} transition={{ duration: 3.2 + (i % 4), delay: p.delay, repeat: Infinity, ease: "easeInOut" }}/>)}</div>;
}

function playTone(kind: "tap" | "success", enabled: boolean, contextRef: React.MutableRefObject<AudioContext | null>) {
  if (!enabled || typeof window === "undefined") return;
  try {
    const context = contextRef.current ?? new AudioContext(); contextRef.current = context;
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = kind === "success" ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(kind === "success" ? 520 : 260, context.currentTime);
    if (kind === "success") oscillator.frequency.exponentialRampToValueAtTime(920, context.currentTime + .16);
    gain.gain.setValueAtTime(.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(.055, context.currentTime + .015); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .22);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .24);
  } catch { /* Sound is enhancement-only. */ }
}

function Header({ view, setView, connected, connecting, address, balance, connect, sound, toggleSound }: { view: View; setView: (v: View) => void; connected: boolean; connecting: boolean; address: string | null; balance: number | null; connect: () => void; sound: boolean; toggleSound: () => void }) {
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
      {connected && <div className="balance"><span>Balance</span><strong><SolIcon /> {balance === null ? "—" : balance.toFixed(3)} SOL</strong></div>}
      <button className="sound-toggle" onClick={toggleSound} aria-label={sound ? "Mute game sounds" : "Enable game sounds"}>{sound ? <Volume2 size={16}/> : <VolumeX size={16}/>}</button>
      <button className={`connect ${connected ? "connected" : ""}`} disabled={connecting} onClick={connect}>{connected ? <><span className="online" /> {address?.slice(0, 4)}...{address?.slice(-4)}</> : <><Wallet size={17} /> {connecting ? "Connecting..." : "Connect wallet"}</>}</button>
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
    <details className="fairness-details"><summary>How fairness works <ArrowUpRight size={14} /></summary><p>Each wager is locked before a Switchboard commitment is bound to the game. The revealed value and deterministic result remain in the Solana account.</p><a href="/verify">Open independent verifier <ArrowUpRight size={14}/></a></details>
  </div>;
}

function Jackpot({ wallet, onConnect, notify }: { wallet: WalletClient; onConnect: () => void; notify: (t: Toast) => void }) {
  const connected = wallet.connected;
  const { games, loading, error, refresh } = useGames("jackpot", "open");
  const round = games[0];
  const [amount, setAmount] = useState("0.50");
  const [submitting, setSubmitting] = useState(false);
  const [seconds, setSeconds] = useState(18);
  useEffect(() => { const timer = setInterval(() => setSeconds(s => s > 0 ? s - 1 : 30), 1000); return () => clearInterval(timer); }, []);
  const pot = round ? sol(round.pot_lamports) : 0;
  const chance = Math.min(100, ((Number(amount) || 0) / (pot + (Number(amount) || 0))) * 100);
  const enter = async () => {
    if (!connected) return onConnect();
    if (!round) return notify({ title: "No open round", text: "Wait for a finalized jackpot round to appear in the indexer." });
    if (!PROGRAM_CONFIGURED) return notify({ title: "Devnet setup required", text: "The audited program address has not been configured, so no funds were requested." });
    try {
      setSubmitting(true);
      const transaction = enterJackpotTransaction({programId:process.env.NEXT_PUBLIC_FATE_PROGRAM_ID!,player:wallet.address!,roundId:BigInt(round.numeric_id),amountLamports:solToLamports(amount)});
      const signature = await wallet.sendTransaction(transaction, status => notify({title:status === "awaiting_approval" ? "Approve in wallet" : `Transaction ${status}`,text:status === "finalized" ? "Your entry is finalized on Solana." : "Waiting for Solana confirmation…"}));
      logEvent({eventType:"jackpot_entry_finalized",category:"transaction",gameType:"jackpot",status:"success",walletAddress:wallet.address!,metadata:{signature,round:round.numeric_id}});
      await refresh();
    } catch (cause) { notify({title:"Entry failed",text:cause instanceof Error?cause.message:"The transaction could not be submitted."}); }
    finally { setSubmitting(false); }
  };
  return <motion.main key="jackpot" className="page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><ParticleField />
    <section className="jackpot-hero">
      <div className="eyebrow"><span className="pulse" /> FINALIZED INDEX <span>{round ? `#${round.numeric_id}` : "NO OPEN ROUND"}</span></div>
      <h1>One pot.<br/><em>One winner.</em></h1>
      <p className="hero-sub">Every entry raises your odds. Winner takes the pot — provably, transparently, on-chain.</p>
      <div className="hero-stats">
        <Stat icon={<Coins size={20} />} label="Total pot" value={`${pot.toFixed(2)} SOL`} accent />
        <Stat icon={<Users size={20} />} label="Feed" value={loading ? "Loading" : error ? "Offline" : "Finalized"} />
        <Stat icon={<Clock3 size={20} />} label="Drawing in" value={`00:${String(seconds).padStart(2, "0")}`} />
      </div>
    </section>

    <section className="jackpot-grid">
      <div className="card pot-card">
        <div className="card-head"><div><span className="kicker">CURRENT POT</span><h2><SolIcon /> <AnimatedNumber value={pot}/> <small>SOL</small></h2></div><div className="chance-ring" style={{ "--chance": `${chance * 3.6}deg` } as React.CSSProperties}><div><strong>{chance.toFixed(1)}%</strong><span>YOUR CHANCE</span></div></div></div>
        <div className="pot-line"><span style={{width:"100%",background:"#c8ff4d"}} /></div>
        <div className="entry-label"><span>Your entry</span><span>Available: {connected && wallet.balance !== null ? wallet.balance.toFixed(3) : "—"} SOL</span></div>
        <div className="amount-input"><SolIcon /><input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-label="Entry amount"/><span>SOL</span><button onClick={() => setAmount(connected ? "24.82" : "1.00")}>MAX</button></div>
        <div className="presets">{["0.10", "0.25", "0.50", "1.00"].map(v => <button className={amount === v ? "selected" : ""} key={v} onClick={() => setAmount(v)}>{v}</button>)}</div>
        <button className="primary" disabled={submitting || !round} onClick={()=>void enter()}>{submitting ? <><LoaderCircle className="spin" size={18}/> Confirming on Solana…</> : connected ? <><Zap size={18} fill="currentColor" /> Enter jackpot · {amount || "0"} SOL</> : <><Wallet size={18} /> Connect wallet to enter</>}</button>
        <div className="fee-note"><ShieldCheck size={14} /> Secured by Solana <span>•</span> 3% winner fee</div>
      </div>

      <div className="card live-card">
        <div className="card-title"><div><Flame size={18} /><strong>On-chain round</strong></div><span className="demo-state">FINALIZED</span></div>
        <div className="entries"><div className="entry"><div className="avatar">◎</div><div><strong>{round ? short(round.address) : "No round indexed"}</strong><span>{error ?? (round ? `Slot ${round.last_slot}` : "Waiting for an open round")}</span></div>{round&&<b><SolIcon/> {pot.toFixed(2)}</b>}</div></div>
        {round&&<div className="whale"><Crown size={17}/><span>Program account</span><strong>{short(round.address)}</strong><b>OPEN</b></div>}
      </div>
    </section>

    <section className="bottom-grid">
      <Fairness />
      <div className="previous card"><div className="card-title"><div><Trophy size={18}/><strong>Previous winner</strong></div><span>Round #1,294</span></div><div className="winner"><div className="winner-mark">7c</div><div><strong>7cXq...2Kp9</strong><span>Won with a 6.8% chance</span></div><b><SolIcon /> 12.84 SOL</b></div><button className="text-link">View transaction <ExternalLink size={14}/></button></div>
    </section>
  </motion.main>;
}

function Coinflip({ wallet, onConnect, notify }: { wallet: WalletClient; onConnect: () => void; notify: (t: Toast) => void }) {
  const connected=wallet.connected; const {games:flips,refresh}=useGames("coinflip","open");
  const [side, setSide] = useState<"Heads" | "Tails">("Heads");
  const [amount, setAmount] = useState("1.00");
  const webglReady = useHydrated();
  const reduceMotion = useReducedMotion();
  const [submitting,setSubmitting]=useState(false);
  const create = async()=>{if(!connected)return onConnect();if(!PROGRAM_CONFIGURED)return notify({title:"Devnet setup required",text:"The program address is not configured."});try{setSubmitting(true);const bytes=crypto.getRandomValues(new Uint32Array(2));const gameId=(BigInt(bytes[0])<<32n)|BigInt(bytes[1]);const tx=createCoinflipTransaction({programId:process.env.NEXT_PUBLIC_FATE_PROGRAM_ID!,creator:wallet.address!,gameId,side,amountLamports:solToLamports(amount),expiresAt:BigInt(Math.floor(Date.now()/1000)+300)});const signature=await wallet.sendTransaction(tx,status=>notify({title:status==="awaiting_approval"?"Approve flip":"Flip transaction "+status,text:"Waiting for finalized Solana state…"}));logEvent({eventType:"coinflip_created",category:"transaction",gameType:"coinflip",status:"success",walletAddress:wallet.address!,metadata:{signature,gameId:gameId.toString()}});await refresh();}catch(cause){notify({title:"Create failed",text:cause instanceof Error?cause.message:"Transaction failed."});}finally{setSubmitting(false)}};
  return <motion.main key="coinflip" className="page subpage" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
    <div className="page-heading"><div><div className="eyebrow"><Swords size={14}/> PLAYER VS PLAYER</div><h1>Call it.<br/><em>Double it.</em></h1><p>Pick a side, set the stakes, and challenge another player. One flip. Winner takes all.</p></div><div className="big-coin">{reduceMotion||!webglReady?<div className={side === "Heads" ? "coin-face heads" : "coin-face tails"}><Mark small /></div>:<Suspense fallback={<div className="canvas-loader"><span/></div>}><GameCoin3D side={side}/></Suspense>}<span className="orbit one"/><span className="orbit two"/></div></div>
    <div className="coin-grid">
      <div className="card create-card"><div className="card-title"><div><Sparkles size={18}/><strong>Create a flip</strong></div><span>1v1</span></div><label>Choose your side</label><div className="side-picker"><button className={side === "Heads" ? "active" : ""} onClick={() => setSide("Heads")}><div className="mini-coin">F</div><strong>Heads</strong><span>Violet side</span></button><button className={side === "Tails" ? "active tails" : ""} onClick={() => setSide("Tails")}><div className="mini-coin lime">◎</div><strong>Tails</strong><span>Lime side</span></button></div><label>Wager amount</label><div className="amount-input"><SolIcon/><input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}/><span>SOL</span></div><div className="presets">{["0.25","0.50","1.00","2.50"].map(v=><button key={v} className={amount===v?"selected":""} onClick={()=>setAmount(v)}>{v}</button>)}</div><button className="primary" disabled={submitting} onClick={()=>void create()}>{submitting?<><LoaderCircle className="spin" size={18}/> Confirming…</>:connected ? <><Swords size={18}/> Create {side.toLowerCase()} flip · {amount} SOL</> : <><Wallet size={18}/> Connect wallet to play</>}</button></div>
      <div className="card active-flips"><div className="card-title"><div><Flame size={18}/><strong>Open challenges</strong></div><span className="demo-state">FINALIZED</span></div>{flips.map((f,i)=><motion.div className="flip-row" key={f.address} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:i*.08}}><div className="mini-coin">F</div><div><strong>{short(f.creator)}</strong><span>#{f.numeric_id} · slot {f.last_slot}</span></div><b><SolIcon/> {sol(f.wager_lamports).toFixed(2)}</b><button disabled title="Joining needs a committed Switchboard randomness account">Oracle required</button></motion.div>)}{!flips.length&&<div className="entry"><span>No finalized open challenges.</span></div>}<div className="active-footer"><ShieldCheck size={15}/> Funds escrowed on-chain until the flip settles</div></div>
    </div>
    <section className="bottom-grid"><Fairness hash="Cf92...D81e"/><div className="card recent-results"><div className="card-title"><div><History size={18}/><strong>Recent flips</strong></div><button className="text-link">View all</button></div><div className="result-row"><span className="win-tag">W</span><strong>3Qm8...pL0f</strong><span>beat</span><strong>Bm72...3kAi</strong><b>+4.85 SOL</b></div><div className="result-row"><span className="loss-tag">L</span><strong>9cV1...Sa2z</strong><span>lost to</span><strong>Rr44...Uo19</strong><b>−0.50 SOL</b></div></div></section>
  </motion.main>;
}

function DailyCase({ wallet, onConnect, notify }: { wallet: WalletClient; onConnect: () => void; notify: (t: Toast) => void }) {
  const connected=wallet.connected; const [opening] = useState(false); const [opened] = useState(false);
  const webglReady = useHydrated();
  const reduceMotion = useReducedMotion();
  const open = () => { if (!connected) return onConnect(); notify({title:"Oracle configuration required",text:"Set NEXT_PUBLIC_SWITCHBOARD_QUEUE before daily claims can safely bind verifiable randomness."}); };
  return <motion.main key="daily" className="page subpage" initial={{opacity:0}} animate={{opacity:1}}><div className="case-layout"><section className="case-copy"><div className="eyebrow"><Gift size={14}/> ONE FREE OPEN EVERY 24H</div><h1>Your daily<br/><em>shot at SOL.</em></h1><p>Open your free case. Your reward is generated on-chain and lands directly in your connected wallet.</p><div className="cooldown"><Clock3 size={18}/><div><span>NEXT FREE OPEN</span><strong>{opened ? "23:59:59" : "READY NOW"}</strong></div></div><div className="reward-list"><span>Possible rewards</span>{[0.01,0.05,0.10,0.25,1.00].map(v=><b key={v}><SolIcon/> {v.toFixed(2)}</b>)}</div></section><section className="case-stage"><div className={`case-box ${opening?"opening":""} ${opened?"opened":""}`}>{reduceMotion||!webglReady?<><div className="case-glow"/><div className="case-lid"><span>FATE</span></div><div className="case-body"><Gift size={56}/><span>DAILY</span></div></>:<Suspense fallback={<div className="canvas-loader"><span/></div>}><DailyCase3D opening={opening} opened={opened}/></Suspense>}{opened&&<motion.div className="reward-pop" initial={{scale:.4,opacity:0,y:14}} animate={{scale:1,opacity:1,y:0}} transition={{type:"spring",stiffness:180,damping:15}}><small>YOU UNLOCKED</small><strong><SolIcon/> <AnimatedNumber value={.25}/> SOL</strong><span>Credited to wallet</span></motion.div>}</div><button className="primary case-button" disabled={opening||opened} onClick={open}>{opening?<><Sparkles size={18}/> Revealing on-chain...</>:opened?<><Check size={18}/> Come back tomorrow</>:connected?<><Gift size={18}/> Open free case</>:<><Wallet size={18}/> Connect wallet to open</>}</button><p className="case-note"><ShieldCheck size={14}/> No deposit required · Provably fair</p></section></div><section className="bottom-grid"><Fairness hash="Dc10...F44a"/><div className="card recent-results"><div className="card-title"><div><Clock3 size={18}/><strong>Your recent opens</strong></div><span>Last 3</span></div>{[["Yesterday","0.05"],["Jul 29","0.10"],["Jul 28","0.01"]].map(r=><div className="claim-row" key={r[0]}><div className="mini-case"><Gift size={16}/></div><strong>{r[0]}</strong><span>Daily case</span><b>+{r[1]} SOL</b></div>)}</div></section></motion.main>;
}

function HistoryPage({wallet}:{wallet:WalletClient}) {
  const {games}=useGames(undefined,undefined,wallet.address);
  const [filter,setFilter]=useState("All games");
  const historyRows=useMemo(()=>games.map(game=>{const name=game.game_type==="jackpot"?"Jackpot":game.game_type==="coinflip"?"Coinflip":"Daily Case";const win=Boolean(wallet.address&&game.winner===wallet.address);return{game:name,id:`#${game.numeric_id}`,result:game.state==="settled"?(win?"Won":"Settled"):game.state,amount:`${win?"+":""}${sol(win?game.payout_lamports:game.wager_lamports).toFixed(2)}`,date:`slot ${game.last_slot}`,win,signature:game.last_signature};}),[games,wallet.address]);
  const shown=useMemo(()=>historyRows.filter(r=>filter==="All games"||r.game===filter),[filter,historyRows]);
  return <motion.main key="history" className="page subpage" initial={{opacity:0}} animate={{opacity:1}}><div className="history-head"><div><div className="eyebrow"><History size={14}/> FINALIZED ON-CHAIN ACTIVITY</div><h1>Your game<br/><em>history.</em></h1></div></div><div className="history-summary"><Stat icon={<Swords size={20}/>} label="Indexed games" value={String(games.length)} accent/><Stat icon={<Trophy size={20}/>} label="Wins" value={String(historyRows.filter(r=>r.win).length)}/><Stat icon={<ShieldCheck size={20}/>} label="Commitment" value="Finalized"/></div><section className="card history-table"><div className="history-toolbar"><div><strong>Recent activity</strong><span>Finalized transactions from your connected wallet</span></div><div className="filters">{["All games","Jackpot","Coinflip","Daily Case"].map(f=><button key={f} className={filter===f?"active":""} onClick={()=>setFilter(f)}>{f}</button>)}</div></div><div className="table-head"><span>GAME</span><span>RESULT</span><span>AMOUNT</span><span>DATE</span><span/></div>{shown.map((r,i)=><motion.div className="table-row" key={r.game+r.id} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} transition={{delay:i*.04}}><div><div className={`game-icon ${r.game.includes("Daily")?"daily":r.game.toLowerCase()}`}>{r.game==="Jackpot"?<Crown size={17}/>:r.game==="Coinflip"?<Swords size={17}/>:<Gift size={17}/>}</div><p><strong>{r.game}</strong><span>{r.id}</span></p></div><span className={r.win?"status win":"status loss"}>{r.result}</span><b className={r.win?"amount-win":""}>{r.amount} SOL</b><span>{r.date}</span><a aria-label="View transaction" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/tx/${r.signature}?cluster=devnet`}><ArrowUpRight size={16}/></a></motion.div>)}</section></motion.main>;
}

function ToastView({ toast, close }: { toast: Toast; close: () => void }) { return <AnimatePresence>{toast&&<motion.div className="toast" initial={{opacity:0,y:20,scale:.96}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:10}}><div><Check size={18}/></div><p><strong>{toast.title}</strong><span>{toast.text}</span></p><button onClick={close}><X size={16}/></button></motion.div>}</AnimatePresence>; }

function WalletModal({ open, wallets, connecting, close, select }: { open: boolean; wallets: WalletOption[]; connecting: boolean; close: () => void; select: (name: string) => void }) {
  return <AnimatePresence>{open&&<motion.div className="modal-backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={close}><motion.section className="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title" initial={{opacity:0,y:18,scale:.97}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:12,scale:.98}} onMouseDown={event=>event.stopPropagation()}><div className="modal-head"><div><span>FATE · DEVNET</span><h2 id="wallet-title">Connect a wallet</h2></div><button onClick={close} aria-label="Close wallet picker"><X size={18}/></button></div><p>Select an installed Solana wallet. FATE never asks for your seed phrase or private key.</p><div className="wallet-list">{wallets.length?wallets.map(option=><button key={option.name} disabled={connecting} onClick={()=>select(option.name)}><Image unoptimized width={38} height={38} src={option.icon} alt=""/><span><strong>{option.name}</strong><small>Detected · Wallet Standard</small></span>{connecting?<LoaderCircle className="spin" size={18}/>:<ChevronRight size={18}/>}</button>):<div className="wallet-empty"><Wallet size={24}/><strong>No wallet detected</strong><span>Install Phantom, Backpack, or Solflare, then refresh this page.</span></div>}</div><div className="modal-network"><i/> Solana Devnet <span>No real-value wagers</span></div></motion.section></motion.div>}</AnimatePresence>;
}

export default function Home() {
  const [view,setView]=useState<View>("jackpot"); const [toast,setToast]=useState<Toast>(null);
  const [walletPicker,setWalletPicker]=useState(false);
  const wallet = useSolanaWallet();
  const connected = wallet.connected;
  const [sound,setSound]=useState(()=>typeof window !== "undefined" && localStorage.getItem("fate_sound")==="on"); const audioContext=useRef<AudioContext|null>(null);
  useEffect(() => startLogging(), []);
  useEffect(() => {
    logEvent({ eventType: "page_view", category: "navigation", gameType: view, status: "info" });
  }, [view]);
  const notify=(t:Toast)=>{setToast(t);if(t){playTone(t.title.includes("unlocked")||t.title.includes("connected")?"success":"tap",sound,audioContext);logEvent({eventType:"game_interaction",category:"gameplay",gameType:view,status:"success",metadata:{action:t.title}})}setTimeout(()=>setToast(null),3200)};
  const connect=()=>{if(connected){void wallet.disconnect();logEvent({eventType:"wallet_disconnected",category:"wallet",status:"success",walletAddress:wallet.address??undefined});notify({title:"Wallet disconnected",text:"Connect again whenever you’re ready."});return;}setWalletPicker(true);};
  const selectWallet=(name:string)=>{void wallet.connect(name).then(()=>{setWalletPicker(false);logEvent({eventType:"wallet_connected",category:"wallet",status:"success",metadata:{standard:"wallet_standard",cluster:wallet.cluster,wallet:name}});notify({title:"Wallet connected",text:"Your Solana devnet account is ready."});}).catch((cause:unknown)=>{const text=cause instanceof Error?cause.message:"Wallet connection failed.";logEvent({eventType:"wallet_connection_failed",category:"wallet",status:"failure",metadata:{reason:text.slice(0,120)}});notify({title:"Could not connect",text});});};
  const toggleSound=()=>{const next=!sound;setSound(next);localStorage.setItem("fate_sound",next?"on":"off");playTone("tap",next,audioContext)};
  return <div className={`app-shell game-${view}`}><div className="noise"/><div className="ambient a1"/><div className="ambient a2"/><Header view={view} setView={setView} connected={connected} connecting={wallet.connecting} address={wallet.address} balance={wallet.balance} connect={connect} sound={sound} toggleSound={toggleSound}/><div className="environment-banner"><span><i/> SOLANA DEVNET</span><p>Wallet-approved transactions · Finalized indexer data · No mainnet wagers</p></div><AnimatePresence mode="wait">{view==="jackpot"?<Jackpot wallet={wallet} onConnect={connect} notify={notify}/>:view==="coinflip"?<Coinflip wallet={wallet} onConnect={connect} notify={notify}/>:view==="daily"?<DailyCase wallet={wallet} onConnect={connect} notify={notify}/>:<HistoryPage wallet={wallet}/>}</AnimatePresence><footer><div className="brand"><Mark small/><span>FATE</span></div><p>Provably fair games. Built on Solana.</p><div><button>Fairness</button><button>Terms</button><button>Support</button><span className="network"><i/> {wallet.cluster === "mainnet-beta" ? "Mainnet" : "Devnet"}</span></div></footer><FateCopilot walletAddress={wallet.address}/><WalletModal open={walletPicker} wallets={wallet.wallets} connecting={wallet.connecting} close={()=>!wallet.connecting&&setWalletPicker(false)} select={selectWallet}/><ToastView toast={toast} close={()=>setToast(null)}/></div>;
}
