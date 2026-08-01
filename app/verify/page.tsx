"use client";

import { CheckCircle2, ExternalLink, Search, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { FairnessResult, GameKind, verifyGameFairness } from "../../lib/fairness";
import "./verify.css";

const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const programId = process.env.NEXT_PUBLIC_FATE_PROGRAM_ID || "";
const providerProgramId = process.env.NEXT_PUBLIC_SWITCHBOARD_PROGRAM_ID || "";
const providerQueue = process.env.NEXT_PUBLIC_SWITCHBOARD_QUEUE || "";

export default function VerifyPage() {
  const [address, setAddress] = useState("");
  const [kind, setKind] = useState<GameKind>("jackpot");
  const [result, setResult] = useState<FairnessResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const explorer = (value: string, type: "address" | "tx" = "address") => `https://explorer.solana.com/${type}/${value}?cluster=devnet`;
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setResult(null);
    try {
      if (!programId || !providerProgramId || !providerQueue) throw new Error("Public program and Switchboard configuration is incomplete.");
      setResult(await verifyGameFairness({ rpcUrl, programId, providerProgramId, providerQueue, gameAddress: address.trim(), gameKind: kind }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Verification failed."); }
    finally { setLoading(false); }
  }
  return <main className="verify-page">
    <Link className="verify-brand" href="/"><span>F</span> FATE</Link>
    <section className="verify-hero"><div className="verify-icon"><ShieldCheck/></div><p>OPEN-SOURCE ON-CHAIN VERIFIER</p><h1>Don’t trust us.<br/><em>Verify the outcome.</em></h1><span>This page reads game and randomness accounts directly from Solana RPC, reproduces the published formula locally, and never queries the FATE API.</span></section>
    <form className="verify-form" onSubmit={submit}>
      <label>Game account address</label><div className="verify-input"><Search/><input required value={address} onChange={event => setAddress(event.target.value)} placeholder="Paste a Jackpot, Coinflip, or Daily Case account"/></div>
      <div className="verify-kinds">{(["jackpot","coinflip","daily"] as GameKind[]).map(value => <button type="button" className={kind===value?"active":""} onClick={()=>setKind(value)} key={value}>{value === "daily" ? "Daily Case" : value}</button>)}</div>
      <button className="verify-submit" disabled={loading}>{loading ? "Reading Solana…" : "Verify fairness"}</button>
    </form>
    {error && <div className="verify-error"><XCircle/>{error}</div>}
    {result && <section className={`verify-result ${result.verified?"passed":"failed"}`}><header>{result.verified?<CheckCircle2/>:<XCircle/>}<div><small>VERIFICATION RESULT</small><h2>{result.verified?"Outcome independently verified":"Verification failed"}</h2></div></header><div className="verify-checks">{result.checks.map(check=><div key={check.label}>{check.ok?<CheckCircle2/>:<XCircle/>}<span><strong>{check.label}</strong><code>{check.detail}</code></span></div>)}</div><dl><div><dt>Randomness account</dt><dd><a href={explorer(result.randomnessAccount!)} target="_blank">{result.randomnessAccount}<ExternalLink/></a></dd></div><div><dt>Seed → reveal slot</dt><dd>{result.seedSlot} → {result.revealSlot}</dd></div><div><dt>Reproduced result</dt><dd>{result.expectedOutcome}</dd></div><div><dt>Stored result</dt><dd>{result.recordedOutcome}</dd></div><div><dt>Raw randomness</dt><dd><code>{result.randomnessHex}</code></dd></div></dl>{result.gameSignature&&<a className="verify-explorer" href={explorer(result.gameSignature,"tx")} target="_blank">Inspect settlement transaction <ExternalLink/></a>}</section>}
    <footer>Verification executes locally in your browser · Source formula matches the deployed Anchor program</footer>
  </main>;
}
