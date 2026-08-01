"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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
  Monitor,
  RefreshCw,
  ShieldCheck,
  Smartphone,
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
import { logEvent, startLogging } from "@/app/logging-client";
import { useSolanaWallet } from "@/app/solana/useWallet";
import { useGames } from "@/app/solana/useGames";
import { createCoinflipTransaction, enterJackpotTransaction, solToLamports } from "@/lib/solana/fate-client";
import { getPublicConfig, requireFateProgramId } from "@/lib/config/client";
import { AnimatedNumber, Mark, SolIcon, Stat } from "@/components/ui/GamePrimitives";
import { jackpotChance } from "@/features/jackpot/model";
import FateCopilot from "@/app/ai/FateCopilot";
import ComplianceCenter from "@/app/compliance/ComplianceCenter";

type View = "jackpot" | "coinflip" | "daily" | "history";
type CoinSide = "Heads" | "Tails";
type Toast = { title: string; text: string } | null;
type WalletOption = { name: string; icon: string };
type WalletClient = ReturnType<typeof useSolanaWallet>;

const WALLET_CATALOG = [
  { name: "Phantom", mark: "P", color: "#ab9ff2", install: "https://phantom.com/download", mobile: (url: string) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}` },
  { name: "Backpack", mark: "B", color: "#e33e3f", install: "https://backpack.app/download", mobile: () => "https://backpack.app/download" },
  { name: "Solflare", mark: "S", color: "#f3a833", install: "https://solflare.com/download", mobile: (url: string) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}` },
] as const;

const GameCoin3D = lazy(() => import("@/components/three/GameCoin3D"));
const DailyCase3D = lazy(() => import("@/components/three/DailyCase3D"));
const JackpotVault3D = lazy(() => import("@/components/three/JackpotVault3D"));
const SpatialBackground3D = lazy(() => import("@/components/three/SpatialBackground3D"));
const LazyComplianceCenter = ComplianceCenter;
const PROGRAM_CONFIGURED = Boolean(getPublicConfig().fateProgramId);

const subscribeHydration = () => () => {};
function useHydrated() {
  return useSyncExternalStore(subscribeHydration, () => true, () => false);
}

const short = (address: string | null) => address ? `${address.slice(0,4)}...${address.slice(-4)}` : "—";
const sol = (lamports: string) => Number(lamports) / 1_000_000_000;


function ParticleField() {
  const reduceMotion = useReducedMotion();
  const particles = useMemo(() => Array.from({ length: 22 }, (_, i) => ({
    left: `${(i * 43) % 97}%`, top: `${18 + (i * 29) % 72}%`, delay: (i % 8) * 0.33,
    size: 2 + (i % 3), color: i % 4 === 0 ? "#c8ff4d" : i % 3 === 0 ? "#53e7ff" : "#8b5cf6",
  })), []);
  if (reduceMotion) return null;
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
    <button className="skip-link" onClick={() => { const main = document.querySelector("main"); if (main instanceof HTMLElement) { main.tabIndex = -1; main.focus(); } }}>Skip to game content</button>
    <button className="brand" aria-label="FATE home" onClick={() => setView("jackpot")}><Mark /><span>FATE</span></button>
    <nav className="desktop-nav" aria-label="Games">
      {nav.map(n => <button key={n.key} aria-current={view === n.key ? "page" : undefined} className={view === n.key ? "active" : ""} onClick={() => setView(n.key)}>{n.label}{view===n.key&&<motion.span className="nav-active" layoutId="active-game" transition={{type:"spring",stiffness:380,damping:34}}/>}{n.key === "daily" && <span className="free-dot">FREE</span>}</button>)}
    </nav>
    <div className="wallet-area">
      {connected && <div className="balance"><span>Balance</span><strong><SolIcon /> {balance === null ? "—" : balance.toFixed(3)} SOL</strong></div>}
      <button className="sound-toggle" onClick={toggleSound} aria-label={sound ? "Mute game sounds" : "Enable game sounds"}>{sound ? <Volume2 size={16}/> : <VolumeX size={16}/>}</button>
      <button className={`connect ${connected ? "connected" : ""}`} disabled={connecting} onClick={connect}>{connected ? <><span className="online" /> {address?.slice(0, 4)}...{address?.slice(-4)}</> : <><Wallet size={17} /> {connecting ? "Connecting..." : "Connect wallet"}</>}</button>
      <button className="menu" onClick={() => setMobile(!mobile)} aria-label="Toggle navigation" aria-expanded={mobile} aria-controls="mobile-navigation">{mobile ? <X /> : <Menu />}</button>
    </div>
    <AnimatePresence>{mobile && <motion.nav id="mobile-navigation" aria-label="Mobile games" className="mobile-nav" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      {nav.map(n => <button key={n.key} aria-current={view === n.key ? "page" : undefined} onClick={() => { setView(n.key); setMobile(false); }}>{n.label}<ChevronRight size={18} /></button>)}
      <button onClick={() => { document.querySelector<HTMLButtonElement>(".compliance-launcher")?.click(); setMobile(false); }}>Safety &amp; privacy<ShieldCheck size={18}/></button>
    </motion.nav>}</AnimatePresence>
  </header>;
}

