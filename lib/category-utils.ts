/**
 * Category Utilities
 * カテゴリ推論とスコア調整のためのユーティリティ
 */

export type ProductCategory = {
  category1_name?: string | null;
  category2_name?: string | null;
  category3_name?: string | null;
};

export type RawProduct = {
  categories?: ProductCategory[] | null;
};

/**
 * metadata.raw から categories 配列を抽出
 */
export function extractCategoriesFromMetadata(
  metadata: Record<string, unknown> | null
): ProductCategory[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = metadata.raw as RawProduct | undefined;
  if (!raw || typeof raw !== "object") return [];
  return raw.categories ?? [];
}

/**
 * カテゴリ配列から全てのカテゴリ名を抽出（フラット化）
 */
export function flattenCategoryNames(categories: ProductCategory[]): string[] {
  return categories
    .flatMap((c) => [c.category1_name, c.category2_name, c.category3_name])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/**
 * カテゴリ配列が指定カテゴリを含むか判定
 */
export function matchesCategory(
  categories: ProductCategory[],
  targetCategory: string
): boolean {
  if (!targetCategory || categories.length === 0) return false;

  const normalizedTarget = targetCategory.trim().toLowerCase();

  return categories.some((entry) => {
    const names = [
      entry.category1_name,
      entry.category2_name,
      entry.category3_name,
    ]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.toLowerCase());

    return names.some(
      (name) =>
        name.includes(normalizedTarget) || normalizedTarget.includes(name)
    );
  });
}

/**
 * カテゴリ一致度に基づくスコア調整値を計算
 * @returns 正の値（一致）または負の値（不一致）
 */
export function getCategoryScoreAdjustment(
  categories: ProductCategory[],
  inferredCategory: string | null
): number {
  if (!inferredCategory) return 0;

  if (matchesCategory(categories, inferredCategory)) {
    return 0.15; // Category match boost
  }

  // Penalty reduced from -0.2 to -0.1 based on Codex review
  // Too aggressive penalty may hide relevant results
  return -0.1; // Category mismatch penalty
}

/**
 * 検索キーワードから推論されるカテゴリのマッピング
 */
