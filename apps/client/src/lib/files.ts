import type { DocumentPickerAsset } from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { API_URL, currentAccessToken } from "./api";

export async function fileForm(asset: DocumentPickerAsset): Promise<FormData> {
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await fetch(asset.uri).then((response) => response.blob());
    form.append("file", blob, asset.name);
  } else {
    form.append("file", {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? "application/octet-stream",
    } as never);
  }
  return form;
}

export async function downloadAuthenticatedFile(
  path: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  const token = currentAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok)
    throw new Error(`Download failed with status ${response.status}.`);
  const blob = await response.blob();
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, filename);
  file.write(new Uint8Array(await blob.arrayBuffer()));
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename });
}
