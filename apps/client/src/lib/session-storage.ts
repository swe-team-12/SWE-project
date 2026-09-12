import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "biletflow_refresh_token";

export async function getRefreshToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  return SecureStore.getItemAsync(KEY);
}

export async function setRefreshToken(token?: string): Promise<void> {
  if (Platform.OS === "web") return;
  if (token) await SecureStore.setItemAsync(KEY, token);
  else await SecureStore.deleteItemAsync(KEY);
}
