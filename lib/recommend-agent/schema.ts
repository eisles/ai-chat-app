import { z } from "zod";

export const agentSearchStrategySchema = z.union([
  z.literal("history_only"),
  z.literal("current_conditions_fallback"),
  z.literal("current_conditions_only"),
]);

export const agentMatchSchema = z
  .object({
    productId: z.string().min(1),
    cityCode: z.string().nullable().optional(),
    score: z.number(),
    amount: z.number().nullable().optional(),
    agentReason: z.string().min(1),
  })
  .passthrough();

export const agentExtractionSummarySchema = z
  .object({
    searchStrategy: agentSearchStrategySchema,
    currentConditions: z.array(z.string()),
    personalizationSignals: z.array(z.string()),
    rerankRules: z.array(z.string()),
    personalizedMatchCount: z.number().int().nonnegative(),
  })
  .passthrough();

export const agentResponseSchema = z
  .object({
    ok: z.literal(true),
    finalUseLlm: z.boolean(),
    strategy: agentSearchStrategySchema,
    queryText: z.string().optional(),
    agentMessage: z.string().min(1),
    agentMatches: z.array(agentMatchSchema),
    agentExtractionSummary: agentExtractionSummarySchema,
  })
  .passthrough();

export type AgentSearchStrategy = z.infer<typeof agentSearchStrategySchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;
