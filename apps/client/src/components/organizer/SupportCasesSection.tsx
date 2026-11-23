import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ErrorBlock, LoadingBlock, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/utils/date";

import {
  Badge,
  ChoiceGroup,
  errorMessage,
  Fact,
  isForbidden,
  Muted,
  PermissionNotice,
  SectionTitle,
} from "./common";
import type { SupportCaseRow } from "./types";
import { eventKey } from "./useEventAccess";

const STATUSES = [
  "all",
  "open",
  "in_progress",
  "waiting_for_customer",
  "resolved",
] as const;

/** Support cases opened for this event; each links to the conversation. */
export function SupportCasesSection({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const cases = useQuery({
    queryKey: eventKey(eventId, "support-cases", status),
    queryFn: () =>
      apiFetch<SupportCaseRow[]>(
        `/events/${eventId}/support-cases${status === "all" ? "" : `?status=${status}`}`,
      ),
  });
  if (isForbidden(cases.error)) return <PermissionNotice />;
  return (
    <Surface className="gap-4">
      <SectionTitle>{t("organizer.support.title")}</SectionTitle>
      <ChoiceGroup
        label={t("organizer.common.filterStatus")}
        value={status}
        onChange={setStatus}
        options={STATUSES.map((item) => ({
          value: item,
          label:
            item === "all" ? t("organizer.common.all") : t(`status.${item}`),
        }))}
      />
      {cases.isLoading ? <LoadingBlock /> : null}
      {cases.error ? (
        <ErrorBlock
          message={errorMessage(cases.error)}
          retry={() => void cases.refetch()}
        />
      ) : null}
      {cases.data?.length === 0 ? (
        <Muted>{t("organizer.support.empty")}</Muted>
      ) : null}
      {cases.data?.map((item) => (
        <Link
          key={item.id}
          href={{ pathname: "/support/[id]", params: { id: item.id } }}
          asChild
        >
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t("organizer.support.open", {
              number: item.case_number,
              subject: item.subject,
            })}
            className="flex-row flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-white p-4 active:opacity-80"
          >
            <View className="min-w-60 flex-1 gap-1">
              <Text className="font-medium text-ink">
                {item.case_number} · {item.subject}
              </Text>
              <Fact
                label={t("organizer.support.requester")}
                value={`${item.requester_name ?? "—"} · ${item.requester_email ?? "—"}`}
              />
              <Fact
                label={t("ui.issueCategory")}
                value={t(`status.${item.category}`, {
                  defaultValue: item.category.replaceAll("_", " "),
                })}
              />
              <Fact
                label={t("organizer.support.assignee")}
                value={item.assignee_name ?? t("organizer.support.unassigned")}
              />
              <Muted>
                {formatDateTime(item.updated_at, i18n.language, "medium")}
              </Muted>
            </View>
            <View className="items-end gap-2">
              <Badge status={item.status} />
              {item.escalated ? (
                <Badge
                  status="escalated"
                  tone="bad"
                  label={t("organizer.support.escalated")}
                />
              ) : null}
            </View>
          </Pressable>
        </Link>
      ))}
    </Surface>
  );
}
