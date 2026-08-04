"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { Connection, PublicKey } from "@solana/web3.js";
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
  Search,
  ShieldAlert,
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
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { logEvent, startLogging } from "@/app/logging-client";
import { useSolanaWallet } from "@/app/solana/useWallet";
import { useGames } from "@/app/solana/useGames";
import { cancelCoinflipTransaction, cancelDailyTimeoutTransaction, COINFLIP_RANDOMNESS_TIMEOUT_SECONDS, createCoinflipTransaction, DAILY_COOLDOWN_SECONDS, DAILY_RANDOMNESS_TIMEOUT_SECONDS, enterJackpotTransaction, fetchCoinflipGameAccount, fetchCoinflipSettlementContext, fetchDailyPlayerAccount, fetchFateWagerConfig, joinCoinflipTransaction, openDailyCaseTransaction, refundCoinflipTimeoutTransaction, settleCoinflipTransaction, settleDailyCaseTransaction, solToLamports, usableJackpotLamports, type DailyPlayerAccount } from "@/lib/solana/fate-client";
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
const formatLamportsInput = (lamports: bigint) => { const whole=lamports/1_000_000_000n,fraction=(lamports%1_000_000_000n).toString().padStart(9,"0").replace(/0+$/,"");return fraction?`${whole}.${fraction}`:whole.toString(); };


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
  const config=getPublicConfig();
  const { games, loading, error, refresh, clockOffsetSeconds } = useGames("jackpot", "open");
  const { games: settledRounds, loading: settledLoading, error: settledError } = useGames("jackpot", "settled");
  const round = games[0];
  const previousRound = settledRounds[0];
  const [amount, setAmount] = useState("0.50");
  const [submitting, setSubmitting] = useState(false);
  const [maxLoading,setMaxLoading]=useState(false);
  const [tick,setTick]=useState(()=>Math.floor(Date.now()/1000));
  const expiredRoundRef=useRef<string|null>(null);
  useEffect(() => { const timer = setInterval(() => setTick(Math.floor(Date.now()/1000)), 1_000); return () => clearInterval(timer); }, []);
  const chainNow=tick+clockOffsetSeconds;
  const seconds=round?.expires_at?Math.max(0,round.expires_at-chainNow):0;
  useEffect(()=>{if(!round||seconds>0){expiredRoundRef.current=null;return;}if(expiredRoundRef.current===round.address)return;expiredRoundRef.current=round.address;void refresh();},[refresh,round,seconds]);
  const pot = round ? sol(round.pot_lamports) : 0;
  const chance = connected && round ? jackpotChance(Number(amount), pot) : 0;
  const maximumEntry=useCallback(async()=>{if(!wallet.address||wallet.balance===null||!round||!config.fateProgramId)throw new Error("Connect a funded wallet while an on-chain round is open.");const connection=new Connection(config.solanaRpcUrl,"confirmed"),probe=enterJackpotTransaction({programId:config.fateProgramId,player:wallet.address,roundId:BigInt(round.numeric_id),amountLamports:1n});const latest=await connection.getLatestBlockhash("confirmed");probe.feePayer=new PublicKey(wallet.address);probe.recentBlockhash=latest.blockhash;const estimatedFee=BigInt((await connection.getFeeForMessage(probe.compileMessage(),"confirmed")).value??5_000),wagerConfig=await fetchFateWagerConfig({rpcUrl:config.solanaRpcUrl,programId:config.fateProgramId});let dailyRemaining:bigint|null=null,weeklyRemaining:bigint|null=null;const limitsResponse=await fetch("/api/compliance/responsible-play",{cache:"no-store"}).catch(()=>null);if(limitsResponse?.ok){const limits=await limitsResponse.json() as {dailyRemaining:number|null;weeklyRemaining:number|null};if(Number.isSafeInteger(limits.dailyRemaining)&&limits.dailyRemaining!==null)dailyRemaining=BigInt(limits.dailyRemaining);if(Number.isSafeInteger(limits.weeklyRemaining)&&limits.weeklyRemaining!==null)weeklyRemaining=BigInt(limits.weeklyRemaining);}const maximum=usableJackpotLamports({walletLamports:BigInt(Math.floor(wallet.balance*1_000_000_000)),estimatedFeeLamports:estimatedFee,safetyReserveLamports:1_000_000n,programMaxLamports:wagerConfig.maxWagerLamports,dailyRemainingLamports:dailyRemaining,weeklyRemainingLamports:weeklyRemaining});if(maximum<wagerConfig.minWagerLamports)throw new Error("Your spendable balance or remaining play limit is below the minimum wager.");return maximum;},[config.fateProgramId,config.solanaRpcUrl,round,wallet.address,wallet.balance]);
  const selectMaximum=async()=>{if(!connected)return onConnect();try{setMaxLoading(true);setAmount(formatLamportsInput(await maximumEntry()));}catch(cause){notify({title:"MAX unavailable",text:cause instanceof Error?cause.message:"The spendable balance could not be calculated."});}finally{setMaxLoading(false)}};
  const enter = async () => {
    if (!connected) return onConnect();
    if (!round) return notify({ title: "No open round", text: "Wait for a finalized jackpot round to appear in the indexer." });
    if(seconds<=0){void refresh();return notify({title:"Round expired",text:"This on-chain round is closed to new entries. Waiting for the next indexed round."});}
    if (!PROGRAM_CONFIGURED) return notify({ title: "Devnet setup required", text: "The audited program address has not been configured, so no funds were requested." });
    try {
      setSubmitting(true);
      const amountLamports=solToLamports(amount),spendable=await maximumEntry();if(amountLamports>spendable)throw new Error(`Entry exceeds the current spendable maximum of ${formatLamportsInput(spendable)} SOL.`);
      const transaction = enterJackpotTransaction({programId:requireFateProgramId(),player:wallet.address!,roundId:BigInt(round.numeric_id),amountLamports});
      const operationId=crypto.randomUUID();
      const signature = await wallet.sendTransaction(transaction,{operationId,gameType:"jackpot",action:"enter_jackpot",amountLamports}, status => notify({title:status === "awaiting_approval" ? "Approve in wallet" : `Transaction ${status}`,text:status === "finalized" ? "Your entry is finalized on Solana." : "Waiting for Solana confirmation…"}));
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
        <Stat icon={<Clock3 size={20} />} label="Drawing in" value={round?`${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`:"—"} />
      </div></div>
      <div className="jackpot-visual">{reduceMotion||!webglReady?<div className="vault-fallback"><SolIcon/><strong>{pot.toFixed(2)}</strong><span>SOL POT</span></div>:<Suspense fallback={<div className="canvas-loader"><span/></div>}><JackpotVault3D pot={pot} chance={chance} seconds={seconds} active={submitting||seconds<4}/></Suspense>}</div>
    </section>

    <section className="jackpot-grid">
      <div className="card pot-card">
        <div className="card-head"><div><span className="kicker">CURRENT POT</span><h2><SolIcon /> <AnimatedNumber value={pot}/> <small>SOL</small></h2></div><div className="chance-ring" style={{ "--chance": `${chance * 3.6}deg` } as React.CSSProperties}><div><strong>{chance.toFixed(1)}%</strong><span>YOUR CHANCE</span></div></div></div>
        <div className="pot-line"><span style={{width:"100%",background:"#c8ff4d"}} /></div>
        <div className="entry-label"><span>Your entry</span><span>Available: {connected && wallet.balance !== null ? wallet.balance.toFixed(3) : "—"} SOL</span></div>
        <div className="amount-input"><SolIcon /><input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-label="Jackpot entry amount in SOL"/><span aria-hidden="true">SOL</span><button type="button" disabled={maxLoading||!connected||wallet.balance===null||!round||seconds===0} onClick={()=>void selectMaximum()}>{maxLoading?<LoaderCircle className="spin" size={15}/>:"MAX"}</button></div>
        <div className="presets" role="group" aria-label="Jackpot amount presets">{["0.10", "0.25", "0.50", "1.00"].map(v => <button type="button" aria-pressed={amount === v} className={amount === v ? "selected" : ""} key={v} onClick={() => setAmount(v)}>{v}</button>)}</div>
        <button className="primary" disabled={submitting||(connected&&(!round||seconds===0))} aria-describedby="jackpot-action-hint" onClick={()=>void enter()}>{submitting ? <><LoaderCircle className="spin" size={18}/> Confirming on Solana…</> : connected ? <><Zap size={18} fill="currentColor" /> Enter jackpot · {amount || "0"} SOL</> : <><Wallet size={18} /> Connect wallet to enter</>}</button>
        <div className="fee-note" id="jackpot-action-hint"><ShieldCheck size={14} /> {!connected ? "Opens the wallet connection popup" : !round ? "No open round is currently indexed" : seconds===0?"This round has expired; waiting for the finalized index":"MAX reserves the estimated network fee and respects wager/play limits"}</div>
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
  const connected=wallet.connected; const config=getPublicConfig(); const {games:coinflipGames,loading,error,refresh}=useGames("coinflip");
  const flips=coinflipGames.filter(game=>game.state==="open"||game.state==="randomness_requested");
  const {games:settledFlips,loading:settledLoading,error:settledError,refresh:refreshSettled}=useGames("coinflip","settled");
  const latestFairnessProof=settledFlips.find(game=>game.randomness_hex)?.randomness_hex ?? null;
  const [side, setSide] = useState<CoinSide>("Heads");
  const [amount, setAmount] = useState("1.00");
  const webglReady = useHydrated();
  const reduceMotion = useReducedMotion();
  const [submitting,setSubmitting]=useState(false);
  const [busyFlip,setBusyFlip]=useState<string|null>(null);
  const [now,setNow]=useState(()=>Math.floor(Date.now()/1000));
  const [setupOpen,setSetupOpen]=useState(false);
  const setupDialogRef=useRef<HTMLDivElement>(null);
  const wagerInputRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{const timer=setInterval(()=>setNow(Math.floor(Date.now()/1000)),1_000);return()=>clearInterval(timer)},[]);
  const closeSetup=()=>{setSetupOpen(false);if(typeof history!=="undefined"&&location.hash==="#coinflip-setup"){location.hash="coinflip-closed";history.replaceState(null,"",location.pathname+location.search)}};
  useEffect(()=>{if(!setupOpen)return;const close=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!submitting)closeSetup()};document.addEventListener("keydown",close);window.setTimeout(()=>wagerInputRef.current?.focus(),80);return()=>document.removeEventListener("keydown",close)},[setupOpen,submitting]);
  const create = async()=>{if(!connected){setSetupOpen(false);return onConnect();}if(!PROGRAM_CONFIGURED)return notify({title:"Devnet setup required",text:"The program address is not configured."});try{setSubmitting(true);const bytes=crypto.getRandomValues(new Uint32Array(2));const gameId=(BigInt(bytes[0])<<32n)|BigInt(bytes[1]);const amountLamports=solToLamports(amount);const tx=createCoinflipTransaction({programId:process.env.NEXT_PUBLIC_FATE_PROGRAM_ID!,creator:wallet.address!,gameId,side,amountLamports,expiresAt:BigInt(Math.floor(Date.now()/1000)+300)});const signature=await wallet.sendTransaction(tx,{operationId:crypto.randomUUID(),gameType:"coinflip",action:"create_coinflip",amountLamports},status=>notify({title:status==="awaiting_approval"?"Approve flip":"Flip transaction "+status,text:"Waiting for finalized Solana state…"}));logEvent({eventType:"coinflip_created",category:"transaction",gameType:"coinflip",status:"success",walletAddress:wallet.address!,metadata:{signature,gameId:gameId.toString()}});await refresh();setSetupOpen(false);}catch(cause){notify({title:"Create failed",text:cause instanceof Error?cause.message:"Transaction failed."});}finally{setSubmitting(false)}};
  const acquireRandomness=async(gameAddress:string)=>{if(config.coinflipRandomnessEndpoint){const response=await fetch(config.coinflipRandomnessEndpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({gameType:"coinflip",gameAddress,walletAddress:wallet.address,network:config.solanaCluster})});if(!response.ok)throw new Error("The verifiable-randomness service could not prepare a fresh commitment.");const payload=await response.json() as {randomnessAccount?:string};if(!payload.randomnessAccount)throw new Error("The randomness service returned no account.");return payload.randomnessAccount;}if(config.coinflipRandomnessAccount)return config.coinflipRandomnessAccount;throw new Error("Coinflip randomness is not configured. Set NEXT_PUBLIC_COINFLIP_RANDOMNESS_ENDPOINT to a fresh committed Switchboard-account service.");};
  const runFlipAction=async(gameAddress:string,action:"join"|"settle"|"cancel"|"refund")=>{if(!connected||!wallet.address)return onConnect();if(!config.fateProgramId)return notify({title:"Coinflip unavailable",text:"The FATE program address is not configured."});try{setBusyFlip(gameAddress);const game=await fetchCoinflipGameAccount({rpcUrl:config.solanaRpcUrl,gameAddress});if(!game)throw new Error("The Coinflip account was not found on devnet.");let transaction;let operationAction:"join_coinflip"|"settle_coinflip"|"cancel_coinflip"|"refund_coinflip_timeout";let amountLamports=0n;if(action==="join"){if(game.state!=="open")throw new Error("This challenge is no longer open.");if(game.creator===wallet.address)throw new Error("The creator cannot join their own Coinflip.");const randomnessAccount=await acquireRandomness(gameAddress);transaction=joinCoinflipTransaction({programId:config.fateProgramId,joiner:wallet.address,gameId:game.id,randomnessAccount});operationAction="join_coinflip";amountLamports=game.amountLamports;}else if(action==="settle"){const settlement=await fetchCoinflipSettlementContext({rpcUrl:config.solanaRpcUrl,programId:config.fateProgramId,gameAddress});transaction=settleCoinflipTransaction({programId:config.fateProgramId,gameId:game.id,randomnessAccount:settlement.game.randomnessAccount!,winner:settlement.winner,treasury:settlement.treasury});operationAction="settle_coinflip";}else if(action==="cancel"){if(game.creator!==wallet.address)throw new Error("Only the creator can cancel this expired challenge.");if(game.state!=="open"||now<game.expiresAt)throw new Error("This challenge is not eligible for cancellation yet.");transaction=cancelCoinflipTransaction({programId:config.fateProgramId,creator:wallet.address,gameId:game.id});operationAction="cancel_coinflip";}else{if(game.state!=="randomness_requested"||!game.joiner)throw new Error("This Coinflip is not awaiting randomness.");if(now<game.randomnessRequestedAt+COINFLIP_RANDOMNESS_TIMEOUT_SECONDS)throw new Error("The oracle timeout has not elapsed yet.");transaction=refundCoinflipTimeoutTransaction({programId:config.fateProgramId,gameId:game.id,creator:game.creator,joiner:game.joiner});operationAction="refund_coinflip_timeout";}const signature=await wallet.sendTransaction(transaction,{operationId:crypto.randomUUID(),gameType:"coinflip",action:operationAction,amountLamports},status=>notify({title:status==="awaiting_approval"?"Approve Coinflip action":`Coinflip ${status}`,text:"Waiting for finalized Solana state…"}));logEvent({eventType:`coinflip_${action}`,category:"transaction",gameType:"coinflip",status:"success",walletAddress:wallet.address,metadata:{signature,gameAddress}});await Promise.all([refresh(),refreshSettled()]);notify({title:action==="join"?"Challenge joined":action==="settle"?"Coinflip settled":action==="cancel"?"Challenge refunded":"Timeout refund finalized",text:action==="join"?"The wager is escrowed and the oracle reveal can now be settled.":"The finalized on-chain state is now reflected in the game feed."});}catch(cause){notify({title:`Coinflip ${action} failed`,text:cause instanceof Error?cause.message:"The transaction could not be completed."});}finally{setBusyFlip(null)}};
  return <motion.main id="main-content" tabIndex={-1} key="coinflip" className="page subpage" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
    <div className="page-heading"><div><div className="eyebrow"><Swords size={14}/> PLAYER VS PLAYER</div><h1>Call it.<br/><em>Double it.</em></h1><p>Pick a side, set the stakes, and challenge another player. One flip. Winner takes all.</p><a href="#coinflip-setup" className="coinflip-launch" onClick={()=>setSetupOpen(true)}><Sparkles size={17}/> Create a coinflip</a></div><div className="big-coin">{reduceMotion||!webglReady?<div className={side === "Heads" ? "coin-face heads" : "coin-face tails"}><Mark small /></div>:<Suspense fallback={<div className="canvas-loader"><span/></div>}><GameCoin3D side={side} active={submitting}/></Suspense>}<span className="orbit one"/><span className="orbit two"/></div></div>
    <div className="coin-grid coin-grid-single">
      <div className="card active-flips">
        <div className="card-title"><div><Flame size={18}/><strong>Active challenges</strong></div><span className="demo-state">{loading ? "SYNCING" : error ? "FEED OFFLINE" : flips.length ? `${flips.length} ACTIVE` : "NO OPEN FLIPS"}</span></div>
        {flips.map((f,i)=><motion.div className="flip-row" key={f.address} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:i*.08}}>
          <div className="mini-coin">F</div><div><strong>{short(f.creator)}</strong><span>#{f.numeric_id} · {f.state==="randomness_requested"?"oracle requested":`slot ${f.last_slot}`}</span></div><b><SolIcon/> {sol(f.wager_lamports).toFixed(2)}</b>
          {f.state==="randomness_requested"?<div className="flip-actions"><button type="button" disabled={busyFlip===f.address} onClick={()=>void runFlipAction(f.address,"settle")}>{busyFlip===f.address?<LoaderCircle className="spin" size={15}/>:<Check size={15}/>} Settle</button><button type="button" disabled={busyFlip===f.address} title="Available after the 10-minute oracle timeout" onClick={()=>void runFlipAction(f.address,"refund")}>Refund timeout</button></div>:wallet.address===f.creator?<button type="button" disabled={busyFlip===f.address||Boolean(f.expires_at&&now<f.expires_at)} title={f.expires_at&&now<f.expires_at?`Cancellation unlocks in ${Math.max(0,f.expires_at-now)} seconds`:"Refund the expired unjoined challenge"} onClick={()=>void runFlipAction(f.address,"cancel")}>{f.expires_at&&now<f.expires_at?`Expires in ${Math.max(0,f.expires_at-now)}s`:"Cancel & refund"}</button>:<button type="button" disabled={busyFlip===f.address} onClick={()=>void runFlipAction(f.address,"join")}>{busyFlip===f.address?<LoaderCircle className="spin" size={15}/>:<Swords size={15}/>} {connected?"Join flip":"Connect to join"}</button>}
        </motion.div>)}
        {!flips.length&&!loading&&<div className="flip-empty"><div className="mini-coin" aria-hidden="true">F</div><strong>{error ? "Challenge feed unavailable" : "No open coinflips yet"}</strong><span>{error ?? "Create the first challenge and wait for another player to join."}</span>{error?<button type="button" onClick={()=>void refresh()}>Try again</button>:<a href="#coinflip-setup" onClick={()=>setSetupOpen(true)}>Set up a coinflip</a>}</div>}
        <div className="active-footer"><ShieldCheck size={15}/> Join, settle, cancel, and timeout refunds execute on-chain</div>
      </div>
    </div>
    <div id="coinflip-setup" className={`modal-backdrop coinflip-modal-backdrop${setupOpen?" is-open":""}`} role="presentation"><a className="coinflip-modal-dismiss" href="#" aria-label="Close coinflip setup" onClick={closeSetup}/><div ref={setupDialogRef} className="wallet-modal coinflip-modal" role="dialog" aria-modal="true" aria-labelledby="coinflip-setup-title"><div className="modal-head"><div><span>1V1 · SOLANA DEVNET</span><h2 id="coinflip-setup-title">Set up a coinflip</h2></div><a href="#" className="coinflip-modal-close" aria-label="Close coinflip setup" onClick={closeSetup}><X size={20}/></a></div><p>Choose your side and wager. Your wallet will show the complete transaction before anything is submitted.</p><span className="field-label" id="modal-coin-side-label">Choose your side</span><div className="side-picker" role="group" aria-labelledby="modal-coin-side-label"><button type="button" aria-pressed={side === "Heads"} className={side === "Heads" ? "active" : ""} onClick={() => setSide("Heads")}><div className="mini-coin">F</div><strong>Heads</strong><span>Violet side</span></button><button type="button" aria-pressed={side === "Tails"} className={side === "Tails" ? "active tails" : ""} onClick={() => setSide("Tails")}><div className="mini-coin lime">◎</div><strong>Tails</strong><span>Lime side</span></button></div><label className="field-label" htmlFor="coin-wager">Wager amount</label><div className="amount-input"><SolIcon/><input ref={wagerInputRef} id="coin-wager" aria-describedby="coin-wager-unit" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}/><span id="coin-wager-unit">SOL</span></div><div className="presets" role="group" aria-label="Coinflip wager presets">{["0.25","0.50","1.00","2.50"].map(v=><button type="button" key={v} aria-pressed={amount===v} className={amount===v?"selected":""} onClick={()=>setAmount(v)}>{v}</button>)}</div><div className="coinflip-summary"><span>Side <strong>{side}</strong></span><span>Wager <strong>{amount||"0"} SOL</strong></span><span>Timeout <strong>5 minutes</strong></span></div><button className="primary" disabled={submitting} onClick={()=>void create()}>{submitting?<><LoaderCircle className="spin" size={18}/> Awaiting wallet approval…</>:connected ? <><Swords size={18}/> Confirm {side.toLowerCase()} · {amount||"0"} SOL</> : <><Wallet size={18}/> Connect wallet to continue</>}</button><div className="modal-network"><i/> Solana Devnet <span>No real-value wagers</span></div></div></div>
    <section className="bottom-grid"><Fairness hash={latestFairnessProof}/><div className="card recent-results"><div className="card-title"><div><History size={18}/><strong>Recent flips</strong></div><span>{settledLoading ? "SYNCING" : settledError ? "FEED OFFLINE" : settledFlips.length ? `${settledFlips.length} FINALIZED` : "NO RESULTS"}</span></div>{settledFlips.map(flip=><div className="result-row" key={flip.address}><span className="win-tag">✓</span><strong>{short(flip.creator ?? flip.address)}</strong><span>winner</span><strong>{flip.winner ? short(flip.winner) : "Not recorded"}</strong><b>{sol(flip.payout_lamports).toFixed(2)} SOL</b></div>)}{!settledFlips.length&&!settledLoading&&<div className="recent-empty"><History size={22}/><strong>{settledError ? "Finalized flip feed unavailable" : "No finalized flips indexed"}</strong><span>{settledError ?? "Settled on-chain coinflips will appear here after finalization."}</span>{settledError&&<button type="button" onClick={()=>void refreshSettled()}>Try again</button>}</div>}{settledLoading&&<div className="recent-empty" aria-live="polite"><LoaderCircle className="spin" size={22}/><strong>Loading finalized flips</strong><span>Checking the finalized Solana index.</span></div>}</div></section>
  </motion.main>;
}

