# Implementation Plan

- [ ] 1. 画像説明生成
- [ ] 1.1 GPT-4o 呼び出しクライアント
  - API キー/エンドポイント設定を追加する
  - 画像入力から日本語説明文を生成する関数を実装する
  - _Requirements: 1.1,1.4_
- [ ] 1.2 画像アップロードの同期ハンドラ
  - PNG/JPEG とサイズ上限の検証
  - GPT-4o で説明文生成
  - _Requirements: 1.2,1.3,4.1_

- [ ] 2. テキスト埋め込みと検索
- [ ] 2.1 テキスト埋め込み生成
  - 説明文をベクトル化する関数を実装
  - _Requirements: 2.1_
- [ ] 2.2 pgvector 類似検索
  - top_k/threshold の適用
  - _Requirements: 2.2,2.3,2.4_

- [ ] 3. 文字情報ベクトル登録
- [ ] 3.1 単件登録 API
  - text と metadata を受けて埋め込み生成し保存
  - _Requirements: 3.1,3.2,3.3_
- [ ] 3.2 一括登録 API
  - bulk 登録の受け付け、保存結果の集計
  - _Requirements: 3.4_
- [ ] 3.3 一意性制約
  - text_hash による重複防止
  - _Requirements: 3.5_

- [ ] 4. データモデルとマイグレーション
- [ ] 4.1 text_embeddings テーブル作成
  - embedding vector, metadata, text_hash を含める
  - _Requirements: 2.2,3.2,3.5_
- [ ] 4.2 image_search_logs テーブル作成（任意）
  - 説明文、信頼度、処理時間を保存
  - _Requirements: 4.4,4.5_

- [ ] 5. オプションとエラーハンドリング
- [ ] 5.1 top_k/threshold のデフォルト
  - 未指定時に推奨値を適用
  - _Requirements: 2.3_
- [ ] 5.2 タイムアウトと 429
  - タイムアウト設定と過負荷制御
  - _Requirements: 4.2,4.3_
- [ ] 5.3 correlation_id のログ付与
  - リクエスト/失敗時の相関 ID
  - _Requirements: 1.5,4.5_

- [ ] 6. テスト
- [ ] 6.1 バリデーションと埋め込みの単体テスト
  - 形式/サイズ/option デフォルト
  - _Requirements: 1.2,1.3,2.3_
- [ ] 6.2 /image-search の統合テスト
  - 正常系・異常系・429
  - _Requirements: 1.1,2.2,4.1,4.3_
- [ ] 6.3 /texts と /texts/bulk の統合テスト
  - 重複排除と bulk 集計
  - _Requirements: 3.1,3.2,3.4,3.5_
