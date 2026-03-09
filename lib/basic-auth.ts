export type BasicAuthMode = "disabled" | "enabled" | "misconfigured";

export type BasicAuthCredentials = {
  username: string;
  password: string;
};

const BASIC_AUTH_PREFIX = "Basic ";

function normalizeSecret(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function decodeBase64(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf-8");
    const normalizedInput = value.replace(/=+$/, "");
    const normalizedDecoded = Buffer.from(decoded, "utf-8")
      .toString("base64")
      .replace(/=+$/, "");

    return normalizedDecoded === normalizedInput ? decoded : null;
  } catch {
    return null;
  }
}

export function getBasicAuthMode(
  username: string | undefined,
  password: string | undefined
): BasicAuthMode {
  const normalizedUsername = normalizeSecret(username);
  const normalizedPassword = normalizeSecret(password);

  if (!normalizedUsername && !normalizedPassword) {
    return "disabled";
  }

  if (normalizedUsername && normalizedPassword) {
    return "enabled";
  }

  return "misconfigured";
}

export function parseBasicAuthHeader(
  authorizationHeader: string | null
): BasicAuthCredentials | null {
  if (!authorizationHeader?.startsWith(BASIC_AUTH_PREFIX)) {
    return null;
  }

  const encodedCredentials = authorizationHeader
    .slice(BASIC_AUTH_PREFIX.length)
    .trim();
  if (!encodedCredentials) {
    return null;
  }

  const decodedCredentials = decodeBase64(encodedCredentials);
  if (!decodedCredentials) {
    return null;
  }

  const separatorIndex = decodedCredentials.indexOf(":");
  if (separatorIndex < 0) {
    return null;
  }

  return {
    username: decodedCredentials.slice(0, separatorIndex),
    password: decodedCredentials.slice(separatorIndex + 1),
  };
}

export function isBasicAuthAuthorized(
  authorizationHeader: string | null,
  expectedUsername: string,
  expectedPassword: string
): boolean {
  const credentials = parseBasicAuthHeader(authorizationHeader);
  if (!credentials) {
    return false;
  }

  return (
    credentials.username === expectedUsername &&
    credentials.password === expectedPassword
  );
}

export function createBasicAuthChallenge(realm: string): string {
  return `Basic realm="${realm}", charset="UTF-8"`;
}
