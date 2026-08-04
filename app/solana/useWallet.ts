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
import type { GameAction, GameType } from "@/lib/transactions";
import { isAuthenticatedAccount, selectAccountForChain, supportsConfiguredChain } from "@/lib/solana/wallet-chain";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const CHAIN = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta" ? "solana:mainnet" : "solana:devnet";
const LAMPORTS_PER_SOL = 1_000_000_000;

export type TransactionState = "draft"|"awaiting_signature"|"submitted"|"confirmed"|"finalized"|"rejected"|"failed"|"expired"|"unknown";
type OperationInput={operationId:string;gameType:GameType;action:GameAction;amountLamports:bigint};
type CompatibleWalletFeatures =
  StandardConnectFeature &
  SolanaSignAndSendTransactionFeature &
  SolanaSignMessageFeature &
  Partial<StandardDisconnectFeature> &
  Partial<StandardEventsFeature>;
type CompatibleWallet = Wallet & { readonly features: Wallet["features"] & CompatibleWalletFeatures };

function isCompatible(wallet: Wallet): wallet is CompatibleWallet {
  return supportsConfiguredChain(wallet, CHAIN)
    && StandardConnect in wallet.features
    && SolanaSignAndSendTransaction in wallet.features
    && SolanaSignMessage in wallet.features;
}

