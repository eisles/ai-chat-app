"use client";

import Image from "next/image";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  formatProductImageSourceLabel,
  type ProductImageEntry,
} from "@/lib/product-detail";

type ProductImageGalleryProps = {
  images: ProductImageEntry[];
  title: string;
};

export function ProductImageGallery({
  images,
  title,
}: ProductImageGalleryProps) {
  const normalizedImages = useMemo(
    () => images.filter((image) => image.url.trim().length > 0),
    [images]
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const thumbnailButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function scrollThumbnailIntoView(index: number) {
    const target = thumbnailButtonRefs.current[index];
    if (!target) {
      return;
    }

    target.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }

  function selectThumbnail(index: number) {
    setSelectedIndex(index);
    requestAnimationFrame(() => {
      scrollThumbnailIntoView(index);
    });
  }

  function moveThumbnail(direction: "left" | "right") {
    const lastIndex = normalizedImages.length - 1;
    if (lastIndex <= 0) {
      return;
    }

    const nextIndex =
      direction === "left"
        ? selectedIndex === 0
          ? lastIndex
          : selectedIndex - 1
        : selectedIndex === lastIndex
          ? 0
          : selectedIndex + 1;
    selectThumbnail(nextIndex);
  }

  if (normalizedImages.length === 0) {
    return (
      <div className="relative aspect-[4/3] overflow-hidden rounded-md border bg-muted">
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          画像なし
        </div>
      </div>
    );
  }

  const safeSelectedIndex = Math.min(selectedIndex, normalizedImages.length - 1);
  const selectedImage = normalizedImages[safeSelectedIndex] ?? normalizedImages[0]!;

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-md border bg-muted">
        <Image
          src={selectedImage.url}
          alt={title}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 100vw, 720px"
        />
        {normalizedImages.length > 1 ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute left-3 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full bg-background/70 shadow backdrop-blur-sm hover:bg-background/85"
              onClick={() => moveThumbnail("left")}
              aria-label="前の画像へ移動"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute right-3 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full bg-background/70 shadow backdrop-blur-sm hover:bg-background/85"
              onClick={() => moveThumbnail("right")}
              aria-label="次の画像へ移動"
            >
              <ChevronRightIcon className="h-5 w-5" />
            </Button>
          </>
        ) : null}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {safeSelectedIndex + 1} / {normalizedImages.length}
        </span>
        <span>{formatProductImageSourceLabel(selectedImage.sourceKey)}</span>
      </div>
      {normalizedImages.length > 1 ? (
        <div className="relative w-full overflow-hidden">
          <div
            className="flex min-w-0 flex-1 gap-2 overflow-x-auto scroll-smooth pb-1 snap-x snap-mandatory [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: "none" }}
          >
            {normalizedImages.map((image, index) => {
              const isActive = index === safeSelectedIndex;
              return (
                <Button
                  key={`${image.url}-${index}`}
                  ref={(node) => {
                    thumbnailButtonRefs.current[index] = node;
                  }}
                  type="button"
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className="h-auto w-[calc((100%-2rem)/5)] min-w-[calc((100%-2rem)/5)] shrink-0 snap-start p-1"
                  onClick={() => selectThumbnail(index)}
                >
                  <div className="relative h-14 w-full overflow-hidden rounded">
                    <Image
                      src={image.url}
                      alt={`${title} ${index + 1}`}
                      fill
                      className="object-cover"
                      sizes="80px"
                    />
                  </div>
                </Button>
              );
            })}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute left-1 top-1/2 z-10 -translate-y-1/2 bg-background/90 shadow"
            onClick={() => moveThumbnail("left")}
            aria-label="前の画像候補を見る"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute right-1 top-1/2 z-10 -translate-y-1/2 bg-background/90 shadow"
            onClick={() => moveThumbnail("right")}
            aria-label="次の画像候補を見る"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
