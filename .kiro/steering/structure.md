# Project Structure

## Organization Philosophy

Next.js App Router を中心に、ページ/機能単位でディレクトリを分割する。UI は共通コンポーネントとして `components` 配下に集約し、API は `app/api` に集約する。

## Directory Patterns

### App Routes
**Location**: `/app/`  
**Purpose**: 画面単位の UI と API ルートを同居させる  
**Example**: `/app/image-search/page.tsx`, `/app/api/image-search/route.ts`

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

### Tests
**Location**: `/tests/`  
**Purpose**: API ルートの統合テスト  
**Example**: `/tests/api/image-search.test.ts`

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
- 共通処理は `lib/` に集約し、UI からは薄い呼び出しにする

---
_Document patterns, not file trees. New files following patterns shouldn't require updates_
