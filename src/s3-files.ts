import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FileStore } from "./types.js";

const URL_TTL_SECONDS = 15 * 60;

/** Attachments in Amazon S3. Credentials come from the IAM role the app runs with, never from env keys. */
export class S3FileStore implements FileStore {
  private readonly s3: S3Client;

  constructor(private readonly bucket: string, region: string) {
    this.s3 = new S3Client({ region });
  }

  uploadUrl(key: string, contentType: string): Promise<string> {
    return getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), { expiresIn: URL_TTL_SECONDS });
  }

  downloadUrl(key: string): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: URL_TTL_SECONDS });
  }

  async remove(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
