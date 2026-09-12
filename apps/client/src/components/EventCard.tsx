import { Link } from "expo-router";
import { ImageBackground, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { EventItem } from "@/types";
import { formatKzt } from "@/utils/format";
import { StatusBadge, Surface } from "./ui";

export function EventCard({ event }: { event: EventItem }) {
  const { t, i18n } = useTranslation();
  const lowest = event.ticket_types.length
    ? Math.min(...event.ticket_types.map((item) => item.price_tiyin))
    : 0;
  return (
    <Surface className="min-w-72 flex-1 gap-4 overflow-hidden p-0">
      <ImageBackground
        source={event.image_url ? { uri: event.image_url } : undefined}
        className="h-36 bg-ink p-5"
        imageStyle={{ opacity: 0.42 }}
        accessibilityLabel={
          event.image_url ? `${event.title} cover image` : undefined
        }
      >
        <View className="flex-row items-start justify-between gap-3">
          <View className="rounded-full bg-aqua px-3 py-1">
            <Text className="text-xs font-black uppercase text-ink">
              {event.category}
            </Text>
          </View>
          <StatusBadge status={event.lifecycle_group ?? event.status} />
        </View>
        <Text
          className="mt-auto text-2xl font-black text-white"
          numberOfLines={2}
        >
          {event.title}
        </Text>
      </ImageBackground>
      <View className="gap-3 px-5 pb-5">
        <Text className="font-semibold text-muted">
          {new Intl.DateTimeFormat(i18n.language, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(event.starts_at))}
        </Text>
        <Text className="text-ink">
          {event.venue_name} · {event.city}
        </Text>
        <View className="flex-row items-end justify-between gap-3">
          <View>
            <Text className="text-xs font-semibold uppercase text-muted">
              {t("common.priceFrom")}
            </Text>
            <Text className="text-xl font-black text-ink">
              {lowest ? formatKzt(lowest, i18n.language) : t("common.free")}
            </Text>
          </View>
          <Link
            href={{ pathname: "/events/[id]", params: { id: event.id } }}
            asChild
          >
            <Pressable
              className="min-h-11 justify-center rounded-xl bg-brand px-4"
              accessibilityRole="link"
            >
              <Text className="font-bold text-white">
                {t("common.viewEvent")}
              </Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </Surface>
  );
}
