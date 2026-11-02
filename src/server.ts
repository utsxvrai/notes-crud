import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PgNotesRepo } from "./pg-repo.js";
import { S3FileStore } from "./s3-files.js";

const config = loadConfig();
const repo = PgNotesRepo.connect(config.databaseUrl, config.databaseSsl);
await repo.migrate();

const app = buildApp({ repo, files: new S3FileStore(config.s3Bucket, config.awsRegion), logger: true });

// Containers get SIGTERM on deploys and scale-in: finish requests, then close the DB pool.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    await app.close();
    await repo.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
