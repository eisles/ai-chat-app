"use client";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMemo, useState } from "react";

type Row = Record<string, string | number | boolean | null>;

function formatCell(value: Row[string]) {
  if (value === null || value === undefined) return "";
  return String(value);
}

type Props = {
  rows: Row[];
};

export default function ProductImagesVectorizeTable({ rows }: Props) {
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
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

    addColumn("id");
    addColumn("city_code");
    addColumn("product_id");
    if (baseColumns.has("image_url")) {
      ordered.push("image_preview");
    }
    addColumn("image_url");
    Array.from(baseColumns)
      .filter((key) => !ordered.includes(key))
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
                  {column === "image_preview" ? "image" : column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => (
              <tr key={index} className="hover:bg-muted/40">
                {columns.map((column) => (
                  <td key={column} className="whitespace-nowrap px-4 py-3">
                    {column === "image_preview" ? (
                      row.image_url ? (
                        <button
                          className="block"
                          onClick={() =>
                            setSelectedImageUrl(String(row.image_url))
                          }
                          type="button"
                        >
                          <img
                            alt="product"
                            className="h-10 w-10 rounded object-cover"
                            loading="lazy"
                            src={String(row.image_url)}
                          />
                        </button>
                      ) : (
                        ""
                      )
                    ) : (
                      formatCell(row[column])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setSelectedImageUrl(null);
        }}
        open={Boolean(selectedImageUrl)}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle>Image preview</DialogTitle>
          {selectedImageUrl ? (
            <img
              alt="product preview"
              className="max-h-[70vh] w-full rounded object-contain"
              src={selectedImageUrl}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
