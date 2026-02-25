"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_QUESTION_SET } from "@/lib/recommend-assistant-config/default-config";
import type {
  AssistantQuestionSet,
  AssistantStepKey,
  AssistantStepConfig,
} from "@/lib/recommend-assistant-config/types";
import { ASSISTANT_STEP_KEYS } from "@/lib/recommend-assistant-config/types";
import { useEffect, useMemo, useState } from "react";

type SetsResponse = {
  ok: boolean;
  sets?: AssistantQuestionSet[];
  error?: string;
};

type GenerateResponse = {
  ok: boolean;
  steps?: AssistantStepConfig[];
  error?: string;
};

type CreateResponse = {
  ok: boolean;
  set?: AssistantQuestionSet;
  error?: string;
};

type UpdateResponse = {
  ok: boolean;
  set?: AssistantQuestionSet;
  error?: string;
};

type PublishResponse = {
  ok: boolean;
  error?: string;
};

type DeleteResponse = {
  ok: boolean;
  error?: string;
};

const STEP_KEY_LABELS: Record<AssistantStepKey, string> = {
  purpose: "用途",
  budget: "予算",
  category: "カテゴリ",
  delivery: "配送希望",
  additional: "追加条件",
};

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function normalizeStepOrders(stepList: AssistantStepConfig[]): AssistantStepConfig[] {
  return stepList.map((step, index) => ({
    ...step,
    order: index + 1,
  }));
}

function createDefaultStep(key: AssistantStepKey): AssistantStepConfig {
  const existing = DEFAULT_QUESTION_SET.steps.find((step) => step.key === key);
  if (existing) {
    return {
      ...existing,
      quickReplies: [...existing.quickReplies],
    };
  }
  return {
    key,
    question: "",
    quickReplies: [],
    optional: key === "delivery" || key === "additional",
    enabled: true,
    order: DEFAULT_QUESTION_SET.steps.length + 1,
  };
}

