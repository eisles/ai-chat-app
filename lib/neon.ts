import { neon } from "@neondatabase/serverless";

let cachedClient: ReturnType<typeof neon> | null = null;

export function getDb() {
  if (cachedClient) {
    return cachedClient;
  }

  const connectionString =
    process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "Missing Neon connection string. Set NEON_DATABASE_URL (or DATABASE_URL).",
    );
  }

  cachedClient = neon(connectionString);
  return cachedClient;
}

export async function pingDatabase() {
  const db = getDb();
  const rows = (await db`select now() as now`) as Array<{ now: unknown }>;
  return { now: rows[0]?.now };
}
