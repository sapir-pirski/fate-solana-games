"use client";

import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from "@wallet-standard/features";
import { SolanaSignAndSendTransaction, SolanaSignMessage, type SolanaSignAndSendTransactionFeature, type SolanaSignMessageFeature } from "@solana/wallet-standard-features";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const CHAIN = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta" ? "solana:mainnet" : "solana:devnet";
const LAMPORTS_PER_SOL = 1_000_000_000;

export type TransactionState = "draft"|"awaiting_signature"|"submitted"|"confirmed"|"finalized"|"rejected"|"failed"|"expired"|"unknown";
type OperationInput={operationId:string;gameType:"jackpot"|"coinflip"|"daily";action:"enter_jackpot"|"create_coinflip"|"join_coinflip"|"open_daily";amountLamports:number};
type CompatibleWallet = Wallet & StandardConnectFeature & SolanaSignAndSendTransactionFeature & SolanaSignMessageFeature & Partial<StandardDisconnectFeature & StandardEventsFeature>;

function isCompatible(wallet: Wallet): wallet is CompatibleWallet {
  return CHAIN === "solana:devnet" || wallet.chains.includes(CHAIN as `${string}:${string}`)
    ? StandardConnect in wallet.features && SolanaSignAndSendTransaction in wallet.features && SolanaSignMessage in wallet.features
    : false;
}

