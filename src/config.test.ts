import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgres://app:pw@mydb.abc.ap-south-1.rds.amazonaws.com:5432/notes", S3_BUCKET: "notes-files", AWS_REGION: "ap-south-1" };

describe("loadConfig", () => {
  it("reads the AWS-provided services from env", () => {
    expect(loadConfig(base)).toEqual({
      port: 3000,
      host: "0.0.0.0",
      databaseUrl: base.DATABASE_URL,
      databaseSsl: true,
      s3Bucket: "notes-files",
      awsRegion: "ap-south-1",
    });
  });

  it("uses PORT and turns SSL off only when asked", () => {
    expect(loadConfig({ ...base, PORT: "8080", DATABASE_SSL: "off" })).toMatchObject({ port: 8080, databaseSsl: false });
  });

  it("accepts separate PG* variables instead of DATABASE_URL (RDS + Secrets Manager style)", () => {
    const { DATABASE_URL: _, ...rest } = base;
    expect(loadConfig({ ...rest, PGHOST: "mydb", PGUSER: "app", PGPASSWORD: "pw", PGDATABASE: "notes" }).databaseUrl).toBeNull();
  });

  it("lists every missing variable at once", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL or PGHOST.*S3_BUCKET.*AWS_REGION/);
    expect(() => loadConfig({ ...base, PORT: "abc" })).toThrow(/PORT/);
  });
});
