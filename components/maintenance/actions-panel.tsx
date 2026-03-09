"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

type ActionItem = {
  value: string;
  label: string;
  pendingLabel: string;
  variant?: "default" | "secondary" | "outline" | "destructive" | "ghost" | "link";
};

type ActionResponse =
  | {
      ok: true;
      action: string;
      message: string;
      executedAt: string;
    }
  | {
      ok: false;
      error: string;
    };

type MaintenanceActionsPanelProps = {
  endpoint: string;
  source: string;
  actions: ActionItem[];
  helpText: React.ReactNode;
};

export function MaintenanceActionsPanel({
  endpoint,
  source,
  actions,
  helpText,
}: MaintenanceActionsPanelProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [isRefreshing, startTransition] = useTransition();

  async function runAction(action: string) {
    setActiveAction(action);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-maintenance-source": source,
        },
        body: JSON.stringify({ action }),
      });

      const data = (await res.json()) as ActionResponse;
      if (!res.ok || !data.ok) {
        setError(data.ok ? "メンテナンスに失敗しました。" : data.error);
        return;
      }

      setMessage(data.message);
      startTransition(() => {
        router.refresh();
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "メンテナンスに失敗しました。"
      );
    } finally {
      setActiveAction(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {actions.map((action) => (
          <Button
            key={action.value}
            type="button"
            variant={action.variant ?? "outline"}
            disabled={activeAction !== null}
            onClick={() => runAction(action.value)}
          >
            {activeAction === action.value ? action.pendingLabel : action.label}
          </Button>
        ))}
      </div>

      <div className="text-xs text-muted-foreground">{helpText}</div>

      {message ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
          {message}
          {isRefreshing ? " 画面を更新しています..." : ""}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}