function Fairness({ hash }: { hash?: string | null }) {
  const [copied, setCopied] = useState(false);
  const proof = hash && !hash.includes("...") ? hash : null;
  const displayHash = proof && proof.length > 18 ? `${proof.slice(0, 10)}…${proof.slice(-8)}` : proof;
  return <div className="fairness">
    <div className="fairness-title"><ShieldCheck size={18} /><span>Fairness proof</span><small>{proof ? "ON-CHAIN" : "NOT AVAILABLE"}</small></div>
    <p>{proof ? "Indexed randomness evidence is available for independent verification." : "No indexed on-chain fairness proof is available for this game yet."}</p>
    {proof ? <div className="hash"><code>{displayHash}</code><button type="button" onClick={() => { void navigator.clipboard.writeText(proof); setCopied(true); setTimeout(() => setCopied(false), 1200); }} aria-label="Copy fairness proof">{copied ? <Check size={15} /> : <Copy size={15} />}</button></div> : <div className="hash unavailable"><code>No fairness proof available</code></div>}
    <details className="fairness-details"><summary>How fairness works <ArrowUpRight size={14} /></summary><p>When a game is configured and settled, its committed randomness and deterministic result can be checked against the finalized Solana account.</p><a href="/verify">Open independent verifier <ArrowUpRight size={14}/></a></details>
  </div>;
}

