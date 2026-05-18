import { getAuthHeaders } from "./auth/auth-client";

type UploadResult = { id: string; url: string; filename: string; contentType: string; sizeBytes: number };

const uploadErrorMessage = (data: any) => {
  if (typeof data?.error === "string") return data.error;
  if (typeof data?.error?.message === "string") return data.error.message;
  if (typeof data?.message === "string") return data.message;
  return "Upload failed";
};

export async function uploadFile(uri: string, filename: string, mimeType: string): Promise<UploadResult> {
  const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL!;

  const formData = new FormData();
  formData.append("file", { uri, type: mimeType, name: filename } as any);

  const response = await fetch(`${BACKEND_URL}/api/upload`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: formData,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(uploadErrorMessage(data));
  return data.data;
}
