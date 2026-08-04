export type AiUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
};

export const EMPTY_AI_USAGE: AiUsageTotals = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 };

export type ProviderUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  output_tokens_details?: { reasoning_tokens?: number | null } | null;
  input_tokens_details?: { cached_tokens?: number | null } | null;
} | null | undefined;

const tokenCount = (value: number | null | undefined) => Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : 0;

export function normalizeAiUsage(usage: ProviderUsage): AiUsageTotals {
  return {
    inputTokens: tokenCount(usage?.input_tokens),
    outputTokens: tokenCount(usage?.output_tokens),
    reasoningTokens: tokenCount(usage?.output_tokens_details?.reasoning_tokens),
    cachedTokens: tokenCount(usage?.input_tokens_details?.cached_tokens),
  };
}

export function addAiUsage(left: AiUsageTotals, right: AiUsageTotals): AiUsageTotals {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
  };
}

export function estimateAiCostUsd(usage: Pick<AiUsageTotals, "inputTokens" | "outputTokens" | "cachedTokens">, inputPrice: number, outputPrice: number, cachedInputPrice: number) {
  const cached = Math.min(usage.inputTokens, usage.cachedTokens);
  const uncached = Math.max(0, usage.inputTokens - cached);
  return (uncached * inputPrice + cached * cachedInputPrice + usage.outputTokens * outputPrice) / 1_000_000;
}
