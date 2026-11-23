import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { durationText } from "@/components/design/durationText";
import { shortDate, shortTime } from "@/components/design/time";
import { Icon, palette } from "@/components/icons";
import { Timeline } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import type { EventItem } from "@/types";

import { Badge, isForbidden } from "./common";
import { ProgressMeter } from "./design";
import type { Analytics } from "./types";
import { eventKey } from "./useEventAccess";

/**
 * Dashboard card for one event: a night feature card with the start → end
 * timeline, status and (for the owner) sold/capacity progress. The whole
 * card is the link into the event workspace.
 */
export function OrganizerEventCard({
  event,
  staffEvent,
}: {
  event: EventItem;
  /** Someone else's event the person is assigned to as staff. */
  staffEvent: boolean;
}) {
  const { t, i18n } = useTranslation();
  // Same query (and cache entry) the event workspace uses for its KPIs.
  const analytics = useQuery({
    queryKey: eventKey(event.id, "analytics", "", "", "all"),
    queryFn: () => apiFetch<Analytics>(`/events/${event.id}/analytics`),
    // Drafts have never been on sale, so skip the request for them.
    enabled: !staffEvent && event.status !== "draft",
    staleTime: 60_000,
    retry: (count, error) => !isForbidden(error) && count < 1,
  });
  const kpi = analytics.data?.kpis;
  const sold = kpi?.tickets_sold ?? 0;
  const capacity = kpi?.capacity ?? event.capacity;
  const sameDay =
    shortDate(event.starts_at, event.timezone, i18n.language) ===
    shortDate(event.ends_at, event.timezone, i18n.language);
  return (
    <Link
      href={{ pathname: "/organizer/events/[id]", params: { id: event.id } }}
      asChild
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${event.title}, ${t(`status.${event.status}`)}`}
        className="min-w-72 flex-1 basis-80 gap-5 overflow-hidden rounded-3xl bg-night p-0 shadow-float active:opacity-90"
      >
        <View className="gap-5 p-5 pb-0">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <View className="flex-row flex-wrap gap-2">
              <Badge status={event.status} onDark />
              {event.paid_sales_suspended ? (
                <Badge
                  status="suspended"
                  onDark
                  label={t("organizer.dashboard.paidSalesSuspended")}
                />
              ) : null}
            </View>
            {staffEvent ? (
              <View className="flex-row items-center gap-1 rounded-lg border border-white/20 px-3 py-1">
                <Icon name="user" size={12} color={palette.white} />
                <Text className="text-xs font-medium text-white">
                  {t("organizerUi.staffChip")}
                </Text>
              </View>
            ) : null}
          </View>
          <Text
            className="text-2xl font-semibold leading-tight tracking-tight text-white"
            numberOfLines={2}
          >
            {event.title}
          </Text>
          <Timeline
            tone="dark"
            start={shortTime(event.starts_at, event.timezone)}
            end={shortTime(event.ends_at, event.timezone)}
            startCaption={shortDate(
              event.starts_at,
              event.timezone,
              i18n.language,
            )}
            endCaption={
              sameDay
                ? event.timezone
                : shortDate(event.ends_at, event.timezone, i18n.language)
            }
            middle={durationText(event.starts_at, event.ends_at, t)}
          />
          <View className="flex-row items-center gap-2">
            <Icon name="pin" size={16} color={palette.mint} />
            <Text className="flex-1 text-sm text-white/75" numberOfLines={1}>
              {event.venue_name} · {event.city}
            </Text>
          </View>
        </View>
        <View className="m-2 mt-0 gap-3 rounded-3xl bg-white/10 p-4">
          {kpi ? (
            <ProgressMeter
              tone="dark"
              label={t("organizerUi.soldOfCapacity")}
              value={sold}
              max={capacity}
              valueText={`${sold} / ${capacity}`}
            />
          ) : (
            <View className="flex-row items-center gap-2">
              <Icon name="ticket" size={16} color={palette.mint} />
              <Text className="text-sm font-semibold text-white/80">
                {t("ui.capacity")}: {event.capacity}
              </Text>
            </View>
          )}
          {event.status !== "published" ? (
            <Text className="text-sm leading-5 text-white/75">
              {t(`organizer.dashboard.statusHelp.${event.status}`)}
            </Text>
          ) : null}
          {staffEvent ? (
            <Text className="text-sm text-white/65">
              {t("organizer.dashboard.staffEvent")}
            </Text>
          ) : null}
          <View
            className="min-h-11 flex-row items-center justify-center gap-2 self-start rounded-2xl bg-mint px-4"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text className="font-medium text-ink">{t("organizerUi.manage")}</Text>
            <Icon name="arrow-right" size={16} color={palette.ink} />
          </View>
        </View>
      </Pressable>
    </Link>
  );
}