export default function RecommendAssistantSettingsPage() {
  const [steps, setSteps] = useState<AssistantStepConfig[]>([]);
  const [name, setName] = useState("質問セット草案");
  const [sets, setSets] = useState<AssistantQuestionSet[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [addStepKey, setAddStepKey] = useState<AssistantStepKey | "">("");

  const publishedSet = useMemo(
    () => sets.find((set) => set.status === "published") ?? null,
    [sets]
  );
  const editingSet = useMemo(
    () => sets.find((set) => set.id === editingSetId) ?? null,
    [sets, editingSetId]
  );
  const availableStepKeys = useMemo(
    () =>
      ASSISTANT_STEP_KEYS.filter((key) => !steps.some((step) => step.key === key)),
    [steps]
  );

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;

    const next = [...steps];
    const current = next[index];
    next[index] = next[target];
    next[target] = current;
    setSteps(normalizeStepOrders(next));
  }

  function removeStep(index: number) {
    const next = steps.filter((_, currentIndex) => currentIndex !== index);
    setSteps(normalizeStepOrders(next));
  }

  function addStep() {
    if (!addStepKey) return;
    const next = [...steps, createDefaultStep(addStepKey)];
    setSteps(normalizeStepOrders(next));
  }

  async function refreshSets() {
    try {
      const res = await fetch("/api/recommend-assistant-settings/sets");
      const data = (await res.json()) as SetsResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "設定一覧の取得に失敗しました。");
      }
      setSets(data.sets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "設定一覧の取得に失敗しました。");
    }
  }

  async function generateDraft() {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/recommend-assistant-settings/generate", {
        method: "POST",
      });
      const data = (await res.json()) as GenerateResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "候補生成に失敗しました。");
      }
      setSteps(normalizeStepOrders(data.steps ?? []));
      setEditingSetId(null);
      setName("質問セット草案");
      setInfo("候補を再生成しました。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "候補生成に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  async function saveDraft() {
    if (!name.trim()) {
      setError("質問セット名を入力してください。");
      return;
    }
    if (steps.length === 0) {
      setError("質問ステップが空です。");
      return;
    }
    const normalizedSteps = normalizeStepOrders(steps);
    setSteps(normalizedSteps);

    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      if (editingSetId) {
        const res = await fetch(
          `/api/recommend-assistant-settings/sets/${editingSetId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, steps: normalizedSteps }),
          }
        );
        const data = (await res.json()) as UpdateResponse;
        if (!res.ok || !data.ok || !data.set) {
          throw new Error(data.error ?? "セットの更新に失敗しました。");
        }
        setLastSavedId(data.set.id);
        setInfo("セットを更新しました。");
      } else {
        const res = await fetch("/api/recommend-assistant-settings/sets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, steps: normalizedSteps }),
        });
        const data = (await res.json()) as CreateResponse;
        if (!res.ok || !data.ok || !data.set) {
          throw new Error(data.error ?? "草案の保存に失敗しました。");
        }
        setLastSavedId(data.set.id);
        setInfo("草案を保存しました。");
      }
      await refreshSets();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "草案の保存または更新に失敗しました。"
      );
    } finally {
      setSaving(false);
    }
  }

  function loadSetForEdit(target: AssistantQuestionSet) {
    setEditingSetId(target.id);
    setName(target.name);
    setSteps(
      normalizeStepOrders(
        target.steps.map((step) => ({
          ...step,
          quickReplies: [...step.quickReplies],
        }))
      )
    );
    setLastSavedId(target.id);
    setError(null);
    setInfo(`v${target.version} を編集中です。`);
  }

  function cancelEditMode() {
    setEditingSetId(null);
    setError(null);
    setInfo("編集モードを終了しました。");
  }

  async function deleteSet(id: string) {
    const target = sets.find((set) => set.id === id);
    if (!target) return;
    if (!window.confirm(`v${target.version} ${target.name} を削除しますか？`)) {
      return;
    }

    setDeletingId(id);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/recommend-assistant-settings/sets/${id}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as DeleteResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "削除に失敗しました。");
      }
      if (editingSetId === id) {
        setEditingSetId(null);
      }
      if (lastSavedId === id) {
        setLastSavedId(null);
      }
      setInfo("セットを削除しました。");
      await refreshSets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました。");
    } finally {
      setDeletingId(null);
    }
  }

  async function publishSet(id: string) {
    setPublishingId(id);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/recommend-assistant-settings/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json()) as PublishResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "公開に失敗しました。");
      }
      setInfo("公開設定を更新しました。");
      await refreshSets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "公開に失敗しました。");
    } finally {
      setPublishingId(null);
    }
  }

  useEffect(() => {
    void refreshSets();
    void generateDraft();
  }, []);

  useEffect(() => {
    if (availableStepKeys.length === 0) {
      if (addStepKey !== "") {
        setAddStepKey("");
      }
      return;
    }
    if (!addStepKey || !availableStepKeys.includes(addStepKey)) {
      setAddStepKey(availableStepKeys[0]);
    }
  }, [addStepKey, availableStepKeys]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Recommend Assistant Settings
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          レコメンド質問セット管理
        </h1>
        <p className="text-sm text-muted-foreground">
          メタデータから候補を生成し、質問文・選択肢を編集して公開できます。
        </p>
      </div>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">操作</div>
            <div className="text-xs text-muted-foreground">
              候補再生成 → 編集 → 草案保存 → 公開 の順で進めます。
            </div>
            {editingSet && (
              <div className="text-xs text-primary">
                編集中: v{editingSet.version} {editingSet.name}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={generateDraft} disabled={loading}>
              {loading ? "生成中..." : "候補再生成"}
            </Button>
            <Button onClick={saveDraft} disabled={saving}>
              {saving
                ? editingSetId
                  ? "更新中..."
                  : "保存中..."
                : editingSetId
                  ? "編集中セットを更新"
                  : "草案保存"}
            </Button>
            {editingSetId && (
              <Button variant="outline" onClick={cancelEditMode} disabled={saving}>
                編集を終了
              </Button>
            )}
            {lastSavedId && (
              <Button
                variant="secondary"
                onClick={() => publishSet(lastSavedId)}
                disabled={publishingId === lastSavedId}
              >
                {publishingId === lastSavedId ? "公開中..." : "最新草案を公開"}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">質問セット名</div>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <div>公開中のセット: {publishedSet ? publishedSet.name : "なし"}</div>
            <div>公開日時: {publishedSet ? formatDate(publishedSet.publishedAt) : "-"}</div>
          </div>
        </div>

        {info && <div className="mt-3 text-sm text-emerald-600">{info}</div>}
        {error && <div className="mt-3 text-sm text-destructive">{error}</div>}
      </Card>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="text-sm font-medium text-foreground">質問ステップ編集</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={addStepKey}
            onChange={(event) => setAddStepKey(event.target.value as AssistantStepKey | "")}
            disabled={availableStepKeys.length === 0}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            {availableStepKeys.length === 0 ? (
              <option value="">追加できるステップはありません</option>
            ) : (
              availableStepKeys.map((key) => (
                <option key={key} value={key}>
                  {STEP_KEY_LABELS[key]} ({key})
                </option>
              ))
            )}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addStep}
            disabled={!addStepKey}
          >
            ステップ追加
          </Button>
        </div>
        <div className="mt-4 space-y-4">
          {steps.length === 0 ? (
            <div className="text-sm text-muted-foreground">ステップがありません。</div>
          ) : (
            steps.map((step, index) => (
              <div key={`${step.key}-${index}`} className="rounded border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">
                    {index + 1}. {STEP_KEY_LABELS[step.key] ?? step.key}
                    <span className="ml-1 text-xs text-muted-foreground">({step.key})</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {step.optional ? "任意" : "必須"} / {step.enabled ? "有効" : "無効"}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={index === 0}
                      onClick={() => moveStep(index, -1)}
                    >
                      上へ
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={index === steps.length - 1}
                      onClick={() => moveStep(index, 1)}
                    >
                      下へ
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeStep(index)}
                    >
                      削除
                    </Button>
                  </div>
                </div>
                <div className="mt-2 space-y-2">
                  <Textarea
                    value={step.question}
                    onChange={(event) => {
                      const next = [...steps];
                      next[index] = { ...next[index], question: event.target.value };
                      setSteps(next);
                    }}
                  />
                  <Input
                    value={step.quickReplies.join(", ")}
                    onChange={(event) => {
                      const next = [...steps];
                      next[index] = {
                        ...next[index],
                        quickReplies: event.target.value
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean),
                      };
                      setSteps(next);
                    }}
                    placeholder="選択肢をカンマ区切りで入力"
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="border bg-card/60 p-4 shadow-sm sm:p-6">
        <div className="text-sm font-medium text-foreground">保存済みセット</div>
        <div className="mt-3 space-y-2">
          {sets.length === 0 ? (
            <div className="text-sm text-muted-foreground">保存済みセットがありません。</div>
          ) : (
            sets.map((set) => (
              <div
                key={set.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
              >
                <div className="space-y-1">
                  <div className="font-medium">
                    v{set.version} {set.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    status: {set.status} / created: {formatDate(set.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => loadSetForEdit(set)}
                  >
                    編集読み込み
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={set.status === "published" || deletingId === set.id}
                    onClick={() => {
                      void deleteSet(set.id);
                    }}
                  >
                    {deletingId === set.id
                      ? "削除中..."
                      : set.status === "published"
                        ? "公開中は削除不可"
                        : "削除"}
                  </Button>
                  <Button
                    type="button"
                    variant={set.status === "published" ? "secondary" : "outline"}
                    size="sm"
                    disabled={set.status === "published" || publishingId === set.id}
                    onClick={() => publishSet(set.id)}
                  >
                    {publishingId === set.id
                      ? "公開中..."
                      : set.status === "published"
                        ? "公開中"
                        : "公開"}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
