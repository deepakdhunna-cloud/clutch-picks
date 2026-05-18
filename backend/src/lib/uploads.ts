import path from "node:path";
import { unlink } from "node:fs/promises";
import { env } from "../env";

export const uploadsDir = path.resolve(env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads"));

const MANAGED_UPLOAD_RE = /^[a-f0-9-]+\.(jpg|jpeg|png|webp|gif)$/i;

export function isManagedUploadFilename(filename: string): boolean {
  return MANAGED_UPLOAD_RE.test(filename);
}

export function managedUploadUrl(filename: string): string {
  return `${env.BACKEND_URL}/uploads/${filename}`;
}

export function managedUploadFilenameFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const base = new URL(env.BACKEND_URL);
    if (url.origin !== base.origin) return null;

    const prefix = "/uploads/";
    if (!url.pathname.startsWith(prefix)) return null;

    const filename = decodeURIComponent(url.pathname.slice(prefix.length));
    return isManagedUploadFilename(filename) ? filename : null;
  } catch {
    return null;
  }
}

export function isManagedUploadUrl(value: string): boolean {
  return managedUploadFilenameFromUrl(value) !== null;
}

export async function deleteManagedUploadUrl(value: string | null | undefined): Promise<void> {
  const filename = managedUploadFilenameFromUrl(value);
  if (!filename) return;

  try {
    await unlink(path.join(uploadsDir, filename));
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "ENOENT") {
      console.warn("[uploads] Failed to delete managed upload:", filename, err);
    }
  }
}
