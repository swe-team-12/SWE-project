import { Link } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { placeText } from "@/lib/placeText";
import type { EventItem } from "@/types";
import { formatKzt } from "@/utils/format";
import { durationText } from "./design/durationText";
import { shortDate, shortTime } from "./design/time";
import { Icon, palette } from "./icons";
import { Chip, DarkCard, StatusBadge, Timeline } from "./ui";

/** Discover card: a dark "night" feature card with a start → end timeline. */
export function EventCard({ event }: { event: EventItem }) {
  const { t, i18n } = useTranslation();
  const lowest = event.ticket_types.length
    ? Math.min(...event.ticket_types.map((item) => item.price_tiyin))
    : 0;
  const sameDay =
    shortDate(event.starts_at, event.timezone, i18n.language) ===
    shortDate(event.ends_at, event.timezone, i18n.language);
  const city = placeText(event.city, i18n.language);
  return (
    <DarkCard className="min-w-72 flex-1 basis-80 gap-5 p-0">
      {event.image_url ? (
        <Image
          source={{ uri: event.image_url }}
          className="absolute inset-0 h-full w-full"
          style={{ opacity: 0.18 }}
          accessibilityLabel={t("attendee.coverImageLabel", {
            title: event.title,
          })}
        />
      ) : null}
      <View className="gap-5 p-5 pb-0">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Chip label={event.category} tone="outlineMint" />
          <StatusBadge
            status={event.lifecycle_group ?? event.status}
            tone="dark"
          />
        </View>
        <Text
          className="text-2xl font-extrabold leading-tight tracking-tight text-white"
          numberOfLines={2}
        >
          {event.title}
        </Text>
        <Timeline
          tone="dark"
          start={shortTime(event.starts_at, event.timezone)}
          end={shortTime(event.ends_at, event.timezone)}
          startCaption={shortDate(event.starts_at, event.timezone, i18n.language)}
          endCaption={
            sameDay
              ? placeText(event.timezone, i18n.language)
              : shortDate(event.ends_at, event.timezone, i18n.language)
          }
          middle={durationText(event.starts_at, event.ends_at, t)}
        />
        <View className="flex-row items-center gap-2">
          <Icon name="pin" size={16} color={palette.mint} />
          <Text className="flex-1 text-sm text-white/75" numberOfLines={1}>
            {event.venue_name} · {city}
          </Text>
        </View>
      </View>
      <View className="m-2 mt-0 flex-row flex-wrap items-center justify-between gap-3 rounded-3xl bg-white/10 p-4">
        <View>
          <Text className="text-xs font-semibold text-white/65">
            {t("common.priceFrom")}
          </Text>
          <Text className="text-2xl font-extrabold tracking-tight text-white">
            {lowest ? formatKzt(lowest, i18n.language) : t("common.free")}
          </Text>
        </View>
        <Link
          href={{ pathname: "/events/[id]", params: { id: event.id } }}
          asChild
        >
          <Pressable
            className="min-h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-mint px-5 active:opacity-80"
            accessibilityRole="link"
            accessibilityLabel={`${t("common.viewEvent")}: ${event.title}`}
          >
            <Text className="font-bold text-ink">{t("common.viewEvent")}</Text>
            <Icon name="arrow-right" size={18} />
          </Pressable>
        </Link>
      </View>
    </DarkCard>
  );
}
