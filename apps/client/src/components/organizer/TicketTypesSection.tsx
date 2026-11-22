import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, Field, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { eventContentText } from "@/lib/eventContentText";
import { formatDateTime } from "@/utils/date";
import { formatKzt } from "@/utils/format";

import {
  Badge,
  ChoiceGroup,
  ErrorText,
  Fact,
  isWholeNumber,
  Muted,
  numberOrNull,
  SectionTitle,
} from "./common";
import { DateTimeField } from "./DateTimeField";
import { fromZonedInput, toZonedInput } from "./dateTime";
import { ProgressMeter } from "./design";
import type {
  AnalyticsTicketType,
  EventAccess,
  OrgEvent,
  OrgTicketType,
} from "./types";
import { eventKey } from "./useEventAccess";

export interface TicketFormValues {
  name: string;
  description: string;
  price: string;
  quantity: string;
  maxPerOrder: string;
  salesStart: string;
  salesEnd: string;
  category: string;
}

export type TicketFormErrors = Partial<Record<keyof TicketFormValues, string>>;

/** Same default and ceiling as the API's ticket-type schema. */
export const DEFAULT_PER_ORDER_LIMIT = 10;
export const MAX_PER_ORDER_LIMIT = 50;

export function ticketToValues(
  ticket: OrgTicketType | null,
  timeZone: string,
): TicketFormValues {
  return {
    name: ticket?.name ?? "",
    description: ticket?.description ?? "",
    price: ticket ? String(ticket.price_tiyin / 100) : "0",
    quantity: ticket ? String(ticket.quantity) : "50",
    maxPerOrder: ticket
      ? String(ticket.max_per_order)
      : String(DEFAULT_PER_ORDER_LIMIT),
    salesStart: toZonedInput(ticket?.sales_start_at, timeZone),
    salesEnd: toZonedInput(ticket?.sales_end_at, timeZone),
    category: ticket?.price_category ?? "standard",
  };
}

/** Returns translation keys (under organizer.validation) per invalid field. */
export function validateTicketForm(
  values: TicketFormValues,
  timeZone: string,
): TicketFormErrors {
  const errors: TicketFormErrors = {};
  if (!values.name.trim()) errors.name = "nameRequired";
  if (values.description.length > 2000) errors.description = "textTooLong";
  const price = numberOrNull(values.price);
  if (price === null || price < 0) errors.price = "priceInvalid";
  const quantity = Number(values.quantity);
  if (!isWholeNumber(values.quantity) || quantity < 1 || quantity > 100_000)
    errors.quantity = "quantityInvalid";
  const limit = Number(values.maxPerOrder);
  if (!isWholeNumber(values.maxPerOrder) || limit < 1 || limit > MAX_PER_ORDER_LIMIT)
    errors.maxPerOrder = "perOrderInvalid";
  const start = values.salesStart.trim()
    ? fromZonedInput(values.salesStart, timeZone)
    : undefined;
  const end = values.salesEnd.trim()
    ? fromZonedInput(values.salesEnd, timeZone)
    : undefined;
  if (start === null) errors.salesStart = "dateTimeInvalid";
  if (end === null) errors.salesEnd = "dateTimeInvalid";
  else if (start && end && end <= start) errors.salesEnd = "endBeforeStart";
  return errors;
}

export function ticketPayload(
  values: TicketFormValues,
  timeZone: string,
  assignedSeating: boolean,
): Record<string, unknown> {
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    price_tiyin: Math.round((numberOrNull(values.price) ?? 0) * 100),
    quantity: Number(values.quantity),
    max_per_order: Number(values.maxPerOrder),
    sales_start_at: values.salesStart.trim()
      ? fromZonedInput(values.salesStart, timeZone)
      : null,
    sales_end_at: values.salesEnd.trim()
      ? fromZonedInput(values.salesEnd, timeZone)
      : null,
    price_category: assignedSeating ? values.category : null,
  };
}

