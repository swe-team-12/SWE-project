import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { apiFetch } from "./api";

const ANALYTICS_ID_KEY = "biletflow_anonymous_analytics_id";

type AnalyticsName =
  "campaign_view" | "event_view" | "checkout_start" | "purchase_demo";

async function anonymousId(): Promise<string> {
  const stored =
    Platform.OS === "web"
      ? globalThis.localStorage?.getItem(ANALYTICS_ID_KEY)
      : await SecureStore.getItemAsync(ANALYTICS_ID_KEY);
  if (stored) return stored;
  const value = Crypto.randomUUID();
  if (Platform.OS === "web")
    globalThis.localStorage?.setItem(ANALYTICS_ID_KEY, value);
  else await SecureStore.setItemAsync(ANALYTICS_ID_KEY, value);
  return value;
}

export async function captureAnalytics(
  name: AnalyticsName,
  options: {
    eventId?: string;
    campaignId?: string;
    source?: string;
    route?: string;
    locale?: string;
  } = {},
): Promise<void> {
  try {
    await apiFetch("/analytics/capture", {
      method: "POST",
      skipRefresh: true,
      body: JSON.stringify({
        anonymous_id: await anonymousId(),
        name,
        event_id: options.eventId ?? null,
        campaign_id: options.campaignId ?? null,
        properties: {
          source: options.source,
          route: options.route,
          locale: options.locale,
          device_category: Platform.OS,
        },
      }),
    });
  } catch {
    // Analytics is intentionally best-effort and never blocks a product journey.
  }
}
