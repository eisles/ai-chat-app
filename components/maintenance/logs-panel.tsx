"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  MaintenanceActionLog,
  MaintenanceLogStatus,
} from "@/lib/maintenance-action-log";

type LogFilter = "all" | MaintenanceLogStatus;

type MaintenanceLogsPanelProps = {
  logs: MaintenanceActionLog[];
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "未実行";
  }
  return new Date(value).toLocaleString("ja-JP");
}

export function MaintenanceLogsPanel({ logs }: MaintenanceLogsPanelProps) {
  const [filter, setFilter] = useState<LogFilter>("all");

  const filteredLogs = useMemo(() => {
    if (filter === "all") {
      return logs;
    }
    return logs.filter((log) => log.status === filter);
  }, [filter, logs]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          表示件数: {filteredLogs.length} / {logs.length}
        </div>
        <Select value={filter} onValueChange={(value) => setFilter(value as LogFilter)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="ステータスで絞り込み" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all</SelectItem>
            <SelectItem value="success">success</SelectItem>
            <SelectItem value="error">error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filteredLogs.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          該当する実行ログはありません。
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLogs.map((log) => (
            <div key={log.id} className="rounded-lg border bg-background/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium">{log.action}</div>
                <Badge
                  variant={log.status === "success" ? "default" : "destructive"}
                >
                  {log.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(log.createdAt)}
                </span>
                {log.durationMs !== null ? (
                  <span className="text-xs text-muted-foreground">
                    duration: {log.durationMs} ms
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>actor: {log.actor ?? "unknown"}</span>
                <span>source: {log.requestSource ?? "unknown"}</span>
              </div>
              {log.message ? (
                <div className="mt-2 text-sm text-foreground">{log.message}</div>
              ) : null}
              {log.error ? (
                <div className="mt-2 text-sm text-destructive">{log.error}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