function Jackpot({ wallet, onConnect, notify }: { wallet: WalletClient; onConnect: () => void; notify: (t: Toast) => void }) {
  const connected = wallet.connected;
  const { games, loading, error, refresh } = useGames("jackpot", "open");
  const { games: settledRounds, loading: settledLoading, error: settledError } = useGames("jackpot", "settled");
  const round = games[0];
  const previousRound = settledRounds[0];
  const [amount, setAmount] = useState("0.50");
  const [submitting, setSubmitting] = useState(false);
  const [seconds, setSeconds] = useState(18);
  useEffect(() => { const timer = setInterval(() => setSeconds(s => s > 0 ? s - 1 : 30), 1000); return () => clearInterval(timer); }, []);
  const pot = round ? sol(round.pot_lamports) : 0;
  const chance = jackpotChance(Number(amount), pot);
  const enter = async () => {
    if (!connected) return onConnect();
    if (!round) return notify({ title: "No open round", text: "Wait for a finalized jackpot round to appear in the indexer." });
    if (!PROGRAM_CONFIGURED) return notify({ title: "Devnet setup required", text: "The audited program address has not been configured, so no funds were requested." });
    try {
      setSubmitting(true);
      const transaction = enterJackpotTransaction({programId:requireFateProgramId(),player:wallet.address!,roundId:BigInt(round.numeric_id),amountLamports:solToLamports(amount)});
      const operationId=crypto.randomUUID();
      const signature = await wallet.sendTransaction(transaction,{operationId,gameType:"jackpot",action:"enter_jackpot",amountLamports:solToLamports(amount)}, status => notify({title:status === "awaiting_approval" ? "Approve in wallet" : `Transaction ${status}`,text:status === "finalized" ? "Your entry is finalized on Solana." : "Waiting for Solana confirmation…"}));
      logEvent({eventType:"jackpot_entry_finalized",category:"transaction",gameType:"jackpot",status:"success",walletAddress:wallet.address!,metadata:{signature,round:round.numeric_id}});
      await refresh();
    } catch (cause) { notify({title:"Entry failed",text:cause instanceof Error?cause.message:"The transaction could not be submitted."}); }
    finally { setSubmitting(false); }
  };
  const webglReady=useHydrated(); const reduceMotion=useReducedMotion();
  return <motion.main id="main-content" tabIndex={-1} key="jackpot" className="page" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{opacity:0,y:-8}} transition={{duration:.42,ease:[.22,1,.36,1]}}><ParticleField />
    <section className="jackpot-hero cinematic-hero">
      <div className="jackpot-hero-copy"><div className="eyebrow"><span className="pulse" /> FINALIZED INDEX <span>{round ? `#${round.numeric_id}` : "NO OPEN ROUND"}</span></div>
      <h1>One pot.<br/><em>One winner.</em></h1>
      <p className="hero-sub">Every entry raises your odds. Winner takes the pot — provably, transparently, on-chain.</p>
      <div className="hero-stats">
        <Stat icon={<Coins size={20} />} label="Total pot" value={`${pot.toFixed(2)} SOL`} accent />
        <Stat icon={<Users size={20} />} label="Feed" value={loading ? "Loading" : error ? "Offline" : "Finalized"} />
        <Stat icon={<Clock3 size={20} />} label="Drawing in" value={`00:${String(seconds).padStart(2, "0")}`} />
      </div></div>
      <div className="jackpot-visual">{reduceMotion||!webglReady?<div className="vault-fallback"><SolIcon/><strong>{pot.toFixed(2)}</strong><span>SOL POT</span></div>:<Suspense fallback={<div className="canvas-loader"><span/></div>}><JackpotVault3D pot={pot} chance={chance} seconds={seconds} active={submitting||seconds<4}/></Suspense>}</div>
    </section>

    <section className="jackpot-grid">
      <div className="card pot-card">
        <div className="card-head"><div><span className="kicker">CURRENT POT</span><h2><SolIcon /> <AnimatedNumber value={pot}/> <small>SOL</small></h2></div><div className="chance-ring" style={{ "--chance": `${chance * 3.6}deg` } as React.CSSProperties}><div><strong>{chance.toFixed(1)}%</strong><span>YOUR CHANCE</span></div></div></div>
        <div className="pot-line"><span style={{width:"100%",background:"#c8ff4d"}} /></div>
        <div className="entry-label"><span>Your entry</span><span>Available: {connected && wallet.balance !== null ? wallet.balance.toFixed(3) : "—"} SOL</span></div>
        <div className="amount-input"><SolIcon /><input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-label="Jackpot entry amount in SOL"/><span aria-hidden="true">SOL</span><button type="button" onClick={() => setAmount(connected ? "24.82" : "1.00")}>MAX</button></div>
        <div className="presets" role="group" aria-label="Jackpot amount presets">{["0.10", "0.25", "0.50", "1.00"].map(v => <button type="button" aria-pressed={amount === v} className={amount === v ? "selected" : ""} key={v} onClick={() => setAmount(v)}>{v}</button>)}</div>
        <button className="primary" disabled={submitting} aria-describedby="jackpot-action-hint" onClick={()=>void enter()}>{submitting ? <><LoaderCircle className="spin" size={18}/> Confirming on Solana…</> : connected ? <><Zap size={18} fill="currentColor" /> Enter jackpot · {amount || "0"} SOL</> : <><Wallet size={18} /> Connect wallet to enter</>}</button>
        <div className="fee-note" id="jackpot-action-hint"><ShieldCheck size={14} /> {!connected ? "Opens the wallet connection popup" : !round ? "No open round is currently indexed" : "Secured by Solana · 3% winner fee"}</div>
      </div>

      <div className="card live-card">
        <div className="card-title"><div><Flame size={18} /><strong>On-chain round</strong></div><span className="demo-state">{round ? "OPEN" : loading ? "SYNCING" : error ? "UNAVAILABLE" : "WAITING"}</span></div>
        <div className="entries"><div className="entry"><div className="avatar">◎</div><div><strong>{round ? short(round.address) : "No round indexed"}</strong><span>{error ?? (round ? `Slot ${round.last_slot}` : "Waiting for an open round")}</span></div>{round&&<b><SolIcon/> {pot.toFixed(2)}</b>}</div></div>
        {round&&<div className="whale"><Crown size={17}/><span>Program account</span><strong>{short(round.address)}</strong><b>OPEN</b></div>}
      </div>
    </section>

    <section className="bottom-grid">
      <Fairness hash={round?.randomness_hex ?? null}/>
      <div className="previous card"><div className="card-title"><div><Trophy size={18}/><strong>Previous winner</strong></div><span>{previousRound ? "FINALIZED" : settledLoading ? "SYNCING" : settledError ? "UNAVAILABLE" : "NO RESULT"}</span></div>{previousRound?.winner ? <><div className="winner"><div className="winner-mark">{previousRound.winner.slice(0,2)}</div><div><strong>{short(previousRound.winner)}</strong><span>Round #{previousRound.numeric_id} · slot {previousRound.last_slot}</span></div><b><SolIcon /> {sol(previousRound.payout_lamports).toFixed(2)} SOL</b></div>{previousRound.last_signature ? <a className="text-link" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/tx/${previousRound.last_signature}?cluster=devnet`}>View transaction <ArrowUpRight size={14}/></a> : <span className="text-link unavailable">Transaction unavailable <ShieldCheck size={14}/></span>}</> : <div className="winner empty"><div className="winner-mark">—</div><div><strong>No previous winner available</strong><span>{settledError ?? "No settled jackpot round has been indexed."}</span></div></div>}</div>
    </section>
  </motion.main>;
}

