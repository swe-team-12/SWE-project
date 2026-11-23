import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams, useRootNavigationState } from "expo-router";
import { createElement, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { monthShort, upcomingDays, weekdayShort } from "@/components/design/time";
import { EventCard } from "@/components/EventCard";
import { Icon, palette } from "@/components/icons";
import {
  Chip,
  ErrorBlock,
  Field,
  IconButton,
  LoadingBlock,
  SectionTitle,
  Surface,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { toIsoDate } from "@/lib/dateInput";
import { useAuth } from "@/providers/AuthProvider";
import type { EventItem } from "@/types";

const DAY_CHIPS = 14;

export default function DiscoverPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  // Filters are mirrored into the URL (?q=&date_from=&date_to=&category=) so
  // they survive browser back navigation from an event detail page (#50).
  const params = useLocalSearchParams<{
    q?: string;
    date_from?: string;
    date_to?: string;
    category?: string;
  }>();
  const [search, setSearch] = useState(firstParam(params.q));
  const [dateFrom, setDateFrom] = useState(firstParam(params.date_from));
  const [dateTo, setDateTo] = useState(firstParam(params.date_to));
  const [category, setCategory] = useState(firstParam(params.category));
  const from = toIsoDate(dateFrom, i18n.language) ?? "";
  const to = toIsoDate(dateTo, i18n.language) ?? "";
  const [days] = useState(() => upcomingDays(DAY_CHIPS));
  const singleDay = from && from === to ? from : "";
  const customRange = !!(dateFrom || dateTo) && !days.some((d) => d.iso === singleDay);
  const [filtersOpen, setFiltersOpen] = useState(customRange);
  // Only sync once the root navigator is mounted (setParams throws before
  // that) and only when the URL actually differs from the filter state.
  const navReady = !!useRootNavigationState()?.key;
  const urlQ = firstParam(params.q);
  const urlFrom = firstParam(params.date_from);
  const urlTo = firstParam(params.date_to);
  const urlCategory = firstParam(params.category);
  useEffect(() => {
    if (!navReady) return;
    if (
      urlQ === search &&
      urlFrom === from &&
      urlTo === to &&
      urlCategory === category
    )
      return;
    router.setParams({
      q: search || undefined,
      date_from: from || undefined,
      date_to: to || undefined,
      category: category || undefined,
    });
  }, [navReady, search, from, to, category, urlQ, urlFrom, urlTo, urlCategory]);
  const query = useQuery({
    queryKey: ["events", search, from, to, category],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (from) params.set("date_from", from);
      if (to) params.set("date_to", to);
      if (category) params.set("category", category);
      if (from || to) params.set("tz", deviceTimeZone());
      const qs = params.toString();
      return apiFetch<EventItem[]>(`/events${qs ? `?${qs}` : ""}`);
    },
  });
  // Category chips come from the unfiltered public catalogue.
  const facets = useQuery({
    queryKey: ["events-facets"],
    queryFn: () => apiFetch<EventItem[]>("/events?limit=100"),
    staleTime: 5 * 60_000,
  });
  const categories = useMemo(
    () =>
      [...new Set((facets.data ?? []).map((event) => event.category))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [facets.data],
  );
  const pickDay = (iso: string) => {
    if (singleDay === iso) {
      setDateFrom("");
      setDateTo("");
      return;
    }
    setDateFrom(iso);
    setDateTo(iso);
  };
  const clearDates = () => {
    setDateFrom("");
    setDateTo("");
  };
  const filtersActive = !!(search || from || to || category);
  const firstName = user?.display_name?.trim().split(/\s+/)[0];
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerClassName="gap-6 pb-28"
    >
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1 flex-row items-center gap-3">
          <View
            className="h-12 w-12 items-center justify-center rounded-2xl bg-ink"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {firstName ? (
              <Text className="text-lg font-semibold text-mint">
                {firstName.slice(0, 1).toUpperCase()}
              </Text>
            ) : (
              <Icon name="ticket" size={22} color={palette.mint} />
            )}
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-sm text-muted">
              {user ? t("attendee.ux.greeting") : t("attendee.ux.welcomeGuest")}
            </Text>
            <Text
              className="text-lg font-semibold text-ink"
              numberOfLines={1}
            >
              {user ? user.display_name : t("attendee.ux.guestTagline")}
            </Text>
          </View>
        </View>
        {user ? (
          <IconButton
            icon="bell"
            label={t("common.notifications")}
            href="/notifications"
          />
        ) : null}
      </View>

      <View className="gap-2">
        <Text
          accessibilityRole="header"
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-ink md:text-6xl"
        >
          {t("ui.heroTitle")}
        </Text>
        <Text className="max-w-2xl text-base leading-6 text-muted md:text-lg">
          {t("ui.heroBody")}
        </Text>
      </View>

      <Surface className="gap-4">
        <View className="flex-row flex-wrap items-end gap-3">
          <View className="min-w-56 flex-1">
            <Field
              label={t("ui.searchEvents")}
              value={search}
              onChangeText={setSearch}
              placeholder={t("ui.searchPlaceholder")}
              icon="search"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: filtersOpen }}
            aria-expanded={filtersOpen}
            onPress={() => setFiltersOpen((value) => !value)}
            className={`h-14 flex-row items-center justify-center gap-2 rounded-2xl border px-4 active:opacity-80 ${filtersOpen ? "border-ink bg-ink" : "border-line bg-white"}`}
          >
            <Icon
              name="filter"
              size={18}
              color={filtersOpen ? palette.white : palette.ink}
            />
            <Text
              className={`font-medium ${filtersOpen ? "text-white" : "text-ink"}`}
            >
              {t("attendee.ux.filters")}
            </Text>
          </Pressable>
        </View>
        {filtersOpen ? (
          <View className="gap-3">
            <View className="flex-row flex-wrap gap-3">
              <View className="min-w-40 flex-1">
                <DateFilter
                  label={t("ui.dateFrom")}
                  value={dateFrom}
                  onChange={setDateFrom}
                  invalid={!!dateFrom && !from}
                  max={to || undefined}
                />
              </View>
              <View className="min-w-40 flex-1">
                <DateFilter
                  label={t("ui.dateTo")}
                  value={dateTo}
                  onChange={setDateTo}
                  invalid={!!dateTo && !to}
                  min={from || undefined}
                />
              </View>
            </View>
            {dateFrom || dateTo ? (
              <View className="self-start">
                <Chip
                  label={t("attendee.ux.clearDates")}
                  icon="close"
                  onPress={clearDates}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </Surface>

      <View className="gap-3">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 pr-4"
          accessibilityLabel={t("attendee.ux.dateChips")}
        >
          <DayTile
            active={!from && !to}
            top={t("attendee.ux.anyDate")}
            big="∞"
            bottom={t("attendee.ux.allDates")}
            label={t("attendee.ux.anyDateLabel")}
            onPress={clearDates}
          />
          {days.map((day, index) => (
            <DayTile
              key={day.iso}
              active={singleDay === day.iso}
              top={
                index === 0
                  ? t("attendee.ux.today")
                  : weekdayShort(day.weekday, i18n.language)
              }
              big={String(day.day)}
              bottom={monthShort(day.month, i18n.language)}
              label={t("attendee.ux.dayChipLabel", {
                date: `${day.day} ${monthShort(day.month, i18n.language)}`,
              })}
              onPress={() => pickDay(day.iso)}
            />
          ))}
        </ScrollView>
        {categories.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2 pr-4"
            accessibilityLabel={t("attendee.ux.categories")}
          >
            <Chip
              label={t("attendee.ux.allCategories")}
              selected={!category}
              tone="mint"
              onPress={() => setCategory("")}
            />
            {categories.map((item) => (
              <Chip
                key={item}
                label={item}
                selected={category === item}
                tone="mint"
                onPress={() => setCategory(category === item ? "" : item)}
              />
            ))}
          </ScrollView>
        ) : null}
      </View>

      <View className="gap-4">
        <SectionTitle
          title={t("common.events")}
          action={
            query.data ? (
              <Text
                className="text-sm font-semibold text-muted"
                accessibilityLiveRegion="polite"
              >
                {t("attendee.discover.resultCount", {
                  count: query.data.length,
                })}
              </Text>
            ) : null
          }
        />
        {query.isLoading ? <LoadingBlock label={t("common.loading")} /> : null}
        {query.error ? (
          <ErrorBlock
            message={(query.error as Error).message}
            retry={() => void query.refetch()}
          />
        ) : null}
        <View className="flex-row flex-wrap gap-5">
          {query.data?.map((event, index) => (
            <EventCard event={event} featured={index === 0} key={event.id} />
          ))}
        </View>
        {query.data?.length === 0 ? (
          <Surface tone="plain" className="items-center gap-3 py-10">
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-mintsoft">
              <Icon name="calendar" size={24} color={palette.brand} />
            </View>
            <Text className="max-w-md text-center text-muted">
              {filtersActive
                ? t("attendee.discover.noMatches")
                : t("attendee.discover.noEvents")}
            </Text>
          </Surface>
        ) : null}
      </View>
    </ScrollView>
  );
}

function DayTile({
  active,
  top,
  big,
  bottom,
  label,
  onPress,
}: {
  active: boolean;
  top: string;
  big: string;
  bottom: string;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      aria-pressed={active}
      onPress={onPress}
      className={`min-h-24 w-[68px] items-center justify-center gap-0.5 rounded-2xl border px-1 py-3 active:opacity-80 ${active ? "border-ink bg-white shadow-panel" : "border-transparent bg-white/55"}`}
    >
      <View
        className={`mb-1 h-1 w-6 rounded-full ${active ? "bg-mint" : "bg-transparent"}`}
      />
      <Text
        className={`text-xs ${active ? "font-medium text-ink" : "text-muted"}`}
        numberOfLines={1}
      >
        {top}
      </Text>
      <Text
        className={`text-2xl font-semibold ${active ? "text-ink" : "text-muted"}`}
      >
        {big}
      </Text>
      <Text
        className={`text-xs ${active ? "font-medium text-ink" : "text-muted"}`}
        numberOfLines={1}
      >
        {bottom}
      </Text>
    </Pressable>
  );
}

/**
 * Date filter. Browsers get the native date picker (value is always ISO);
 * native platforms keep a typed field that accepts the local date format.
 */
function DateFilter({
  label,
  value,
  onChange,
  invalid,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  invalid: boolean;
  min?: string;
  max?: string;
}) {
  const { t, i18n } = useTranslation();
  if (Platform.OS !== "web")
    return (
      <Field
        label={label}
        value={value}
        onChangeText={onChange}
        placeholder={t("attendee.discover.datePlaceholder")}
        error={invalid ? t("attendee.discover.invalidDate") : undefined}
      />
    );
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-ink">{label}</Text>
      {createElement("input", {
        type: "date",
        "aria-label": label,
        lang: i18n.language,
        value: toIsoDate(value, i18n.language) ?? "",
        min,
        max,
        onChange: (event: { target: { value: string } }) =>
          onChange(event.target.value),
        style: {
          height: 56,
          borderRadius: 16,
          border: `1px solid ${palette.line}`,
          backgroundColor: palette.white,
          padding: "0 16px",
          fontSize: 16,
          fontFamily: "inherit",
          color: palette.ink,
          boxSizing: "border-box",
          width: "100%",
        },
      })}
    </View>
  );
}

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Almaty";
  } catch {
    return "Asia/Almaty";
  }
}

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}