export function useSolanaWallet() {
  const [availableWallets, setAvailableWallets] = useState<CompatibleWallet[]>([]);
  const [wallet, setWallet] = useState<CompatibleWallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authenticatedAddress,setAuthenticatedAddress]=useState<string|null>(null);
  const [recovering,setRecovering]=useState(true);
  const [operations,setOperations]=useState<Array<{operationId:string;status:TransactionState;signature?:string|null}>>([]);
  const rpcUrl = useMemo(() => RPC_URL, []);
  const refreshWallets = useCallback(() => {
    const next = getWallets().get().filter(isCompatible);
    setAvailableWallets(current => {
      const unchanged = current.length === next.length && current.every((item, index) => {
        const candidate = next[index];
        return item === candidate || (item.name === candidate.name && item.icon === candidate.icon);
      });
      return unchanged ? current : next;
    });
  }, []);

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
      if (typeof lamports !== "number" || !Number.isSafeInteger(lamports)) throw new Error("RPC returned an invalid balance.");
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

  const setOperationState=useCallback((operationId:string,status:TransactionState,extra:Record<string,unknown>={})=>{setOperations(items=>{const current=items.find(item=>item.operationId===operationId);return current?items.map(item=>item.operationId===operationId?{...item,status,...extra}:item):[...items,{operationId,status,...extra}]});},[]);
  const updateOperation=useCallback(async(operationId:string,status:TransactionState,extra:Record<string,unknown>={})=>{setOperationState(operationId,status,extra);try{await fetch("/api/transactions",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({operationId,status,...extra})});}catch{/* durable server reconciliation remains available */}},[setOperationState]);

  const authenticated=isAuthenticatedAccount(account?.address,authenticatedAddress);
  const authenticate=useCallback(async(selected:CompatibleWallet,nextAccount:WalletAccount)=>{const challengeResponse=await fetch("/api/auth/challenge",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({walletAddress:nextAccount.address})});if(!challengeResponse.ok)throw new Error("Could not create wallet authentication challenge.");const challenge=await challengeResponse.json() as {challengeId:string;message:string};const [signed]=await selected.features[SolanaSignMessage].signMessage({account:nextAccount,message:new TextEncoder().encode(challenge.message)});if(!signed)throw new Error("Wallet did not sign the authentication message.");const verify=await fetch("/api/auth/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({challengeId:challenge.challengeId,walletAddress:nextAccount.address,signature:base58(signed.signature)})});if(!verify.ok)throw new Error("Wallet authentication signature was rejected.");const verified=await verify.json() as {authenticated?:boolean;walletAddress?:string};if(verified.authenticated!==true||verified.walletAddress!==nextAccount.address)throw new Error("The authenticated session does not match the selected wallet account.");return verified.walletAddress;},[]);

  const connect = useCallback(async (walletName?: string) => {
    setConnecting(true);
    setError(null);
    let previousSessionCleared=false;
    try {
      const wallets = getWallets().get().filter(isCompatible);
      if (!wallets.length) throw new Error("No compatible Solana wallet was found. Install Phantom, Backpack, or Solflare.");
      const selected = wallets.find(candidate => candidate.name === walletName) ?? wallets.find(candidate => /phantom/i.test(candidate.name)) ?? wallets[0];
      const output = await Promise.race([
        selected.features[StandardConnect].connect(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Wallet connection timed out. Unlock the wallet and try again.")), 30_000)),
      ]);
      const nextAccount = selectAccountForChain(output.accounts, CHAIN);
      if (!nextAccount) throw new Error(`The wallet did not authorize an account for ${CHAIN}. Switch the wallet to the configured network and try again.`);
      const cleared=await fetch("/api/auth/session",{method:"DELETE"});if(!cleared.ok)throw new Error("The previous wallet session could not be cleared safely.");
      previousSessionCleared=true;setAuthenticatedAddress(null);
      const verifiedAddress=await authenticate(selected,nextAccount);
      setAuthenticatedAddress(verifiedAddress);
      setWallet(selected);setAccount(nextAccount);localStorage.setItem("fate_wallet_name",selected.name);
      await refreshBalance(nextAccount);
    } catch (cause) {
      if(previousSessionCleared){setWallet(null);setAccount(null);setBalance(null);setAuthenticatedAddress(null);localStorage.removeItem("fate_wallet_name");}
      setError(cause instanceof Error ? cause.message : "Wallet connection failed.");
      throw cause;
    } finally {
      setConnecting(false);
    }
  }, [authenticate,refreshBalance]);

  const disconnect = useCallback(async () => {
    try {
      await fetch("/api/auth/session",{method:"DELETE"}).catch(()=>undefined);
      const disconnectFeature = wallet?.features[StandardDisconnect];
      if (disconnectFeature) await disconnectFeature.disconnect();
    } finally {
      setWallet(null);
      setAccount(null);
      setBalance(null);
      setAuthenticatedAddress(null); localStorage.removeItem("fate_wallet_name");
    }
  }, [wallet]);

  const sendTransaction = useCallback(async (transaction: Transaction, operation:OperationInput, onStatus?: (status: "awaiting_approval" | "submitted" | "confirmed" | "finalized") => void) => {
    if (!wallet || !account || !isAuthenticatedAccount(account.address,authenticatedAddress)) throw new Error("Connect and authenticate a compatible Solana wallet first.");
    if (!supportsConfiguredChain(wallet,CHAIN)||!supportsConfiguredChain(account,CHAIN)) throw new Error(`The connected wallet account does not support ${CHAIN}. Reconnect on the configured network before signing.`);
    const sessionResponse=await fetch("/api/auth/session",{cache:"no-store"});const session=sessionResponse.ok?await sessionResponse.json() as {walletAddress?:string}:null;if(session?.walletAddress!==account.address){setAuthenticatedAddress(null);throw new Error("The wallet account no longer matches the authenticated server session. Reconnect before signing.");}
    const rpcUrls=[rpcUrl,...(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS??"").split(",")].filter((value,index,all)=>value&&all.indexOf(value)===index);
    const connection = new Connection(rpcUrls[0], "confirmed");
    const latest = await connection.getLatestBlockhash("confirmed");
    transaction.feePayer = new PublicKey(account.address);
    transaction.recentBlockhash = latest.blockhash;
    const unsignedTransaction=bytesToBase64(transaction.serialize({requireAllSignatures:false,verifySignatures:false}));
    const operationPayload={operationId:operation.operationId,gameType:operation.gameType,action:operation.action,unsignedTransaction,lastValidBlockHeight:latest.lastValidBlockHeight};
    const create=await fetch("/api/transactions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(operationPayload)});if(!create.ok){const failure=await create.json().catch(()=>({})) as {code?:string};const messages:Record<string,string>={AGE_ATTESTATION_REQUIRED:"Complete the Safety & privacy eligibility check first.",CONSENT_RENEWAL_REQUIRED:"Review and renew the current policies first.",JURISDICTION_BLOCKED:"This service is unavailable in your declared jurisdiction.",COMPLIANCE_REVIEW_REQUIRED:"Eligibility requires review before playing.",SELF_EXCLUDED:"Self-exclusion is active for this wallet.",COOLDOWN_ACTIVE:"A cooling-off period is active for this wallet.",DAILY_LIMIT_EXCEEDED:"Your daily play limit would be exceeded.",WEEKLY_LIMIT_EXCEEDED:"Your weekly play limit would be exceeded.",MAINNET_DISABLED_PENDING_LICENSE:"Mainnet is disabled pending licensing.",TRANSACTION_METADATA_MISMATCH:"The prepared transaction does not match the selected game action.",INVALID_TRANSACTION_PROGRAM:"The prepared transaction targets an unapproved program.",INVALID_TRANSACTION_ACCOUNTS:"The prepared transaction contains unexpected Solana accounts.",WAGER_VERIFICATION_UNAVAILABLE:"The wager could not be verified on-chain. Try again shortly."};throw new Error(messages[failure.code??""]??"The server rejected the prepared transaction intent.");}
    onStatus?.("awaiting_approval"); await updateOperation(operation.operationId,"awaiting_signature",{lastValidBlockHeight:latest.lastValidBlockHeight});
    let output; try {[output] = await wallet.features[SolanaSignAndSendTransaction].signAndSendTransaction({
      account, chain: CHAIN as `${string}:${string}`, transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
      options: { commitment: "confirmed", skipPreflight: false, maxRetries: 3 },
    });}catch(cause){const message=cause instanceof Error?cause.message:"Wallet request failed";const rejected=/reject|declin|cancel/i.test(message);await updateOperation(operation.operationId,rejected?"rejected":"unknown",{errorCode:rejected?"WALLET_REJECTED":"SUBMISSION_STATUS_UNKNOWN",errorMessage:message});throw cause;}
    if (!output) {await updateOperation(operation.operationId,"unknown",{errorCode:"MISSING_SIGNATURE"});throw new Error("The wallet returned no transaction signature.");}
    const signature = base58(output.signature); onStatus?.("submitted"); await updateOperation(operation.operationId,"submitted",{signature,lastValidBlockHeight:latest.lastValidBlockHeight});
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      let status=null;for(const endpoint of rpcUrls){try{status=(await new Connection(endpoint,"confirmed").getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];if(status)break;}catch{await new Promise(resolve=>setTimeout(resolve,250+Math.random()*500));}}
      if (status?.err) {setOperationState(operation.operationId,"failed",{signature,errorCode:"CHAIN_ERROR",errorMessage:JSON.stringify(status.err)});throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);}
      if(status?.confirmationStatus==="confirmed"){onStatus?.("confirmed");setOperationState(operation.operationId,"confirmed",{signature});}
      if (status?.confirmationStatus === "finalized") {
        const verified=await fetch("/api/transactions",{cache:"no-store"});
        if(verified.ok){const payload=await verified.json() as {operations:Array<{operationId:string;status:TransactionState;errorCode?:string|null}>};const serverOperation=payload.operations.find(item=>item.operationId===operation.operationId);if(serverOperation?.status==="failed")throw new Error(`The finalized transaction failed server intent verification (${serverOperation.errorCode??"INTENT_MISMATCH"}).`);if(serverOperation?.status==="finalized"){setOperations(payload.operations);onStatus?.("finalized");await refreshBalance(account);return signature;}}
      }
      await new Promise(resolve => setTimeout(resolve, 1_500));
    }
    await updateOperation(operation.operationId,"unknown",{signature,errorCode:"CONFIRMATION_TIMEOUT"});throw new Error(`Transaction ${signature} was submitted; confirmation tracking will resume automatically.`);
  }, [account, authenticatedAddress, refreshBalance, rpcUrl, setOperationState, updateOperation, wallet]);

  useEffect(()=>{let cancelled=false;(async()=>{try{const response=await fetch("/api/auth/session",{cache:"no-store"});if(!response.ok)return;const session=await response.json() as {walletAddress:string};const name=localStorage.getItem("fate_wallet_name");const selected=getWallets().get().filter(isCompatible).find(candidate=>candidate.name===name);if(!selected)return;const output=await selected.features[StandardConnect].connect({silent:true});const restored=selectAccountForChain(output.accounts,CHAIN,session.walletAddress);if(!restored)return;if(!cancelled){setWallet(selected);setAccount(restored);setAuthenticatedAddress(session.walletAddress);await refreshBalance(restored);}}catch{/* explicit connect remains available */}finally{if(!cancelled)setRecovering(false);}})();return()=>{cancelled=true};},[refreshBalance]);

  useEffect(()=>{if(!authenticated)return;let stopped=false;const reconcile=async()=>{try{const response=await fetch("/api/transactions",{cache:"no-store"});if(!response.ok)return;const payload=await response.json() as {operations:Array<{operationId:string;status:TransactionState;signature?:string|null}>};if(!stopped)setOperations(payload.operations);}catch{/* retry on interval */}};void reconcile();const timer=setInterval(()=>void reconcile(),5000);return()=>{stopped=true;clearInterval(timer)};},[authenticated]);
  useEffect(()=>{const timer=setTimeout(()=>{try{const saved=JSON.parse(localStorage.getItem("fate_transaction_operations")??"[]");if(Array.isArray(saved))setOperations(saved.slice(0,100));}catch{/* corrupted recovery data is discarded */}},0);return()=>clearTimeout(timer);},[]);
  useEffect(()=>{localStorage.setItem("fate_transaction_operations",JSON.stringify(operations.slice(0,100)));},[operations]);

  useEffect(() => {
    const eventsFeature = wallet?.features[StandardEvents];
    if (!eventsFeature) return;
    return eventsFeature.on("change", ({ accounts }) => {
      if (!accounts) return;
      const next = selectAccountForChain(accounts, CHAIN, account?.address);
      if (!next) {
        setAccount(null);
        setBalance(null);
        setAuthenticatedAddress(null);
        setError(`The authorized wallet account is no longer available on ${CHAIN}. Reconnect to continue.`);
        localStorage.removeItem("fate_wallet_name");
        void fetch("/api/auth/session",{method:"DELETE"}).catch(()=>undefined);
        return;
      }
      setAccount(next);
      void refreshBalance(next);
    });
  }, [account?.address, refreshBalance, wallet]);

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

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