function Coinflip({ wallet, onConnect, notify }: { wallet: WalletClient; onConnect: () => void; notify: (t: Toast) => void }) {
  const connected=wallet.connected; const {games:flips,refresh}=useGames("coinflip","open");
  const [side, setSide] = useState<CoinSide>("Heads");
  const [amount, setAmount] = useState("1.00");
  const webglReady = useHydrated();
  const reduceMotion = useReducedMotion();
  const [submitting,setSubmitting]=useState(false);
  const create = async()=>{if(!connected)return onConnect();if(!PROGRAM_CONFIGURED)return notify({title:"Devnet setup required",text:"The program address is not configured."});try{setSubmitting(true);const bytes=crypto.getRandomValues(new Uint32Array(2));const gameId=(BigInt(bytes[0])<<32n)|BigInt(bytes[1]);const amountLamports=solToLamports(amount);const tx=createCoinflipTransaction({programId:process.env.NEXT_PUBLIC_FATE_PROGRAM_ID!,creator:wallet.address!,gameId,side,amountLamports,expiresAt:BigInt(Math.floor(Date.now()/1000)+300)});const signature=await wallet.sendTransaction(tx,{operationId:crypto.randomUUID(),gameType:"coinflip",action:"create_coinflip",amountLamports},status=>notify({title:status==="awaiting_approval"?"Approve flip":"Flip transaction "+status,text:"Waiting for finalized Solana state…"}));logEvent({eventType:"coinflip_created",category:"transaction",gameType:"coinflip",status:"success",walletAddress:wallet.address!,metadata:{signature,gameId:gameId.toString()}});await refresh();}catch(cause){notify({title:"Create failed",text:cause instanceof Error?cause.message:"Transaction failed."});}finally{setSubmitting(false)}};
  return <motion.main id="main-content" tabIndex={-1} key="coinflip" className="page subpage" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
    <div className="page-heading"><div><div className="eyebrow"><Swords size={14}/> PLAYER VS PLAYER</div><h1>Call it.<br/><em>Double it.</em></h1><p>Pick a side, set the stakes, and challenge another player. One flip. Winner takes all.</p></div><div className="big-coin">{reduceMotion||!webglReady?<div className={side === "Heads" ? "coin-face heads" : "coin-face tails"}><Mark small /></div>:<Suspense fallback={<div className="canvas-loader"><span/></div>}><GameCoin3D side={side} active={submitting}/></Suspense>}<span className="orbit one"/><span className="orbit two"/></div></div>
    <div className="coin-grid">
      <div className="card create-card"><div className="card-title"><div><Sparkles size={18}/><strong>Create a flip</strong></div><span>1v1</span></div><span className="field-label" id="coin-side-label">Choose your side</span><div className="side-picker" role="group" aria-labelledby="coin-side-label"><button type="button" aria-pressed={side === "Heads"} className={side === "Heads" ? "active" : ""} onClick={() => setSide("Heads")}><div className="mini-coin">F</div><strong>Heads</strong><span>Violet side</span></button><button type="button" aria-pressed={side === "Tails"} className={side === "Tails" ? "active tails" : ""} onClick={() => setSide("Tails")}><div className="mini-coin lime">◎</div><strong>Tails</strong><span>Lime side</span></button></div><label className="field-label" htmlFor="coin-wager">Wager amount</label><div className="amount-input"><SolIcon/><input id="coin-wager" aria-describedby="coin-wager-unit" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}/><span id="coin-wager-unit">SOL</span></div><div className="presets">{["0.25","0.50","1.00","2.50"].map(v=><button type="button" key={v} aria-pressed={amount===v} className={amount===v?"selected":""} onClick={()=>setAmount(v)}>{v}</button>)}</div><button className="primary" disabled={submitting} onClick={()=>void create()}>{submitting?<><LoaderCircle className="spin" size={18}/> Confirming…</>:connected ? <><Swords size={18}/> Create {side.toLowerCase()} flip · {amount} SOL</> : <><Wallet size={18}/> Connect wallet to play</>}</button></div>
      <div className="card active-flips"><div className="card-title"><div><Flame size={18}/><strong>Open challenges</strong></div><span className="demo-state">FINALIZED</span></div>{flips.map((f,i)=><motion.div className="flip-row" key={f.address} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:i*.08}}><div className="mini-coin">F</div><div><strong>{short(f.creator)}</strong><span>#{f.numeric_id} · slot {f.last_slot}</span></div><b><SolIcon/> {sol(f.wager_lamports).toFixed(2)}</b><button disabled title="Joining needs a committed Switchboard randomness account">Oracle required</button></motion.div>)}{!flips.length&&<div className="entry"><span>No finalized open challenges.</span></div>}<div className="active-footer"><ShieldCheck size={15}/> Funds escrowed on-chain until the flip settles</div></div>
    </div>
    <section className="bottom-grid"><Fairness hash="Cf92...D81e"/><div className="card recent-results"><div className="card-title"><div><History size={18}/><strong>Recent flips</strong></div><button className="text-link">View all</button></div><div className="result-row"><span className="win-tag">W</span><strong>3Qm8...pL0f</strong><span>beat</span><strong>Bm72...3kAi</strong><b>+4.85 SOL</b></div><div className="result-row"><span className="loss-tag">L</span><strong>9cV1...Sa2z</strong><span>lost to</span><strong>Rr44...Uo19</strong><b>−0.50 SOL</b></div></div></section>
  </motion.main>;
}

