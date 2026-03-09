import { describe, expect, it } from "vitest";

import {
  collectProductImageEntries,
  collectProductImageUrls,
  extractMunicipalityName,
  extractProductInfo,
  formatProductImageSourceLabel,
} from "@/lib/product-detail";

describe("product detail helpers", () => {
  it("collects main and slide images without duplicates", () => {
    const metadata = {
      raw: {
        image: "https://example.com/main.jpg",
        slide_image1: "https://example.com/slide-1.jpg",
        slide_image_2: "https://example.com/slide-2.jpg",
        slide_image3: "https://example.com/main.jpg",
      },
    };

    expect(collectProductImageUrls(metadata, ["https://example.com/extra.jpg"])).toEqual([
      "https://example.com/extra.jpg",
      "https://example.com/main.jpg",
      "https://example.com/slide-1.jpg",
      "https://example.com/slide-2.jpg",
    ]);
  });

  it("collects image entries with source column names", () => {
    const metadata = {
      raw: {
        image: "https://example.com/main.jpg",
        slide_image1: "https://example.com/slide-1.jpg",
        slide_image_2: "https://example.com/slide-2.jpg",
      },
    };

    expect(
      collectProductImageEntries(metadata, [
        { url: "https://example.com/extra.jpg", sourceKey: "image_url" },
      ])
    ).toEqual([
      { url: "https://example.com/extra.jpg", sourceKey: "image_url" },
      { url: "https://example.com/main.jpg", sourceKey: "image" },
      { url: "https://example.com/slide-1.jpg", sourceKey: "slide_image1" },
      { url: "https://example.com/slide-2.jpg", sourceKey: "slide_image_2" },
    ]);
  });

  it("extracts name, image, and description from metadata.raw", () => {
    const metadata = {
      raw: {
        name: "ぶどう",
        image: "https://example.com/main.jpg",
        catchphrase: "甘い果物です",
        description: "詳細説明",
      },
    };

    expect(extractProductInfo(metadata)).toEqual({
      name: "ぶどう",
      image: "https://example.com/main.jpg",
      description: "甘い果物です",
    });
  });

  it("formats image source keys into Japanese labels", () => {
    expect(formatProductImageSourceLabel("image")).toBe("代表画像");
    expect(formatProductImageSourceLabel("image_url")).toBe("検索起点画像");
    expect(formatProductImageSourceLabel("slide_image1")).toBe("商品画像1");
    expect(formatProductImageSourceLabel("slide_image_2")).toBe("商品画像2");
    expect(formatProductImageSourceLabel("unknown_key")).toBe("unknown_key");
  });

  it("extracts municipality name from metadata.raw", () => {
    const metadata = {
      raw: {
        prefecture_name: "北海道",
        city_name: "長沼町",
      },
    };

    expect(extractMunicipalityName(metadata)).toBe("北海道 / 長沼町");
  });
});
