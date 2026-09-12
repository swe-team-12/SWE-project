import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  Button,
  ErrorBlock,
  Field,
  LoadingBlock,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { EventItem } from "@/types";

export default function OrganizerDashboard() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const [organizationName, setOrganizationName] = useState("");
  const [phone, setPhone] = useState("");
  const events = useQuery({
    queryKey: ["organizer-events"],
    queryFn: () => apiFetch<EventItem[]>("/organizer/events"),
    enabled: !!user?.roles.includes("organizer"),
  });
  const profile = useMutation({
    mutationFn: () =>
      apiFetch("/auth/organizer-profile", {
        method: "PUT",
        body: JSON.stringify({
          organization_name: organizationName,
          contact_phone: phone || null,
          contact_email: user?.email,
          payout_account_label: "Demo payout account",
        }),
      }),
    onSuccess: async () => {
      await refreshUser();
      await events.refetch();
    },
  });
  if (!user) {
    return (
      <Surface className="mx-auto mt-8 max-w-xl gap-4">
        <Text className="text-3xl font-black text-ink">
          {t("ui.organizerSignIn")}
        </Text>
        <Text className="text-muted">{t("ui.organizerSignInHelp")}</Text>
        <Link href="/login" asChild>
          <Pressable className="min-h-12 items-center justify-center rounded-2xl bg-brand">
            <Text className="font-bold text-white">{t("common.signIn")}</Text>
          </Pressable>
        </Link>
      </Surface>
    );
  }
  if (!user.roles.includes("organizer")) {
    return (
      <Surface className="mx-auto mt-8 w-full max-w-xl gap-5 p-7">
        <View>
          <Text className="text-sm font-black uppercase text-brand">
            {t("ui.startOrganizing")}
          </Text>
          <Text className="mt-1 text-3xl font-black text-ink">
            {t("ui.createOrganizerProfile")}
          </Text>
        </View>
        <Text className="text-muted">{t("ui.freeEventsHelp")}</Text>
        <Field
          label={t("ui.organizationName")}
          value={organizationName}
          onChangeText={setOrganizationName}
        />
        <Field
          label={t("ui.contactPhone")}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        {profile.error ? (
          <Text className="text-danger">
            {(profile.error as Error).message}
          </Text>
        ) : null}
        <Button
          label={t("ui.createOrganizerProfile")}
          onPress={() => profile.mutate()}
          loading={profile.isPending}
          disabled={organizationName.length < 2}
        />
      </Surface>
    );
  }
  const groups = ["active", "upcoming", "completed", "cancelled"];
  return (
    <ScrollView contentContainerClassName="gap-7 pb-16">
      <View className="flex-row flex-wrap items-end justify-between gap-4">
        <View>
          <Text className="text-sm font-black uppercase tracking-wider text-brand">
            {t("ui.organizerWorkspace")}
          </Text>
          <Text className="mt-1 text-4xl font-black text-ink">
            {t("ui.eventsOperations")}
          </Text>
        </View>
        <Link href="/organizer/new" asChild>
          <Pressable className="min-h-12 items-center justify-center rounded-2xl bg-brand px-6">
            <Text className="font-bold text-white">{t("ui.createEvent")}</Text>
          </Pressable>
        </Link>
      </View>
      {events.isLoading ? <LoadingBlock /> : null}
      {events.error ? (
        <ErrorBlock
          message={(events.error as Error).message}
          retry={() => void events.refetch()}
        />
      ) : null}
      {groups.map((group) => {
        const items =
          events.data?.filter((event) => event.lifecycle_group === group) ?? [];
        if (!items.length) return null;
        return (
          <View className="gap-3" key={group}>
            <Text className="text-xl font-black capitalize text-ink">
              {t(`status.${group}`)}
            </Text>
            <View className="gap-3">
              {items.map((event) => (
                <Link
                  href={{
                    pathname: "/organizer/events/[id]",
                    params: { id: event.id },
                  }}
                  asChild
                  key={event.id}
                >
                  <Pressable className="flex-row flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-white p-5 active:bg-slate-50">
                    <View className="min-w-60 flex-1 gap-1">
                      <Text className="text-lg font-black text-ink">
                        {event.title}
                      </Text>
                      <Text className="text-muted">
                        {new Date(event.starts_at).toLocaleString()} ·{" "}
                        {event.venue_name}
                      </Text>
                    </View>
                    <StatusBadge status={event.status} />
                  </Pressable>
                </Link>
              ))}
            </View>
          </View>
        );
      })}
      {events.data?.length === 0 ? (
        <Surface className="items-start gap-4">
          <Text className="text-xl font-black text-ink">
            {t("ui.firstEvent")}
          </Text>
          <Text className="text-muted">{t("ui.firstEventHelp")}</Text>
          <Button
            label={t("ui.createEvent")}
            onPress={() => router.push("/organizer/new")}
          />
        </Surface>
      ) : null}
    </ScrollView>
  );
}
