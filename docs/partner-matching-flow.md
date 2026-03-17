# パートナーサイトURL マッチングフロー

お礼の品IDとパートナーサイト商品URLの紐づけ管理フロー。

## 概要

- CMS側でパートナー商品URL・画像URLとお礼の品IDを登録
- CSV/JSONでエクスポートし、バッチ処理で本アプリDBへ取り込み
- 1つのお礼の品IDに対して複数パートナーURLを紐づけ（1対多）
- 本アプリ側では画像+リンクの一覧として表示

## 全体フロー

```mermaid
flowchart TB
    A1[パートナーサイト登録] --> A2[商品URL 画像URL登録]
    A3[お礼の品登録] --> A4[マッチング登録]
    A2 --> A4
    A4 --> A5[CSV JSON エクスポート]
    A5 --> S1[S3 SFTP]
    SC1[cron 毎日AM3時] --> B1[ファイル検知]
    S1 --> B2[取得 パース]
    B1 --> B2
    B2 --> B3[バリデーション]
    B3 -- OK --> B5[差分検出]
    B3 -- NG --> B8[エラー通知]
    B5 --> B6[DB反映]
    B6 --> B7[ログ出力 アーカイブ]
    B6 --> T1[マッチングテーブル]

    U[ユーザー入力] --> QA[クエリ解析]
    QA --> Search[3-Way Hybrid Search]
    Search --> Results[検索結果 お礼の品リスト]
    Results --> PM[マッチングテーブル JOIN]
    T1 --> PM
    PM --> LLM[LLM 推薦文生成]
    LLM --> Response[画像とリンク一覧表示]
```

## バッチ処理シーケンス

```mermaid
sequenceDiagram
    Cron->>Batch: 定時起動
    Batch->>Store: 未処理ファイル検索
    Store-->>Batch: JSONファイル
    Batch->>Batch: バリデーション
    alt NG
        Batch->>Notify: エラー通知
    else OK
        Batch->>DB: 既存データ取得
        Batch->>DB: UPSERT DELETE
        Batch->>Store: アーカイブ移動
        Batch->>Notify: 完了通知
    end
```

## データ構造

### CSV/JSON インポート形式

```json
{
  "matchings": [
    {
      "gift_item_id": "001",
      "partner_name": "パートナーA",
      "product_url": "https://partner-a.com/product/123",
      "image_url": "https://partner-a.com/images/123.jpg"
    },
    {
      "gift_item_id": "001",
      "partner_name": "パートナーB",
      "product_url": "https://partner-b.com/product/456",
      "image_url": "https://partner-b.com/images/456.jpg"
    }
  ]
}
```

### マッチングテーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | serial | 主キー |
| gift_item_id | varchar | お礼の品ID |
| partner_name | varchar | パートナー名 |
| product_url | text | 商品ページURL |
| image_url | text | 商品画像URL |
| created_at | timestamp | 作成日時 |
| updated_at | timestamp | 更新日時 |

### ユニーク制約

`gift_item_id + product_url` の複合ユニーク制約でUPSERT制御。

## バッチ処理仕様

| 項目 | 内容 |
|------|------|
| 実行タイミング | 毎日 AM 3:00 (cron) |
| ファイル配置先 | S3 / SFTP / 共有ストレージ |
| ファイル形式 | JSON (CSV対応可) |
| 差分処理 | 追加・更新・削除を差分検出 |
| エラー時 | ファイル単位でスキップし通知 |
| 処理済ファイル | archive/ へ移動して再処理防止 |
| DB反映 | トランザクション一括コミット |

## 検索チャットとパートナーリンク表示フロー

### 検索結果とパートナーリンクの結合

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant Chat as チャット画面
    participant API as chat-recommend API
    participant HS as Hybrid Search
    participant PTE as product_text_embeddings
    participant MT as matching テーブル
    participant LLM as LLM

    User->>Chat: お肉のおすすめは?
    Chat->>API: POST history=お肉のおすすめ
    API->>API: クエリ解析 タイプ=keyword
    API->>HS: 3-Way Hybrid Search実行

    par 並列検索
        HS->>PTE: Dense検索 pgvector
        HS->>PTE: Sparse検索 pg_trgm
        HS->>PTE: Keyword検索 ILIKE
    end

    PTE-->>HS: 各検索結果
    HS->>HS: RRF スコア統合
    HS->>HS: カテゴリブースト適用
    HS-->>API: 上位N件のお礼の品

    API->>MT: gift_item_idで パートナーリンク取得
    MT-->>API: 画像URL リンクURL一覧

    API->>LLM: 検索結果で推薦文生成
    LLM-->>API: 推薦テキスト

    API-->>Chat: 推薦文 + 商品情報 + パートナーリンク
    Chat-->>User: 推薦表示 + パートナーリンク一覧
```

### レスポンス構造

```json
{
  "recommendation": "お肉のお礼の品をご紹介します...",
  "items": [
    {
      "gift_item_id": "001",
      "name": "黒毛和牛 すき焼きセット",
      "score": 0.92,
      "search_type": "keyword",
      "partner_links": [
        {
          "partner_name": "パートナーA",
          "product_url": "https://partner-a.com/product/123",
          "image_url": "https://partner-a.com/images/123.jpg"
        },
        {
          "partner_name": "パートナーB",
          "product_url": "https://partner-b.com/product/456",
          "image_url": "https://partner-b.com/images/456.jpg"
        }
      ]
    }
  ]
}
```

### 表示イメージ

```
AI: お肉のお礼の品をご紹介します。

1. 黒毛和牛 すき焼きセット（スコア: 0.92）
   ┣ [画像A] パートナーA → 購入ページへ
   ┣ [画像B] パートナーB → 購入ページへ
   ┗ [画像C] パートナーC → 購入ページへ

2. 特選焼肉セット（スコア: 0.87）
   ┣ [画像D] パートナーA → 購入ページへ
   ┗ [画像E] パートナーD → 購入ページへ
```

### パートナーリンク取得クエリ

```sql
SELECT m.partner_name, m.product_url, m.image_url
FROM partner_matching m
WHERE m.gift_item_id = ANY($1)
ORDER BY m.gift_item_id, m.partner_name;
```

検索結果の `gift_item_id` 配列を渡し、一括でパートナーリンクを取得する。
