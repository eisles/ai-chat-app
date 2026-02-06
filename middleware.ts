import { NextRequest, NextResponse } from "next/server";

// メンテナンスモード: MAINTENANCE_MODE=true で全リクエストを /maintenance にリライト
export function middleware(request: NextRequest) {
  const isMaintenanceMode = process.env.MAINTENANCE_MODE === "true";

  if (isMaintenanceMode) {
    const { pathname } = request.nextUrl;

    // メンテナンスページ自体と静的アセットはリライト対象外
    if (
      pathname === "/maintenance" ||
      pathname.startsWith("/_next/") ||
      pathname === "/favicon.ico"
    ) {
      return NextResponse.next();
    }

    const url = request.nextUrl.clone();
    url.pathname = "/maintenance";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  // 静的ファイルを除外してパフォーマンスを確保
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