function DailyCase({ wallet, onConnect, notify }: { wallet: WalletClient; onConnect: () => void; notify: (t: Toast) => void }) {
  const connected=wallet.connected; const [opening,setOpening] = useState(false); const [opened] = useState(false);
  const webglReady = useHydrated();
  const reduceMotion = useReducedMotion();
  const open = () => { if (!connected) return onConnect(); setOpening(true); setTimeout(()=>{setOpening(false);notify({title:"Oracle configuration required",text:"The preview stopped before opening because verifiable randomness is not configured."})},1100); };
  return <motion.main key="daily" className="page subpage" initial={{opacity:0}} animate={{opacity:1}}><div className="case-layout"><section className="case-copy"><div className="eyebrow"><Gift size={14}/> ONE FREE OPEN EVERY 24H</div><h1>Your daily<br/><em>shot at SOL.</em></h1><p>Open your free case. Your reward is generated on-chain and lands directly in your connected wallet.</p><div className="cooldown"><Clock3 size={18}/><div><span>NEXT FREE OPEN</span><strong>{opened ? "23:59:59" : "READY NOW"}</strong></div></div><div className="reward-list"><span>Possible rewards</span>{[0.01,0.05,0.10,0.25,1.00].map(v=><b key={v}><SolIcon/> {v.toFixed(2)}</b>)}</div></section><section className="case-stage"><div className={`case-box ${opening?"opening":""} ${opened?"opened":""}`}>{reduceMotion||!webglReady?<><div className="case-glow"/><div className="case-lid"><span>FATE</span></div><div className="case-body"><Gift size={56}/><span>DAILY</span></div></>:<Suspense fallback={<div className="canvas-loader"><span/></div>}><DailyCase3D opening={opening} opened={opened}/></Suspense>}{opened&&<motion.div className="reward-pop" initial={{scale:.4,opacity:0,y:14}} animate={{scale:1,opacity:1,y:0}} transition={{type:"spring",stiffness:180,damping:15}}><small>YOU UNLOCKED</small><strong><SolIcon/> <AnimatedNumber value={.25}/> SOL</strong><span>Credited to wallet</span></motion.div>}</div><button className="primary case-button" disabled={opening||opened} onClick={open}>{opening?<><Sparkles size={18}/> Revealing on-chain...</>:opened?<><Check size={18}/> Come back tomorrow</>:connected?<><Gift size={18}/> Open free case</>:<><Wallet size={18}/> Connect wallet to open</>}</button><p className="case-note"><ShieldCheck size={14}/> No deposit required · Provably fair</p></section></div><section className="bottom-grid"><Fairness hash="Dc10...F44a"/><div className="card recent-results"><div className="card-title"><div><Clock3 size={18}/><strong>Your recent opens</strong></div><span>Last 3</span></div>{[["Yesterday","0.05"],["Jul 29","0.10"],["Jul 28","0.01"]].map(r=><div className="claim-row" key={r[0]}><div className="mini-case"><Gift size={16}/></div><strong>{r[0]}</strong><span>Daily case</span><b>+{r[1]} SOL</b></div>)}</div></section></motion.main>;
}

