import { useQuery } from "@tanstack/react-query";
import { Link, useLocalSearchParams } from "expo-router";
import {
  ImageBackground,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  ErrorBlock,
  LoadingBlock,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { captureAnalytics } from "@/lib/analytics";
import { downloadAuthenticatedFile } from "@/lib/files";
import type { EventItem } from "@/types";
import { formatKzt } from "@/utils/format";

export default function EventPage() {
  const { id, promo } = useLocalSearchParams<{ id: string; promo?: string }>();
  const { t, i18n } = useTranslation();
  const query = useQuery({
    queryKey: ["event", id],
    queryFn: () => apiFetch<EventItem>(`/events/${id}`),
    enabled: !!id,
  });
  const event = query.data;
  const calendars = useQuery({
    queryKey: ["calendar-links", id],
    queryFn: () =>
      apiFetch<{ google: string; outlook: string; yahoo: string }>(
        `/events/${id}/calendar-links`,
      ),
    enabled: !!event,
  });
  useEffect(() => {
    if (event?.id) {
      void captureAnalytics("event_view", {
        eventId: event.id,
        source: promo ? "campaign" : "discovery",
        route: "/events/[id]",
        locale: i18n.language,
      });
    }
  }, [event?.id, i18n.language, promo]);
  if (query.isLoading) return <LoadingBlock />;
  if (query.error || !event)
    return (
      <ErrorBlock
        message={(query.error as Error)?.message ?? t("ui.eventNotFound")}
        retry={() => void query.refetch()}
      />
    );
  return (
    <ScrollView contentContainerClassName="gap-6 pb-16">
      <ImageBackground
        source={event.image_url ? { uri: event.image_url } : undefined}
        className="overflow-hidden rounded-[32px] bg-ink p-7 md:p-12"
        imageStyle={{ opacity: 0.3 }}
        accessibilityLabel={
          event.image_url ? `${event.title} cover image` : undefined
        }
      >
        <View className="max-w-4xl gap-5">
          <View className="flex-row flex-wrap items-center gap-3">
            <View className="rounded-full bg-aqua px-3 py-1">
              <Text className="text-xs font-black uppercase text-ink">
                {event.category}
              </Text>
            </View>
            <StatusBadge status={event.status} />
            {event.seating_mode === "assigned" ? (
              <View className="rounded-full bg-white/10 px-3 py-1">
                <Text className="text-xs font-bold text-white">
                  {t("ui.assignedSeating")}
                </Text>
              </View>
            ) : null}
          </View>
          <Text className="text-4xl font-black leading-tight text-white md:text-6xl">
            {event.title}
          </Text>
          <Text className="text-lg leading-7 text-slate-200">
            {event.description}
          </Text>
          {promo ? (
            <View className="self-start rounded-xl bg-emerald-100 px-4 py-3">
              <Text className="font-bold text-success">
                {t("ui.promoApplied", { code: promo })}
              </Text>
            </View>
          ) : null}
        </View>
      </ImageBackground>
      <View className="flex-row flex-wrap gap-5">
        <Surface className="min-w-64 flex-1 gap-2">
          <Text className="text-xs font-black uppercase text-muted">
            {t("common.date")}
          </Text>
          <Text className="text-xl font-bold text-ink">
            {new Intl.DateTimeFormat(i18n.language, {
              dateStyle: "full",
              timeStyle: "short",
            }).format(new Date(event.starts_at))}
          </Text>
          <Text className="text-muted">{event.timezone}</Text>
        </Surface>
        <Surface className="min-w-64 flex-1 gap-2">
          <Text className="text-xs font-black uppercase text-muted">
            {t("common.venue")}
          </Text>
          <Text className="text-xl font-bold text-ink">{event.venue_name}</Text>
          <Text className="text-muted">{event.venue_address}</Text>
        </Surface>
      </View>
      <Surface className="gap-5">
        <Text className="text-2xl font-black text-ink">
          {t("ui.eventTickets")}
        </Text>
        {event.ticket_types
          .filter((item) => !item.is_hidden)
          .map((item) => (
            <View
              key={item.id}
              className="flex-row flex-wrap items-center justify-between gap-4 border-b border-line py-4 last:border-b-0"
            >
              <View className="min-w-56 flex-1 gap-1">
                <Text className="text-lg font-bold text-ink">{item.name}</Text>
                <Text className="text-muted">{item.description}</Text>
              </View>
              <Text className="text-xl font-black text-ink">
                {item.price_tiyin
                  ? formatKzt(item.price_tiyin, i18n.language)
                  : t("common.free")}
              </Text>
            </View>
          ))}
        <Link
          href={{
            pathname: "/checkout/[eventId]",
            params: { eventId: event.id, promo: promo ?? "" },
          }}
          asChild
        >
          <Pressable className="min-h-14 items-center justify-center rounded-2xl bg-brand px-6">
            <Text className="text-lg font-black text-white">
              {t("common.buyTickets")}
            </Text>
          </Pressable>
        </Link>
      </Surface>
      <View className="flex-row flex-wrap gap-5">
        <Surface className="min-w-64 flex-1 gap-3">
          <Text className="text-lg font-black text-ink">
            {t("common.refundPolicy")}
          </Text>
          <Text className="leading-6 text-muted">{event.refund_policy}</Text>
        </Surface>
        <Surface className="min-w-64 flex-1 gap-3">
          <Text className="text-lg font-black text-ink">
            {t("common.calendar")}
          </Text>
          <Button
            label={t("ui.downloadIcs")}
            variant="secondary"
            onPress={() =>
              void downloadAuthenticatedFile(
                `/events/${event.id}/calendar.ics`,
                `${event.slug}.ics`,
                "text/calendar",
              )
            }
          />
          <View className="flex-row flex-wrap gap-2">
            {(["google", "outlook", "yahoo"] as const).map((provider) => (
              <Button
                key={provider}
                label={provider[0].toUpperCase() + provider.slice(1)}
                variant="ghost"
                disabled={!calendars.data?.[provider]}
                onPress={() =>
                  calendars.data?.[provider] &&
                  void Linking.openURL(calendars.data[provider])
                }
              />
            ))}
          </View>
        </Surface>
      </View>
    </ScrollView>
  );
}
