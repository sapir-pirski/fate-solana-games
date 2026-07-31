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
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const CHAIN = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta" ? "solana:mainnet" : "solana:devnet";

type CompatibleWallet = Wallet & StandardConnectFeature & Partial<StandardDisconnectFeature & StandardEventsFeature>;

function isCompatible(wallet: Wallet): wallet is CompatibleWallet {
  return CHAIN === "solana:devnet" || wallet.chains.includes(CHAIN as `${string}:${string}`)
    ? StandardConnect in wallet.features
    : false;
}

export function useSolanaWallet() {
  const [wallet, setWallet] = useState<CompatibleWallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connection = useMemo(() => new Connection(RPC_URL, "confirmed"), []);

  const refreshBalance = useCallback(async (nextAccount = account) => {
    if (!nextAccount) return setBalance(null);
    try {
      const lamports = await connection.getBalance(new PublicKey(nextAccount.address), "confirmed");
      setBalance(lamports / LAMPORTS_PER_SOL);
    } catch {
      setBalance(null);
    }
  }, [account, connection]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const wallets = getWallets().get().filter(isCompatible);
      if (!wallets.length) throw new Error("No compatible Solana wallet was found. Install Phantom, Backpack, or Solflare.");
      const selected = wallets.find(candidate => /phantom/i.test(candidate.name)) ?? wallets[0];
      const output = await selected.features[StandardConnect].connect();
      const nextAccount = output.accounts.find(item => item.chains.includes(CHAIN as `${string}:${string}`)) ?? output.accounts[0];
      if (!nextAccount) throw new Error("The wallet did not authorize a Solana account.");
      setWallet(selected);
      setAccount(nextAccount);
      await refreshBalance(nextAccount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed.");
      throw cause;
    } finally {
      setConnecting(false);
    }
  }, [refreshBalance]);

  const disconnect = useCallback(async () => {
    try {
      if (wallet && StandardDisconnect in wallet.features) await wallet.features[StandardDisconnect].disconnect();
    } finally {
      setWallet(null);
      setAccount(null);
      setBalance(null);
    }
  }, [wallet]);

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
    account,
    address: account?.address ?? null,
    balance,
    cluster: CHAIN.slice("solana:".length),
    connected: Boolean(account),
    connecting,
    error,
    connect,
    disconnect,
    refreshBalance,
  };
}

