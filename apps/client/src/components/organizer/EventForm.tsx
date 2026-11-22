import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, Field, Notice } from "@/components/ui";

import { ChoiceGroup, ErrorText, isWholeNumber } from "./common";
import { DateTimeField } from "./DateTimeField";
import { SectionCard } from "./design";
import {
  COMMON_TIME_ZONES,
  DEFAULT_TIME_ZONE,
  defaultZonedInput,
  fromZonedInput,
  isValidTimeZone,
  toZonedInput,
} from "./dateTime";
import type { OrgEvent } from "./types";

export interface EventFormValues {
  title: string;
  description: string;
  category: string;
  city: string;
  venueName: string;
  venueAddress: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  capacity: string;
  visibility: OrgEvent["visibility"];
  seatingMode: OrgEvent["seating_mode"];
  refundPolicy: string;
}

export type EventFormErrors = Partial<Record<keyof EventFormValues, string>>;

// Stored in English so attendees see it in their own language (see
// eventContentText); organizer-written text is shown as written.
export const DEFAULT_REFUND_POLICY =
  "Full refunds are available until the event starts.";

export function newEventValues(now: Date = new Date()): EventFormValues {
  const start = defaultZonedInput(14, 18, DEFAULT_TIME_ZONE, now);
  return {
    title: "",
    description: "",
    category: "",
    city: "Almaty",
    venueName: "",
    venueAddress: "",
    timezone: DEFAULT_TIME_ZONE,
    startsAt: start,
    endsAt: defaultZonedInput(14, 21, DEFAULT_TIME_ZONE, now),
    registrationOpensAt: toZonedInput(now.toISOString(), DEFAULT_TIME_ZONE),
    registrationClosesAt: start,
    capacity: "100",
    visibility: "public",
    seatingMode: "general_admission",
    refundPolicy: DEFAULT_REFUND_POLICY,
  };
}

export function eventToValues(event: OrgEvent): EventFormValues {
  return {
    title: event.title,
    description: event.description,
    category: event.category,
    city: event.city,
    venueName: event.venue_name,
    venueAddress: event.venue_address,
    timezone: event.timezone,
    startsAt: toZonedInput(event.starts_at, event.timezone),
    endsAt: toZonedInput(event.ends_at, event.timezone),
    registrationOpensAt: toZonedInput(
      event.registration_opens_at,
      event.timezone,
    ),
    registrationClosesAt: toZonedInput(
      event.registration_closes_at,
      event.timezone,
    ),
    capacity: String(event.capacity),
    visibility: event.visibility,
    seatingMode: event.seating_mode,
    refundPolicy: event.refund_policy,
  };
}

/** Returns translation keys (under organizer.validation) per invalid field. */
export function validateEventForm(values: EventFormValues): EventFormErrors {
  const errors: EventFormErrors = {};
  if (values.title.trim().length < 3) errors.title = "titleShort";
  if (values.description.trim().length < 10)
    errors.description = "descriptionShort";
  if (values.category.trim().length < 2) errors.category = "categoryShort";
  if (values.venueName.trim().length < 2) errors.venueName = "venueShort";
  if (values.venueAddress.trim().length < 3)
    errors.venueAddress = "addressShort";
  const zoneOk = isValidTimeZone(values.timezone);
  if (!zoneOk) errors.timezone = "timezoneInvalid";
  const zone = zoneOk ? values.timezone : DEFAULT_TIME_ZONE;
  const starts = fromZonedInput(values.startsAt, zone);
  const ends = fromZonedInput(values.endsAt, zone);
  if (!starts) errors.startsAt = "dateTimeInvalid";
  if (!ends) errors.endsAt = "dateTimeInvalid";
  else if (starts && ends <= starts) errors.endsAt = "endBeforeStart";
  const opens = values.registrationOpensAt.trim()
    ? fromZonedInput(values.registrationOpensAt, zone)
    : undefined;
  const closes = values.registrationClosesAt.trim()
    ? fromZonedInput(values.registrationClosesAt, zone)
    : undefined;
  if (opens === null) errors.registrationOpensAt = "dateTimeInvalid";
  if (closes === null) errors.registrationClosesAt = "dateTimeInvalid";
  else if (opens && closes && closes <= opens)
    errors.registrationClosesAt = "registrationCloseBeforeOpen";
  if (values.seatingMode !== "assigned") {
    const capacity = Number(values.capacity);
    if (!isWholeNumber(values.capacity) || capacity < 1 || capacity > 100_000)
      errors.capacity = "capacityInvalid";
  }
  if (values.refundPolicy.length > 2000) errors.refundPolicy = "refundTooLong";
  return errors;
}