function DailyCase({ wallet, onConnect, notify }: { wallet: WalletClient; onConnect: () => void; notify: (t: Toast) => void }) {
  const connected=wallet.connected; const config=getPublicConfig();
  const [phase,setPhase] = useState<"idle"|"loading"|"opening"|"settling"|"canceling">("idle");
  const [daily,setDaily] = useState<DailyPlayerAccount|null>(null);
  const [chainError,setChainError] = useState<string|null>(null);
  const [now,setNow] = useState(()=>Math.floor(Date.now()/1000));
  const {games:recentOpens,loading:opensLoading,error:opensError,refresh:refreshOpens}=useGames("daily","settled",wallet.address,connected);
  const latestFairnessProof=daily?.randomnessHex ?? recentOpens.find(game=>game.randomness_hex)?.randomness_hex ?? null;
  const webglReady = useHydrated();
  const reduceMotion = useReducedMotion();
  const refreshDaily=useCallback(async()=>{if(!connected||!wallet.address||!config.fateProgramId){setDaily(null);return null;}try{const next=await fetchDailyPlayerAccount({rpcUrl:config.solanaRpcUrl,programId:config.fateProgramId,player:wallet.address});setDaily(next);setChainError(null);return next;}catch(cause){const message=cause instanceof Error?cause.message:"Could not read Daily Case state.";setChainError(message);return null;}},[config.fateProgramId,config.solanaRpcUrl,connected,wallet.address]);
  useEffect(()=>{if(!connected){const reset=window.setTimeout(()=>{setDaily(null);setChainError(null);},0);return()=>window.clearTimeout(reset);}const initial=window.setTimeout(()=>{setPhase("loading");void refreshDaily().finally(()=>setPhase("idle"));},0);const poll=window.setInterval(()=>void refreshDaily(),5000);return()=>{window.clearTimeout(initial);window.clearInterval(poll);};},[connected,refreshDaily]);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Math.floor(Date.now()/1000)),1000);return()=>window.clearInterval(timer);},[]);
  const pending=daily?.state==="randomness_requested";
  const timeoutAt=pending?(daily.randomnessRequestedAt+DAILY_RANDOMNESS_TIMEOUT_SECONDS):0;
  const eligibleAt=daily?.lastOpenedAt?daily.lastOpenedAt+DAILY_COOLDOWN_SECONDS:0;
  const cooling=eligibleAt>now;
  const opened=Boolean(daily?.rewardLamports&&cooling);
  const opening=phase==="opening"||phase==="settling";
  const remaining=Math.max(0,eligibleAt-now);
  const cooldownText=cooling?`${String(Math.floor(remaining/3600)).padStart(2,"0")}:${String(Math.floor((remaining%3600)/60)).padStart(2,"0")}:${String(remaining%60).padStart(2,"0")}`:"READY NOW";
  const rewardSol=Number(daily?.rewardLamports??0n)/1_000_000_000;
  const acquireRandomness=async()=>{if(config.dailyRandomnessEndpoint){const response=await fetch(config.dailyRandomnessEndpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({gameType:"daily",walletAddress:wallet.address,network:config.solanaCluster})});if(!response.ok)throw new Error("The verifiable-randomness service could not prepare a fresh request.");const payload=await response.json() as {randomnessAccount?:string};if(!payload.randomnessAccount)throw new Error("The randomness service returned no account.");return payload.randomnessAccount;}if(config.dailyRandomnessAccount)return config.dailyRandomnessAccount;throw new Error("Daily Case randomness is not configured. Set NEXT_PUBLIC_DAILY_RANDOMNESS_ENDPOINT to a service that leases fresh committed Switchboard accounts.");};
  const open=async()=>{if(!connected||!wallet.address)return onConnect();if(!config.fateProgramId)return notify({title:"Daily Case unavailable",text:"The FATE program address is not configured."});if(cooling)return;try{setPhase("opening");const randomnessAccount=await acquireRandomness();const transaction=openDailyCaseTransaction({programId:config.fateProgramId,player:wallet.address,randomnessAccount,initializePlayer:!daily});await wallet.sendTransaction(transaction,{operationId:crypto.randomUUID(),gameType:"daily",action:"open_daily",amountLamports:0n});await refreshDaily();notify({title:"Randomness requested",text:"The on-chain request is finalized. Settle after the oracle reveals the result."});}catch(cause){notify({title:"Daily Case request failed",text:cause instanceof Error?cause.message:"The wallet request could not be completed."});}finally{setPhase("idle");}};
  const settle=async()=>{if(!wallet.address||!config.fateProgramId||!daily?.randomnessAccount)return;try{setPhase("settling");const transaction=settleDailyCaseTransaction({programId:config.fateProgramId,player:wallet.address,randomnessAccount:daily.randomnessAccount});await wallet.sendTransaction(transaction,{operationId:crypto.randomUUID(),gameType:"daily",action:"settle_daily",amountLamports:0n});const next=await refreshDaily();await refreshOpens();notify({title:"Daily reward credited",text:`${(Number(next?.rewardLamports??0n)/1_000_000_000).toFixed(2)} SOL was paid by the on-chain vault.`});}catch(cause){notify({title:"Reward is not ready",text:cause instanceof Error?cause.message:"The oracle has not revealed the request yet. Retry shortly."});}finally{setPhase("idle");}};
  const cancel=async()=>{if(!wallet.address||!config.fateProgramId)return;try{setPhase("canceling");await wallet.sendTransaction(cancelDailyTimeoutTransaction({programId:config.fateProgramId,player:wallet.address}),{operationId:crypto.randomUUID(),gameType:"daily",action:"cancel_daily_timeout",amountLamports:0n});await refreshDaily();notify({title:"Timed-out request released",text:"The Daily Case is ready for a new verifiable-randomness request."});}catch(cause){notify({title:"Could not release request",text:cause instanceof Error?cause.message:"Retry after the timeout is finalized on-chain."});}finally{setPhase("idle");}};
  const action=()=>{if(!connected)return onConnect();if(pending)return now>=timeoutAt?void cancel():void settle();return void open();};
  const buttonText=!connected?"Connect wallet to open":phase==="loading"?"Checking on-chain state…":phase==="opening"?"Confirm request in wallet…":phase==="settling"?"Confirm reward settlement…":phase==="canceling"?"Releasing timed-out request…":pending?(now>=timeoutAt?"Release timed-out request":"Settle revealed reward"):cooling?"Come back tomorrow":"Open free case";
  return <motion.main key="daily" className="page subpage" initial={{opacity:0}} animate={{opacity:1}}><div className="case-layout"><section className="case-copy"><div className="eyebrow"><Gift size={14}/> ONE FREE OPEN EVERY 24H</div><h1>Your daily<br/><em>shot at SOL.</em></h1><p>Open your free case. Your reward is generated on-chain and lands directly in your connected wallet.</p><div className="cooldown"><Clock3 size={18}/><div><span>{pending?"RANDOMNESS REQUEST":"NEXT FREE OPEN"}</span><strong>{pending?(now>=timeoutAt?"TIMED OUT":"AWAITING REVEAL"):cooldownText}</strong></div></div><div className="reward-list"><span>Possible rewards</span>{[0.01,0.05,0.10,0.25,1.00].map(v=><b key={v}><SolIcon/> {v.toFixed(2)}</b>)}</div></section><section className="case-stage"><div className={`case-box ${opening?"opening":""} ${opened?"opened":""}`}>{reduceMotion||!webglReady?<><div className="case-glow"/><div className="case-lid"><span>FATE</span></div><div className="case-body"><Gift size={56}/><span>DAILY</span></div></>:<Suspense fallback={<div className="canvas-loader"><span/></div>}><DailyCase3D opening={opening} opened={opened}/></Suspense>}{opened&&<motion.div className="reward-pop" initial={{scale:.4,opacity:0,y:14}} animate={{scale:1,opacity:1,y:0}} transition={{type:"spring",stiffness:180,damping:15}}><small>LAST REWARD</small><strong><SolIcon/> <AnimatedNumber value={rewardSol}/> SOL</strong><span>Credited on-chain</span></motion.div>}</div><button className="primary case-button" disabled={phase!=="idle"||cooling} onClick={action}>{phase!=="idle"?<LoaderCircle className="spin" size={18}/>:pending?<RefreshCw size={18}/>:cooling?<Check size={18}/>:connected?<Gift size={18}/>:<Wallet size={18}/>} {buttonText}</button><p className="case-note"><ShieldCheck size={14}/> {chainError?`On-chain state unavailable: ${chainError}`:pending?"Settlement pays only after the committed oracle value is revealed":"No deposit required · Provably fair"}</p></section></div><section className="bottom-grid"><Fairness hash={latestFairnessProof}/><div className="card recent-results"><div className="card-title"><div><Clock3 size={18}/><strong>Your recent opens</strong></div><span>{!connected ? "WALLET REQUIRED" : opensLoading ? "SYNCING" : opensError ? "FEED OFFLINE" : recentOpens.length ? `${recentOpens.length} FINALIZED` : "NO OPENS"}</span></div>{recentOpens.map(game=><div className="claim-row" key={game.address}><div className="mini-case"><Gift size={16}/></div><strong>{game.settled_at ? new Date(game.settled_at*1000).toLocaleDateString(undefined,{month:"short",day:"numeric"}) : `Slot ${game.last_slot}`}</strong><span>Daily case #{game.numeric_id}</span><b>+{sol(game.payout_lamports).toFixed(2)} SOL</b></div>)}{!connected?<div className="recent-empty"><Wallet size={22}/><strong>Connect wallet to view your opens</strong><span>Only finalized Daily Case rewards associated with your wallet are shown.</span><button type="button" onClick={onConnect}>Connect wallet</button></div>:opensLoading?<div className="recent-empty" aria-live="polite"><LoaderCircle className="spin" size={22}/><strong>Loading your recent opens</strong><span>Checking finalized Daily Case records.</span></div>:!recentOpens.length?<div className="recent-empty"><Gift size={22}/><strong>{opensError ? "Recent opens unavailable" : "No Daily Case opens indexed"}</strong><span>{opensError ?? "Your finalized Daily Case rewards will appear here."}</span>{opensError&&<button type="button" onClick={()=>void refreshOpens()}>Try again</button>}</div>:null}</div></section></motion.main>;
}

function HistoryPage({wallet,onConnect}:{wallet:WalletClient;onConnect:()=>void}) {
  const connected=wallet.connected;
  const {games,loading,error,refresh}=useGames(undefined,"settled",wallet.address,connected);
  const [filter,setFilter]=useState("All games");
  const historyRows=useMemo(()=>games.map(game=>{const name=game.game_type==="jackpot"?"Jackpot":game.game_type==="coinflip"?"Coinflip":"Daily Case";const win=Boolean(wallet.address&&game.winner===wallet.address);return{game:name,id:`#${game.numeric_id}`,result:win?"Won":"Settled",amount:`${win?"+":""}${sol(win?game.payout_lamports:game.wager_lamports).toFixed(2)}`,date:game.settled_at?new Date(game.settled_at*1000).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):`Slot ${game.last_slot}`,win,signature:game.last_signature};}),[games,wallet.address]);
  const shown=useMemo(()=>historyRows.filter(r=>filter==="All games"||r.game===filter),[filter,historyRows]);
  const commitment=!connected?"Wallet required":loading?"Syncing":error?"Unavailable":historyRows.length?"Finalized":"Waiting";
  const summaryValue=(value:number)=>connected&&!loading&&!error?String(value):"—";
  return <motion.main key="history" className="page subpage" initial={{opacity:0}} animate={{opacity:1}}><div className="history-head"><div><div className="eyebrow"><History size={14}/> FINALIZED ON-CHAIN ACTIVITY</div><h1>Your game<br/><em>history.</em></h1></div></div><div className="history-summary"><Stat icon={<Swords size={20}/>} label="Indexed games" value={summaryValue(historyRows.length)} accent/><Stat icon={<Trophy size={20}/>} label="Wins" value={summaryValue(historyRows.filter(r=>r.win).length)}/><Stat icon={<ShieldCheck size={20}/>} label="Commitment" value={commitment}/></div><section className="card history-table"><div className="history-toolbar"><div><strong>Recent activity</strong><span>{connected?"Finalized transactions from your connected wallet":"Connect your wallet to load finalized activity"}</span></div><div className="filters">{["All games","Jackpot","Coinflip","Daily Case"].map(f=><button key={f} disabled={!historyRows.length||loading||Boolean(error)} className={filter===f?"active":""} onClick={()=>setFilter(f)}>{f}</button>)}</div></div>{shown.length>0&&<div className="table-head"><span>GAME</span><span>RESULT</span><span>AMOUNT</span><span>DATE</span><span/></div>}{shown.map((r,i)=><motion.div className="table-row" key={r.game+r.id} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} transition={{delay:i*.04}}><div><div className={`game-icon ${r.game.includes("Daily")?"daily":r.game.toLowerCase()}`}>{r.game==="Jackpot"?<Crown size={17}/>:r.game==="Coinflip"?<Swords size={17}/>:<Gift size={17}/>}</div><p><strong>{r.game}</strong><span>{r.id}</span></p></div><span className={r.win?"status win":"status loss"}>{r.result}</span><b className={r.win?"amount-win":""}>{r.amount} SOL</b><span>{r.date}</span>{r.signature?<a aria-label="View transaction" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/tx/${r.signature}?cluster=devnet`}><ArrowUpRight size={16}/></a>:<span aria-label="Transaction unavailable">—</span>}</motion.div>)}{!connected?<div className="history-empty"><Wallet size={24}/><strong>Connect wallet to view your history</strong><span>FATE only displays finalized games associated with your wallet.</span><button type="button" onClick={onConnect}>Connect wallet</button></div>:loading?<div className="history-empty" aria-live="polite"><LoaderCircle className="spin" size={24}/><strong>Loading finalized activity</strong><span>Checking the finalized Solana index.</span></div>:error?<div className="history-empty"><ShieldAlert size={24}/><strong>History is temporarily unavailable</strong><span>{error}</span><button type="button" onClick={()=>void refresh()}>Try again</button></div>:!historyRows.length?<div className="history-empty"><History size={24}/><strong>No finalized games yet</strong><span>Your settled Jackpot, Coinflip, and Daily Case activity will appear here.</span></div>:!shown.length?<div className="history-empty"><Search size={24}/><strong>No {filter} activity</strong><span>Choose another filter to view your finalized games.</span></div>:null}</section></motion.main>;
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
  return <div className={`app-shell game-${view}`}>{hydrated&&!reduceMotion&&<Suspense fallback={null}><SpatialBackground3D accent={accent}/></Suspense>}<div className="noise"/><div className="ambient a1"/><div className="ambient a2"/><Header view={view} setView={setView} connected={connected} connecting={wallet.connecting||wallet.recovering} address={wallet.address} balance={wallet.balance} connect={connect} sound={sound} toggleSound={toggleSound}/><div className="environment-banner"><span><i/> SOLANA DEVNET</span><p>{wallet.recovering?"Recovering wallet session…":activeOperation?`Transaction recovery · ${activeOperation.status.replaceAll("_"," ")}${activeOperation.signature?` · ${activeOperation.signature.slice(0,8)}…`:""}`:connected&&wallet.authenticated?"Wallet authenticated · Compliance-gated · No mainnet wagers":"Wallet-approved transactions · No mainnet wagers"}</p></div><AnimatePresence mode="wait">{view==="jackpot"?<Jackpot wallet={wallet} onConnect={connect} notify={notify}/>:view==="coinflip"?<Coinflip wallet={wallet} onConnect={connect} notify={notify}/>:view==="daily"?<DailyCase wallet={wallet} onConnect={connect} notify={notify}/>:<HistoryPage wallet={wallet} onConnect={connect}/>}</AnimatePresence><footer><div className="brand"><Mark small/><span>FATE</span></div><p>Provably fair games. Built on Solana.</p><div><a href="/verify">Fairness</a><a href="/legal#terms">Terms</a><a href="/legal#privacy">Privacy</a><a href="/legal#responsible-play">Responsible play</a><button className="footer-compliance" onClick={()=>document.querySelector<HTMLButtonElement>(".compliance-launcher")?.click()}>Safety &amp; privacy</button><span className="network"><i/> {wallet.cluster === "mainnet-beta" ? "Mainnet" : "Devnet"}</span></div></footer><FateCopilot walletAddress={wallet.address}/><Suspense fallback={null}><LazyComplianceCenter authenticated={wallet.authenticated} walletAddress={wallet.address}/></Suspense><WalletModal open={walletPicker} wallets={wallet.wallets} connecting={wallet.connecting} error={wallet.error} selected={connectingWallet} close={()=>!wallet.connecting&&setWalletPicker(false)} select={selectWallet} detect={wallet.refreshWallets} demo={continueDemo}/><ToastView toast={toast} close={()=>setToast(null)}/></div>;
}
