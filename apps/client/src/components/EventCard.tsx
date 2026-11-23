import { Link } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { placeText } from "@/lib/placeText";
import type { EventItem } from "@/types";
import { formatKzt } from "@/utils/format";
import { durationText } from "./design/durationText";
import { shortDate, shortTime } from "./design/time";
import { Icon, palette } from "./icons";
import { Chip, StatusBadge, Timeline } from "./ui";

/**
 * Discover card, drawn as a paper ticket: event details on top, a perforated
 * tear line, and the price stub below. The first card in the list is the
 * featured one and is printed on the dark "night" stock; the rest stay light
 * so the featured event reads first.
 */
export function EventCard({
  event,
  featured = false,
}: {
  event: EventItem;
  featured?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lowest = event.ticket_types.length
    ? Math.min(...event.ticket_types.map((item) => item.price_tiyin))
    : 0;
  const sameDay =
    shortDate(event.starts_at, event.timezone, i18n.language) ===
    shortDate(event.ends_at, event.timezone, i18n.language);
  const city = placeText(event.city, i18n.language);
  const dark = featured;
  return (
    <View
      className={`min-w-72 flex-1 basis-80 overflow-hidden rounded-3xl border ${dark ? "border-night bg-night" : "border-line bg-white"}`}
    >
      {dark && event.image_url ? (
        <Image
          source={{ uri: event.image_url }}
          className="absolute inset-0 h-full w-full"
          style={{ opacity: 0.18 }}
          accessibilityLabel={t("attendee.coverImageLabel", {
            title: event.title,
          })}
        />
      ) : null}
      <View className="flex-1 gap-5 p-5">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Chip label={event.category} tone={dark ? "outlineMint" : "mint"} />
          <StatusBadge
            status={event.lifecycle_group ?? event.status}
            tone={dark ? "dark" : "light"}
          />
        </View>
        <Text
          className={`text-2xl font-semibold leading-tight tracking-tight ${dark ? "text-white" : "text-ink"}`}
          numberOfLines={2}
        >
          {event.title}
        </Text>
        <Timeline
          tone={dark ? "dark" : "light"}
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
          <Icon
            name="pin"
            size={16}
            color={dark ? palette.mint : palette.muted}
          />
          <Text
            className={`flex-1 text-sm ${dark ? "text-white/75" : "text-muted"}`}
            numberOfLines={1}
          >
            {event.venue_name} · {city}
          </Text>
        </View>
      </View>

      <TearLine dark={dark} />

      <View className="gap-4 p-5 pt-4">
        <View>
          <Text className={`text-xs ${dark ? "text-white/65" : "text-muted"}`}>
            {t("common.priceFrom")}
          </Text>
          <Text
            className={`text-2xl font-semibold tracking-tight ${dark ? "text-white" : "text-ink"}`}
            style={{ fontVariant: ["tabular-nums"] }}
            numberOfLines={1}
          >
            {lowest ? formatKzt(lowest, i18n.language) : t("common.free")}
          </Text>
        </View>
        <Link
          href={{ pathname: "/events/[id]", params: { id: event.id } }}
          asChild
        >
          <Pressable
            className={`min-h-12 w-full flex-row items-center justify-center gap-2 rounded-xl px-5 active:opacity-80 ${dark ? "bg-mint" : "border border-line bg-white"}`}
            accessibilityRole="link"
            accessibilityLabel={`${t("common.viewEvent")}: ${event.title}`}
          >
            <Text className="font-medium text-ink">
              {t("common.viewEvent")}
            </Text>
            <Icon name="arrow-right" size={18} />
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

/** Perforation between the event details and the price stub. */
function TearLine({ dark }: { dark: boolean }) {
  return (
    <View
      className="relative h-5 justify-center"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        className={`mx-6 border-t-2 border-dashed ${dark ? "border-white/15" : "border-line"}`}
      />
      <View className="absolute -left-2.5 top-0 h-5 w-5 rounded-full bg-canvas" />
      <View className="absolute -right-2.5 top-0 h-5 w-5 rounded-full bg-canvas" />
    </View>
  );
}
