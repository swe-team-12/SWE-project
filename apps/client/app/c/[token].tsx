import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { ErrorBlock, LoadingBlock } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { captureAnalytics } from "@/lib/analytics";

export default function CampaignRedirect() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const query = useQuery({
    queryKey: ["campaign", token],
    queryFn: () =>
      apiFetch<{ event_id: string; promo_code: string; campaign_id: string }>(
        `/campaigns/resolve/${token}`,
      ),
    enabled: !!token,
  });
  useEffect(() => {
    if (query.data) {
      void captureAnalytics("campaign_view", {
        eventId: query.data.event_id,
        campaignId: query.data.campaign_id,
        source: "campaign_qr_or_link",
        route: "/c/[token]",
      });
    }
  }, [query.data]);
  if (query.isLoading) return <LoadingBlock label={t("ui.applyingCampaign")} />;
  if (query.error || !query.data)
    return (
      <ErrorBlock
        message={(query.error as Error)?.message ?? "Campaign unavailable"}
      />
    );
  return (
    <Redirect
      href={{
        pathname: "/events/[id]",
        params: { id: query.data.event_id, promo: query.data.promo_code },
      }}
    />
  );
}
