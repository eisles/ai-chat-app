import { isRerankingAvailable } from "@/lib/reranker";

export const runtime = "nodejs";

// 機能の利用可否を返すエンドポイント
export function GET() {
  return Response.json({
    cohereRerankerAvailable: isRerankingAvailable(),
  });
}
