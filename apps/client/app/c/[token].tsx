import { useQuery } from "@tanstack/react-query";
import { Link, Redirect, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AuthCard } from "@/components/design/AuthCard";
import { Icon } from "@/components/icons";
import { ErrorBlock, LoadingBlock, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { captureAnalytics } from "@/lib/analytics";
import type { CampaignResolution } from "@/types";
import { formatDateTime } from "@/utils/date";

export default function CampaignRedirect() {
  const { t, i18n } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const query = useQuery({
    queryKey: ["campaign", token],
    queryFn: () =>
      apiFetch<CampaignResolution>(`/campaigns/resolve/${token}`),
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
  const campaign = query.data;
  if (query.error || !campaign)
    return (
      <ErrorBlock
        message={
          (query.error as Error)?.message ?? t("attendee.campaign.unavailable")
        }
        retry={() => void query.refetch()}
      />
    );
  // Older API builds return no state; a promo code then means "active".
  const state = campaign.state ?? (campaign.promo_code ? "active" : "disabled");
  if (state === "active" && campaign.promo_code)
    return (
      <Redirect
        href={{
          pathname: "/events/[id]",
          params: { id: campaign.event_id, promo: campaign.promo_code },
        }}
      />
    );
  const reasonState = state === "active" ? "disabled" : state;
  return (
    <AuthCard
      icon="sparkle"
      kicker={campaign.name || undefined}
      title={t("attendee.campaign.inactiveTitle")}
    >
      <Notice tone="warning" role="status">
        {t(`attendee.campaign.state.${reasonState}`, {
          date: formatDateTime(
            (reasonState === "not_started"
              ? campaign.starts_at
              : campaign.ends_at) ?? "",
            i18n.language,
            "medium",
          ),
        })}
      </Notice>
      <View className="flex-row items-start gap-3 rounded-2xl bg-canvas p-4">
        <Icon name="calendar" size={18} />
        <Text className="flex-1 text-ink">
        {campaign.event_title
          ? t("attendee.campaign.eventStillOpen", {
              title: campaign.event_title,
            })
          : t("attendee.campaign.eventStillOpenGeneric")}
        </Text>
      </View>
      <Link
        href={{ pathname: "/events/[id]", params: { id: campaign.event_id } }}
        asChild
      >
        <Pressable
          accessibilityRole="link"
          className="min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-mint px-6 active:opacity-80"
        >
          <Text className="text-base font-bold text-ink">
            {t("common.viewEvent")}
          </Text>
          <Icon name="arrow-right" size={18} />
        </Pressable>
      </Link>
    </AuthCard>
  );
}
