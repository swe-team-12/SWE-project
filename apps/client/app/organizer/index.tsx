import { useQuery } from "@tanstack/react-query";
import { Link, router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon, palette } from "@/components/icons";
import { errorMessage } from "@/components/organizer/common";
import { OrganizerEventCard } from "@/components/organizer/OrganizerEventCard";
import { ProfileCard } from "@/components/organizer/ProfileCard";
import { RequireAuth } from "@/components/RequireAuth";
import {
  Button,
  DarkCard,
  ErrorBlock,
  IconButton,
  LoadingBlock,
  SectionTitle,
  SegmentedControl,
  Surface,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { EventItem } from "@/types";

const GROUPS = ["active", "upcoming", "completed", "cancelled"] as const;
const STATUSES = [
  "draft",
  "published",
  "unpublished",
  "suspended",
  "cancelled",
] as const;
type StatusFilter = "all" | (typeof STATUSES)[number];

function OrganizerDashboardContent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const isOrganizer = !!user?.roles.includes("organizer");
  // Staff assigned to someone else's event also see it here, so the list is
  // loaded for every signed-in person.
  const events = useQuery({
    queryKey: ["organizer-events"],
    queryFn: () => apiFetch<EventItem[]>("/organizer/events"),
    enabled: !!user,
  });
  // RequireAuth renders the signed-out state before this mounts.
  if (!user) return null;
  const all = events.data ?? [];
  const counts = (status: string) =>
    all.filter((event) => event.status === status).length;
  const shown =
    filter === "all" ? all : all.filter((event) => event.status === filter);
  const firstName = user.display_name?.trim().split(/\s+/)[0];
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
              <Icon name="calendar" size={22} color={palette.mint} />
            )}
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-sm text-muted">
              {t("attendee.ux.greeting")}
            </Text>
            <Text className="text-lg font-semibold text-ink" numberOfLines={1}>
              {user.display_name}
            </Text>
          </View>
        </View>
        <IconButton
          icon="bell"
          label={t("common.notifications")}
          href="/notifications"
        />
      </View>

      <View className="flex-row flex-wrap items-end justify-between gap-4">
        <View className="min-w-0 flex-1 basis-64 gap-1">
          <Text className="text-sm font-semibold text-muted">
            {isOrganizer ? t("ui.organizerWorkspace") : t("ui.startOrganizing")}
          </Text>
          <Text
            accessibilityRole="header"
            className="text-4xl font-semibold leading-tight tracking-tight text-ink md:text-5xl"
          >
            {t("ui.eventsOperations")}
          </Text>
        </View>
        {isOrganizer ? (
          <Link href="/organizer/new" asChild>
            <Pressable
              accessibilityRole="button"
              className="min-h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-mint px-5 active:opacity-80"
            >
              <Icon name="plus" size={18} color={palette.ink} />
              <Text className="font-medium text-ink">
                {t("ui.createEvent")}
              </Text>
            </Pressable>
          </Link>
        ) : null}
      </View>

      {isOrganizer ? null : <ProfileCard />}

      {all.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="grow-0"
        >
          <SegmentedControl<StatusFilter>
            label={t("organizer.dashboard.filterByStatus")}
            value={filter}
            onChange={setFilter}
            options={[
              {
                value: "all" as StatusFilter,
                label: `${t("organizer.common.all")} (${all.length})`,
              },
              ...STATUSES.filter((status) => counts(status) > 0).map(
                (status) => ({
                  value: status as StatusFilter,
                  label: `${t(`status.${status}`)} (${counts(status)})`,
                }),
              ),
            ]}
          />
        </ScrollView>
      ) : null}

      {events.isLoading ? <LoadingBlock /> : null}
      {events.error ? (
        <ErrorBlock
          message={errorMessage(events.error)}
          retry={() => void events.refetch()}
        />
      ) : null}

      {GROUPS.map((group) => {
        const items = shown.filter((event) => event.lifecycle_group === group);
        if (!items.length) return null;
        return (
          <View className="gap-4" key={group}>
            <SectionTitle
              title={`${t(`status.${group}`)} (${items.length})`}
            />
            <View className="flex-row flex-wrap gap-5">
              {items.map((event) => (
                <OrganizerEventCard
                  key={event.id}
                  event={event}
                  staffEvent={event.owner_id !== user.id}
                />
              ))}
            </View>
          </View>
        );
      })}

      {events.data && all.length > 0 && shown.length === 0 ? (
        <Surface tone="plain" className="items-center gap-3 py-8">
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-mintsoft">
            <Icon name="filter" size={22} color={palette.brand} />
          </View>
          <Text className="text-center text-muted">
            {t("organizer.dashboard.noMatches")}
          </Text>
        </Surface>
      ) : null}
      {isOrganizer && events.data?.length === 0 ? (
        <DarkCard className="items-start gap-4">
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-mint/15">
            <Icon name="plus" size={22} color={palette.mint} />
          </View>
          <Text className="text-2xl font-semibold tracking-tight text-white">
            {t("ui.firstEvent")}
          </Text>
          <Text className="leading-6 text-white/75">
            {t("ui.firstEventHelp")}
          </Text>
          <Button
            label={t("ui.createEvent")}
            iconName="plus"
            onPress={() => router.push("/organizer/new")}
          />
        </DarkCard>
      ) : null}

      {isOrganizer ? <ProfileCard /> : null}
    </ScrollView>
  );
}

export default function OrganizerDashboard() {
  const { t } = useTranslation();
  return (
    <RequireAuth
      title={t("ui.organizerSignIn")}
      message={t("ui.organizerSignInHelp")}
    >
      <OrganizerDashboardContent />
    </RequireAuth>
  );
}