/** API body for POST /events (all fields) built from valid form values. */
export function eventPayload(values: EventFormValues): Record<string, unknown> {
  const zone = values.timezone.trim();
  const payload: Record<string, unknown> = {
    title: values.title.trim(),
    description: values.description.trim(),
    category: values.category.trim(),
    city: values.city.trim() || "Almaty",
    venue_name: values.venueName.trim(),
    venue_address: values.venueAddress.trim(),
    timezone: zone,
    starts_at: fromZonedInput(values.startsAt, zone),
    ends_at: fromZonedInput(values.endsAt, zone),
    registration_opens_at: values.registrationOpensAt.trim()
      ? fromZonedInput(values.registrationOpensAt, zone)
      : null,
    registration_closes_at: values.registrationClosesAt.trim()
      ? fromZonedInput(values.registrationClosesAt, zone)
      : null,
    visibility: values.visibility,
    seating_mode: values.seatingMode,
    refund_policy: values.refundPolicy.trim() || DEFAULT_REFUND_POLICY,
  };
  // Assigned seating uses the fixed hall map; the server sets its capacity.
  payload.capacity =
    values.seatingMode === "assigned" ? 168 : Number(values.capacity);
  return payload;
}

/** Only the fields that differ from the stored event (for PATCH). */
export function changedEventFields(
  values: EventFormValues,
  event: OrgEvent,
): Record<string, unknown> {
  const next = eventPayload(values);
  const current = eventPayload(eventToValues(event));
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(next)) {
    if (next[key] !== current[key]) changes[key] = next[key];
  }
  if (values.seatingMode === "assigned" && !("seating_mode" in changes)) {
    delete changes.capacity;
  }
  return changes;
}

