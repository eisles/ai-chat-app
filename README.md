This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Connecting to Neon

1. Create a Postgres database in [Neon](https://neon.tech) and copy the connection string (e.g. `postgresql://...`).
2. Add the string to your environment: in `.env.local` set `NEON_DATABASE_URL="postgresql://user:password@host/db?sslmode=require"`. `DATABASE_URL` is also accepted.
3. Start the dev server (`npm run dev`) and verify the connection at [`/api/db-test`](http://localhost:3000/api/db-test). You should see JSON with the current database time.
4. For production (Vercel, etc.), set the same `NEON_DATABASE_URL` as a project environment variable.

## Vectorize API endpoint

画像ベクトル化APIのエンドポイントは環境変数で切り替えできます。

- `VECTORIZE_ENDPOINT`: 例 `http://localhost:8080/vectorize`
- 未設定の場合は `https://convertvectorapi.onrender.com/vectorize` を使用します。

## Basic auth style protection

サイト全体を簡易的に保護するため、`next@16` の `proxy.ts` で Basic 認証風のガードを入れています。

- `BASIC_AUTH_USERNAME`: 認証ユーザー名
- `BASIC_AUTH_PASSWORD`: 認証パスワード
- `BASIC_AUTH_REALM`: 任意。未設定時は `Protected`

設定例:

```bash
BASIC_AUTH_USERNAME=admin
BASIC_AUTH_PASSWORD=change-me
BASIC_AUTH_REALM=Preview
```

- `BASIC_AUTH_USERNAME` と `BASIC_AUTH_PASSWORD` の両方が未設定なら認証は無効です。
- どちらか片方だけ設定された場合は誤設定とみなし、全リクエストを `500` にします。
- `/_next/static`、`/_next/image`、`/favicon.ico` は除外しています。
