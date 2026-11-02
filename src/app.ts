import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import type { FileStore, Note, NotesRepo } from "./types.js";

const noteBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 200 },
    body: { type: "string", maxLength: 10_000 },
  },
} as const;

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

/** Keeps S3 keys predictable and safe: letters, digits, dot, dash, underscore. */
function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-100) || "file";
}

export function buildApp({ repo, files, logger = false }: { repo: NotesRepo; files: FileStore; logger?: boolean }): FastifyInstance {
  const app = Fastify({ logger });

  const withUrl = async (note: Note) => ({
    ...note,
    attachmentUrl: note.attachmentKey ? await files.downloadUrl(note.attachmentKey) : null,
  });

  app.get("/healthz", async (_req, reply) => {
    try {
      await repo.ping();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  app.get("/", async (_req, reply) => {
    const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
    return reply.type("text/html").send(html);
  });

  app.get("/api/notes", async () => repo.list());

  app.get<{ Params: { id: string } }>("/api/notes/:id", { schema: { params: idParams } }, async (req, reply) => {
    const note = await repo.get(req.params.id);
    return note ? withUrl(note) : reply.code(404).send({ error: "Note not found" });
  });

  app.post<{ Body: { title: string; body: string } }>(
    "/api/notes",
    { schema: { body: { ...noteBody, required: ["title", "body"] } } },
    async (req, reply) => reply.code(201).send(await repo.create(req.body)),
  );

  app.patch<{ Params: { id: string }; Body: { title?: string; body?: string } }>(
    "/api/notes/:id",
    { schema: { params: idParams, body: { ...noteBody, minProperties: 1 } } },
    async (req, reply) => {
      const note = await repo.update(req.params.id, req.body);
      return note ? withUrl(note) : reply.code(404).send({ error: "Note not found" });
    },
  );

  app.delete<{ Params: { id: string } }>("/api/notes/:id", { schema: { params: idParams } }, async (req, reply) => {
    const note = await repo.get(req.params.id);
    if (!note) return reply.code(404).send({ error: "Note not found" });
    await repo.remove(note.id);
    if (note.attachmentKey) await files.remove(note.attachmentKey);
    return reply.code(204).send();
  });

  // The browser uploads straight to S3 with this URL; the API only records the key.
  app.post<{ Params: { id: string }; Body: { fileName: string; contentType: string } }>(
    "/api/notes/:id/attachment",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["fileName", "contentType"],
          additionalProperties: false,
          properties: {
            fileName: { type: "string", minLength: 1, maxLength: 200 },
            contentType: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const note = await repo.get(req.params.id);
      if (!note) return reply.code(404).send({ error: "Note not found" });
      const key = `notes/${note.id}/${randomUUID()}-${safeFileName(req.body.fileName)}`;
      const uploadUrl = await files.uploadUrl(key, req.body.contentType);
      if (note.attachmentKey) await files.remove(note.attachmentKey);
      await repo.update(note.id, { attachmentKey: key });
      return { uploadUrl, key };
    },
  );

  return app;
}
