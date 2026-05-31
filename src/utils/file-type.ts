import { fileTypeFromBuffer } from "file-type";

export async function parseBufferToDynamicBase64(
  imageBuffer: Buffer<ArrayBufferLike> | null | undefined,
): Promise<string | null> {
  if (!imageBuffer) return null;

  const bufferInstance = Buffer.from(imageBuffer);

  // Detect extension and mime properties asynchronously
  const detected = await fileTypeFromBuffer(bufferInstance);
  const mimeType = detected ? detected.mime : "application/octet-stream";

  const base64String = bufferInstance.toString("base64");
  return `data:${mimeType};base64,${base64String}`;
}
