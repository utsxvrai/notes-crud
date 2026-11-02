# notes-crud

A deliberately small notes CRUD app for trying out SeekInfra deployments.
Every external service it needs is an AWS service:

| Need | AWS service | Env vars |
|---|---|---|
| Database | Amazon RDS for PostgreSQL | `DATABASE_URL` (or `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`) |
| File attachments | Amazon S3 (presigned upload/download URLs) | `S3_BUCKET`, `AWS_REGION` |
| AWS credentials | IAM role of the task/instance (no keys in the app) | none |

There is intentionally **no Dockerfile and no infrastructure code**; that is what SeekInfra should generate.

## API

| Method | Path | Body |
|---|---|---|
| GET | `/healthz` | – (checks the database; 503 if down) |
| GET | `/api/notes` | – |
| GET | `/api/notes/:id` | – (includes a presigned `attachmentUrl`) |
| POST | `/api/notes` | `{ "title": "…", "body": "…" }` |
| PATCH | `/api/notes/:id` | `{ "title"?: "…", "body"?: "…" }` |
| DELETE | `/api/notes/:id` | – (also deletes the S3 attachment) |
| POST | `/api/notes/:id/attachment` | `{ "fileName": "a.pdf", "contentType": "application/pdf" }` → `{ uploadUrl, key }` |

`GET /` serves a tiny web UI for all of the above.

## Run

```bash
npm install
npm test             # API tests, no database needed
cp .env.example .env # point it at a Postgres and an S3 bucket
npm run dev          # build + start on $PORT (default 3000)
```

Production: `npm ci && npm run build && npm start`. The table is created on first start.

## Deployment notes (for whoever writes the infra)

- Listens on `0.0.0.0:$PORT`, health check `GET /healthz`, handles `SIGTERM` gracefully.
- Needs PostgreSQL 13+ (uses the built-in `gen_random_uuid()`). TLS is on unless `DATABASE_SSL=off`.
- The app's IAM role needs `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `arn:aws:s3:::$S3_BUCKET/notes/*`.
- The browser uploads directly to S3, so the bucket needs a CORS rule allowing `PUT` (and `GET`) from the app's origin with the `Content-Type` header.
