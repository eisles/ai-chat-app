import { getDb } from "@/lib/neon";
import { getRecommendCategoryCandidates } from "@/lib/recommend/category-candidates";
import type { AssistantStepConfig } from "./types";

const CATEGORY_SEED_REPLIES = [
  "肉",
  "魚介",
  "果物",
  "米・パン",
  "スイーツ",
  "旅行・体験",
  "温泉",
];

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export async function generateStepDraftsFromMetadata(): Promise<AssistantStepConfig[]> {
  const db = getDb();

  const categoryCandidates = await getRecommendCategoryCandidates(60, 1);
  const categories = dedupe([
    ...CATEGORY_SEED_REPLIES,
    ...categoryCandidates.map((candidate) => candidate.name),
  ]).slice(0, 20);

  const deliveryRows = (await db`
    select
      sum(case when (metadata->'raw'->>'shipping_frozen_flag')::int = 1 then 1 else 0 end)::int as frozen_count,
      sum(case when (metadata->'raw'->>'shipping_refrigerated_flag')::int = 1 then 1 else 0 end)::int as refrigerated_count,
      sum(case when (metadata->'raw'->>'shipping_ordinary_flag')::int = 1 then 1 else 0 end)::int as ordinary_count,
      sum(case when (metadata->'raw'->>'delivery_hour_flag')::int = 1 then 1 else 0 end)::int as hour_count
    from public.product_text_embeddings
    where metadata is not null
  `) as Array<{
    frozen_count: number;
    refrigerated_count: number;
    ordinary_count: number;
    hour_count: number;
  }>;

  const deliveryCounts = deliveryRows[0] ?? {
    frozen_count: 0,
    refrigerated_count: 0,
    ordinary_count: 0,
    hour_count: 0,
  };

  const delivery = [
    "特になし",
    deliveryCounts.frozen_count > 0 ? "冷凍" : null,
    deliveryCounts.refrigerated_count > 0 ? "冷蔵" : null,
    deliveryCounts.ordinary_count > 0 ? "常温" : null,
    deliveryCounts.hour_count > 0 ? "日時指定できる" : null,
  ].filter((value): value is string => !!value);

  return [
    {
      key: "purpose",
      question: "用途を教えてください（自宅用・贈り物など）",
      quickReplies: ["自宅用", "贈り物", "家族向け", "特別な日"],
      optional: false,
      enabled: true,
      order: 1,
    },
    {
      key: "budget",
      question: "ご予算を教えてください（例: 10,001〜20,000円）",
      quickReplies: [
        "〜5,000円",
        "5,001〜10,000円",
        "10,001〜20,000円",
        "20,001〜30,000円",
        "30,001円以上",
      ],
      optional: false,
      enabled: true,
      order: 2,
    },
    {
      key: "category",
      question: "カテゴリは何が良いですか？",
      quickReplies: categories.length > 0 ? categories : CATEGORY_SEED_REPLIES,
      optional: false,
      enabled: true,
      order: 3,
    },
    {
      key: "delivery",
      question: "配送希望はありますか？",
      quickReplies: delivery,
      optional: true,
      enabled: true,
      order: 4,
    },
    {
      key: "additional",
      question: "追加条件はありますか？（なければ特になし）",
      quickReplies: ["特になし", "卵アレルギーに配慮", "北海道の返礼品"],
      optional: true,
      enabled: true,
      order: 5,
    },
  ];
}
