export type ChainAware = { readonly chains: readonly string[] };
export type ChainAccount = ChainAware & { readonly address: string };

export function supportsConfiguredChain(subject: ChainAware, chain: string) {
  return subject.chains.some(candidate => candidate === chain);
}

export function selectAccountForChain<T extends ChainAccount>(
  accounts: readonly T[],
  chain: string,
  preferredAddress?: string | null,
): T | null {
  if (preferredAddress) {
    return accounts.find(account => account.address === preferredAddress && supportsConfiguredChain(account, chain)) ?? null;
  }
  return accounts.find(account => supportsConfiguredChain(account, chain)) ?? null;
}
