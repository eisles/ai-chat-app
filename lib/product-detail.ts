export type ProductDetailInfo = {
  name: string | null;
  image: string | null;
  description: string | null;
};

export type ProductImageEntry = {
  url: string;
  sourceKey: string;
};

export function formatProductImageSourceLabel(sourceKey: string): string {
  if (sourceKey === "image") {
    return "代表画像";
  }
  if (sourceKey === "image_url") {
    return "検索起点画像";
  }

  const slideMatch = sourceKey.match(/^slide_image_?(\d+)$/);
  if (slideMatch) {
    return `商品画像${slideMatch[1]}`;
  }

  return sourceKey;
}

function readRaw(metadata: Record<string, unknown> | null) {
  if (!metadata) {
    return null;
  }

  const raw = metadata.raw;
  if (!raw || typeof raw !== "object") {
    return null;
  }

  return raw as Record<string, unknown>;
}

function normalizeImageUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractProductInfo(
  metadata: Record<string, unknown> | null
): ProductDetailInfo {
  const raw = readRaw(metadata);
  if (!raw) {
    return { name: null, image: null, description: null };
  }

  const descriptionCandidates = [
    raw.catchphrase,
    raw.description,
    raw.shipping_text,
    raw.application_text,
    raw.bulk_text,
  ];
  const description = descriptionCandidates.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  return {
    name: typeof raw.name === "string" ? raw.name : null,
    image: normalizeImageUrl(raw.image),
    description: description ?? null,
  };
}

export function extractMunicipalityName(
  metadata: Record<string, unknown> | null
): string | null {
  const raw = readRaw(metadata);
  if (!raw) {
    return null;
  }

  const municipalityCandidates = [
    normalizeText(raw.municipality_name),
    normalizeText(raw.city_name),
    normalizeText(raw.local_government_name),
  ];
  const prefecture = normalizeText(raw.prefecture_name);
  const municipality = municipalityCandidates.find((value) => value !== null);

  if (prefecture && municipality) {
    return `${prefecture} / ${municipality}`;
  }

  return municipality ?? prefecture ?? null;
}

export function collectProductImageUrls(
  metadata: Record<string, unknown> | null,
  extraImageUrls: Array<string | null | undefined> = []
): string[] {
  return collectProductImageEntries(
    metadata,
    extraImageUrls.map((url) => ({ url, sourceKey: "image_url" }))
  ).map((entry) => entry.url);
}

export function collectProductImageEntries(
  metadata: Record<string, unknown> | null,
  extraImages: Array<{
    url: string | null | undefined;
    sourceKey: string;
  }> = []
): ProductImageEntry[] {
  const raw = readRaw(metadata);
  const candidates: Array<{
    url: unknown;
    sourceKey: string;
  }> = extraImages.map((entry) => ({
    url: entry.url,
    sourceKey: entry.sourceKey,
  }));

  if (raw) {
    candidates.push({ url: raw.image, sourceKey: "image" });
    for (let index = 1; index <= 8; index += 1) {
      candidates.push({
        url: raw[`slide_image${index}`],
        sourceKey: `slide_image${index}`,
      });
      candidates.push({
        url: raw[`slide_image_${index}`],
        sourceKey: `slide_image_${index}`,
      });
    }
  }

  const uniqueUrls = new Set<string>();
  const entries: ProductImageEntry[] = [];
  for (const candidate of candidates) {
    const url = normalizeImageUrl(candidate.url);
    if (!url) {
      continue;
    }
    if (uniqueUrls.has(url)) {
      continue;
    }
    uniqueUrls.add(url);
    entries.push({
      url,
      sourceKey: candidate.sourceKey,
    });
  }

  return entries;
}
