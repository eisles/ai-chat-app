# ふるさと納税おすすめAIエージェント 実装計画（現行システム拡張）

## 1. 目的
- 既存の `/api/recommend/conversation` と `/api/recommend/agent-personalized` を活用し、
  「会話で条件収集 -> 推薦 -> 理由提示 -> クリック学習」までを 1 つのAIエージェント体験として完成させる。
- 既存機能を壊さず、段階リリース可能な差分実装にする。

## 2. 現状資産（再利用する実装）
- 会話推薦API: `app/api/recommend/conversation/route.ts`
- エージェント推薦API: `app/api/recommend/agent-personalized/route.ts`
- クリック収集API: `app/api/recommend/events/click/route.ts`
- 個人化プロファイル: `lib/recommend-personalization/profile.ts`
- 再スコア: `lib/recommend-personalization/rerank.ts`
- UI: `app/recommend-assistant/page.tsx`

このため、ゼロから作り直す必要はなく、**エージェント層の整理と評価導線の追加**が主作業になる。

## 3. 実装方針（3フェーズ）

### フェーズ1: エージェント出力契約を固定
目的: APIの返却形式を固定し、UI側の分岐ロジックを安定化する。

実装:
- `lib/recommend-agent/schema.ts` を追加
- `agentMessage` / `agentMatches` / `agentExtractionSummary` をZodで検証
- 失敗時は既存フォールバック文言を返す

#### 追加コード例: `lib/recommend-agent/schema.ts`
```ts
import { z } from "zod";

export const agentSearchStrategySchema = z.union([
  z.literal("history_only"),
  z.literal("current_conditions_fallback"),
  z.literal("current_conditions_only"),
]);

export const agentMatchSchema = z.object({
  productId: z.string().min(1),
  cityCode: z.string().nullable().optional(),
  score: z.number(),
  amount: z.number().nullable().optional(),
  agentReason: z.string().min(1),
});

export const agentResponseSchema = z.object({
  ok: z.literal(true),
  finalUseLlm: z.boolean(),
  strategy: agentSearchStrategySchema,
  agentMessage: z.string().min(1),
  agentMatches: z.array(agentMatchSchema),
  agentExtractionSummary: z.object({
    searchStrategy: agentSearchStrategySchema,
    currentConditions: z.array(z.string()),
    personalizationSignals: z.array(z.string()),
    rerankRules: z.array(z.string()),
    personalizedMatchCount: z.number().int().nonnegative(),
  }),
});

export type AgentResponse = z.infer<typeof agentResponseSchema>;
```

#### 既存API適用例: `app/api/recommend/agent-personalized/route.ts`
```ts
import { agentResponseSchema } from "@/lib/recommend-agent/schema";

// ...既存ロジックで payload を作る
const payload = {
  ok: true,
  finalUseLlm,
  strategy,
  queryText: result.queryText,
  agentMessage: llmMessage ?? buildFallbackAgentMessage(agentMatches, strategy),
  agentMatches,
  agentExtractionSummary,
};

const parsed = agentResponseSchema.safeParse(payload);
if (!parsed.success) {
  return Response.json(
    { ok: false, error: "agent response schema validation failed" },
    { status: 500 }
  );
}

return Response.json(parsed.data);
```

### フェーズ2: エージェント実行サービスを分離
目的: ルートハンドラの責務を薄くし、テスト可能なサービスに寄せる。

実装:
- `lib/recommend-agent/service.ts` を追加
- `route.ts` から「入力パース + エラーハンドリング」以外を移す
- 将来の「画像起点」「季節イベント起点」の追加を容易にする

#### 追加コード例: `lib/recommend-agent/service.ts`
```ts
import {
  recommendByAnswers,
  type RecommendByAnswersResult,
} from "@/lib/recommend/by-answers-engine";
import {
  buildUserPreferenceProfile,
  type UserPreferenceProfile,
} from "@/lib/recommend-personalization/profile";

export type RunAgentInput = {
  userId: string;
  slots: {
    budget?: string;
    category?: string;
    purpose?: string;
    delivery?: string[];
    allergen?: string;
    prefecture?: string;
    cityCode?: string;
  };
  topK: number;
  threshold: number;
  finalUseLlm: boolean;
};

export type RunAgentOutput = {
  strategy: "history_only" | "current_conditions_fallback" | "current_conditions_only";
  result: RecommendByAnswersResult;
  profile: UserPreferenceProfile | null;
  amountFilterApplied: boolean;
};

export async function runAgent(input: RunAgentInput): Promise<RunAgentOutput> {
  const profile = await buildUserPreferenceProfile(input.userId, {
    useLlmPersonalization: input.finalUseLlm,
  });

  if (!profile) {
    const result = await recommendByAnswers({
      ...input.slots,
      topK: input.topK,
      threshold: input.threshold,
      userId: input.userId,
      useLlmPersonalization: input.finalUseLlm,
    });
    return {
      strategy: "current_conditions_only",
      result,
      profile: null,
      amountFilterApplied: false,
    };
  }

  const historyQueryText = [
    ...Object.keys(profile.categoryWeights).slice(0, 3).map((v) => `履歴カテゴリ: ${v}`),
    ...Object.keys(profile.keywordWeights).slice(0, 5).map((v) => `履歴キーワード: ${v}`),
  ].join("\n");

  const historyResult = await recommendByAnswers({
    queryText: historyQueryText,
    topK: input.topK,
    threshold: input.threshold,
    userId: input.userId,
    useLlmPersonalization: input.finalUseLlm,
  });

  if (historyResult.matches.length > 0) {
    return {
      strategy: "history_only",
      result: historyResult,
      profile,
      amountFilterApplied: false,
    };
  }

  const fallbackResult = await recommendByAnswers({
    ...input.slots,
    topK: input.topK,
    threshold: input.threshold,
    userId: input.userId,
    useLlmPersonalization: input.finalUseLlm,
  });

  return {
    strategy: "current_conditions_fallback",
    result: fallbackResult,
    profile,
    amountFilterApplied: false,
  };
}
```

