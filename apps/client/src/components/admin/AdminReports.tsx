import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, Field, StatusBadge, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/utils/date";

import {
  Chips,
  ConfirmPanel,
  errorText,
  eventManageHref,
  ListState,
  Meta,
  Notice,
  Row,
  TextLink,
} from "./shared";

interface Person {
  id: string;
  display_name: string;
  email: string;
}

interface EventReport {
  id: string;
  category: string;
  details: string;
  status: "open" | "resolved" | "dismissed";
  created_at: string;
  event_id: string;
  event_title: string;
  event_status: string;
  event_open_reports: number;
  reporter: Person | null;
  reporter_name?: string;
  reporter_email?: string;
  resolution_note: string | null;
  resolved_by: Person | null;
  resolved_at: string | null;
}

type StatusFilter = "all" | "open" | "resolved" | "dismissed";
type Resolution = "resolved" | "dismissed";

export function AdminReports({
  onFindEvent,
}: {
  onFindEvent(title: string): void;
}) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [pending, setPending] = useState<{ id: string; status: Resolution }>();
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string>();
  const reports = useQuery({
    queryKey: ["admin-reports", status],
    queryFn: () =>
      apiFetch<EventReport[]>(
        `/admin/reports/events${status === "all" ? "" : `?status=${status}`}`,
      ),
  });
  const resolve = useMutation({
    mutationFn: (input: { id: string; status: Resolution }) =>
      apiFetch<EventReport>(`/admin/reports/events/${input.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ status: input.status, note: note.trim() }),
      }),
    onSuccess: async (_result, input) => {
      setDone(t(`adminX.reports.done.${input.status}`));
      setPending(undefined);
      setNote("");
      await reports.refetch();
    },
    onError: () => void reports.refetch(),
  });
  const begin = (id: string, next: Resolution) => {
    resolve.reset();
    setDone(undefined);
    setNote("");
    setPending({ id, status: next });
  };
  return (
    <Surface className="gap-4">
      <Text accessibilityRole="header" className="text-xl font-extrabold tracking-tight text-ink">
        {t("adminX.reports.title")}
      </Text>
      <Meta>{t("adminX.reports.help")}</Meta>
      <Chips
        label={t("adminX.common.statusFilter")}
        value={status}
        onChange={(next) => {
          setStatus(next);
          setPending(undefined);
        }}
        options={(["open", "resolved", "dismissed", "all"] as const).map(
          (value) => ({
            value,
            label:
              value === "all" ? t("adminX.common.all") : t(`status.${value}`),
          }),
        )}
      />
      {done ? <Notice tone="success">{done}</Notice> : null}
      <ListState
        loading={reports.isLoading}
        error={reports.error}
        retry={() => void reports.refetch()}
        empty={reports.data?.length === 0}
        emptyText={t("adminX.reports.empty")}
      />
      {reports.data?.map((item) => (
        <Row
          key={item.id}
          aside={
            <>
              <StatusBadge status={item.status} />
              {item.status === "open" ? (
                <>
                  <Button
                    size="sm"
                    label={t("adminX.reports.resolve")}
                    onPress={() => begin(item.id, "resolved")}
                  />
                  <Button
                    size="sm"
                    label={t("adminX.reports.dismiss")}
                    variant="secondary"
                    onPress={() => begin(item.id, "dismissed")}
                  />
                </>
              ) : null}
            </>
          }
          below={
            pending?.id === item.id ? (
              <ConfirmPanel
                title={t(`adminX.reports.confirm.${pending.status}`, {
                  title: item.event_title,
                })}
                message={t("adminX.reports.confirmHelp")}
                confirmLabel={t(
                  pending.status === "resolved"
                    ? "adminX.reports.resolve"
                    : "adminX.reports.dismiss",
                )}
                loading={resolve.isPending}
                error={resolve.error ? errorText(resolve.error) : undefined}
                onConfirm={() => resolve.mutate(pending)}
                onCancel={() => {
                  setPending(undefined);
                  resolve.reset();
                }}
              >
                <Field
                  label={t("adminX.reports.note")}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  numberOfLines={2}
                  maxLength={2000}
                />
              </ConfirmPanel>
            ) : null
          }
        >
          <Text className="font-bold text-ink">
            {t(`adminX.reportCategory.${item.category}`, {
              defaultValue: item.category,
            })}
          </Text>
          <TextLink
            href={eventManageHref(item.event_id)}
            label={item.event_title}
            accessibilityLabel={t("adminX.common.manageEvent", {
              title: item.event_title,
            })}
          />
          <View className="flex-row flex-wrap items-center gap-2">
            <Meta>{t("adminX.reports.eventStatus")}</Meta>
            <StatusBadge status={item.event_status} />
            <Meta>
              {t("adminX.reports.openCount", {
                count: item.event_open_reports,
              })}
            </Meta>
          </View>
          {item.details ? (
            <Text className="text-ink">{item.details}</Text>
          ) : (
            <Meta>{t("adminX.reports.noDetails")}</Meta>
          )}
          <Meta>
            {t("adminX.reports.reportedBy", {
              name: item.reporter?.display_name ?? item.reporter_name ?? "—",
              email: item.reporter?.email ?? item.reporter_email ?? "—",
              date: formatDateTime(item.created_at, i18n.language, "medium"),
            })}
          </Meta>
          {item.status !== "open" ? (
            <Meta>
              {t("adminX.reports.closedBy", {
                name: item.resolved_by?.display_name ?? "—",
                date: item.resolved_at
                  ? formatDateTime(item.resolved_at, i18n.language, "medium")
                  : "—",
              })}
              {item.resolution_note
                ? ` · ${t("adminX.reports.noteValue", { note: item.resolution_note })}`
                : ""}
            </Meta>
          ) : null}
          <Button
            label={t("adminX.reports.moderateEvent")}
            variant="ghost"
            onPress={() => onFindEvent(item.event_title)}
          />
        </Row>
      ))}
    </Surface>
  );
}
