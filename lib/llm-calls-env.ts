/** Shared AI SDK credentials for text / non-image LLM lanes. */
export const llmCallsApiKey =
  process.env.LLM_CALLS_API_KEY || process.env.AI_GATEWAY_API_KEY;

export const llmCallsModel =
  process.env.LLM_CALLS_MODEL ||
  process.env.AI_GATEWAY_MODEL ||
  "google/gemini-3-flash";

export function ensureAiGatewayApiKey(resolvedKey: string | undefined): void {
  if (resolvedKey && !process.env.AI_GATEWAY_API_KEY) {
    process.env.AI_GATEWAY_API_KEY = resolvedKey;
  }
}
