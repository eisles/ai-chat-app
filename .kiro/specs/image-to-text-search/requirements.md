# Requirements Document

## Introduction
画像をアップロードして日本語の説明文を生成し、その説明文をベクトル化して既存の文字情報ベクトルから類似検索する同期 API を提供する。あわせて、類似検索対象となる文字情報の登録機能を提供する。

## Requirements

### Requirement 1: 画像アップロードと説明文生成
**Objective:** ユーザーとして、画像をアップロードしたら日本語の説明文を取得したい。

#### Acceptance Criteria
1. When ユーザーが PNG/JPEG をアップロードした場合, the service shall GPT-4o を用いて日本語の説明文を生成する。
2. If アップロードがサイズ上限を超える場合, then the service shall 400/413 のエラーを返す。
3. If 非対応形式（PNG/JPEG 以外）をアップロードした場合, then the service shall 400 のエラーを返す。
4. The service shall 説明文と推定信頼度（0.0-1.0）をレスポンスに含める。
5. The service shall 相関 ID をログに付与し、説明生成と検索を追跡できるようにする。

### Requirement 2: テキスト埋め込み生成と類似検索
**Objective:** ユーザーとして、説明文に近い既存の文字情報を検索したい。

#### Acceptance Criteria
1. When 説明文が生成された場合, the service shall 説明文をテキスト埋め込みモデルでベクトル化する。
2. The service shall pgvector を使って既存の文字情報ベクトルから類似検索を行う。
3. The service shall top_k と threshold を任意指定でき、未指定時は推奨デフォルトを使用する。
4. The service shall 類似度スコアと文字情報メタデータをレスポンスに含める。
5. If ベクトル化や検索が失敗した場合, then the service shall エラー原因を返し、処理を中断する。

### Requirement 3: 文字情報ベクトルの登録
**Objective:** サービス提供者として、類似検索対象となる文字情報を登録したい。

#### Acceptance Criteria
1. The service shall 文字情報（text, metadata）を登録できる API を提供する。
2. When 文字情報が登録された場合, the service shall テキスト埋め込みを生成し pgvector に保存する。
3. If 登録時の埋め込み生成に失敗した場合, then the service shall 失敗理由を返し保存しない。
4. The service shall 文字情報の一括登録（bulk）を提供できる。
5. The service shall 既存の文字情報を再登録しないように一意性を担保する。

### Requirement 4: 同期レスポンスと性能
**Objective:** ユーザーとして、画像アップロードから検索結果まで同期で受け取りたい。

#### Acceptance Criteria
1. The service shall 1 回のリクエスト内で説明生成と類似検索まで完了する。
2. The service shall タイムアウトを設定し、超過時はエラーを返す。
3. The service shall 高負荷時に 429 を返す。
4. The service shall レスポンスに処理時間を含められる。
5. The service shall ログに処理時間とエラーを記録する。
