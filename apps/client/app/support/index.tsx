import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
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

interface SupportCase {
  id: string;
  case_number: string;
  kind: string;
  category: string;
  status: string;
  subject: string;
  event_id?: string;
  updated_at: string;
}

export default function SupportPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const client = useQueryClient();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("technical");
  const [eventId, setEventId] = useState<string>();
  const [organizerCase, setOrganizerCase] = useState(false);
  const cases = useQuery({
    queryKey: ["support-cases"],
    queryFn: () => apiFetch<SupportCase[]>("/support/cases"),
    enabled: !!user,
    refetchInterval: 15_000,
  });
  const events = useQuery({
    queryKey: ["events"],
    queryFn: () => apiFetch<EventItem[]>("/events"),
    enabled: !!user,
  });
  const create = useMutation({
    mutationFn: () =>
      apiFetch<SupportCase>("/support/cases", {
        method: "POST",
        body: JSON.stringify({
          kind: organizerCase
            ? "organizer_to_platform"
            : "attendee_to_organizer",
          category,
          subject,
          message,
          event_id: organizerCase ? null : eventId,
        }),
      }),
    onSuccess: async () => {
      setSubject("");
      setMessage("");
      await client.invalidateQueries({ queryKey: ["support-cases"] });
    },
  });
  if (!user) return <ErrorBlock message={t("ui.supportHelp")} />;
  return (
    <ScrollView contentContainerClassName="gap-7 pb-16">
      <View>
        <Text className="text-sm font-black uppercase tracking-wider text-brand">
          {t("ui.helpCenter")}
        </Text>
        <Text className="mt-1 text-4xl font-black text-ink">
          {t("ui.supportConversations")}
        </Text>
        <Text className="mt-2 text-muted">{t("ui.supportHelp")}</Text>
      </View>
      <View className="flex-row flex-wrap items-start gap-5">
        <Surface className="min-w-80 flex-1 gap-4">
          <Text className="text-xl font-black text-ink">
            {t("ui.openCase")}
          </Text>
          {user.roles.includes("organizer") ? (
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setOrganizerCase(false)}
                className={`min-h-11 justify-center rounded-xl border px-3 ${!organizerCase ? "border-brand bg-teal-50" : "border-line"}`}
              >
                <Text className="font-bold text-ink">
                  {t("ui.eventSupport")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setOrganizerCase(true)}
                className={`min-h-11 justify-center rounded-xl border px-3 ${organizerCase ? "border-brand bg-teal-50" : "border-line"}`}
              >
                <Text className="font-bold text-ink">
                  {t("ui.platformSupport")}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {!organizerCase ? (
            <View className="gap-2">
              <Text className="text-sm font-bold text-ink">
                {t("ui.relatedEvent")}
              </Text>
              <ScrollView horizontal contentContainerClassName="gap-2">
                {events.data?.map((event) => (
                  <Pressable
                    key={event.id}
                    onPress={() => setEventId(event.id)}
                    className={`min-h-11 justify-center rounded-xl border px-3 ${eventId === event.id ? "border-brand bg-teal-50" : "border-line"}`}
                  >
                    <Text className="font-bold text-ink">{event.title}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
          <View className="gap-2">
            <Text className="text-sm font-bold text-ink">
              {t("ui.issueCategory")}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {[
                "ticket_delivery",
                "payment",
                "refund",
                "seating",
                "event_information",
                "check_in",
                "account",
                "technical",
                "activation",
              ].map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setCategory(item)}
                  className={`rounded-full border px-3 py-2 ${category === item ? "border-brand bg-teal-50" : "border-line"}`}
                >
                  <Text className="text-xs font-bold capitalize text-ink">
                    {t(`status.${item}`, {
                      defaultValue: item.replaceAll("_", " "),
                    })}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Field
            label={t("ui.subject")}
            value={subject}
            onChangeText={setSubject}
          />
          <Field
            label={t("ui.message")}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
          {create.error ? (
            <Text className="text-danger">
              {(create.error as Error).message}
            </Text>
          ) : null}
          <Button
            label={t("ui.submitCase")}
            onPress={() => create.mutate()}
            loading={create.isPending}
            disabled={!subject || !message || (!organizerCase && !eventId)}
          />
        </Surface>
        <View className="min-w-80 flex-[1.4] gap-3">
          <Text className="text-xl font-black text-ink">
            {t("ui.yourCases")}
          </Text>
          {cases.isLoading ? <LoadingBlock /> : null}
          {cases.error ? (
            <ErrorBlock message={(cases.error as Error).message} />
          ) : null}
          {cases.data?.map((item) => (
            <Link
              key={item.id}
              href={{ pathname: "/support/[id]", params: { id: item.id } }}
              asChild
            >
              <Pressable className="rounded-2xl border border-line bg-white p-4">
                <View className="flex-row justify-between gap-3">
                  <Text className="font-mono text-xs font-bold text-brand">
                    {item.case_number}
                  </Text>
                  <StatusBadge status={item.status} />
                </View>
                <Text className="mt-2 text-lg font-black text-ink">
                  {item.subject}
                </Text>
                <Text className="mt-1 text-sm capitalize text-muted">
                  {t(`status.${item.category}`, {
                    defaultValue: item.category.replaceAll("_", " "),
                  })}{" "}
                  · {new Date(item.updated_at).toLocaleString(i18n.language)}
                </Text>
              </Pressable>
            </Link>
          ))}
          {cases.data?.length === 0 ? (
            <Text className="py-12 text-center text-muted">
              {t("ui.noCases")}
            </Text>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}
