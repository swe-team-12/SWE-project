import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, ErrorBlock, LoadingBlock, Surface } from "@/components/ui";
import { apiFetchList } from "@/lib/api";
import { formatDateTime } from "@/utils/date";

import {
  ChoiceGroup,
  errorMessage,
  ErrorText,
  isForbidden,
  Muted,
  Pager,
  PermissionNotice,
  SectionTitle,
} from "./common";
import { DateTimeField } from "./DateTimeField";
import {
  DEFAULT_TIME_ZONE,
  defaultZonedInput,
  fromZonedInput,
  parseDateInput,
} from "./dateTime";
import type { HistoryEntry } from "./types";
import { eventKey } from "./useEventAccess";

const PAGE = 25;

/** Activity families offered as a filter (prefix of the audit action). */
export const HISTORY_FAMILIES = [
  "all",
  "event",
  "ticket_type",
  "campaign",
  "checkout",
  "order",
  "payment",
  "paid_sales",
  "payout",
  "staff",
  "support",
  "ticket",
  "admin",
] as const;
export type HistoryFamily = (typeof HISTORY_FAMILIES)[number];

export interface HistoryFilter {
  family: HistoryFamily;
  start: string;
  end: string;
}

/**
 * The history endpoint filters by instant, so whole days are sent as the
 * first and last moment of that day on the event's clock (the end day is
 * included).
 */
export function historyQuery(
  filter: HistoryFilter,
  offset: number,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const params = new URLSearchParams({
    limit: String(PAGE),
    offset: String(offset),
  });
  if (filter.family !== "all") params.set("activity_type", filter.family);
  const start = filter.start
    ? fromZonedInput(`${filter.start}T00:00`, timeZone)
    : null;
  if (start) params.set("start", start);
  const endStart = filter.end
    ? fromZonedInput(`${filter.end}T00:00`, timeZone)
    : null;
  if (endStart) {
    const nextDay = fromZonedInput(
      defaultZonedInput(1, 0, timeZone, new Date(endStart)),
      timeZone,
    );
    if (nextDay)
      params.set("end", new Date(new Date(nextDay).getTime() - 1).toISOString());
  }
  return `?${params.toString()}`;
}

/**
 * Translated name of a known audit action ("event.published"); unknown actions
 * fall back to the description the server recorded.
 */
export function historyActionText(
  entry: Pick<HistoryEntry, "action" | "description">,
  t: TFunction,
): string {
  const key = `organizer.history.actions.${entry.action.replaceAll(".", "_")}`;
  const text = t(key, { defaultValue: "" });
  return text || entry.description || entry.action;
}

const EMPTY: HistoryFilter = { family: "all", start: "", end: "" };

/** Audit history of one event with filters and pagination. */
export function HistorySection({
  eventId,
  timeZone,
}: {
  eventId: string;
  timeZone: string;
}) {
  const { t, i18n } = useTranslation();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [applied, setApplied] = useState<HistoryFilter>(EMPTY);
  const [offset, setOffset] = useState(0);
  const [rangeError, setRangeError] = useState("");
  const history = useQuery({
    queryKey: eventKey(
      eventId,
      "history",
      applied.family,
      applied.start,
      applied.end,
      offset,
    ),
    queryFn: () =>
      apiFetchList<HistoryEntry>(
        `/events/${eventId}/history${historyQuery(applied, offset, timeZone)}`,
      ),
    placeholderData: keepPreviousData,
  });
  if (isForbidden(history.error))
    return <PermissionNotice message={t("organizer.history.forbidden")} />;
  const applyDates = () => {
    const from = start ? parseDateInput(start) : "";
    const to = end ? parseDateInput(end) : "";
    if (from === null || to === null) {
      setRangeError(t("organizer.validation.dateInvalid"));
      return;
    }
    if (from && to && from > to) {
      setRangeError(t("organizer.validation.rangeOrder"));
      return;
    }
    setRangeError("");
    setOffset(0);
    setApplied((current) => ({ ...current, start: from, end: to }));
  };
  const filtered = applied.family !== "all" || !!applied.start || !!applied.end;
  const rows = history.data?.items ?? [];
  return (
    <Surface className="gap-4">
      <SectionTitle>{t("organizer.history.title")}</SectionTitle>
      <Muted>{t("organizer.history.help")}</Muted>
      <ChoiceGroup
        label={t("organizer.history.activity")}
        value={applied.family}
        onChange={(family) => {
          setOffset(0);
          setApplied((current) => ({ ...current, family }));
        }}
        options={HISTORY_FAMILIES.map((family) => ({
          value: family,
          label:
            family === "all"
              ? t("organizer.common.all")
              : t(`organizer.history.families.${family}`),
        }))}
      />
      <View className="flex-row flex-wrap gap-3">
        <View className="min-w-52 flex-1">
          <DateTimeField
            mode="date"
            label={t("organizer.common.from")}
            value={start}
            onChange={setStart}
            testID="history-start"
          />
        </View>
        <View className="min-w-52 flex-1">
          <DateTimeField
            mode="date"
            label={t("organizer.common.to")}
            value={end}
            onChange={setEnd}
            testID="history-end"
          />
        </View>
      </View>
      {rangeError ? <ErrorText error={new Error(rangeError)} /> : null}
      <View className="flex-row flex-wrap gap-3">
        <Button
          label={t("organizer.common.apply")}
          onPress={applyDates}
          testID="history-apply"
        />
        {filtered ? (
          <Button
            label={t("organizer.common.reset")}
            variant="secondary"
            onPress={() => {
              setStart("");
              setEnd("");
              setRangeError("");
              setOffset(0);
              setApplied(EMPTY);
            }}
          />
        ) : null}
      </View>
      {history.isLoading ? <LoadingBlock /> : null}
      {history.error ? (
        <ErrorBlock
          message={errorMessage(history.error)}
          retry={() => void history.refetch()}
        />
      ) : null}
      {history.data && rows.length === 0 ? (
        <Muted>{t("organizer.history.empty")}</Muted>
      ) : null}
      {rows.map((entry) => (
        <View
          key={entry.id}
          testID={`history-${entry.id}`}
          className="gap-1 rounded-2xl border border-line bg-canvas/60 p-4"
        >
          <Text className="font-bold text-ink">
            {historyActionText(entry, t)}
          </Text>
          <Text className="text-sm text-ink">
            {t("organizer.history.by", {
              name: entry.actor_name ?? t("organizer.history.system"),
            })}
            {entry.entity_type
              ? ` · ${t(`organizer.history.entities.${entry.entity_type}`, {
                  defaultValue: entry.entity_type.replaceAll("_", " "),
                })}${entry.entity_id ? ` ${entry.entity_id.slice(0, 8)}` : ""}`
              : ""}
          </Text>
          <Muted>
            {formatDateTime(entry.timestamp, i18n.language, "medium")}
          </Muted>
        </View>
      ))}
      {history.data ? (
        <Pager
          offset={offset}
          limit={PAGE}
          total={history.data.total}
          count={rows.length}
          onChange={setOffset}
        />
      ) : null}
    </Surface>
  );
}
