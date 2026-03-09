import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  createBasicAuthChallenge,
  getBasicAuthMode,
  isBasicAuthAuthorized,
} from "@/lib/basic-auth";

const BASIC_AUTH_USERNAME = process.env.BASIC_AUTH_USERNAME;
const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD;
const BASIC_AUTH_REALM = process.env.BASIC_AUTH_REALM ?? "Protected";

function createUnauthorizedResponse(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": createBasicAuthChallenge(BASIC_AUTH_REALM),
    },
  });
}

function createMisconfiguredResponse(): NextResponse {
  return new NextResponse("Basic auth is misconfigured", {
    status: 500,
  });
}

export function proxy(request: NextRequest): NextResponse {
  const authMode = getBasicAuthMode(
    BASIC_AUTH_USERNAME,
    BASIC_AUTH_PASSWORD
  );

  if (authMode === "disabled") {
    return NextResponse.next();
  }

  if (authMode === "misconfigured") {
    return createMisconfiguredResponse();
  }

  const isAuthorized = isBasicAuthAuthorized(
    request.headers.get("authorization"),
    BASIC_AUTH_USERNAME as string,
    BASIC_AUTH_PASSWORD as string
  );

  return isAuthorized ? NextResponse.next() : createUnauthorizedResponse();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
