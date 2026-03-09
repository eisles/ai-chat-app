import { describe, expect, it } from "vitest";

import {
  createBasicAuthChallenge,
  getBasicAuthMode,
  isBasicAuthAuthorized,
  parseBasicAuthHeader,
} from "@/lib/basic-auth";

function createAuthorizationHeader(username: string, password: string): string {
  const encoded = Buffer.from(`${username}:${password}`, "utf-8").toString(
    "base64"
  );
  return `Basic ${encoded}`;
}

describe("getBasicAuthMode", () => {
  it("returns disabled when both secrets are missing", () => {
    expect(getBasicAuthMode(undefined, undefined)).toBe("disabled");
    expect(getBasicAuthMode("", "")).toBe("disabled");
  });

  it("returns misconfigured when only one secret is present", () => {
    expect(getBasicAuthMode("user", undefined)).toBe("misconfigured");
    expect(getBasicAuthMode(undefined, "pass")).toBe("misconfigured");
  });

  it("returns enabled when both secrets are present", () => {
    expect(getBasicAuthMode("user", "pass")).toBe("enabled");
  });
});

describe("parseBasicAuthHeader", () => {
  it("returns parsed credentials for a valid header", () => {
    expect(parseBasicAuthHeader(createAuthorizationHeader("user", "pass"))).toEqual({
      username: "user",
      password: "pass",
    });
  });

  it("returns null for malformed headers", () => {
    expect(parseBasicAuthHeader(null)).toBeNull();
    expect(parseBasicAuthHeader("Bearer token")).toBeNull();
    expect(parseBasicAuthHeader("Basic !!!")).toBeNull();
    expect(
      parseBasicAuthHeader(
        `Basic ${Buffer.from("user-only", "utf-8").toString("base64")}`
      )
    ).toBeNull();
  });
});

describe("isBasicAuthAuthorized", () => {
  it("returns true only when username and password match", () => {
    const validHeader = createAuthorizationHeader("admin", "secret");

    expect(isBasicAuthAuthorized(validHeader, "admin", "secret")).toBe(true);
    expect(isBasicAuthAuthorized(validHeader, "admin", "wrong")).toBe(false);
    expect(isBasicAuthAuthorized(validHeader, "wrong", "secret")).toBe(false);
  });
});

describe("createBasicAuthChallenge", () => {
  it("creates a browser prompt header", () => {
    expect(createBasicAuthChallenge("Preview")).toBe(
      'Basic realm="Preview", charset="UTF-8"'
    );
  });
});
