import { repairPhotoService } from "@/features/repairs/repair-photo-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const variantParam = new URL(request.url).searchParams.get("variant");
    if (variantParam !== null && variantParam !== "display" && variantParam !== "thumb") {
      throw new AppError("VALIDATION_FAILED", "照片变体参数无效");
    }
    const variant = variantParam === "thumb" ? "thumb" : "display";
    const { bytes, mimeType, etag } = await repairPhotoService.open(
      (await params).photoId,
      actor,
      variant,
    );
    const headers = {
      ETag: etag,
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    };
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch?.split(",").some((value) => value.trim() === etag)) {
      return new Response(null, { status: 304, headers });
    }
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: { ...headers, "Content-Type": mimeType, "Content-Length": String(bytes.byteLength) },
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