function TicketTypeForm({
  event,
  ticket,
  onClose,
}: {
  event: OrgEvent;
  ticket: OrgTicketType | null;
  onClose?(): void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const assigned = event.seating_mode === "assigned";
  const [values, setValues] = useState(() =>
    ticketToValues(ticket, event.timezone),
  );
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? validateTicketForm(values, event.timezone) : {};
  const set = (key: keyof TicketFormValues, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const text = (key: keyof TicketFormValues) =>
    errors[key] ? t(`organizer.validation.${errors[key]}`) : undefined;
  const save = useMutation({
    mutationFn: () =>
      apiFetch<OrgTicketType>(
        ticket
          ? `/events/${event.id}/ticket-types/${ticket.id}`
          : `/events/${event.id}/ticket-types`,
        {
          method: ticket ? "PATCH" : "POST",
          body: JSON.stringify(ticketPayload(values, event.timezone, assigned)),
        },
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: eventKey(event.id) });
      if (!ticket) {
        setValues(ticketToValues(null, event.timezone));
        setSubmitted(false);
      }
      onClose?.();
    },
  });
  const zoneHint = t("organizer.form.timesInZone", { zone: event.timezone });
  const prefix = ticket ? `ticket-${ticket.id}` : "ticket-new";
  return (
    <View className="gap-4">
      <Field
        label={t("organizer.tickets.name")}
        value={values.name}
        onChangeText={(value) => set("name", value)}
        error={text("name")}
        testID={`${prefix}-name`}
      />
      <Field
        label={t("organizer.tickets.description")}
        value={values.description}
        onChangeText={(value) => set("description", value)}
        multiline
        numberOfLines={2}
        error={text("description")}
      />
      <View className="flex-row flex-wrap gap-3">
        <View className="min-w-36 flex-1 gap-1">
          <Field
            label={t("ui.priceKzt")}
            value={values.price}
            onChangeText={(value) => set("price", value)}
            keyboardType="numeric"
            error={text("price")}
            testID={`${prefix}-price`}
          />
          <Text className="text-xs text-muted">
            {t("organizer.tickets.freeHint")}
          </Text>
        </View>
        <View className="min-w-36 flex-1">
          <Field
            label={t("organizer.tickets.quantity")}
            value={values.quantity}
            onChangeText={(value) => set("quantity", value)}
            keyboardType="number-pad"
            error={text("quantity")}
            testID={`${prefix}-quantity`}
          />
        </View>
        <View className="min-w-36 flex-1">
          <Field
            label={t("organizer.tickets.perOrder")}
            value={values.maxPerOrder}
            onChangeText={(value) => set("maxPerOrder", value)}
            keyboardType="number-pad"
            error={text("maxPerOrder")}
            testID={`${prefix}-per-order`}
          />
        </View>
      </View>
      <View className="flex-row flex-wrap gap-3">
        <View className="min-w-60 flex-1">
          <DateTimeField
            label={t("organizer.tickets.salesStart")}
            value={values.salesStart}
            onChange={(value) => set("salesStart", value)}
            error={text("salesStart")}
            hint={`${t("organizer.tickets.salesOptional")} ${zoneHint}`}
          />
        </View>
        <View className="min-w-60 flex-1">
          <DateTimeField
            label={t("organizer.tickets.salesEnd")}
            value={values.salesEnd}
            onChange={(value) => set("salesEnd", value)}
            error={text("salesEnd")}
            hint={`${t("organizer.tickets.salesOptional")} ${zoneHint}`}
          />
        </View>
      </View>
      {assigned ? (
        <ChoiceGroup
          label={t("ui.seatCategory")}
          value={values.category}
          onChange={(value) => set("category", value)}
          options={["premium", "standard", "accessible"].map((item) => ({
            value: item,
            label: t(`organizer.tickets.categories.${item}`),
          }))}
        />
      ) : null}
      <ErrorText error={save.error} />
      <View className="flex-row flex-wrap gap-3">
        <Button
          label={
            ticket ? t("organizer.tickets.save") : t("ui.addTicketType")
          }
          loading={save.isPending}
          testID={`${prefix}-save`}
          onPress={() => {
            setSubmitted(true);
            if (
              Object.keys(validateTicketForm(values, event.timezone)).length ===
              0
            )
              save.mutate();
          }}
        />
        {onClose ? (
          <Button
            label={t("common.cancel")}
            variant="secondary"
            onPress={onClose}
          />
        ) : null}
      </View>
    </View>
  );
}

/** One line of inventory numbers, matched to the ticket type by id. */
export function inventoryFor(
  rows: AnalyticsTicketType[] | undefined,
  ticketTypeId: string,
): AnalyticsTicketType | undefined {
  return rows?.find((row) => (row.ticket_type_id ?? row.id) === ticketTypeId);
}

