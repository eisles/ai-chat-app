"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DEFAULT_QUESTION_SET } from "@/lib/recommend-assistant-config/default-config";
import type { AssistantStepConfig } from "@/lib/recommend-assistant-config/types";
import { getOrCreateRecommendUserId } from "@/lib/recommend-personalization/client-user-id";
import type {
  ConversationSession,
  ConversationStepKey,
  SlotState,
} from "@/lib/recommend-conversation/types";
import { Loader2Icon } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

// 商品詳細URLを構築
function buildProductUrl(productId: string, cityCode: string | null): string {
  if (cityCode) {
    return `https://www.furusato-tax.jp/product/detail/${cityCode}/${productId}`;
  }
  return `https://www.furusato-tax.jp/search?q=${productId}`;
}

// metadata.rawから商品情報を取得
function extractProductInfo(metadata: Record<string, unknown> | null): {
  name: string | null;
  image: string | null;
  description: string | null;
} {
  if (!metadata) {
    return { name: null, image: null, description: null };
  }

  const raw = metadata.raw as Record<string, unknown> | undefined;
  if (!raw) {
    return { name: null, image: null, description: null };
  }

  const descriptionCandidates = [
    raw.catchphrase,
    raw.description,
    raw.shipping_text,
    raw.application_text,
    raw.bulk_text,
  ];
  const description = descriptionCandidates.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  return {
    name: typeof raw.name === "string" ? raw.name : null,
    image: typeof raw.image === "string" ? raw.image : null,
    description: description ?? null,
  };
}

type BudgetRange = {
  min: number | null;
  max: number | null;
};

type Match = {
  id: string;
  productId: string;
  cityCode: string | null;
  text: string;
  metadata: Record<string, unknown> | null;
  score: number;
  amount: number | null;
  personalBoost?: number;
  personalReasons?: string[];
};

type SimilarImageResult = {
  id: string;
  city_code: string | null;
  product_id: string | null;
  slide_index: number | null;
  image_url: string;
  distance: number;
  metadata: Record<string, unknown> | null;
  amount: number | null;
};

type ApiResponse = {
  ok: boolean;
  action?: "ask" | "recommend";
  session?: ConversationSession;
  missingKeys?: ConversationStepKey[];
  nextQuestionKey?: ConversationStepKey | null;
  quickReplies?: string[];
  assistantMessage?: string;
  queryText?: string;
  matches?: Match[];
  budgetRange?: BudgetRange | null;
  error?: string;
};

type SimilarImageApiResponse = {
  ok: boolean;
  queryImageUrl?: string;
  embeddingDurationMs?: number;
  model?: string;
  dim?: number;
  normalized?: boolean | null;
  results?: SimilarImageResult[];
  error?: string;
};

type AgentMatch = Match & {
  agentReason: string;
};

type AgentExtractionSummary = {
  searchStrategy?:
    | "history_only"
    | "current_conditions_fallback"
    | "current_conditions_only";
  currentConditions?: string[];
  personalizationSignals?: string[];
  rerankRules?: string[];
  personalizedMatchCount?: number;
};

type AgentApiResponse = {
  ok: boolean;
  finalUseLlm?: boolean;
  queryText?: string;
  agentMessage?: string;
  agentMatches?: AgentMatch[];
  agentExtractionSummary?: AgentExtractionSummary;
  error?: string;
};

type Message = {
  role: "assistant" | "user";
  text: string;
};

type ClickPayload = {
  userId: string;
  productId: string;
  cityCode?: string | null;
  source?: string;
  score?: number | null;
  metadata?: Record<string, unknown> | null;
};

const DEFAULT_SIMILAR_IMAGE_RESULT_LIMIT = 20;
const MIN_SIMILAR_IMAGE_RESULT_LIMIT = 1;
const MAX_SIMILAR_IMAGE_RESULT_LIMIT = 100;

const FIELD_LABELS: Record<string, string> = {
  purpose: "用途",
  budget: "予算",
  category: "カテゴリ",
  delivery: "配送希望",
  additional: "追加条件",
};

const AGENT_LOADING_STAGES = [
  "クリック履歴と傾向を解析しています",
  "履歴ベース候補を検索しています",
  "現在条件との整合を確認しています",
  "おすすめ候補を整理しています",
];

type InitialState = {
  messages: Message[];
  missingKeys: ConversationStepKey[];
  nextQuestionKey: ConversationStepKey | null;
  quickReplies: string[];
};

function normalizeSteps(steps?: AssistantStepConfig[]): AssistantStepConfig[] {
  const source = Array.isArray(steps) ? steps : [];
  const enabled = source.filter((step) => step.enabled);
  const ordered = enabled
    .map((step, index) => ({ step, index }))
    .sort((a, b) => a.step.order - b.step.order || a.index - b.index)
    .map(({ step }) => step);
  if (ordered.length > 0) return ordered;

  return DEFAULT_QUESTION_SET.steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => a.step.order - b.step.order || a.index - b.index)
    .map(({ step }) => step);
}

function buildInitialState(steps: AssistantStepConfig[]): InitialState {
  const flow = normalizeSteps(steps);
  const firstStep = flow[0];
  const fallbackStep = DEFAULT_QUESTION_SET.steps[0];
  const question = firstStep?.question ?? fallbackStep?.question ?? "条件を教えてください。";
  return {
    messages: [{ role: "assistant", text: question }],
    missingKeys: flow.map((step) => step.key),
    nextQuestionKey: firstStep?.key ?? null,
    quickReplies: firstStep?.quickReplies ?? [],
  };
}

