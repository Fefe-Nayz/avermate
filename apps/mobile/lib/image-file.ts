import { fetch as expoFetch } from "expo/fetch";
import * as ImagePicker from "expo-image-picker";

export const MAX_UPLOAD_IMAGE_BYTES = 2 * 1024 * 1024;
export const UPLOAD_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export class ImageSelectionError extends Error {
  constructor(public readonly code: "permission" | "size" | "type") {
    super(code);
  }
}

/** Converts a sandboxed native asset into the File oRPC transports natively. */
export async function selectImage(options?: {
  square?: boolean;
}): Promise<{ file: File; uri: string } | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new ImageSelectionError("permission");

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: options?.square ?? false,
    aspect: options?.square ? [1, 1] : undefined,
    quality: 0.8,
  });
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return null;

  const response = await expoFetch(asset.uri);
  const blob = await response.blob();
  const type = asset.mimeType || blob.type || "image/jpeg";
  const file = new File(
    [blob],
    asset.fileName || `avermate-image-${Date.now()}.jpg`,
    { type },
  );
  if (file.size > MAX_UPLOAD_IMAGE_BYTES) throw new ImageSelectionError("size");
  if (!UPLOAD_IMAGE_TYPES.has(type)) throw new ImageSelectionError("type");
  return { file, uri: asset.uri };
}
