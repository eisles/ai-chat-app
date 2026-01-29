"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";

type Match = {
  id: string;
  productId: string;
  cityCode: string | null;
  text: string;
  metadata: Record<string, unknown> | null;
  score: number;
};

type ApiResult = {
  ok: boolean;
  queryText?: string;
  matches?: Match[];
  error?: string;
};

const budgetOptions = [
  "〜5,000円",
  "5,001〜10,000円",
  "10,001〜20,000円",
  "20,001〜30,000円",
  "30,001円以上",
];

const categoryOptions = [
  "肉",
  "魚介",
  "米・パン",
  "果物・野菜",
  "乳製品・卵",
  "お酒・飲料",
  "加工品・惣菜",
  "雑貨・日用品",
  "体験・宿泊",
];

const purposeOptions = [
  "自宅で食べる",
  "贈り物",
  "バーベキュー/キャンプ",
  "子ども向け",
  "ストック・備蓄",
];

const deliveryOptions = [
  "早く届く",
  "冷蔵",
  "冷凍",
  "常温",
  "日時指定できる",
];

const allergenOptions = ["なし", "乳", "卵", "小麦", "甲殻類", "牛肉"];

export default function AgentRecommendPage() {
  const [budget, setBudget] = useState("");
  const [category, setCategory] = useState("");
  const [purpose, setPurpose] = useState("");
  const [delivery, setDelivery] = useState<string[]>([]);
  const [allergen, setAllergen] = useState("なし");
  const [prefecture, setPrefecture] = useState("");
  const [cityCode, setCityCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  const answeredCount = useMemo(() => {
    let count = 0;
    if (budget) count += 1;
    if (category) count += 1;
    if (purpose) count += 1;
    if (delivery.length > 0) count += 1;
    if (allergen && allergen !== "なし") count += 1;
    if (prefecture || cityCode) count += 1;
    return count;
  }, [budget, category, purpose, delivery, allergen, prefecture, cityCode]);

  async function handleRecommend() {
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/recommend/by-answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budget,
          category,
          purpose,
          delivery,
          allergen,
          prefecture,
          cityCode,
        }),
      });

      let data: ApiResult;
      try {
        data = (await res.json()) as ApiResult;
      } catch {
        data = { ok: false, error: `Failed to parse response (status ${res.status})` };
      }
      setResult(data);
    } catch (error) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleDelivery(value: string) {
    setDelivery((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Agent Guided Recommend
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          質問に答えて返礼品レコメンド
        </h1>
        <p className="text-sm text-muted-foreground">
          いくつかの質問に答えると、返礼品のテキストベクトルからおすすめを提示します。
        </p>
      </div>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>回答済み: {answeredCount}</span>
          <span> / 6</span>
        </div>
        <div className="mt-4 space-y-6">
          <div className="space-y-2">
            <div className="text-sm font-medium">Q1. 予算帯は？</div>
            <div className="flex flex-wrap gap-2">
              {budgetOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={budget === option ? "default" : "secondary"}
                  onClick={() => setBudget(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Q2. カテゴリは？</div>
            <div className="flex flex-wrap gap-2">
              {categoryOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={category === option ? "default" : "secondary"}
                  onClick={() => setCategory(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Q3. 用途は？</div>
            <div className="flex flex-wrap gap-2">
              {purposeOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={purpose === option ? "default" : "secondary"}
                  onClick={() => setPurpose(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Q4. 配送条件の希望は？</div>
            <div className="flex flex-wrap gap-2">
              {deliveryOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={delivery.includes(option) ? "default" : "secondary"}
                  onClick={() => toggleDelivery(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Q5. アレルゲン配慮は？</div>
            <div className="flex flex-wrap gap-2">
              {allergenOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={allergen === option ? "default" : "secondary"}
                  onClick={() => setAllergen(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-sm font-medium">Q6. 地域の希望は？</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="都道府県 (任意)"
                value={prefecture}
                onChange={(event) => setPrefecture(event.target.value)}
              />
              <Input
                placeholder="市町村コード (任意)"
                value={cityCode}
                onChange={(event) => setCityCode(event.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" onClick={handleRecommend} disabled={isSubmitting}>
            {isSubmitting ? "レコメンド中..." : "レコメンドを見る"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setBudget("");
              setCategory("");
              setPurpose("");
              setDelivery([]);
              setAllergen("なし");
              setPrefecture("");
              setCityCode("");
              setResult(null);
            }}
          >
            回答をリセット
          </Button>
        </div>
      </Card>

      {result && (
        <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">レコメンド結果</h2>
          {result.ok ? (
            <div className="mt-3 space-y-4 text-sm">
              <div className="space-y-1">
                <div className="whitespace-pre-wrap">
                  queryText: {result.queryText}
                </div>
              </div>
              {result.matches && result.matches.length > 0 ? (
                <div className="space-y-3">
                  {result.matches.map((match) => (
                    <div className="rounded-md border bg-background/70 p-3" key={match.id}>
                      <div className="text-sm font-semibold">
                        score: {match.score.toFixed(4)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        productId: {match.productId}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        cityCode: {match.cityCode ?? "-"}
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
                <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  類似結果がありません。
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {result.error ?? "不明なエラー"}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