export function EventForm({
  initial,
  submitLabel,
  onSubmit,
  pending,
  error,
  seatingLocked,
}: {
  initial: EventFormValues;
  submitLabel: string;
  onSubmit(values: EventFormValues): void;
  pending?: boolean;
  error?: unknown;
  /** Hide the seating choice (events that already exist keep their mode). */
  seatingLocked?: boolean;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? validateEventForm(values) : {};
  const set = <K extends keyof EventFormValues>(
    key: K,
    value: EventFormValues[K],
  ) => setValues((current) => ({ ...current, [key]: value }));
  const text = (key: keyof EventFormValues) =>
    errors[key] ? t(`organizer.validation.${errors[key]}`) : undefined;
  const zoneHint = t("organizer.form.timesInZone", {
    zone: isValidTimeZone(values.timezone)
      ? values.timezone
      : DEFAULT_TIME_ZONE,
  });
  const submit = () => {
    setSubmitted(true);
    if (Object.keys(validateEventForm(values)).length === 0) onSubmit(values);
  };
  return (
    <View className="gap-5">
      <SectionCard
        title={t("organizerUi.form.basics")}
        subtitle={t("organizerUi.form.basicsHelp")}
      >
        <Field
          label={t("ui.eventTitle")}
          value={values.title}
          onChangeText={(value) => set("title", value)}
          error={text("title")}
        />
        <Field
          label={t("ui.description")}
          value={values.description}
          onChangeText={(value) => set("description", value)}
          multiline
          numberOfLines={5}
          error={text("description")}
        />
        <View className="flex-row flex-wrap gap-4">
          <View className="min-w-52 flex-1">
            <Field
              label={t("ui.category")}
              value={values.category}
              onChangeText={(value) => set("category", value)}
              error={text("category")}
            />
          </View>
          <View className="min-w-52 flex-1">
            <Field
              label={t("ui.city")}
              value={values.city}
              onChangeText={(value) => set("city", value)}
              icon="pin"
            />
          </View>
        </View>
        <View className="flex-row flex-wrap gap-4">
          <View className="min-w-52 flex-1">
            <Field
              label={t("ui.venueName")}
              value={values.venueName}
              onChangeText={(value) => set("venueName", value)}
              error={text("venueName")}
            />
          </View>
          <View className="min-w-52 flex-1">
            <Field
              label={t("ui.venueAddress")}
              value={values.venueAddress}
              onChangeText={(value) => set("venueAddress", value)}
              error={text("venueAddress")}
            />
          </View>
        </View>
      </SectionCard>

      <SectionCard
        title={t("organizerUi.form.schedule")}
        subtitle={zoneHint}
      >
        <Field
          label={t("organizer.form.timezone")}
          value={values.timezone}
          onChangeText={(value) => set("timezone", value.trim())}
          autoCapitalize="none"
          autoCorrect={false}
          error={text("timezone")}
          hint={t("organizer.form.timezoneHelp")}
          icon="clock"
        />
        <ChoiceGroup
          label={t("organizer.form.timezoneQuick")}
          options={COMMON_TIME_ZONES.map((zone) => ({
            value: zone,
            label: zone,
          }))}
          value={values.timezone}
          onChange={(value) => set("timezone", value)}
        />
        <View className="flex-row flex-wrap gap-4">
          <View className="min-w-60 flex-1">
            <DateTimeField
              label={t("organizer.form.startsAt")}
              value={values.startsAt}
              onChange={(value) => set("startsAt", value)}
              error={text("startsAt")}
              hint={zoneHint}
              testID="event-starts-at"
            />
          </View>
          <View className="min-w-60 flex-1">
            <DateTimeField
              label={t("organizer.form.endsAt")}
              value={values.endsAt}
              onChange={(value) => set("endsAt", value)}
              error={text("endsAt")}
              hint={zoneHint}
              testID="event-ends-at"
            />
          </View>
        </View>
        <View className="flex-row flex-wrap gap-4">
          <View className="min-w-60 flex-1">
            <DateTimeField
              label={t("organizer.form.registrationOpens")}
              value={values.registrationOpensAt}
              onChange={(value) => set("registrationOpensAt", value)}
              error={text("registrationOpensAt")}
              hint={t("organizer.form.registrationOpensHelp")}
              testID="event-registration-opens"
            />
          </View>
          <View className="min-w-60 flex-1">
            <DateTimeField
              label={t("organizer.form.registrationCloses")}
              value={values.registrationClosesAt}
              onChange={(value) => set("registrationClosesAt", value)}
              error={text("registrationClosesAt")}
              hint={t("organizer.form.registrationClosesHelp")}
              testID="event-registration-closes"
            />
          </View>
        </View>
      </SectionCard>

      <SectionCard title={t("organizerUi.form.access")}>
        <View className="gap-2">
          <ChoiceGroup
            label={t("ui.visibility")}
            options={(["public", "unlisted", "private"] as const).map(
              (item) => ({
                value: item,
                label: t(`status.${item}`),
              }),
            )}
            value={values.visibility}
            onChange={(value) => set("visibility", value)}
          />
          <Text className="text-xs text-muted">
            {t(`organizer.form.visibilityHelp.${values.visibility}`)}
          </Text>
        </View>

        {seatingLocked ? (
          <Text className="text-sm text-muted">
            {t("organizer.form.seatingLocked", {
              mode: t(`status.${values.seatingMode}`),
            })}
          </Text>
        ) : (
          <ChoiceGroup
            label={t("organizer.form.seatingMode")}
            options={(["general_admission", "assigned"] as const).map(
              (item) => ({ value: item, label: t(`status.${item}`) }),
            )}
            value={values.seatingMode}
            onChange={(value) => set("seatingMode", value)}
          />
        )}

        {values.seatingMode === "assigned" ? (
          <Text className="text-sm text-muted">
            {t("organizer.form.capacityAssigned")}
          </Text>
        ) : (
          <View className="max-w-xs">
            <Field
              label={t("ui.capacity")}
              value={values.capacity}
              onChangeText={(value) => set("capacity", value)}
              keyboardType="number-pad"
              error={text("capacity")}
              icon="user"
            />
          </View>
        )}
      </SectionCard>

      <SectionCard title={t("organizerUi.form.policy")}>
        <Field
          label={t("common.refundPolicy")}
          value={values.refundPolicy}
          onChangeText={(value) => set("refundPolicy", value)}
          multiline
          numberOfLines={3}
          error={text("refundPolicy")}
          hint={t("organizer.form.refundPolicyHelp")}
        />
      </SectionCard>

      {submitted && Object.keys(errors).length > 0 ? (
        <Notice tone="danger" role="alert" bold>
          {t("organizer.validation.fixFields")}
        </Notice>
      ) : null}
      <ErrorText error={error} />
      <View className="flex-row flex-wrap">
        <Button
          label={submitLabel}
          onPress={submit}
          loading={pending}
          iconName="check"
          size="lg"
        />
      </View>
    </View>
  );
}
