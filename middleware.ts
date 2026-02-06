import { NextResponse } from "next/server";

// メンテナンスモード: MAINTENANCE_MODE=true で全リクエストにメンテナンス画面を表示
export function middleware() {
  const isMaintenanceMode = process.env.MAINTENANCE_MODE === "true";

  if (isMaintenanceMode) {
    // メンテナンス画面のHTMLを直接返す（サイドナビなし）
    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>メンテナンス中 | AI Chat App</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 2rem;
      max-width: 500px;
    }
    .icon { font-size: 5rem; margin-bottom: 1.5rem; }
    h1 { font-size: 2rem; margin-bottom: 1rem; font-weight: 600; }
    p { font-size: 1.1rem; opacity: 0.9; line-height: 1.6; }
    .card {
      background: rgba(255,255,255,0.15);
      backdrop-filter: blur(10px);
      border-radius: 1rem;
      padding: 3rem 2rem;
      box-shadow: 0 8px 32px rgba(0,0,0,0.1);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="icon">🔧</div>
      <h1>メンテナンス中</h1>
      <p>
        現在、システムメンテナンスを実施しています。<br>
        ご不便をおかけしますが、しばらくお待ちください。
      </p>
    </div>
  </div>
</body>
</html>`;

    return new NextResponse(html, {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Retry-After": "3600",
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/).*)"],
};
