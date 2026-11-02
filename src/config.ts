export interface Config {
  port: number;
  host: string;
  /** null when the connection comes from PGHOST/PGUSER/PGPASSWORD/PGDATABASE, which `pg` reads itself. */
  databaseUrl: string | null;
  databaseSsl: boolean;
  s3Bucket: string;
  awsRegion: string;
}

/**
 * Every external service comes from AWS: Postgres on Amazon RDS, files on Amazon S3.
 * No AWS keys here: on AWS the SDK picks up the task/instance role automatically.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const missing: string[] = [];
  if (!env.DATABASE_URL && !env.PGHOST) missing.push("DATABASE_URL or PGHOST");
  if (!env.S3_BUCKET) missing.push("S3_BUCKET");
  if (!env.AWS_REGION) missing.push("AWS_REGION");
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) missing.push("PORT (must be a port number)");
  if (missing.length > 0) throw new Error(`Missing or invalid environment variables: ${missing.join(", ")}`);

  return {
    port,
    host: env.HOST ?? "0.0.0.0",
    databaseUrl: env.DATABASE_URL ?? null,
    // RDS Postgres enforces TLS by default; turn off only for a local database.
    databaseSsl: env.DATABASE_SSL !== "off",
    s3Bucket: env.S3_BUCKET!,
    awsRegion: env.AWS_REGION!,
  };
}
