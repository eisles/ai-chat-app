"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";

type ProductResultCardProps = {
  imageUrl: string | null;
  displayName: string;
  productUrl: string;
  amount: number | null;
  cityCode?: string | null;
  municipalityName?: string | null;
  productId?: string | null;
  accent?: ReactNode;
  badges?: ReactNode;
  details?: ReactNode;
  extra?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  onProductClick?: () => void;
};

export function ProductResultCard({
  imageUrl,
  displayName,
  productUrl,
  amount,
  cityCode = null,
  municipalityName = null,
  productId = null,
  accent,
  badges,
  details,
  extra,
  primaryAction,
  secondaryAction,
  onProductClick,
}: ProductResultCardProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const displayImage = imageUrl && failedImageUrl !== imageUrl ? imageUrl : null;

  return (
    <div className="overflow-hidden rounded-lg border bg-background/70 shadow-sm transition-shadow hover:shadow-md">
      <div className="relative aspect-[4/3] bg-muted">
        {displayImage ? (
          <Image
            src={displayImage}
            alt={displayName}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            onError={() => setFailedImageUrl(imageUrl)}
          />
        ) : null}
        <div
          className={`absolute inset-0 items-center justify-center bg-muted text-sm text-muted-foreground ${
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
          onClick={onProductClick}
        >
          {displayName}
          <span className="ml-1 inline-block text-xs text-muted-foreground">↗</span>
        </a>

        {accent ? <div className="mt-2">{accent}</div> : null}

        <div className="mt-2 text-lg font-bold text-primary">
          {amount != null ? `${amount.toLocaleString()}円` : "金額未設定"}
        </div>

        {badges ? <div className="mt-2">{badges}</div> : null}
        {details ? <div className="mt-2">{details}</div> : null}

        <div className="mt-1 text-xs text-muted-foreground">自治体コード: {cityCode ?? "-"}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          自治体名: {municipalityName ?? "-"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">品ID: {productId ?? "-"}</div>

        {extra ? <div className="mt-2">{extra}</div> : null}
        {primaryAction ? <div className="mt-3">{primaryAction}</div> : null}
        {secondaryAction ? <div className="mt-2">{secondaryAction}</div> : null}
      </div>
    </div>
  );
}
