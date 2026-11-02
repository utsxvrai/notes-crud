import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import type { FileStore, Note, NoteInput, NotesRepo } from "./types.js";

class MemoryRepo implements NotesRepo {
  notes = new Map<string, Note>();
  healthy = true;
  async list(): Promise<Note[]> { return [...this.notes.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async get(id: string): Promise<Note | null> { return this.notes.get(id) ?? null; }
  async create(input: NoteInput): Promise<Note> {
    const now = new Date().toISOString();
    const note = { id: randomUUID(), ...input, attachmentKey: null, createdAt: now, updatedAt: now };
    this.notes.set(note.id, note);
    return note;
  }
  async update(id: string, patch: Partial<NoteInput> & { attachmentKey?: string | null }): Promise<Note | null> {
    const note = this.notes.get(id);
    if (!note) return null;
    const next = { ...note, ...patch, updatedAt: new Date().toISOString() };
    this.notes.set(id, next);
    return next;
  }
  async remove(id: string): Promise<boolean> { return this.notes.delete(id); }
  async ping(): Promise<void> { if (!this.healthy) throw new Error("db down"); }
}

class FakeFiles implements FileStore {
  removed: string[] = [];
  async uploadUrl(key: string): Promise<string> { return `https://s3.test/${key}?upload`; }
  async downloadUrl(key: string): Promise<string> { return `https://s3.test/${key}?download`; }
  async remove(key: string): Promise<void> { this.removed.push(key); }
}

describe("notes API", () => {
  let app: FastifyInstance;
  let repo: MemoryRepo;
  let files: FakeFiles;

  beforeEach(async () => {
    repo = new MemoryRepo();
    files = new FakeFiles();
    app = buildApp({ repo, files });
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  const create = async (title = "Groceries", body = "milk, eggs") =>
    (await app.inject({ method: "POST", url: "/api/notes", payload: { title, body } })).json<Note>();

  it("creates, lists, reads, updates and deletes a note", async () => {
    const created = await app.inject({ method: "POST", url: "/api/notes", payload: { title: "Groceries", body: "milk" } });
    expect(created.statusCode).toBe(201);
    const note = created.json<Note>();
    expect(note).toMatchObject({ title: "Groceries", body: "milk", attachmentKey: null });

    expect((await app.inject("/api/notes")).json()).toHaveLength(1);
    expect((await app.inject(`/api/notes/${note.id}`)).json()).toMatchObject({ id: note.id, attachmentUrl: null });

    const updated = await app.inject({ method: "PATCH", url: `/api/notes/${note.id}`, payload: { body: "milk, eggs" } });
    expect(updated.json()).toMatchObject({ title: "Groceries", body: "milk, eggs" });

    expect((await app.inject({ method: "DELETE", url: `/api/notes/${note.id}` })).statusCode).toBe(204);
    expect((await app.inject(`/api/notes/${note.id}`)).statusCode).toBe(404);
  });

  it("rejects invalid input", async () => {
    expect((await app.inject({ method: "POST", url: "/api/notes", payload: { title: "" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/notes", payload: { title: "x".repeat(201), body: "" } })).statusCode).toBe(400);
    const note = await create();
    expect((await app.inject({ method: "PATCH", url: `/api/notes/${note.id}`, payload: {} })).statusCode).toBe(400);
  });

  it("returns 404 for unknown notes", async () => {
    const id = randomUUID();
    expect((await app.inject(`/api/notes/${id}`)).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/api/notes/${id}`, payload: { title: "x" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/notes/${id}` })).statusCode).toBe(404);
  });

  it("hands out an S3 upload URL, stores the key, and returns a download URL", async () => {
    const note = await create();
    const res = await app.inject({ method: "POST", url: `/api/notes/${note.id}/attachment`, payload: { fileName: "list.pdf", contentType: "application/pdf" } });
    expect(res.statusCode).toBe(200);
    const { uploadUrl, key } = res.json<{ uploadUrl: string; key: string }>();
    expect(key).toMatch(new RegExp(`^notes/${note.id}/[0-9a-f-]+-list\\.pdf$`));
    expect(uploadUrl).toBe(`https://s3.test/${key}?upload`);
    expect((await app.inject(`/api/notes/${note.id}`)).json()).toMatchObject({ attachmentKey: key, attachmentUrl: `https://s3.test/${key}?download` });
  });

  it("deletes the attachment from S3 together with the note", async () => {
    const note = await create();
    const { key } = (await app.inject({ method: "POST", url: `/api/notes/${note.id}/attachment`, payload: { fileName: "a.png", contentType: "image/png" } })).json<{ key: string }>();
    await app.inject({ method: "DELETE", url: `/api/notes/${note.id}` });
    expect(files.removed).toEqual([key]);
  });

  it("reports health from the database", async () => {
    expect((await app.inject("/healthz")).json()).toEqual({ ok: true });
    repo.healthy = false;
    const res = await app.inject("/healthz");
    expect(res.statusCode).toBe(503);
  });
});