function HistoryPage({wallet}:{wallet:WalletClient}) {
  const {games}=useGames(undefined,undefined,wallet.address);
  const [filter,setFilter]=useState("All games");
  const historyRows=useMemo(()=>games.map(game=>{const name=game.game_type==="jackpot"?"Jackpot":game.game_type==="coinflip"?"Coinflip":"Daily Case";const win=Boolean(wallet.address&&game.winner===wallet.address);return{game:name,id:`#${game.numeric_id}`,result:game.state==="settled"?(win?"Won":"Settled"):game.state,amount:`${win?"+":""}${sol(win?game.payout_lamports:game.wager_lamports).toFixed(2)}`,date:`slot ${game.last_slot}`,win,signature:game.last_signature};}),[games,wallet.address]);
  const shown=useMemo(()=>historyRows.filter(r=>filter==="All games"||r.game===filter),[filter,historyRows]);
  return <motion.main key="history" className="page subpage" initial={{opacity:0}} animate={{opacity:1}}><div className="history-head"><div><div className="eyebrow"><History size={14}/> FINALIZED ON-CHAIN ACTIVITY</div><h1>Your game<br/><em>history.</em></h1></div></div><div className="history-summary"><Stat icon={<Swords size={20}/>} label="Indexed games" value={String(games.length)} accent/><Stat icon={<Trophy size={20}/>} label="Wins" value={String(historyRows.filter(r=>r.win).length)}/><Stat icon={<ShieldCheck size={20}/>} label="Commitment" value="Finalized"/></div><section className="card history-table"><div className="history-toolbar"><div><strong>Recent activity</strong><span>Finalized transactions from your connected wallet</span></div><div className="filters">{["All games","Jackpot","Coinflip","Daily Case"].map(f=><button key={f} className={filter===f?"active":""} onClick={()=>setFilter(f)}>{f}</button>)}</div></div><div className="table-head"><span>GAME</span><span>RESULT</span><span>AMOUNT</span><span>DATE</span><span/></div>{shown.map((r,i)=><motion.div className="table-row" key={r.game+r.id} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} transition={{delay:i*.04}}><div><div className={`game-icon ${r.game.includes("Daily")?"daily":r.game.toLowerCase()}`}>{r.game==="Jackpot"?<Crown size={17}/>:r.game==="Coinflip"?<Swords size={17}/>:<Gift size={17}/>}</div><p><strong>{r.game}</strong><span>{r.id}</span></p></div><span className={r.win?"status win":"status loss"}>{r.result}</span><b className={r.win?"amount-win":""}>{r.amount} SOL</b><span>{r.date}</span><a aria-label="View transaction" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/tx/${r.signature}?cluster=devnet`}><ArrowUpRight size={16}/></a></motion.div>)}</section></motion.main>;
}

function ToastView({ toast, close }: { toast: Toast; close: () => void }) { return <AnimatePresence>{toast&&<motion.div className="toast" role="status" aria-live="polite" aria-atomic="true" initial={{opacity:0,y:20,scale:.96}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:10}}><div aria-hidden="true"><Check size={18}/></div><p><strong>{toast.title}</strong><span>{toast.text}</span></p><button onClick={close} aria-label="Dismiss notification"><X size={16}/></button></motion.div>}</AnimatePresence>; }

function WalletModal({ open, wallets, connecting, error, selected, close, select, detect, demo }: { open: boolean; wallets: WalletOption[]; connecting: boolean; error: string | null; selected: string | null; close: () => void; select: (name: string) => void; detect: () => void; demo: () => void }) {
  const [mode, setMode] = useState<"browser" | "mobile">("browser");
  const [mobileWallet, setMobileWallet] = useState<(typeof WALLET_CATALOG)[number]>(WALLET_CATALOG[0]);
  const [qrData, setQrData] = useState("");
  const [detecting, setDetecting] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  const connectingRef = useRef(connecting);
  useEffect(() => { closeRef.current = close; }, [close]);
  useEffect(() => { connectingRef.current = connecting; }, [connecting]);
  const mobileLink = typeof window === "undefined" ? "" : mobileWallet.mobile(window.location.href);
  useEffect(() => {
    if (!open) return;
    const refresh = () => detect();
    const initial = window.requestAnimationFrame(refresh);
    const onVisibilityChange = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => { window.cancelAnimationFrame(initial); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVisibilityChange); };
  }, [detect, open]);
  useEffect(() => {
    if (!open || mode !== "mobile" || !mobileLink) return;
    let cancelled = false;
    void import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(mobileLink, { width: 232, margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b0d12", light: "#ffffff" } })).then(data => { if (!cancelled) setQrData(data); }).catch(() => { if (!cancelled) setQrData(""); });
    return () => { cancelled = true; };
  }, [mobileLink, mode, open]);
  const retryDetection = () => { setDetecting(true); detect(); window.setTimeout(() => setDetecting(false), 700); };
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusFrame = window.requestAnimationFrame(() => dialog?.focus({ preventScroll: true }));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !connectingRef.current) closeRef.current();
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus({ preventScroll: true }); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus({ preventScroll: true });
    };
  }, [open]);
  const switchMode = (next: "browser" | "mobile") => {
    const scrollTop = dialogRef.current?.scrollTop ?? 0;
    setMode(next);
    window.requestAnimationFrame(() => { if (dialogRef.current) dialogRef.current.scrollTop = scrollTop; });
  };
  return <AnimatePresence>{open&&<motion.div className="modal-backdrop" initial={{opacity:0,backdropFilter:"blur(0px)"}} animate={{opacity:1,backdropFilter:"blur(14px)"}} exit={{opacity:0,backdropFilter:"blur(0px)"}} onMouseDown={close} onWheel={event=>event.preventDefault()} onTouchMove={event=>event.preventDefault()}><motion.section ref={dialogRef} tabIndex={-1} className="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title" aria-describedby="wallet-description" initial={{opacity:0,y:24,scale:.94,rotateX:-7}} animate={{opacity:1,y:0,scale:1,rotateX:0}} exit={{opacity:0,y:18,scale:.96,rotateX:4}} transition={{type:"spring",stiffness:280,damping:26,mass:.8}} onMouseDown={event=>event.stopPropagation()} onWheel={event=>event.stopPropagation()} onTouchMove={event=>event.stopPropagation()}>
    <div className="modal-head"><div><span>FATE · DEVNET</span><h2 id="wallet-title">Connect a wallet</h2></div><button onClick={close} disabled={connecting} aria-label="Close wallet picker"><X size={18}/></button></div>
    <p id="wallet-description">Your wallet keeps the keys. FATE only requests approval for clearly described devnet actions.</p>
    <div className="wallet-tabs" role="tablist" aria-label="Connection method"><button role="tab" aria-selected={mode==="browser"} className={mode==="browser"?"active":""} onClick={()=>switchMode("browser")}><Monitor size={15}/> Browser</button><button role="tab" aria-selected={mode==="mobile"} className={mode==="mobile"?"active":""} onClick={()=>switchMode("mobile")}><Smartphone size={15}/> Mobile / QR</button></div>
    {error&&<motion.div className="wallet-error" role="alert" initial={{opacity:0,y:-4}} animate={{opacity:1,y:0}}><strong>{/reject|declin|cancel/i.test(error)?"Request rejected":/timed out/i.test(error)?"Connection timed out":"Could not connect"}</strong><span>{error} Unlock the extension, confirm it supports Solana Devnet, then retry.</span></motion.div>}
    {mode==="browser"?<>
      <div className="wallet-list">{wallets.length?wallets.map((option,index)=><motion.button key={option.name} disabled={connecting} onClick={()=>select(option.name)} initial={{opacity:0,x:-8}} animate={{opacity:1,x:0}} transition={{delay:index*.05}}><Image unoptimized width={38} height={38} src={option.icon} alt=""/><span><strong>{option.name}</strong><small>{selected===option.name&&connecting?"Waiting for wallet approval…":"Detected · Wallet Standard"}</small></span>{selected===option.name&&connecting?<LoaderCircle className="spin" size={18}/>:<ChevronRight size={18}/>}</motion.button>):<div className="wallet-empty"><Wallet size={24}/><strong>No compatible wallet detected</strong><span>Install a supported extension below. FATE detects Wallet Standard registration automatically—no page refresh is normally needed.</span><button onClick={retryDetection} disabled={detecting}>{detecting?<LoaderCircle className="spin" size={15}/>:<RefreshCw size={15}/>} Try detection again</button></div>}</div>
      <div className="wallet-install"><div><strong>Install a wallet</strong><span>Chrome, Edge, Firefox, Brave, and Safari are supported when the selected wallet offers an extension.</span></div>{WALLET_CATALOG.map(item=>{const found=wallets.some(wallet=>wallet.name.toLowerCase().includes(item.name.toLowerCase()));return <a key={item.name} href={item.install} target="_blank" rel="noreferrer" aria-label={`${found?"Open":"Install"} ${item.name}`} className={found?"detected":""}><i style={{background:item.color}}>{item.mark}</i><span>{item.name}<small>{found?"Detected":"Official download"}</small></span><ExternalLink size={14}/></a>})}</div>
    </>:<div className="wallet-mobile">
      <div className="mobile-wallets">{WALLET_CATALOG.map(item=><button key={item.name} className={mobileWallet.name===item.name?"active":""} onClick={()=>setMobileWallet(item)}><i style={{background:item.color}}>{item.mark}</i>{item.name}</button>)}</div>
      <div className="qr-shell">{qrData?<Image unoptimized src={qrData} width={232} height={232} alt={`QR code to open FATE in ${mobileWallet.name}`}/>:<div className="qr-loading"><LoaderCircle className="spin"/><span>Generating private QR…</span></div>}</div>
      <p>Scan with your phone camera, or open FATE inside {mobileWallet.name}. The QR contains only this public page URL.</p><a className="mobile-open" href={mobileLink}><Smartphone size={16}/> Open in {mobileWallet.name}</a>
    </div>}
    <div className="wallet-help"><button onClick={demo}>Continue in demo mode</button><a href="/legal#wallet-safety" target="_blank">Wallet safety guide <ArrowUpRight size={13}/></a></div>
    <div className="modal-network"><i/> Solana Devnet <span>No real-value wagers</span></div>
  </motion.section></motion.div>}</AnimatePresence>;
}

export default function PlatformApp({ initialView = "jackpot" }: { initialView?: View }) {
  const [view,setView]=useState<View>(initialView); const [toast,setToast]=useState<Toast>(null);
  const [walletPicker,setWalletPicker]=useState(false);
  const [connectingWallet,setConnectingWallet]=useState<string|null>(null);
  const hydrated=useHydrated(); const reduceMotion=useReducedMotion();
  const wallet = useSolanaWallet();
  const connected = wallet.connected;
  const [sound,setSound]=useState(()=>typeof window !== "undefined" && localStorage.getItem("fate_sound")==="on"); const audioContext=useRef<AudioContext|null>(null);
  useEffect(() => startLogging(), []);
  useEffect(() => {
    logEvent({ eventType: "page_view", category: "navigation", gameType: view, status: "info" });
  }, [view]);
  const notify=(t:Toast)=>{setToast(t);if(t){playTone(t.title.includes("unlocked")||t.title.includes("connected")?"success":"tap",sound,audioContext);logEvent({eventType:"game_interaction",category:"gameplay",gameType:view,status:"success",metadata:{action:t.title}})}setTimeout(()=>setToast(null),3200)};
  const connect=()=>{if(connected){void wallet.disconnect();logEvent({eventType:"wallet_disconnected",category:"wallet",status:"success",walletAddress:wallet.address??undefined});notify({title:"Wallet disconnected",text:"Connect again whenever you’re ready."});return;}setWalletPicker(true);};
  const selectWallet=(name:string)=>{setConnectingWallet(name);void wallet.connect(name).then(()=>{setWalletPicker(false);logEvent({eventType:"wallet_connected",category:"wallet",status:"success",metadata:{standard:"wallet_standard",cluster:wallet.cluster,wallet:name}});notify({title:"Wallet connected",text:"Your Solana devnet account is ready."});}).catch((cause:unknown)=>{const text=cause instanceof Error?cause.message:"Wallet connection failed.";logEvent({eventType:"wallet_connection_failed",category:"wallet",status:"failure",metadata:{reason:text.slice(0,120)}});notify({title:"Could not connect",text});}).finally(()=>setConnectingWallet(null));};
  const continueDemo=()=>{localStorage.setItem("fate_demo_mode","on");setWalletPicker(false);notify({title:"Demo mode enabled",text:"Browse games and fairness proofs without signing transactions."});};
  const toggleSound=()=>{const next=!sound;setSound(next);localStorage.setItem("fate_sound",next?"on":"off");playTone("tap",next,audioContext)};
  const activeOperation=wallet.operations.find(operation=>!["finalized","failed","rejected","expired"].includes(operation.status));
  const accent=view==="jackpot"?"#8bff63":view==="coinflip"?"#9945ff":view==="daily"?"#55e7ff":"#42d392";
  return <div className={`app-shell game-${view}`}>{hydrated&&!reduceMotion&&<Suspense fallback={null}><SpatialBackground3D accent={accent}/></Suspense>}<div className="noise"/><div className="ambient a1"/><div className="ambient a2"/><Header view={view} setView={setView} connected={connected} connecting={wallet.connecting||wallet.recovering} address={wallet.address} balance={wallet.balance} connect={connect} sound={sound} toggleSound={toggleSound}/><div className="environment-banner"><span><i/> SOLANA DEVNET</span><p>{wallet.recovering?"Recovering wallet session…":activeOperation?`Transaction recovery · ${activeOperation.status.replaceAll("_"," ")}${activeOperation.signature?` · ${activeOperation.signature.slice(0,8)}…`:""}`:connected&&wallet.authenticated?"Wallet authenticated · Compliance-gated · No mainnet wagers":"Wallet-approved transactions · No mainnet wagers"}</p></div><AnimatePresence mode="wait">{view==="jackpot"?<Jackpot wallet={wallet} onConnect={connect} notify={notify}/>:view==="coinflip"?<Coinflip wallet={wallet} onConnect={connect} notify={notify}/>:view==="daily"?<DailyCase wallet={wallet} onConnect={connect} notify={notify}/>:<HistoryPage wallet={wallet}/>}</AnimatePresence><footer><div className="brand"><Mark small/><span>FATE</span></div><p>Provably fair games. Built on Solana.</p><div><a href="/verify">Fairness</a><a href="/legal#terms">Terms</a><a href="/legal#privacy">Privacy</a><a href="/legal#responsible-play">Responsible play</a><button className="footer-compliance" onClick={()=>document.querySelector<HTMLButtonElement>(".compliance-launcher")?.click()}>Safety &amp; privacy</button><span className="network"><i/> {wallet.cluster === "mainnet-beta" ? "Mainnet" : "Devnet"}</span></div></footer><FateCopilot walletAddress={wallet.address}/><Suspense fallback={null}><LazyComplianceCenter authenticated={wallet.authenticated} walletAddress={wallet.address}/></Suspense><WalletModal open={walletPicker} wallets={wallet.wallets} connecting={wallet.connecting} error={wallet.error} selected={connectingWallet} close={()=>!wallet.connecting&&setWalletPicker(false)} select={selectWallet} detect={wallet.refreshWallets} demo={continueDemo}/><ToastView toast={toast} close={()=>setToast(null)}/></div>;
}