export function TicketTypesSection({
  event,
  access,
  inventory,
  inventoryLoading,
}: {
  event: OrgEvent;
  access: EventAccess;
  inventory: AnalyticsTicketType[] | undefined;
  inventoryLoading?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: (item: OrgTicketType) =>
      apiFetch(`/events/${event.id}/ticket-types/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_hidden: !item.is_hidden }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: eventKey(event.id) }),
  });
  const when = (value?: string | null) =>
    value
      ? formatDateTime(value, i18n.language, "medium")
      : t("organizer.common.noLimit");
  return (
    <View className="gap-5">
      <Surface className="gap-4">
        <SectionTitle>{t("ui.ticketInventory")}</SectionTitle>
        {event.ticket_types.length === 0 ? (
          <Muted>{t("organizer.tickets.empty")}</Muted>
        ) : null}
        <ErrorText error={toggle.error} />
        {event.ticket_types.map((item) => {
          const row = inventoryFor(inventory, item.id);
          return (
            <View
              key={item.id}
              testID={`ticket-type-${item.id}`}
              className="gap-3 rounded-2xl border border-line bg-canvas/60 p-4"
            >
              <View className="flex-row flex-wrap items-start justify-between gap-3">
                <View className="min-w-52 flex-1 gap-1">
                  <View className="flex-row flex-wrap items-center justify-between gap-2">
                    <Text className="text-lg font-extrabold tracking-tight text-ink">
                      {item.name}
                    </Text>
                    <Text
                      accessibilityLabel={`${t("organizer.tickets.price")}: ${item.price_tiyin === 0 ? t("common.free") : formatKzt(item.price_tiyin, i18n.language)}`}
                      className="text-xl font-extrabold tracking-tight text-ink"
                    >
                      {item.price_tiyin === 0
                        ? t("common.free")
                        : formatKzt(item.price_tiyin, i18n.language)}
                    </Text>
                  </View>
                  {item.description ? (
                    <Text className="text-sm text-muted">
                      {eventContentText(item.description, i18n.language)}
                    </Text>
                  ) : null}
                  <Fact
                    label={t("organizer.tickets.quantity")}
                    value={item.quantity}
                  />
                  <Fact
                    label={t("organizer.tickets.perOrder")}
                    value={item.max_per_order}
                  />
                  <Fact
                    label={t("organizer.tickets.salesWindow")}
                    value={`${when(item.sales_start_at)} — ${when(item.sales_end_at)}`}
                  />
                </View>
                <Badge
                  status={item.is_hidden ? "disabled" : "active"}
                  label={
                    item.is_hidden
                      ? t("organizer.tickets.hidden")
                      : t("organizer.tickets.onSale")
                  }
                />
              </View>
              {row ? (
                <ProgressMeter
                  label={t("status.sold")}
                  value={row.sold}
                  max={row.quantity ?? item.quantity}
                  valueText={`${row.sold} / ${row.quantity ?? item.quantity}`}
                />
              ) : null}
              {row ? (
                <View
                  accessibilityLabel={t("organizer.tickets.countsLabel", {
                    name: item.name,
                  })}
                  className="flex-row flex-wrap gap-x-5 gap-y-1"
                >
                  <Fact label={t("status.available")} value={row.available} />
                  <Fact
                    label={t("organizer.tickets.reserved")}
                    value={row.reserved}
                  />
                  <Fact label={t("status.sold")} value={row.sold} />
                  <Fact label={t("status.refunded")} value={row.refunded} />
                  <Fact
                    label={t("organizer.tickets.checkedIn")}
                    value={row.checked_in}
                  />
                </View>
              ) : (
                <Muted>
                  {inventoryLoading
                    ? t("common.loading")
                    : t("organizer.tickets.countsUnavailable")}
                </Muted>
              )}
              {access.manage ? (
                editing === item.id ? (
                  <View className="rounded-2xl border border-line bg-white p-4">
                    <TicketTypeForm
                      event={event}
                      ticket={item}
                      onClose={() => setEditing(null)}
                    />
                  </View>
                ) : (
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      label={t("organizer.tickets.edit", { name: item.name })}
                      variant="secondary"
                      onPress={() => setEditing(item.id)}
                      testID={`ticket-${item.id}-edit`}
                    />
                    <Button
                      label={
                        item.is_hidden
                          ? t("organizer.tickets.show", { name: item.name })
                          : t("organizer.tickets.hide", { name: item.name })
                      }
                      variant="secondary"
                      loading={
                        toggle.isPending && toggle.variables?.id === item.id
                      }
                      onPress={() => toggle.mutate(item)}
                    />
                  </View>
                )
              ) : null}
            </View>
          );
        })}
      </Surface>
      {access.manage ? (
        <Surface className="gap-4">
          <SectionTitle>{t("ui.addTicketType")}</SectionTitle>
          <TicketTypeForm event={event} ticket={null} />
        </Surface>
      ) : null}
    </View>
  );
}
