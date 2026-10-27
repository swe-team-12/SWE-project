import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { EventCard } from "@/components/EventCard";
import { ErrorBlock, Field, LoadingBlock } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import type { EventItem } from "@/types";

export default function DiscoverPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const from = isIsoDate(dateFrom) ? dateFrom : "";
  const to = isIsoDate(dateTo) ? dateTo : "";
  const query = useQuery({
    queryKey: ["events", search, from, to],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (from) params.set("date_from", from);
      if (to) params.set("date_to", to);
      if (from || to) params.set("tz", deviceTimeZone());
      const qs = params.toString();
      return apiFetch<EventItem[]>(`/events${qs ? `?${qs}` : ""}`);
    },
  });
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerClassName="gap-8 pb-16"
    >
      <View className="overflow-hidden rounded-[32px] bg-ink p-7 md:p-12">
        <View className="max-w-3xl gap-5">
          <View className="self-start rounded-full bg-aqua px-4 py-2">
            <Text className="text-xs font-black uppercase tracking-wider text-ink">
              BiletFlow · KZ
            </Text>
          </View>
          <Text
            accessibilityRole="header"
            className="text-4xl font-black leading-tight text-white md:text-6xl"
          >
            {t("ui.heroTitle")}
          </Text>
          <Text className="max-w-2xl text-lg leading-7 text-slate-200">
            {t("ui.heroBody")}
          </Text>
          <View className="mt-2 max-w-xl">
            <Field
              label={t("ui.searchEvents")}
              value={search}
              onChangeText={setSearch}
              placeholder={t("ui.searchPlaceholder")}
            />
          </View>
          <View className="max-w-xl flex-row gap-3">
            <View className="flex-1">
              <Field
                label={t("ui.dateFrom")}
                value={dateFrom}
                onChangeText={setDateFrom}
                placeholder={t("ui.datePlaceholder")}
                error={dateFrom && !from ? t("ui.invalidDate") : undefined}
              />
            </View>
            <View className="flex-1">
              <Field
                label={t("ui.dateTo")}
                value={dateTo}
                onChangeText={setDateTo}
                placeholder={t("ui.datePlaceholder")}
                error={dateTo && !to ? t("ui.invalidDate") : undefined}
              />
            </View>
          </View>
        </View>
      </View>
      <View className="gap-4">
        <View className="flex-row items-end justify-between">
          <View>
            <Text className="text-sm font-black uppercase tracking-wider text-brand">
              {t("common.discover")}
            </Text>
            <Text className="mt-1 text-3xl font-black text-ink">
              {t("common.events")}
            </Text>
          </View>
          <Text className="text-muted">
            {query.data?.length ?? 0} · {t("common.events")}
          </Text>
        </View>
        {query.isLoading ? <LoadingBlock label={t("common.loading")} /> : null}
        {query.error ? (
          <ErrorBlock
            message={(query.error as Error).message}
            retry={() => void query.refetch()}
          />
        ) : null}
        <View className="flex-row flex-wrap gap-5">
          {query.data?.map((event) => (
            <EventCard event={event} key={event.id} />
          ))}
        </View>
        {query.data?.length === 0 ? (
          <Text className="py-16 text-center text-muted">
            {t("common.noResults")}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Almaty";
  } catch {
    return "Asia/Almaty";
  }
}
