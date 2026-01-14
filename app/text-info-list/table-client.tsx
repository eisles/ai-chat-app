"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMemo, useState } from "react";

type Row = Record<string, string | number | boolean | null>;

function formatCell(value: Row[string]) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" && value.length > 100) {
    return value.slice(0, 100) + "...";
  }
  return String(value);
}

type Props = {
  rows: Row[];
};

export default function TextInfoTable({ rows }: Props) {
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);

  const columns = useMemo(() => {
    const baseColumns = rows.reduce<Set<string>>((set, row) => {
      Object.keys(row ?? {}).forEach((key) => set.add(key));
      return set;
    }, new Set<string>());

    const ordered: string[] = [];
    const addColumn = (key: string) => {
      if (baseColumns.has(key) && !ordered.includes(key)) {
        ordered.push(key);
      }
    };

    // Prioritize important columns
    addColumn("id");
    addColumn("product_id");
    addColumn("city_code");
    addColumn("text");
    addColumn("metadata");
    addColumn("created_at");

    // Add remaining columns except embedding
    Array.from(baseColumns)
      .filter((key) => !ordered.includes(key) && key !== "embedding")
      .forEach((key) => ordered.push(key));

    return ordered;
  }, [rows]);

  return (
    <>
      <div className="overflow-auto rounded-lg border bg-card/60">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3">
                  {column}
                </th>
              ))}
              <th className="px-4 py-3">actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => (
              <tr key={index} className="hover:bg-muted/40">
                {columns.map((column) => (
                  <td key={column} className="whitespace-nowrap px-4 py-3">
                    {formatCell(row[column])}
                  </td>
                ))}
                <td className="whitespace-nowrap px-4 py-3">
                  <button
                    className="text-xs text-blue-600 hover:underline"
                    onClick={() => setSelectedRow(row)}
                    type="button"
                  >
                    詳細
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setSelectedRow(null);
        }}
        open={Boolean(selectedRow)}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle>レコード詳細</DialogTitle>
          <DialogDescription>
            文字情報の詳細データを表示しています。
          </DialogDescription>
          {selectedRow ? (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {Object.entries(selectedRow).map(([key, value]) => (
                    <tr key={key} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium text-muted-foreground">
                        {key}
                      </td>
                      <td className="px-3 py-2 break-all">
                        {value === null || value === undefined
                          ? ""
                          : String(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
