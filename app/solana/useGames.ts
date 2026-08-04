"use client";
import { useCallback, useEffect, useState } from "react";
export type IndexedGame = { address:string; chain_address:string; game_type:"jackpot"|"coinflip"|"daily"; numeric_id:string; state:string; creator:string|null; winner:string|null; wager_lamports:string; pot_lamports:string; payout_lamports:string; fee_lamports:string; randomness_hex:string|null; expires_at:number|null; settled_at:number|null; last_signature:string; last_slot:string };
export function useGames(type?: IndexedGame["game_type"], state?: string, wallet?: string|null, enabled=true) {
  const [games,setGames]=useState<IndexedGame[]>([]), [loading,setLoading]=useState(true), [error,setError]=useState<string|null>(null);
  const refresh=useCallback(async()=>{if(!enabled){setGames([]);setError(null);setLoading(false);return;}try{setLoading(true);const query=new URLSearchParams();if(type)query.set("type",type);if(state)query.set("state",state);if(wallet)query.set("wallet",wallet);const response=await fetch(`/api/indexer/games?${query}`,{cache:"no-store"});if(!response.ok)throw new Error("Indexed game feed is unavailable.");const payload=await response.json() as {games:IndexedGame[]};setGames(payload.games);setError(null);}catch(cause){setError(cause instanceof Error?cause.message:"Game feed failed.");}finally{setLoading(false);}},[enabled,state,type,wallet]);
  useEffect(()=>{
    const initial=setTimeout(()=>void refresh(),0);
    if(!enabled)return()=>clearTimeout(initial);
    const timer=setInterval(()=>void refresh(),10_000);
    return()=>{clearTimeout(initial);clearInterval(timer);};
  },[enabled,refresh]);
  return {games,loading,error,refresh};
}
