import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, ErrorBlock, Field, LoadingBlock, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/utils/date";

import {
  Badge,
  ChoiceGroup,
  errorMessage,
  Fact,
  isForbidden,
  Muted,
  Pager,
  PermissionNotice,
  SectionTitle,
} from "./common";
import type { AttendeeRow, OrgEvent, Paged } from "./types";
import { eventKey } from "./useEventAccess";

const PAGE = 25;
const STATUSES = ["all", "valid", "checked_in", "refunded", "cancelled"] as const;

/** Searchable attendee list with ticket, seat, status and check-in state. */
export function AttendeesSection({ event }: { event: OrgEvent }) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [ticketType, setTicketType] = useState("all");
  const [offset, setOffset] = useState(0);
  const attendees = useQuery({
    queryKey: eventKey(event.id, "attendees", query, status, ticketType, offset),
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(PAGE),
        offset: String(offset),
      });
      if (query) params.set("q", query);
      if (status !== "all") params.set("status", status);
      if (ticketType !== "all") params.set("ticket_type_id", ticketType);
      return apiFetch<Paged<AttendeeRow>>(
        `/events/${event.id}/attendees?${params.toString()}`,
      );
    },
    placeholderData: keepPreviousData,
  });
  if (isForbidden(attendees.error)) return <PermissionNotice />;
  const apply = () => {
    setQuery(search.trim());
    setOffset(0);
  };
  return (
    <Surface className="gap-4">
      <SectionTitle>{t("organizer.attendees.title")}</SectionTitle>
      <View className="flex-row flex-wrap items-end gap-3">
        <View className="min-w-60 flex-1">
          <Field
            label={t("organizer.attendees.search")}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={apply}
            returnKeyType="search"
            autoCapitalize="none"
            icon="search"
            testID="attendee-search"
          />
        </View>
        <Button
          label={t("ui.search")}
          variant="dark"
          size="lg"
          onPress={apply}
          testID="attendee-search-apply"
        />
      </View>
      <ChoiceGroup
        label={t("organizer.attendees.ticketStatus")}
        value={status}
        onChange={(value) => {
          setStatus(value);
          setOffset(0);
        }}
        options={STATUSES.map((item) => ({
          value: item,
          label:
            item === "all" ? t("organizer.common.all") : t(`status.${item}`),
        }))}
      />
      {event.ticket_types.length > 1 ? (
        <ChoiceGroup
          label={t("organizer.common.ticketType")}
          value={ticketType}
          onChange={(value) => {
            setTicketType(value);
            setOffset(0);
          }}
          options={[
            { value: "all", label: t("organizer.common.all") },
            ...event.ticket_types.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ]}
        />
      ) : null}
      {attendees.isLoading ? <LoadingBlock /> : null}
      {attendees.error ? (
        <ErrorBlock
          message={errorMessage(attendees.error)}
          retry={() => void attendees.refetch()}
        />
      ) : null}
      {attendees.data ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-muted">
          {t("organizer.attendees.found", { count: attendees.data.total })}
        </Text>
      ) : null}
      {attendees.data?.items.length === 0 ? (
        <Muted>{t("organizer.attendees.empty")}</Muted>
      ) : null}
      {attendees.data?.items.map((row) => (
        <View
          key={row.ticket_id}
          className="flex-row flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-canvas/60 p-4"
        >
          <View className="min-w-60 flex-1 gap-1">
            <Text className="font-medium text-ink">{row.attendee_name}</Text>
            <Text selectable className="text-sm text-muted">
              {row.attendee_email}
            </Text>
            <Fact
              label={t("organizer.common.ticketType")}
              value={row.ticket_type_name}
            />
            <Fact
              label={t("organizer.attendees.seat")}
              value={row.seat_label ?? t("organizer.attendees.noSeat")}
            />
            <Fact
              label={t("organizer.sales.orderNumber")}
              value={row.order_number}
            />
            <Fact
              label={t("organizer.attendees.ticketCode")}
              value={row.ticket_code}
            />
            <Fact
              label={t("organizer.attendees.checkIn")}
              value={
                row.checked_in
                  ? `${t("organizer.attendees.checkedInAt", {
                      time: row.checked_in_at
                        ? formatDateTime(
                            row.checked_in_at,
                            i18n.language,
                            "medium",
                          )
                        : "",
                    })}`
                  : `○ ${t("organizer.attendees.notCheckedIn")}`
              }
            />
          </View>
          <Badge status={row.ticket_status} />
        </View>
      ))}
      {attendees.data ? (
        <Pager
          offset={offset}
          limit={PAGE}
          total={attendees.data.total}
          count={attendees.data.items.length}
          onChange={setOffset}
        />
      ) : null}
    </Surface>
  );
}