function getQuickRepliesForKey(
  steps: AssistantStepConfig[],
  key: ConversationStepKey | null
): string[] {
  if (!key) return [];
  const flow = normalizeSteps(steps);
  const target = flow.find((step) => step.key === key);
  if (target) return target.quickReplies;
  const fallback = DEFAULT_QUESTION_SET.steps.find((step) => step.key === key);
  return fallback?.quickReplies ?? [];
}

function parseBudgetRange(budget: string | undefined): BudgetRange | null {
  if (!budget) {
    return null;
  }
  if (budget === "〜5,000円") return { min: null, max: 5000 };
  if (budget === "5,001〜10,000円") return { min: 5001, max: 10000 };
  if (budget === "10,001〜20,000円") return { min: 10001, max: 20000 };
  if (budget === "20,001〜30,000円") return { min: 20001, max: 30000 };
  if (budget === "30,001円以上") return { min: 30001, max: null };
  return null;
}

function buildReasonLabels(slots: SlotState, match: Match): string[] {
  const labels: string[] = [];
  if (slots.category) {
    labels.push("カテゴリ一致");
  }
  const budgetRange = parseBudgetRange(slots.budget);
  if (budgetRange && match.amount !== null) {
    labels.push("予算一致");
  }
  if (slots.delivery && slots.delivery.length > 0) {
    labels.push("配送条件一致");
  }
  if (match.personalReasons && match.personalReasons.length > 0) {
    labels.push(...match.personalReasons);
  } else if (match.personalBoost && match.personalBoost > 0) {
    labels.push("最近のクリック傾向に一致");
  }
  return labels;
}

function buildSlotSummary(slots: SlotState): string[] {
  const summary: string[] = [];
  if (slots.budget) summary.push(`予算: ${slots.budget}`);
  if (slots.category) summary.push(`カテゴリ: ${slots.category}`);
  if (slots.purpose) summary.push(`用途: ${slots.purpose}`);
  if (slots.delivery && slots.delivery.length > 0) {
    summary.push(`配送: ${slots.delivery.join(" / ")}`);
  }
  if (slots.allergen) summary.push(`アレルゲン: ${slots.allergen}`);
  if (slots.prefecture) summary.push(`都道府県: ${slots.prefecture}`);
  if (slots.cityCode) summary.push(`市町村コード: ${slots.cityCode}`);
  return summary;
}

function buildProductUrlForVectorResult(
  productId: string | null,
  cityCode: string | null,
  fallbackUrl: string
): string {
  if (productId && cityCode) {
    return `https://www.furusato-tax.jp/product/detail/${cityCode}/${productId}`;
  }
  if (productId) {
    return `https://www.furusato-tax.jp/search?q=${productId}`;
  }
  return fallbackUrl;
}

function parseSimilarImageLimit(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_SIMILAR_IMAGE_RESULT_LIMIT;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return DEFAULT_SIMILAR_IMAGE_RESULT_LIMIT;
  const intValue = Math.floor(parsed);
  return Math.max(
    MIN_SIMILAR_IMAGE_RESULT_LIMIT,
    Math.min(intValue, MAX_SIMILAR_IMAGE_RESULT_LIMIT)
  );
}

function buildModalDescription(match: Match): string {
  const info = extractProductInfo(match.metadata);
  if (info.description) return info.description;
  return match.text;
}

function buildModalMatchFromSimilarResult(row: SimilarImageResult): Match {
  const info = extractProductInfo(row.metadata);
  const fallbackText = row.product_id ? `商品ID: ${row.product_id}` : `ID: ${row.id}`;
  return {
    id: `similar-${row.id}`,
    productId: row.product_id ?? row.id,
    cityCode: row.city_code ?? null,
    text: info.name ?? fallbackText,
    metadata: row.metadata,
    score: Math.max(0, 1 - row.distance),
    amount: row.amount,
  };
}

function formatAgentSearchStrategy(
  strategy: AgentExtractionSummary["searchStrategy"]
): string {
  if (strategy === "history_only") return "クリック履歴優先で抽出";
  if (strategy === "current_conditions_fallback") {
    return "クリック履歴で不足したため現在条件へフォールバック";
  }
  if (strategy === "current_conditions_only") return "現在条件のみで抽出";
  return "-";
}

function trackClick(payload: ClickPayload) {
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon("/api/recommend/events/click", blob)) return;
  }
  void fetch("/api/recommend/events/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  });
}

function buildClickMetadata(
  match: Match,
  queryText: string | null,
  interaction: "external_link" | "modal_interest" | "agent_recommend_link"
): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};
  if (queryText) {
    metadata.queryText = queryText;
  }
  metadata.interaction = interaction;
  if (match.personalBoost && match.personalBoost > 0) {
    metadata.personalBoost = match.personalBoost;
  }
  if (match.personalReasons && match.personalReasons.length > 0) {
    metadata.personalReasons = match.personalReasons;
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}

function createInitialSession(): ConversationSession {
  return {
    slots: {},
    askedKeys: [],
  };
}