export function useSolanaWallet() {
  const [availableWallets, setAvailableWallets] = useState<CompatibleWallet[]>([]);
  const [wallet, setWallet] = useState<CompatibleWallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authenticated,setAuthenticated]=useState(false);
  const [recovering,setRecovering]=useState(true);
  const [operations,setOperations]=useState<Array<{operationId:string;status:TransactionState;signature?:string|null}>>([]);
  const rpcUrl = useMemo(() => RPC_URL, []);
  const refreshWallets = useCallback(() => setAvailableWallets(getWallets().get().filter(isCompatible)), []);

  const refreshBalance = useCallback(async (nextAccount = account) => {
    if (!nextAccount) return setBalance(null);
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "getBalance", params: [nextAccount.address, { commitment: "confirmed" }] }),
      });
      if (!response.ok) throw new Error("RPC balance request failed.");
      const payload = await response.json() as { result?: { value?: number }; error?: unknown };
      const lamports = payload.result?.value;
      if (!Number.isSafeInteger(lamports)) throw new Error("RPC returned an invalid balance.");
      setBalance(lamports / LAMPORTS_PER_SOL);
    } catch {
      setBalance(null);
    }
  }, [account, rpcUrl]);

  useEffect(() => {
    const registry = getWallets();
    const update = refreshWallets;
    const initial = window.setTimeout(update, 0);
    const offRegister = registry.on("register", update);
    const offUnregister = registry.on("unregister", update);
    return () => { window.clearTimeout(initial); offRegister(); offUnregister(); };
  }, [refreshWallets]);

  const updateOperation=useCallback(async(operationId:string,status:TransactionState,extra:Record<string,unknown>={})=>{setOperations(items=>{const current=items.find(item=>item.operationId===operationId);return current?items.map(item=>item.operationId===operationId?{...item,status,...extra}:item):[...items,{operationId,status,...extra}]});try{await fetch("/api/transactions",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({operationId,status,...extra})});}catch{/* local recovery remains available */}},[]);

  const authenticate=useCallback(async(selected:CompatibleWallet,nextAccount:WalletAccount)=>{const challengeResponse=await fetch("/api/auth/challenge",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({walletAddress:nextAccount.address})});if(!challengeResponse.ok)throw new Error("Could not create wallet authentication challenge.");const challenge=await challengeResponse.json() as {challengeId:string;message:string};const [signed]=await selected.features[SolanaSignMessage].signMessage({account:nextAccount,message:new TextEncoder().encode(challenge.message)});if(!signed)throw new Error("Wallet did not sign the authentication message.");const verify=await fetch("/api/auth/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({challengeId:challenge.challengeId,walletAddress:nextAccount.address,signature:base58(signed.signature)})});if(!verify.ok)throw new Error("Wallet authentication signature was rejected.");setAuthenticated(true);localStorage.setItem("fate_wallet_name",selected.name);},[]);

  const connect = useCallback(async (walletName?: string) => {
    setConnecting(true);
    setError(null);
    try {
      const wallets = getWallets().get().filter(isCompatible);
      if (!wallets.length) throw new Error("No compatible Solana wallet was found. Install Phantom, Backpack, or Solflare.");
      const selected = wallets.find(candidate => candidate.name === walletName) ?? wallets.find(candidate => /phantom/i.test(candidate.name)) ?? wallets[0];
      const output = await Promise.race([
        selected.features[StandardConnect].connect(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Wallet connection timed out. Unlock the wallet and try again.")), 30_000)),
      ]);
      const nextAccount = output.accounts.find(item => item.chains.includes(CHAIN as `${string}:${string}`)) ?? output.accounts[0];
      if (!nextAccount) throw new Error("The wallet did not authorize a Solana account.");
      setWallet(selected);
      setAccount(nextAccount);
      await authenticate(selected,nextAccount);
      await refreshBalance(nextAccount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed.");
      throw cause;
    } finally {
      setConnecting(false);
    }
  }, [authenticate,refreshBalance]);

  const disconnect = useCallback(async () => {
    try {
      await fetch("/api/auth/session",{method:"DELETE"}).catch(()=>undefined);
      if (wallet && StandardDisconnect in wallet.features) await wallet.features[StandardDisconnect].disconnect();
    } finally {
      setWallet(null);
      setAccount(null);
      setBalance(null);
      setAuthenticated(false); localStorage.removeItem("fate_wallet_name");
    }
  }, [wallet]);

  const sendTransaction = useCallback(async (transaction: Transaction, operation:OperationInput, onStatus?: (status: "awaiting_approval" | "submitted" | "confirmed" | "finalized") => void) => {
    if (!wallet || !account || !authenticated) throw new Error("Connect and authenticate a compatible Solana wallet first.");
    const create=await fetch("/api/transactions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(operation)});if(!create.ok){const failure=await create.json().catch(()=>({})) as {code?:string};const messages:Record<string,string>={AGE_ATTESTATION_REQUIRED:"Complete the Safety & privacy eligibility check first.",CONSENT_RENEWAL_REQUIRED:"Review and renew the current policies first.",JURISDICTION_BLOCKED:"This service is unavailable in your declared jurisdiction.",COMPLIANCE_REVIEW_REQUIRED:"Eligibility requires review before playing.",SELF_EXCLUDED:"Self-exclusion is active for this wallet.",COOLDOWN_ACTIVE:"A cooling-off period is active for this wallet.",DAILY_LIMIT_EXCEEDED:"Your daily play limit would be exceeded.",WEEKLY_LIMIT_EXCEEDED:"Your weekly play limit would be exceeded.",MAINNET_DISABLED_PENDING_LICENSE:"Mainnet is disabled pending licensing."};throw new Error(messages[failure.code??""]??"Could not create an idempotent transaction operation.");}
    const rpcUrls=[rpcUrl,...(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS??"").split(",")].filter((value,index,all)=>value&&all.indexOf(value)===index);
    const connection = new Connection(rpcUrls[0], "confirmed");
    const latest = await connection.getLatestBlockhash("confirmed");
    transaction.feePayer = new PublicKey(account.address);
    transaction.recentBlockhash = latest.blockhash;
    onStatus?.("awaiting_approval"); await updateOperation(operation.operationId,"awaiting_signature",{lastValidBlockHeight:latest.lastValidBlockHeight});
    let output; try {[output] = await wallet.features[SolanaSignAndSendTransaction].signAndSendTransaction({
      account, chain: CHAIN as `${string}:${string}`, transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
      options: { commitment: "confirmed", skipPreflight: false, maxRetries: 3 },
    });}catch(cause){const message=cause instanceof Error?cause.message:"Wallet request failed";const rejected=/reject|declin|cancel/i.test(message);await updateOperation(operation.operationId,rejected?"rejected":"failed",{errorCode:rejected?"WALLET_REJECTED":"SUBMISSION_FAILED",errorMessage:message});throw cause;}
    if (!output) throw new Error("The wallet returned no transaction signature.");
    const signature = base58(output.signature); onStatus?.("submitted"); await updateOperation(operation.operationId,"submitted",{signature,lastValidBlockHeight:latest.lastValidBlockHeight});
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      let status=null;for(const endpoint of rpcUrls){try{status=(await new Connection(endpoint,"confirmed").getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];if(status)break;}catch{await new Promise(resolve=>setTimeout(resolve,250+Math.random()*500));}}
      if (status?.err) {await updateOperation(operation.operationId,"failed",{signature,errorCode:"CHAIN_ERROR",errorMessage:JSON.stringify(status.err)});throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);}
      if(status?.confirmationStatus==="confirmed"){onStatus?.("confirmed");await updateOperation(operation.operationId,"confirmed",{signature});}
      if (status?.confirmationStatus === "finalized") { onStatus?.("finalized");await updateOperation(operation.operationId,"finalized",{signature}); await refreshBalance(account); return signature; }
      await new Promise(resolve => setTimeout(resolve, 1_500));
    }
    await updateOperation(operation.operationId,"unknown",{signature,errorCode:"CONFIRMATION_TIMEOUT"});throw new Error(`Transaction ${signature} was submitted; confirmation tracking will resume automatically.`);
  }, [account, authenticated, refreshBalance, rpcUrl, updateOperation, wallet]);

  useEffect(()=>{let cancelled=false;(async()=>{try{const response=await fetch("/api/auth/session",{cache:"no-store"});if(!response.ok)return;const session=await response.json() as {walletAddress:string};const name=localStorage.getItem("fate_wallet_name");const selected=getWallets().get().filter(isCompatible).find(candidate=>candidate.name===name);if(!selected)return;const output=await selected.features[StandardConnect].connect({silent:true});const restored=output.accounts.find(item=>item.address===session.walletAddress);if(!restored)return;if(!cancelled){setWallet(selected);setAccount(restored);setAuthenticated(true);await refreshBalance(restored);}}catch{/* explicit connect remains available */}finally{if(!cancelled)setRecovering(false);}})();return()=>{cancelled=true};},[refreshBalance]);

  useEffect(()=>{if(!authenticated)return;let stopped=false;const reconcile=async()=>{try{const response=await fetch("/api/transactions",{cache:"no-store"});if(!response.ok)return;const payload=await response.json() as {operations:Array<{operationId:string;status:TransactionState;signature?:string|null}>};if(stopped)return;setOperations(payload.operations);for(const item of payload.operations){if(!item.signature||!["submitted","confirmed","unknown"].includes(item.status))continue;for(const endpoint of [rpcUrl,...(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS??"").split(",")].filter(Boolean)){try{const status=(await new Connection(endpoint,"confirmed").getSignatureStatuses([item.signature],{searchTransactionHistory:true})).value[0];if(status?.err){await updateOperation(item.operationId,"failed",{signature:item.signature,errorCode:"CHAIN_ERROR"});break;}if(status?.confirmationStatus==="finalized"){await updateOperation(item.operationId,"finalized",{signature:item.signature});break;}if(status?.confirmationStatus==="confirmed"){await updateOperation(item.operationId,"confirmed",{signature:item.signature});break;}}catch{/* try next RPC */}}}}catch{/* retry on interval */}};void reconcile();const timer=setInterval(()=>void reconcile(),5000);return()=>{stopped=true;clearInterval(timer)};},[authenticated,rpcUrl,updateOperation]);
  useEffect(()=>{const timer=setTimeout(()=>{try{const saved=JSON.parse(localStorage.getItem("fate_transaction_operations")??"[]");if(Array.isArray(saved))setOperations(saved.slice(0,100));}catch{/* corrupted recovery data is discarded */}},0);return()=>clearTimeout(timer);},[]);
  useEffect(()=>{localStorage.setItem("fate_transaction_operations",JSON.stringify(operations.slice(0,100)));},[operations]);

  useEffect(() => {
    if (!wallet || !(StandardEvents in wallet.features)) return;
    return wallet.features[StandardEvents].on("change", ({ accounts }) => {
      if (!accounts) return;
      const next = accounts.find(item => item.chains.includes(CHAIN as `${string}:${string}`)) ?? null;
      setAccount(next);
      void refreshBalance(next);
    });
  }, [refreshBalance, wallet]);

  useEffect(() => {
    const interval = account ? window.setInterval(() => void refreshBalance(), 15_000) : undefined;
    return () => { if (interval) window.clearInterval(interval); };
  }, [account, refreshBalance]);

  return {
    wallets: availableWallets.map(item => ({ name: item.name, icon: item.icon })),
    account,
    address: account?.address ?? null,
    balance,
    cluster: CHAIN.slice("solana:".length),
    connected: Boolean(account),
    connecting,
    authenticated,
    recovering,
    operations,
    error,
    refreshWallets,
    connect,
    disconnect,
    refreshBalance,
    sendTransaction,
  };
}

function base58(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (const byte of bytes) { let carry = byte; for (let i = 0; i < digits.length; i++) { const value = digits[i] * 256 + carry; digits[i] = value % 58; carry = Math.floor(value / 58); } while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); } }
  let output = ""; for (const byte of bytes) { if (byte !== 0) break; output += "1"; }
  return output + digits.reverse().map(value => alphabet[value]).join("");
}