### フェーズ3: UIを「会話結果」と「エージェント提案」に明確分離
目的: ユーザーが「通常推薦」と「AIエージェント提案」の違いを理解できるUIにする。

実装:
- `app/recommend-assistant/page.tsx` の表示を2ブロック化
- 上段: 会話で得た通常候補
- 下段: ボタン押下時のエージェント候補（理由付き）
- ロード中メッセージを段階表示（既存 `AGENT_LOADING_STAGES` を継続利用）

#### UI呼び出しコード例: `app/recommend-assistant/page.tsx`
```ts
async function fetchAgentRecommendations() {
  if (!session) return;
  setIsAgentLoading(true);

  const userId = getOrCreateRecommendUserId();
  const res = await fetch("/api/recommend/agent-personalized", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session,
      userId,
      topK,
      threshold,
      useLlmPersonalization,
    }),
  });

  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? "agent request failed");
  }

  setAgentMessage(json.agentMessage ?? "");
  setAgentMatches(json.agentMatches ?? []);
  setAgentExtractionSummary(json.agentExtractionSummary ?? null);
  setIsAgentLoading(false);
}
```

#### クリック学習送信コード例（既存改善）
```ts
function trackClick(payload: {
  userId: string;
  productId: string;
  cityCode?: string | null;
  score?: number;
  queryText?: string;
}) {
  const body = JSON.stringify({
    userId: payload.userId,
    productId: payload.productId,
    cityCode: payload.cityCode ?? null,
    source: "recommend-assistant",
    score: payload.score ?? null,
    metadata: { queryText: payload.queryText ?? null },
  });

  const blob = new Blob([body], { type: "application/json" });
  if (navigator.sendBeacon("/api/recommend/events/click", blob)) {
    return;
  }

  void fetch("/api/recommend/events/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  });
}
```

## 4. テスト計画

### 4.1 APIテスト（追加）
- 追加: `tests/api/recommend-agent-contract.test.ts`
- 観点:
- `agentResponseSchema` に合致する
- `history_only` / `current_conditions_fallback` の遷移
- `LLM失敗時フォールバック` が 200 で返る

#### テストコード例
```ts
import { describe, expect, it } from "vitest";
import { agentResponseSchema } from "@/lib/recommend-agent/schema";

describe("agent response contract", () => {
  it("valid payload", () => {
    const payload = {
      ok: true,
      finalUseLlm: false,
      strategy: "history_only",
      agentMessage: "クリック履歴を優先して3件提案します。",
      agentMatches: [
        {
          productId: "123",
          cityCode: "01234",
          score: 0.91,
          amount: 12000,
          agentReason: "最近のクリック傾向に一致",
        },
      ],
      agentExtractionSummary: {
        searchStrategy: "history_only",
        currentConditions: ["用途: 自宅用"],
        personalizationSignals: ["最近クリックした商品数: 5件"],
        rerankRules: ["カテゴリ一致を最大 +0.12 で加点"],
        personalizedMatchCount: 1,
      },
    };

    const parsed = agentResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});
```

### 4.2 既存テストの拡張
- `tests/api/recommend-agent-personalized.test.ts`
- `tests/api/recommend-conversation.test.ts`
- `tests/api/recommend-events-click.test.ts`

拡張ポイント:
- `finalUseLlm` のON/OFF分岐
- `agentExtractionSummary` の表示項目固定
- `sendBeacon` 失敗時の `fetch keepalive` フォールバック

## 5. リリース手順
1. `schema.ts` と `service.ts` を追加（API契約固定）
2. `agent-personalized` ルートをサービス経由に置換
3. UIを2ブロック化し、導線を統一
4. テスト追加後に `npm run test:run`
5. ステージングで推薦品質確認（最低50セッション）
6. 本番リリース

## 6. 完了条件（Definition of Done）
- `/recommend-assistant` で会話推薦とエージェント推薦を同一画面で使い分け可能
- エージェントAPIのレスポンス形式がスキーマで固定される
- クリック学習が失敗時フォールバック込みで送信される
- 主要分岐（履歴優先/フォールバック/LLM失敗）をテストで担保

## 7. 工数見積り
- フェーズ1: 0.5日
- フェーズ2: 1日
- フェーズ3: 1日
- テスト/調整: 0.5日
- 合計: **3営業日前後**

