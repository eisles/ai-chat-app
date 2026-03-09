# Project Structure

## Organization Philosophy

Next.js App Router を中心に、ページ/機能単位でディレクトリを分割する。UI は共通コンポーネントとして `components` 配下に集約し、API は `app/api` に集約する。

## Directory Patterns

### App Routes
**Location**: `/app/`  
**Purpose**: 画面単位の UI と API ルートを同居させる  
**Example**: `/app/image-search/page.tsx`, `/app/api/image-search/route.ts`

### Feature-local Helpers
**Location**: 各 route ディレクトリ直下の `table-client.tsx`, `actions-client.tsx` など  
**Purpose**: Page 本体はデータ取得やレイアウトに寄せ、クライアント状態や局所 UI を同階層ファイルへ分離する  
**Example**: `/app/product-images-vectorize/maintenance/actions-client.tsx`

### UI Components
**Location**: `/components/ui/`  
**Purpose**: UI プリミティブ（ボタン・カードなど）を共通化  
**Example**: `/components/ui/button.tsx`

### Feature Components
**Location**: `/components/ai-elements/`  
**Purpose**: チャット UI など機能単位の部品  
**Example**: `/components/ai-elements/message.tsx`

### Shared Libraries
**Location**: `/lib/`  
**Purpose**: DB 接続やユーティリティなどの共有ロジック  
**Example**: `/lib/neon.ts`, `/lib/image-text-search.ts`

### Domain Modules
**Location**: `/lib/recommend*`, `/lib/*-config`, `/lib/*-conversation`  
**Purpose**: API ルートから委譲される業務ロジックを機能単位で分離する  
**Example**: `/lib/recommend/by-answers-engine.ts`, `/lib/recommend-agent/service.ts`

### Operational Modules
**Location**: `/lib/*maintenance*`, `/lib/maintenance-action-log.ts`  
**Purpose**: 検索対象テーブルの状態確認、index 再構築、ANALYZE、実行ログ保存などの運用処理を UI/API から安全に呼べる形でまとめる  
**Example**: `/lib/vectorize-product-images-maintenance.ts`, `/lib/text-embeddings-maintenance.ts`

### Database Migrations
**Location**: `/migrations/`  
**Purpose**: Postgres スキーマ変更を SQL ファイルで加算管理する  
**Example**: `/migrations/20260220_recommend_personalization_events.sql`

### Tests
**Location**: `/tests/`  
**Purpose**: API ルートの契約テストと、`lib/` の純粋ロジックの単体テスト  
**Example**: `/tests/api/image-search.test.ts`, `/tests/lib/recommend-agent/service.test.ts`

### Request Guard
**Location**: `/proxy.ts`  
**Purpose**: 環境変数が揃った場合のみ全体を Basic 認証で保護し、片側設定は 500 で fail-closed  
**Example**: `/proxy.ts`（`lib/basic-auth` を参照）

## Naming Conventions

- **Files**: 小文字・ケバブ/単語区切り（`image-search`, `text-registration`）
- **Components**: PascalCase
- **Functions**: camelCase

## Import Organization

```typescript
import { Button } from "@/components/ui/button"
import { localHelper } from "./local-helper"
```

**Path Aliases**:
- `@/`: リポジトリルート

## Code Organization Principles

- API ルートは UI から直接呼び出す同期処理を基本とする
- API ルートは入力検証・フラグ判定・エラーハンドリングに寄せ、業務ロジックは `lib/` に委譲する
- 共通処理は `lib/` に集約し、UI からは薄い呼び出しにする
- 読み取り中心の管理/検証ページでは Server Component から DB を直接参照する構成も許容する
- 同一機能の画面配下に `list` / `search` / `maintenance` を並べ、閲覧・検索・運用を近い URL 空間にまとめる
- 画像類似検索や URL 生成のような横断ロジックは、複数画面で再利用できる小さな共有 helper に切り出す
- 性能対策用の小さな補助機能は feature 配下の helper として切り出し、cache や maintenance log のような横断機能は `lib/` 直下に置く

---
_Document patterns, not file trees. New files following patterns shouldn't require updates_

## 更新履歴
- updated_at: 2026-03-09
- 変更理由: feature-local helper、運用モジュール、性能対策 helper の配置パターンを反映
