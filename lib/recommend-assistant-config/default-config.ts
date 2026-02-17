import type { AssistantStepConfig } from "./types";

export type AssistantQuestionSetSeed = {
  name: string;
  steps: AssistantStepConfig[];
  meta: Record<string, unknown>;
};

export const DEFAULT_QUESTION_SET: AssistantQuestionSetSeed = {
  name: "デフォルト質問セット",
  steps: [
    {
      key: "purpose",
      question: "まず用途を教えてください（自宅用・贈り物など）",
      quickReplies: ["自宅用", "贈り物", "家族向け", "特別な日", "職場向け"],
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
      question: "カテゴリは何が良いですか？（肉・魚介・果物など）",
      quickReplies: ["肉", "魚介", "果物", "米・パン", "スイーツ"],
      optional: false,
      enabled: true,
      order: 3,
    },
    {
      key: "delivery",
      question: "配送希望はありますか？（冷凍・冷蔵・常温・日時指定など）",
      quickReplies: ["冷凍", "冷蔵", "常温", "日時指定できる", "こだわらない"],
      optional: true,
      enabled: true,
      order: 4,
    },
    {
      key: "additional",
      question:
        "最後に、避けたい条件や追加条件があれば教えてください（なければ特になし）",
      quickReplies: ["特になし", "卵アレルギーに配慮", "北海道の返礼品", "甘いもの以外"],
      optional: true,
      enabled: true,
      order: 5,
    },
  ],
  meta: {},
};
