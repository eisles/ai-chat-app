import Link from "next/link";

import {
  listRecentRecommendClickEvents,
  listRecommendClickInteractionCounts,
} from "@/lib/recommend-personalization/repository";

type RecommendClickEventsPageProps = {
  searchParams?: Promise<{
    interaction?: string;
  }>;
};

export default async function RecommendClickEventsPage(
  props: RecommendClickEventsPageProps
) {
  const searchParams = (await props.searchParams) ?? {};
  const selectedInteraction =
    typeof searchParams.interaction === "string" &&
    searchParams.interaction.trim().length > 0
      ? searchParams.interaction.trim()
      : null;

  const [counts, events] = await Promise.all([
    listRecommendClickInteractionCounts(),
    listRecentRecommendClickEvents({
      limit: 100,
      interaction: selectedInteraction,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">クリックイベント管理</h1>
        <p className="text-sm text-muted-foreground">
          `recommend_click_events` の最近の記録です。`similar_image_search` を含む
          interaction をここで確認できます。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/recommend-click-events"
          className={`rounded-lg border p-4 text-sm transition-colors ${
            selectedInteraction === null ? "border-primary bg-primary/5" : "bg-card/60"
          }`}
        >
          <div className="text-xs text-muted-foreground">filter</div>
          <div className="mt-1 font-medium">all</div>
        </Link>
        {counts.map((row) => (
          <Link
            key={row.interaction}
            href={`/recommend-click-events?interaction=${encodeURIComponent(row.interaction)}`}
            className={`rounded-lg border p-4 text-sm transition-colors ${
              selectedInteraction === row.interaction
                ? "border-primary bg-primary/5"
                : "bg-card/60"
            }`}
          >
            <div className="text-xs text-muted-foreground">interaction</div>
            <div className="mt-1 font-medium">{row.interaction}</div>
            <div className="mt-1 text-xs text-muted-foreground">{row.count}件</div>
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card/60">
        <div className="border-b px-4 py-3 text-sm font-medium">
          最近のクリックイベント {selectedInteraction ? `(${selectedInteraction})` : ""}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">created_at</th>
                <th className="px-4 py-3">interaction</th>
                <th className="px-4 py-3">source</th>
                <th className="px-4 py-3">product_id</th>
                <th className="px-4 py-3">city_code</th>
                <th className="px-4 py-3">score</th>
                <th className="px-4 py-3">user_id</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={7}>
                    該当イベントはありません。
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr className="border-t align-top" key={`${event.createdAt}-${event.userId}-${event.productId}`}>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString("ja-JP", {
                        timeZone: "Asia/Tokyo",
                      })}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {event.interaction ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-xs">{event.source}</td>
                    <td className="px-4 py-3 text-xs">{event.productId}</td>
                    <td className="px-4 py-3 text-xs">{event.cityCode ?? "-"}</td>
                    <td className="px-4 py-3 text-xs">
                      {event.score != null ? event.score.toFixed(4) : "-"}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                      {event.userId}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