export const KEYWORD_TO_CATEGORY: Record<string, string> = {
  // 肉類
  お肉: "肉",
  肉: "肉",
  牛肉: "肉",
  豚肉: "肉",
  鶏肉: "肉",
  和牛: "肉",
  黒毛和牛: "肉",
  ステーキ: "肉",
  焼肉: "肉",
  ハンバーグ: "肉",
  ベーコン: "肉",
  ハム: "肉",
  ソーセージ: "肉",
  すき焼き: "肉",
  しゃぶしゃぶ: "肉",
  ローストビーフ: "肉",

  // 魚介類
  魚: "魚介",
  海鮮: "魚介",
  シーフード: "魚介",
  鰻: "魚介",
  うなぎ: "魚介",
  ウナギ: "魚介",
  蟹: "魚介",
  カニ: "魚介",
  かに: "魚介",
  エビ: "魚介",
  海老: "魚介",
  えび: "魚介",
  いくら: "魚介",
  イクラ: "魚介",
  鮭: "魚介",
  サーモン: "魚介",
  マグロ: "魚介",
  まぐろ: "魚介",
  鯛: "魚介",
  たい: "魚介",
  ホタテ: "魚介",
  帆立: "魚介",
  ほたて: "魚介",
  牡蠣: "魚介",
  カキ: "魚介",
  かき: "魚介",
  ふぐ: "魚介",
  フグ: "魚介",
  アワビ: "魚介",
  あわび: "魚介",
  ウニ: "魚介",
  うに: "魚介",

  // 果物
  果物: "果物",
  フルーツ: "果物",
  りんご: "果物",
  リンゴ: "果物",
  林檎: "果物",
  みかん: "果物",
  ミカン: "果物",
  蜜柑: "果物",
  ぶどう: "果物",
  ブドウ: "果物",
  葡萄: "果物",
  シャインマスカット: "果物",
  マスカット: "果物",
  桃: "果物",
  もも: "果物",
  モモ: "果物",
  梨: "果物",
  なし: "果物",
  ナシ: "果物",
  いちご: "果物",
  イチゴ: "果物",
  苺: "果物",
  メロン: "果物",
  マンゴー: "果物",
  さくらんぼ: "果物",
  サクランボ: "果物",
  柿: "果物",
  // かき: "果物", // 「かき」は魚介（牡蠣）として定義済み、柿は漢字で対応
  びわ: "果物",
  キウイ: "果物",
  スイカ: "果物",
  西瓜: "果物",

  // 野菜
  野菜: "野菜",
  トマト: "野菜",
  きゅうり: "野菜",
  なす: "野菜",
  玉ねぎ: "野菜",
  じゃがいも: "野菜",
  にんじん: "野菜",
  キャベツ: "野菜",
  レタス: "野菜",
  ほうれん草: "野菜",
  アスパラ: "野菜",

  // 米
  米: "米",
  お米: "米",
  コシヒカリ: "米",
  ひとめぼれ: "米",
  あきたこまち: "米",
  ゆめぴりか: "米",
  ななつぼし: "米",
  つや姫: "米",
  新米: "米",

  // 酒
  酒: "酒",
  お酒: "酒",
  日本酒: "酒",
  ワイン: "酒",
  ビール: "酒",
  焼酎: "酒",
  ウイスキー: "酒",
  地酒: "酒",
  クラフトビール: "酒",

  // スイーツ・菓子
  スイーツ: "スイーツ",
  ケーキ: "スイーツ",
  チョコレート: "スイーツ",
  アイス: "スイーツ",
  アイスクリーム: "スイーツ",
  和菓子: "スイーツ",
  洋菓子: "スイーツ",
  プリン: "スイーツ",
  クッキー: "スイーツ",
  お菓子: "スイーツ",
  菓子: "スイーツ",
  饅頭: "スイーツ",
  まんじゅう: "スイーツ",
  羊羹: "スイーツ",
  ようかん: "スイーツ",

  // 加工品
  加工品: "加工品",
  缶詰: "加工品",
  レトルト: "加工品",
  干物: "加工品",
  漬物: "加工品",
  佃煮: "加工品",
  燻製: "加工品",

  // 調味料
  調味料: "調味料",
  醤油: "調味料",
  味噌: "調味料",
  塩: "調味料",
  酢: "調味料",
  ドレッシング: "調味料",
  ソース: "調味料",

  // 飲料
  飲料: "飲料",
  ジュース: "飲料",
  お茶: "飲料",
  コーヒー: "飲料",
  紅茶: "飲料",
  水: "飲料",
  炭酸: "飲料",

  // 工芸品・雑貨
  工芸品: "工芸品",
  雑貨: "雑貨",
  陶器: "工芸品",
  漆器: "工芸品",
  織物: "工芸品",
  タオル: "雑貨",

  // 旅行・体験
  旅行: "旅行",
  体験: "体験",
  宿泊: "旅行",
  チケット: "体験",
  温泉: "旅行",
};

/**
 * キーワードからカテゴリを推論（辞書ベース）
 */
export function inferCategoryFromKeyword(keyword: string): string | null {
  if (!keyword) return null;

  const normalized = keyword.trim();

  // 完全一致
  if (KEYWORD_TO_CATEGORY[normalized]) {
    return KEYWORD_TO_CATEGORY[normalized];
  }

  // 部分一致（キーワードがマッピングキーを含む、またはその逆）
  for (const [key, category] of Object.entries(KEYWORD_TO_CATEGORY)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return category;
    }
  }

  return null;
}

/**
 * 複数キーワードからカテゴリを推論
 * 最初にマッチしたカテゴリを返す
 */
export function inferCategoryFromKeywords(keywords: string[]): string | null {
  for (const keyword of keywords) {
    const category = inferCategoryFromKeyword(keyword);
    if (category) return category;
  }
  return null;
}

/**
 * 大カテゴリ名のリスト（LLMプロンプト用）
 */
export const KNOWN_CATEGORIES = [
  "肉",
  "魚介",
  "果物",
  "野菜",
  "米",
  "酒",
  "スイーツ",
  "加工品",
  "調味料",
  "飲料",
  "工芸品",
  "雑貨",
  "旅行",
  "体験",
] as const;

export type KnownCategory = (typeof KNOWN_CATEGORIES)[number];
