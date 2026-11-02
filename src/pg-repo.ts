import pg from "pg";
import type { Note, NoteInput, NotesRepo } from "./types.js";

interface Row {
  id: string;
  title: string;
  body: string;
  attachment_key: string | null;
  created_at: Date;
  updated_at: Date;
}

const toNote = (r: Row): Note => ({
  id: r.id,
  title: r.title,
  body: r.body,
  attachmentKey: r.attachment_key,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/** Notes in Postgres (Amazon RDS in production). */
export class PgNotesRepo implements NotesRepo {
  constructor(private readonly pool: pg.Pool) {}

  static connect(databaseUrl: string | null, ssl: boolean): PgNotesRepo {
    // POC: TLS without CA pinning. For production, verify with the RDS CA bundle.
    return new PgNotesRepo(new pg.Pool({
      ...(databaseUrl ? { connectionString: databaseUrl } : {}),
      ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
      max: 10,
    }));
  }

  /** Creates the table on first start, so a fresh RDS database works without a separate migration step. */
  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title text NOT NULL,
        body text NOT NULL DEFAULT '',
        attachment_key text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
  }

  async list(): Promise<Note[]> {
    const { rows } = await this.pool.query<Row>("SELECT * FROM notes ORDER BY created_at DESC LIMIT 500");
    return rows.map(toNote);
  }

  async get(id: string): Promise<Note | null> {
    const { rows } = await this.pool.query<Row>("SELECT * FROM notes WHERE id = $1", [id]);
    return rows[0] ? toNote(rows[0]) : null;
  }

  async create(input: NoteInput): Promise<Note> {
    const { rows } = await this.pool.query<Row>(
      "INSERT INTO notes (title, body) VALUES ($1, $2) RETURNING *",
      [input.title, input.body],
    );
    return toNote(rows[0]!);
  }

  async update(id: string, patch: Partial<NoteInput> & { attachmentKey?: string | null }): Promise<Note | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE notes SET
         title = COALESCE($2, title),
         body = COALESCE($3, body),
         attachment_key = CASE WHEN $4::boolean THEN $5 ELSE attachment_key END,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, patch.title ?? null, patch.body ?? null, patch.attachmentKey !== undefined, patch.attachmentKey ?? null],
    );
    return rows[0] ? toNote(rows[0]) : null;
  }

  async remove(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("DELETE FROM notes WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
