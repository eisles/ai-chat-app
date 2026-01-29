import {
  embedWithVectorizeApi,
  upsertProductImagesVectorize,
} from "@/lib/vectorize-product-images";

type ProductImagePayload = {
  imageUrl?: string;
  productId?: string;
  cityCode?: string;
};

export async function POST(req: Request) {
  const { imageUrl, productId, cityCode }: ProductImagePayload = await req.json();

  const targetImageUrl =
    imageUrl ??
    "https://img.furusato-tax.jp/cdn-cgi/image/width=800,height=498,fit=pad,format=auto/img/unresized/x/product/details/20250519/sd1_5c4f2dc77bd866d82a580e200a1e13fd8e229a84.jpg";
  const targetProductId = productId ?? "20250519";
  const targetCityCode = cityCode ?? null;

  try {
    const { vector, durationMs, byteSize, model, dim, normalized } =
      await embedWithVectorizeApi(targetImageUrl);
    await upsertProductImagesVectorize({
      productId: targetProductId,
      cityCode: targetCityCode,
      imageUrl: targetImageUrl,
      imageEmbedding: {
        vector,
        durationMs,
        byteSize,
        model,
        dim,
        normalized,
      },
    });

    return Response.json({
      ok: true,
      cityCode: targetCityCode ?? undefined,
      productId: targetProductId,
      imageUrl: targetImageUrl,
      embeddingLength: vector.length,
      embeddingByteSize: byteSize,
      embeddingDurationMs: durationMs,
      model,
      dim,
      normalized,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown ingestion error";

    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