export default function RecommendAssistantPage() {
  const defaultInitialState = buildInitialState(DEFAULT_QUESTION_SET.steps);
  const [activeSteps, setActiveSteps] = useState<AssistantStepConfig[]>(
    DEFAULT_QUESTION_SET.steps
  );
  const [session, setSession] = useState<ConversationSession>(createInitialSession());
  const [messages, setMessages] = useState<Message[]>(defaultInitialState.messages);
  const [input, setInput] = useState("");
  const [topK, setTopK] = useState("10");
  const [threshold, setThreshold] = useState("0.35");
  const [matches, setMatches] = useState<Match[]>([]);
  const [queryText, setQueryText] = useState<string | null>(null);
  const [missingKeys, setMissingKeys] = useState<ConversationStepKey[]>(
    defaultInitialState.missingKeys
  );
  const [nextQuestionKey, setNextQuestionKey] = useState<ConversationStepKey | null>(
    defaultInitialState.nextQuestionKey
  );
  const [quickReplies, setQuickReplies] = useState<string[]>(
    defaultInitialState.quickReplies
  );
  const [displayMode, setDisplayMode] = useState<"debug" | "product">("product");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [recommendUserId, setRecommendUserId] = useState<string | null>(null);
  const [useLlmPersonalization, setUseLlmPersonalization] = useState(false);
  const [modalMatch, setModalMatch] = useState<Match | null>(null);
  const [modalInterestTracked, setModalInterestTracked] = useState(false);
  const [agentMatches, setAgentMatches] = useState<AgentMatch[]>([]);
  const [agentMessage, setAgentMessage] = useState<string | null>(null);
  const [agentFinalUseLlm, setAgentFinalUseLlm] = useState<boolean | null>(null);
  const [agentExtractionSummary, setAgentExtractionSummary] =
    useState<AgentExtractionSummary | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentLoadingStageIndex, setAgentLoadingStageIndex] = useState(0);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [similarImageSourceUrl, setSimilarImageSourceUrl] = useState<string | null>(null);
  const [similarImageSourceProductId, setSimilarImageSourceProductId] = useState<string | null>(
    null
  );
  const [similarImageResults, setSimilarImageResults] = useState<SimilarImageResult[]>([]);
  const [similarImageLoading, setSimilarImageLoading] = useState(false);
  const [similarImageError, setSimilarImageError] = useState<string | null>(null);
  const [similarImageEmbeddingMs, setSimilarImageEmbeddingMs] = useState<number | null>(null);
  const [similarImageModel, setSimilarImageModel] = useState<string | null>(null);
  const [similarImageLimit, setSimilarImageLimit] = useState(
    String(DEFAULT_SIMILAR_IMAGE_RESULT_LIMIT)
  );
  const [similarImageResultLimit, setSimilarImageResultLimit] = useState(
    DEFAULT_SIMILAR_IMAGE_RESULT_LIMIT
  );
  const [similarImageSearchRequestId, setSimilarImageSearchRequestId] = useState(0);
  const similarImageResultAnchorRef = useRef<HTMLDivElement | null>(null);

  const resetToSteps = useCallback((steps: AssistantStepConfig[]) => {
    const initialState = buildInitialState(steps);
    setSession(createInitialSession());
    setMessages(initialState.messages);
    setInput("");
    setMatches([]);
    setQueryText(null);
    setMissingKeys(initialState.missingKeys);
    setNextQuestionKey(initialState.nextQuestionKey);
    setQuickReplies(initialState.quickReplies);
    setDisplayMode("product");
    setError(null);
  }, []);

  const clearSimilarImageResults = useCallback(() => {
    setSimilarImageSourceUrl(null);
    setSimilarImageSourceProductId(null);
    setSimilarImageResults([]);
    setSimilarImageLoading(false);
    setSimilarImageError(null);
    setSimilarImageEmbeddingMs(null);
    setSimilarImageModel(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialSteps() {
      try {
        const res = await fetch("/api/recommend-assistant-settings/sets");
        const data = (await res.json()) as {
          ok?: boolean;
          sets?: Array<{ status?: string; steps?: AssistantStepConfig[] }>;
        };
        if (!res.ok || !data.ok) return;
        const published = data.sets?.find((set) => set.status === "published");
        const steps =
          published?.steps && published.steps.length > 0
            ? published.steps
            : DEFAULT_QUESTION_SET.steps;
        if (cancelled) return;
        setActiveSteps(steps);
        if (!hasInteracted) {
          resetToSteps(steps);
        }
      } catch {
        // 失敗時はデフォルトで継続
      }
    }

    void loadInitialSteps();

    return () => {
      cancelled = true;
    };
  }, [hasInteracted, resetToSteps]);

  useEffect(() => {
    setRecommendUserId(getOrCreateRecommendUserId());
  }, []);

  useEffect(() => {
    if (similarImageSearchRequestId <= 0) return;
    const frameId = requestAnimationFrame(() => {
      similarImageResultAnchorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => cancelAnimationFrame(frameId);
  }, [similarImageSearchRequestId]);

  useEffect(() => {
    if (!agentLoading) {
      setAgentLoadingStageIndex(0);
      return;
    }
    setAgentLoadingStageIndex(0);
    const intervalId = window.setInterval(() => {
      setAgentLoadingStageIndex(
        (prev) => (prev + 1) % AGENT_LOADING_STAGES.length
      );
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [agentLoading]);

  async function submitMessage(
    rawText: string,
    options?: { selectedStepKey?: ConversationStepKey | null }
  ) {
    if (isSubmitting) return;

    const userText = rawText.trim();
    if (!userText) return;

    setInput("");
    setError(null);
    setHasInteracted(true);
    setMessages((prev) => [...prev, { role: "user", text: userText }]);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/recommend/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          session,
          topK: topK ? Number(topK) : undefined,
          threshold: threshold ? Number(threshold) : undefined,
          selectedStepKey: options?.selectedStepKey ?? undefined,
          selectedValue: options?.selectedStepKey ? userText : undefined,
          userId: recommendUserId ?? undefined,
          useLlmPersonalization,
        }),
      });

      let data: ApiResponse;
      try {
        data = (await res.json()) as ApiResponse;
      } catch {
        data = { ok: false, error: `Failed to parse response (status ${res.status})` };
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Request failed (status ${res.status})`);
      }

      const assistantMessage = data.assistantMessage ?? "";
      setSession((prev) => data.session ?? prev);
      setMissingKeys(data.missingKeys ?? []);
      setNextQuestionKey(data.nextQuestionKey ?? null);
      setQuickReplies(
        data.quickReplies ??
          (data.nextQuestionKey
            ? getQuickRepliesForKey(activeSteps, data.nextQuestionKey)
            : [])
      );
      setMessages((prev) => [...prev, { role: "assistant", text: assistantMessage }]);

      if (data.action === "recommend") {
        setMatches(data.matches ?? []);
        setQueryText(data.queryText ?? null);
        setNextQuestionKey(null);
        setQuickReplies([]);
        setMissingKeys([]);
        setAgentMatches([]);
        setAgentMessage(null);
        setAgentFinalUseLlm(null);
        setAgentExtractionSummary(null);
        setAgentError(null);
        clearSimilarImageResults();
      } else {
        setMatches([]);
        setQueryText(null);
        setAgentMatches([]);
        setAgentMessage(null);
        setAgentFinalUseLlm(null);
        setAgentExtractionSummary(null);
        setAgentError(null);
        clearSimilarImageResults();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "エラーが発生しました。条件をもう一度教えてください。" },
      ]);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function searchSimilarProductsByImage(
    imageUrl: string,
    sourceProductId: string
  ) {
    if (!imageUrl.trim()) return;
    const safeLimit = parseSimilarImageLimit(similarImageLimit);

    setSimilarImageLoading(true);
    setSimilarImageError(null);
    setSimilarImageSourceUrl(imageUrl);
    setSimilarImageSourceProductId(sourceProductId);
    setSimilarImageLimit(String(safeLimit));
    setSimilarImageResultLimit(safeLimit);
    setSimilarImageResults([]);
    setSimilarImageEmbeddingMs(null);
    setSimilarImageModel(null);
    setSimilarImageSearchRequestId((value) => value + 1);

    try {
      const res = await fetch("/api/vectorize-product-images/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          limit: safeLimit,
        }),
      });

      let data: SimilarImageApiResponse;
      try {
        data = (await res.json()) as SimilarImageApiResponse;
      } catch {
        data = {
          ok: false,
          error: `Failed to parse response (status ${res.status})`,
        };
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Request failed (status ${res.status})`);
      }

      setSimilarImageResults(data.results ?? []);
      setSimilarImageEmbeddingMs(data.embeddingDurationMs ?? null);
      setSimilarImageModel(data.model ?? null);
    } catch (err) {
      setSimilarImageError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSimilarImageLoading(false);
    }
  }

  async function requestAgentRecommendations() {
    if (agentLoading || !recommendUserId) return;

    setAgentLoading(true);
    setAgentError(null);
    setAgentMessage(null);
    setAgentMatches([]);
    setAgentFinalUseLlm(null);
    setAgentExtractionSummary(null);

    try {
      const res = await fetch("/api/recommend/agent-personalized", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session,
          topK: topK ? Number(topK) : undefined,
          threshold: threshold ? Number(threshold) : undefined,
          userId: recommendUserId,
          useLlmPersonalization,
        }),
      });

      let data: AgentApiResponse;
      try {
        data = (await res.json()) as AgentApiResponse;
      } catch {
        data = { ok: false, error: `Failed to parse response (status ${res.status})` };
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Request failed (status ${res.status})`);
      }

      setAgentMessage(data.agentMessage ?? null);
      setAgentMatches(data.agentMatches ?? []);
      setAgentFinalUseLlm(
        typeof data.finalUseLlm === "boolean" ? data.finalUseLlm : null
      );
      setAgentExtractionSummary(data.agentExtractionSummary ?? null);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAgentLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await submitMessage(input);
  }

  function resetConversation() {
    if (isSubmitting) return;
    setHasInteracted(false);
    resetToSteps(activeSteps);
    setModalMatch(null);
    setModalInterestTracked(false);
    setAgentMatches([]);
    setAgentMessage(null);
    setAgentFinalUseLlm(null);
    setAgentExtractionSummary(null);
    setAgentError(null);
    clearSimilarImageResults();
  }

  function openProductDetailModal(match: Match) {
    setModalMatch(match);
    setModalInterestTracked(false);
  }

  function handleModalOpenChange(open: boolean) {
    if (open) return;
    setModalMatch(null);
    setModalInterestTracked(false);
  }

  function handleModalInterestClick() {
    if (!modalMatch || modalInterestTracked || !recommendUserId) return;
    trackClick({
      userId: recommendUserId,
      productId: modalMatch.productId,
      cityCode: modalMatch.cityCode,
      source: "recommend-assistant",
      score: modalMatch.score,
      metadata: buildClickMetadata(modalMatch, queryText, "modal_interest"),
    });
    setModalInterestTracked(true);
  }

  const slotSummary = buildSlotSummary(session.slots);
  const missingLabels = missingKeys.map((key) => FIELD_LABELS[key] ?? key);
  const modalInfo = modalMatch ? extractProductInfo(modalMatch.metadata) : null;
  const modalDisplayName = modalMatch
    ? modalInfo?.name ?? `商品ID: ${modalMatch.productId}`
    : null;
  const modalImage = modalInfo?.image ?? null;
  const modalDescription = modalMatch ? buildModalDescription(modalMatch) : "";
  const agentLoadingStage = AGENT_LOADING_STAGES[agentLoadingStageIndex] ?? "";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Recommend Assistant
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">対話型レコメンド</h1>
        <p className="text-sm text-muted-foreground">
          条件を聞きながら、返礼品のおすすめを提案します。
        </p>
      </div>

      <Card className="border bg-card/60 p-4 text-sm text-muted-foreground shadow-sm sm:p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          検索仕様
        </div>
        <ul className="mt-3 space-y-2">
          <li>基本導線: 用途 → 予算 → カテゴリ → 配送希望 → 追加条件</li>
          <li>入力方法: 自由入力と質問ごとの選択肢ボタンを併用可能</li>
          <li>カテゴリ候補: 既存 `metadata` から抽出した頻出カテゴリを優先表示</li>
          <li>検索件数（`topK`）と類似度しきい値（`threshold`）は画面で調整可能</li>
          <li>初期値: `topK=10` / `threshold=0.35`</li>
          <li>予算フィルタ: 予算レンジに一致する金額のみを表示</li>
          <li>カテゴリフィルタ: 商品カテゴリに入力カテゴリが含まれるものを優先</li>
          <li>配送フィルタ: 指定された配送条件をすべて満たす商品のみ表示</li>
          <li>結果カードの理由表示: カテゴリ一致 / 予算一致 / 配送条件一致</li>
          <li>商品カードから画像ベクトル類似検索を実行（件数は指定可能、初期値20）</li>
          <li>`AIエージェントにおすすめを聞く` ボタンで別ブロックに候補を表示</li>
        </ul>
      </Card>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="space-y-4">
          <div className="space-y-3">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {message.text}
                </div>
              </div>
            ))}
          </div>

          {missingKeys.length > 0 && (
            <div className="text-xs text-muted-foreground">
              まだ確認中の項目: {missingLabels.join(" / ")}
            </div>
          )}

          {quickReplies.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                {FIELD_LABELS[nextQuestionKey ?? ""] ?? "質問"}の選択肢（自由入力も可能）
              </div>
              <div className="flex flex-wrap gap-2">
                {quickReplies.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => {
                      void submitMessage(option, {
                        selectedStepKey: nextQuestionKey,
                      });
                    }}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">検索件数 (`topK`)</div>
              <Input
                type="number"
                min={1}
                value={topK}
                onChange={(event) => setTopK(event.target.value)}
                placeholder="10"
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">類似度しきい値 (`threshold`)</div>
              <Input
                type="number"
                min={0}
                max={1}
                step="0.01"
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
                placeholder="0.35"
              />
            </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">画像類似件数 (`limit`)</div>
            <Input
              type="number"
              min={MIN_SIMILAR_IMAGE_RESULT_LIMIT}
              max={MAX_SIMILAR_IMAGE_RESULT_LIMIT}
              step={1}
              value={similarImageLimit}
              onChange={(event) => setSimilarImageLimit(event.target.value)}
              placeholder={String(DEFAULT_SIMILAR_IMAGE_RESULT_LIMIT)}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={useLlmPersonalization}
            onChange={(event) => setUseLlmPersonalization(event.target.checked)}
          />
          LLM個人化を使う（実験）
        </label>
        <div className="text-xs text-muted-foreground">
          有効条件: `RECOMMEND_PERSONALIZATION_LLM_ENABLED=true` かつ
          画面でONのときのみ。失敗時は自動でルールベースへフォールバックします。
        </div>

        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleSubmit}>
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="例: 1万円前後で魚介、贈り物用"
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "送信中..." : "送信"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={isSubmitting}
                onClick={resetConversation}
              >
                会話をリセット
              </Button>
            </div>
          </form>

          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>
      </Card>

      {slotSummary.length > 0 && (
        <Card className="border bg-card/60 p-4 text-sm text-muted-foreground shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            現在の条件
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {slotSummary.map((line) => (
              <span key={line} className="rounded bg-muted px-2 py-1 text-xs">
                {line}
              </span>
            ))}
          </div>
          {queryText && (
            <pre className="mt-3 whitespace-pre-wrap rounded bg-muted/70 p-3 text-xs text-foreground">
              {queryText}
            </pre>
          )}
        </Card>
      )}

      {matches.length > 0 ? (
        <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-medium text-muted-foreground">
              推薦結果: {matches.length}件
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant={displayMode === "debug" ? "default" : "outline"}
                onClick={() => setDisplayMode("debug")}
              >
                デバッグ表示
              </Button>
              <Button
                type="button"
                size="sm"
                variant={displayMode === "product" ? "default" : "outline"}
                onClick={() => setDisplayMode("product")}
              >
                商品カード表示
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={agentLoading || !recommendUserId}
                onClick={() => {
                  void requestAgentRecommendations();
                }}
              >
                {agentLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    AIエージェントが検討中...
                  </span>
                ) : (
                  "AIエージェントにおすすめを聞く"
                )}
              </Button>
            </div>
          </div>

          {displayMode === "debug" ? (
            <div className="space-y-3">
              {matches.map((match) => (
                <div key={match.id} className="rounded border bg-background/70 p-3 text-sm">
                  <div className="text-sm font-semibold">
                    score: {match.score.toFixed(4)}
                  </div>
                  {match.personalBoost !== undefined && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      personalBoost: {match.personalBoost.toFixed(4)}
                    </div>
                  )}
                  {match.personalReasons && match.personalReasons.length > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      personalReasons: {match.personalReasons.join(" / ")}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    productId: {match.productId}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    cityCode: {match.cityCode ?? "-"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    金額: {match.amount ? `${match.amount.toLocaleString()}円` : "-"}
                  </div>
                  <div className="mt-2 text-sm">{match.text}</div>
                  {match.metadata && (
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">
                      {JSON.stringify(match.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {matches.map((match) => {
                const { name, image } = extractProductInfo(match.metadata);
                const productUrl = buildProductUrl(match.productId, match.cityCode);
                const displayName = name || `商品ID: ${match.productId}`;
                const reasonLabels = buildReasonLabels(session.slots, match);
                const clickMetadata = buildClickMetadata(match, queryText, "external_link");
                const isPersonalized = (match.personalBoost ?? 0) > 0;
                const isSearchingThisImage =
                  similarImageLoading &&
                  !!image &&
                  similarImageSourceUrl === image;

                return (
                  <div
                    key={match.id}
                    className="overflow-hidden rounded-lg border bg-background/70 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <div className="relative aspect-[4/3] bg-muted">
                      {image ? (
                        <Image
                          src={image}
                          alt={displayName}
                          fill
                          className="object-cover"
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          onError={(event) => {
                            const target = event.currentTarget;
                            target.style.display = "none";
                            const fallback = target.parentElement?.querySelector(".image-fallback");
                            if (fallback) {
                              (fallback as HTMLElement).style.display = "flex";
                            }
                          }}
                        />
                      ) : null}
                      <div
                        className={`image-fallback absolute inset-0 items-center justify-center bg-muted text-sm text-muted-foreground ${
                          image ? "hidden" : "flex"
                        }`}
                      >
                        画像なし
                      </div>
                    </div>

                    <div className="p-3">
                      <a
                        href={productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="line-clamp-2 text-sm font-medium hover:text-primary hover:underline"
                        title={displayName}
                        onClick={() => {
                          if (!recommendUserId) return;
                          trackClick({
                            userId: recommendUserId,
                            productId: match.productId,
                            cityCode: match.cityCode,
                            source: "recommend-assistant",
                            score: match.score,
                            metadata: clickMetadata,
                          });
                        }}
                      >
                        {displayName}
                        <span className="ml-1 inline-block text-xs text-muted-foreground">↗</span>
                      </a>

                      <div className="mt-2 text-lg font-bold text-primary">
                        {match.amount ? `${match.amount.toLocaleString()}円` : "金額未設定"}
                      </div>
                      {isPersonalized && (
                        <div className="mt-2 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                          あなた向け
                        </div>
                      )}

                      {reasonLabels.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {reasonLabels.map((label) => (
                            <span key={label} className="rounded bg-muted px-2 py-0.5 text-xs">
                              {label}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="mt-2 text-xs text-muted-foreground">
                        スコア: {match.score.toFixed(4)}
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="mt-3 w-full"
                        onClick={() => openProductDetailModal(match)}
                      >
                        画像と説明をみる
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2 w-full"
                        disabled={!image || similarImageLoading}
                        onClick={() => {
                          if (!image) return;
                          void searchSimilarProductsByImage(image, match.productId);
                        }}
                      >
                        {!image
                          ? "画像がないため検索不可"
                          : isSearchingThisImage
                            ? "類似画像を検索中..."
                            : "この画像に似た商品を検索"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          まだおすすめが表示されていません。条件を入力してください。
        </div>
      )}

      {(
        agentLoading ||
        agentError ||
        agentMessage ||
        agentExtractionSummary ||
        agentMatches.length > 0
      ) && (
        <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
          <div className="mb-3 text-sm font-medium text-foreground">エージェントのおすすめ</div>
          {agentLoading && (
            <div className="rounded-md border bg-muted/40 px-3 py-3">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Loader2Icon className="h-4 w-4 animate-spin text-primary" />
                AIエージェントが考えています...
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {agentLoadingStage}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {[0, 1, 2].map((index) => (
                  <div
                    key={`agent-loading-skeleton-${index}`}
                    className="rounded border bg-background/80 p-2"
                  >
                    <div className="aspect-[4/3] w-full animate-pulse rounded bg-muted" />
                    <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-muted" />
                    <div className="mt-2 h-3 w-3/5 animate-pulse rounded bg-muted" />
                  </div>
                ))}
              </div>
            </div>
          )}
          {!agentLoading && agentError && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {agentError}
            </div>
          )}
          {!agentLoading && !agentError && agentMessage && (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-sm text-foreground">
              {agentMessage}
            </div>
          )}
          {!agentLoading && !agentError && agentExtractionSummary && (
            <div className="mt-3 rounded-md border bg-background/60 p-3 text-xs">
              <div className="font-medium text-foreground">
                このおすすめの抽出内容
              </div>
              <div className="mt-1 text-muted-foreground">
                LLM個人化経路:{" "}
                {agentFinalUseLlm === null
                  ? "-"
                  : agentFinalUseLlm
                    ? "有効"
                    : "無効"}
                {" / "}
                個人化で並び替えが入った候補:{" "}
                {agentExtractionSummary.personalizedMatchCount ?? 0}件
              </div>
              <div className="mt-1 text-muted-foreground">
                抽出戦略:{" "}
                {formatAgentSearchStrategy(agentExtractionSummary.searchStrategy)}
              </div>
              {agentExtractionSummary.currentConditions &&
                agentExtractionSummary.currentConditions.length > 0 && (
                  <div className="mt-2">
                    <div className="font-medium text-foreground">現在条件</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {agentExtractionSummary.currentConditions.map((line) => (
                        <span key={line} className="rounded bg-muted px-2 py-0.5">
                          {line}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              {agentExtractionSummary.personalizationSignals &&
                agentExtractionSummary.personalizationSignals.length > 0 && (
                  <div className="mt-2">
                    <div className="font-medium text-foreground">
                      クリック履歴シグナル
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {agentExtractionSummary.personalizationSignals.map((line) => (
                        <span key={line} className="rounded bg-muted px-2 py-0.5">
                          {line}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              {agentExtractionSummary.rerankRules &&
                agentExtractionSummary.rerankRules.length > 0 && (
                  <div className="mt-2">
                    <div className="font-medium text-foreground">
                      再スコアリングルール
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {agentExtractionSummary.rerankRules.map((line) => (
                        <span key={line} className="rounded bg-muted px-2 py-0.5">
                          {line}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          )}

          {!agentLoading && !agentError && agentMatches.length > 0 && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {agentMatches.map((match) => {
                const { name, image } = extractProductInfo(match.metadata);
                const displayName = name || `商品ID: ${match.productId}`;
                const productUrl = buildProductUrl(match.productId, match.cityCode);
                const isSearchingThisImage =
                  similarImageLoading &&
                  !!image &&
                  similarImageSourceUrl === image;

                return (
                  <div
                    key={`agent-${match.id}`}
                    className="overflow-hidden rounded-lg border bg-background/70 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <div className="relative aspect-[4/3] bg-muted">
                      {image ? (
                        <Image
                          src={image}
                          alt={displayName}
                          fill
                          className="object-cover"
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                          画像なし
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <a
                        href={productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="line-clamp-2 text-sm font-medium hover:text-primary hover:underline"
                        title={displayName}
                        onClick={() => {
                          if (!recommendUserId) return;
                          trackClick({
                            userId: recommendUserId,
                            productId: match.productId,
                            cityCode: match.cityCode,
                            source: "recommend-assistant",
                            score: match.score,
                            metadata: buildClickMetadata(
                              match,
                              queryText,
                              "agent_recommend_link"
                            ),
                          });
                        }}
                      >
                        {displayName}
                        <span className="ml-1 inline-block text-xs text-muted-foreground">↗</span>
                      </a>
                      <div className="mt-2 text-xs text-primary">{match.agentReason}</div>
                      <div className="mt-2 text-lg font-bold text-primary">
                        {match.amount ? `${match.amount.toLocaleString()}円` : "金額未設定"}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        スコア: {match.score.toFixed(4)}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="mt-3 w-full"
                        onClick={() => openProductDetailModal(match)}
                      >
                        画像と説明をみる
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2 w-full"
                        disabled={!image || similarImageLoading}
                        onClick={() => {
                          if (!image) return;
                          void searchSimilarProductsByImage(image, match.productId);
                        }}
                      >
                        {!image
                          ? "画像がないため検索不可"
                          : isSearchingThisImage
                            ? "類似画像を検索中..."
                            : "この画像に似た商品を検索"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <Dialog open={!!modalMatch} onOpenChange={handleModalOpenChange}>
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
          onClick={handleModalInterestClick}
        >
          <DialogHeader>
            <DialogTitle>{modalDisplayName ?? "商品詳細"}</DialogTitle>
            <DialogDescription>
              モーダル内をクリックすると「興味あり」として学習に反映します。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative aspect-[4/3] overflow-hidden rounded-md border bg-muted">
              {modalImage ? (
                <Image
                  src={modalImage}
                  alt={modalDisplayName ?? "商品画像"}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 100vw, 720px"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  画像なし
                </div>
              )}
            </div>
            {modalMatch && (
              <div className="space-y-2 text-sm">
                <div className="text-muted-foreground">
                  商品ID: {modalMatch.productId} / 市町村コード: {modalMatch.cityCode ?? "-"}
                </div>
                <div className="text-muted-foreground">
                  金額:{" "}
                  {modalMatch.amount ? `${modalMatch.amount.toLocaleString()}円` : "金額未設定"}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">
                  {modalDescription}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {(similarImageSourceUrl || similarImageLoading) && (
        <div ref={similarImageResultAnchorRef}>
          <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
            <div className="mb-3 space-y-1">
              <div className="text-sm font-medium text-foreground">
                画像ベクトル類似検索結果
              </div>
              <div className="text-xs text-muted-foreground">
                参照商品: {similarImageSourceProductId ?? "-"} / 表示件数:{" "}
                {similarImageResultLimit}件
              </div>
              <div className="break-all text-xs text-muted-foreground">
                参照画像: {similarImageSourceUrl}
              </div>
              {similarImageSourceUrl && (
                <div className="relative mt-2 aspect-[4/3] w-full max-w-sm overflow-hidden rounded-md border bg-muted">
                  <Image
                    src={similarImageSourceUrl}
                    alt="参照画像"
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 100vw, 400px"
                    onError={(event) => {
                      const target = event.currentTarget;
                      target.style.display = "none";
                      const fallback = target.parentElement?.querySelector(".source-image-fallback");
                      if (fallback) {
                        (fallback as HTMLElement).style.display = "flex";
                      }
                    }}
                  />
                  <div className="source-image-fallback absolute inset-0 hidden items-center justify-center text-sm text-muted-foreground">
                    画像を表示できません
                  </div>
                </div>
              )}
              {similarImageModel && (
                <div className="text-xs text-muted-foreground">
                  model: {similarImageModel}
                  {similarImageEmbeddingMs !== null
                    ? ` / vectorization: ${similarImageEmbeddingMs}ms`
                    : ""}
                </div>
              )}
            </div>

          {similarImageLoading && (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              類似画像を検索しています...
            </div>
          )}

          {!similarImageLoading && similarImageError && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {similarImageError}
            </div>
          )}

          {!similarImageLoading && !similarImageError && similarImageResults.length === 0 && (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              類似結果がありません。
            </div>
          )}

          {!similarImageLoading && !similarImageError && similarImageResults.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {similarImageResults.map((row) => {
                const { name, image } = extractProductInfo(row.metadata);
                const displayImage = image ?? row.image_url;
                const sourceImageUrl = row.image_url || displayImage || "";
                const sourceProductId = row.product_id ?? row.id;
                const displayName = row.product_id
                  ? name ?? `商品ID: ${row.product_id}`
                  : name ?? `ID: ${row.id}`;
                const productUrl = buildProductUrlForVectorResult(
                  row.product_id,
                  row.city_code,
                  row.image_url
                );
                const hasDifferentSearchImage =
                  sourceImageUrl.length > 0 &&
                  displayImage &&
                  sourceImageUrl !== displayImage;
                const isSearchingThisImage =
                  similarImageLoading &&
                  sourceImageUrl.length > 0 &&
                  similarImageSourceUrl === sourceImageUrl;

                return (
                  <div
                    key={row.id}
                    className="overflow-hidden rounded-lg border bg-background/70 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <div className="relative aspect-[4/3] bg-muted">
                      {displayImage ? (
                        <Image
                          src={displayImage}
                          alt={displayName}
                          fill
                          className="object-cover"
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          onError={(event) => {
                            const target = event.currentTarget;
                            target.style.display = "none";
                            const fallback = target.parentElement?.querySelector(".image-fallback");
                            if (fallback) {
                              (fallback as HTMLElement).style.display = "flex";
                            }
                          }}
                        />
                      ) : null}
                      <div
                        className={`image-fallback absolute inset-0 items-center justify-center bg-muted text-sm text-muted-foreground ${
                          displayImage ? "hidden" : "flex"
                        }`}
                      >
                        画像なし
                      </div>
                    </div>
                    <div className="p-3">
                      <a
                        href={productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="line-clamp-2 text-sm font-medium hover:text-primary hover:underline"
                        title={displayName}
                      >
                        {displayName}
                        <span className="ml-1 inline-block text-xs text-muted-foreground">
                          ↗
                        </span>
                      </a>

                      <div className="mt-2 text-lg font-bold text-primary">
                        {row.amount != null ? `${row.amount.toLocaleString()}円` : "金額未設定"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        距離: {row.distance.toFixed(4)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        productId: {row.product_id ?? "-"}
                      </div>
                      {hasDifferentSearchImage && (
                        <div className="mt-2 flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                          <div className="relative h-12 w-12 flex-none overflow-hidden rounded bg-muted">
                            <Image
                              src={sourceImageUrl}
                              alt="検索対象画像"
                              fill
                              className="object-cover"
                              sizes="48px"
                              onError={(event) => {
                                const target = event.currentTarget;
                                target.style.display = "none";
                                const fallback = target.parentElement?.querySelector(
                                  ".source-image-fallback"
                                );
                                if (fallback) {
                                  (fallback as HTMLElement).style.display = "flex";
                                }
                              }}
                            />
                            <div className="source-image-fallback absolute inset-0 hidden items-center justify-center text-[10px] text-muted-foreground">
                              画像なし
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            検索対象の画像
                          </div>
                        </div>
                      )}

                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="mt-3 w-full"
                        onClick={() => openProductDetailModal(buildModalMatchFromSimilarResult(row))}
                      >
                        画像と説明をみる
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2 w-full"
                        disabled={sourceImageUrl.length === 0 || similarImageLoading}
                        onClick={() => {
                          if (!sourceImageUrl) return;
                          void searchSimilarProductsByImage(sourceImageUrl, sourceProductId);
                        }}
                      >
                        {sourceImageUrl.length === 0
                          ? "画像がないため検索不可"
                          : isSearchingThisImage
                            ? "類似画像を検索中..."
                            : "この画像に似た商品を検索"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </Card>
        </div>
      )}
    </div>
  );
}
