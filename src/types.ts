export interface Note {
  id: string;
  title: string;
  body: string;
  attachmentKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  title: string;
  body: string;
}

/** Where notes live. Postgres (Amazon RDS) in production. */
export interface NotesRepo {
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | null>;
  create(input: NoteInput): Promise<Note>;
  update(id: string, patch: Partial<NoteInput> & { attachmentKey?: string | null }): Promise<Note | null>;
  remove(id: string): Promise<boolean>;
  ping(): Promise<void>;
}

/** Where attachments live. Amazon S3 in production; the browser uploads and downloads directly via presigned URLs. */
export interface FileStore {
  uploadUrl(key: string, contentType: string): Promise<string>;
  downloadUrl(key: string): Promise<string>;
  remove(key: string): Promise<void>;
}
