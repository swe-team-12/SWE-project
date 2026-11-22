import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Image, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, ErrorBlock, Field, LoadingBlock, Surface } from "@/components/ui";
import { API_URL, apiFetch, currentAccessToken } from "@/lib/api";
import { downloadAuthenticatedFile } from "@/lib/files";
import { formatDateTime } from "@/utils/date";
import { formatKzt } from "@/utils/format";

import {
  Badge,
  ChoiceGroup,
  ConfirmButton,
  copyText,
  errorMessage,
  ErrorText,
  Fact,
  isForbidden,
  isWholeNumber,
  MultiChoice,
  Muted,
  numberOrNull,
  PermissionNotice,
  SectionTitle,
  SuccessText,
} from "./common";
import { DateTimeField } from "./DateTimeField";
import { fromZonedInput } from "./dateTime";
import type { Campaign, OrgEvent } from "./types";
import { eventKey } from "./useEventAccess";

export interface CampaignFormValues {
  name: string;
  code: string;
  discountType: "percentage" | "fixed_kzt";
  discountValue: string;
  startsAt: string;
  endsAt: string;
  maxRedemptions: string;
  ticketTypeIds: string[];
}

export type CampaignFormErrors = Partial<
  Record<keyof CampaignFormValues, string>
>;

export const EMPTY_CAMPAIGN: CampaignFormValues = {
  name: "",
  code: "",
  discountType: "percentage",
  discountValue: "10",
  startsAt: "",
  endsAt: "",
  maxRedemptions: "",
  ticketTypeIds: [],
};

/** Returns translation keys (under `organizer.validation`) per invalid field. */
export function validateCampaignForm(
  values: CampaignFormValues,
  timeZone: string,
): CampaignFormErrors {
  const errors: CampaignFormErrors = {};
  if (values.name.trim().length < 2) errors.name = "nameRequired";
  const code = values.code.trim();
  if (code && !/^[A-Za-z0-9_-]{3,40}$/.test(code)) errors.code = "codeInvalid";
  const amount = numberOrNull(values.discountValue);
  if (values.discountType === "percentage") {
    if (amount === null || amount < 1 || amount > 100 || !Number.isInteger(amount))
      errors.discountValue = "percentInvalid";
  } else if (amount === null || amount <= 0) {
    errors.discountValue = "amountInvalid";
  }
  const start = values.startsAt ? fromZonedInput(values.startsAt, timeZone) : "";
  const end = values.endsAt ? fromZonedInput(values.endsAt, timeZone) : "";
  if (start === null) errors.startsAt = "dateTimeInvalid";
  if (end === null) errors.endsAt = "dateTimeInvalid";
  if (start && end && start >= end) errors.endsAt = "endBeforeStart";
  if (
    values.maxRedemptions.trim() &&
    (!isWholeNumber(values.maxRedemptions) || Number(values.maxRedemptions) < 1)
  )
    errors.maxRedemptions = "redemptionsInvalid";
  return errors;
}

/** Request body for `POST /events/{id}/campaigns` (fixed amounts in tiyin). */
export function campaignPayload(
  values: CampaignFormValues,
  timeZone: string,
): Record<string, unknown> {
  const amount = Number(values.discountValue.replace(",", "."));
  return {
    name: values.name.trim(),
    code: values.code.trim() ? values.code.trim().toUpperCase() : null,
    discount_type: values.discountType,
    discount_value:
      values.discountType === "percentage" ? amount : Math.round(amount * 100),
    starts_at: values.startsAt
      ? fromZonedInput(values.startsAt, timeZone)
      : null,
    ends_at: values.endsAt ? fromZonedInput(values.endsAt, timeZone) : null,
    max_redemptions: values.maxRedemptions.trim()
      ? Number(values.maxRedemptions)
      : null,
    applicable_ticket_type_ids: values.ticketTypeIds,
  };
}

/** Lifecycle state shown for a campaign when the API did not send one. */
export function campaignState(campaign: Campaign, now = new Date()): string {
  if (campaign.state) return campaign.state;
  if (!campaign.is_enabled) return "disabled";
  if (campaign.starts_at && new Date(campaign.starts_at) > now)
    return "not_started";
  if (campaign.ends_at && new Date(campaign.ends_at) < now) return "expired";
  if (campaign.redemptions_remaining === 0) return "exhausted";
  return "active";
}

function CampaignCard({
  campaign,
  event,
  onDisabled,
}: {
  campaign: Campaign;
  event: OrgEvent;
  onDisabled(): Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const money = (value: number) => formatKzt(value, i18n.language);
  const [notice, setNotice] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const disable = useMutation({
    mutationFn: () =>
      apiFetch(`/campaigns/${campaign.id}/disable`, { method: "PATCH" }),
    onSuccess: onDisabled,
  });
  const download = useMutation({
    mutationFn: () =>
      downloadAuthenticatedFile(
        `/campaigns/${campaign.id}/qr.png`,
        `campaign-${campaign.code}.png`,
        "image/png",
      ),
  });
  const state = campaignState(campaign);
  const names = campaign.applicable_ticket_type_ids
    .map((id) => event.ticket_types.find((item) => item.id === id)?.name)
    .filter(Boolean)
    .join(", ");
  const window = (value: string | null, empty: string) =>
    value ? formatDateTime(value, i18n.language, "medium") : empty;
  return (
    <View
      testID={`campaign-${campaign.id}`}
      className="gap-3 rounded-2xl border border-line bg-canvas/60 p-4"
    >
      <View className="flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-52 flex-1 gap-1">
          <Text className="text-lg font-extrabold text-ink">{campaign.name}</Text>
          <Text selectable className="font-mono font-bold text-brand">
            {campaign.code}
          </Text>
        </View>
        <Badge
          status={state}
          tone={state === "active" ? "good" : state === "disabled" ? "bad" : "warn"}
        />
      </View>
      <View className="flex-row flex-wrap items-start gap-4">
        <Image
          className="h-24 w-24"
          accessibilityLabel={t("organizer.campaigns.qrAlt", {
            name: campaign.name,
          })}
          source={{
            uri: `${API_URL}/campaigns/${campaign.id}/qr.png`,
            headers: { Authorization: `Bearer ${currentAccessToken()}` },
          }}
        />
        <View className="min-w-60 flex-1 gap-1">
          <Fact
            label={t("ui.discount")}
            value={
              campaign.discount_type === "percentage"
                ? `${campaign.discount_value}%`
                : money(campaign.discount_value)
            }
          />
          <Fact
            label={t("organizer.campaigns.window")}
            value={`${window(campaign.starts_at, t("organizer.campaigns.fromNow"))} — ${window(campaign.ends_at, t("organizer.campaigns.noEnd"))}`}
          />
          <Fact
            label={t("organizer.campaigns.maxRedemptions")}
            value={
              campaign.max_redemptions === null
                ? t("organizer.common.noLimit")
                : String(campaign.max_redemptions)
            }
          />
          <Fact
            label={t("organizer.campaigns.appliesTo")}
            value={names || t("organizer.campaigns.allTicketTypes")}
          />
          <Fact
            label={t("organizer.campaigns.redemptions")}
            value={
              campaign.redemptions_remaining === null ||
              campaign.redemptions_remaining === undefined
                ? String(campaign.redemptions)
                : t("organizer.campaigns.redemptionsLeft", {
                    used: campaign.redemptions,
                    left: campaign.redemptions_remaining,
                  })
            }
          />
          <Fact
            label={t("organizer.campaigns.tickets")}
            value={String(campaign.tickets_sold)}
          />
          <Fact
            label={t("organizer.sales.gross")}
            value={money(campaign.gross_tiyin)}
          />
          <Fact
            label={t("organizer.campaigns.discountGiven")}
            value={money(campaign.discount_tiyin)}
          />
        </View>
      </View>
      {campaign.campaign_url ? (
        <View className="gap-1">
          <Text className="text-sm font-bold text-ink">
            {t("organizer.campaigns.url")}
          </Text>
          <Text selectable className="text-sm text-brand">
            {campaign.campaign_url}
          </Text>
        </View>
      ) : null}
      {notice ? <SuccessText>{notice}</SuccessText> : null}
      {showUrl ? <Muted>{t("organizer.common.copyManually")}</Muted> : null}
      <ErrorText error={disable.error ?? download.error} />
      <View className="flex-row flex-wrap gap-3">
        {campaign.campaign_url ? (
          <Button
            label={t("organizer.campaigns.copyUrl")}
            variant="secondary"
            onPress={() => {
              void copyText(campaign.campaign_url ?? "").then((copied) => {
                setNotice(copied ? t("organizer.common.copied") : "");
                setShowUrl(!copied);
              });
            }}
            testID={`campaign-${campaign.id}-copy`}
          />
        ) : null}
        <Button
          label={t("organizer.campaigns.downloadQr")}
          variant="secondary"
          loading={download.isPending}
          onPress={() => download.mutate()}
        />
        {campaign.is_enabled ? (
          <ConfirmButton
            label={t("organizer.campaigns.disable")}
            message={t("organizer.campaigns.disableConfirm", {
              name: campaign.name,
            })}
            confirmLabel={t("organizer.campaigns.disable")}
            loading={disable.isPending}
            onConfirm={() => disable.mutate()}
            testID={`campaign-${campaign.id}-disable`}
          />
        ) : null}
      </View>
    </View>
  );
}

/** Promo campaigns: performance list, sharing, disabling and creation. */
export function CampaignsSection({ event }: { event: OrgEvent }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [values, setValues] = useState<CampaignFormValues>(EMPTY_CAMPAIGN);
  const [errors, setErrors] = useState<CampaignFormErrors>({});
  const [created, setCreated] = useState("");
  const set = <K extends keyof CampaignFormValues>(
    key: K,
    value: CampaignFormValues[K],
  ) => setValues((current) => ({ ...current, [key]: value }));
  const campaigns = useQuery({
    queryKey: eventKey(event.id, "campaigns"),
    queryFn: () => apiFetch<Campaign[]>(`/events/${event.id}/campaigns`),
  });
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: eventKey(event.id, "campaigns") }),
      client.invalidateQueries({ queryKey: eventKey(event.id, "analytics") }),
      client.invalidateQueries({ queryKey: eventKey(event.id, "history") }),
    ]);
  const create = useMutation({
    mutationFn: () =>
      apiFetch<Campaign>(`/events/${event.id}/campaigns`, {
        method: "POST",
        body: JSON.stringify(campaignPayload(values, event.timezone)),
      }),
    onSuccess: async (campaign) => {
      setCreated(t("organizer.campaigns.created", { code: campaign.code }));
      setValues(EMPTY_CAMPAIGN);
      await refresh();
    },
  });
  if (isForbidden(campaigns.error)) return <PermissionNotice />;
  const err = (key: keyof CampaignFormValues) =>
    errors[key] ? t(`organizer.validation.${errors[key]}`) : undefined;
  const submit = () => {
    const found = validateCampaignForm(values, event.timezone);
    setErrors(found);
    setCreated("");
    if (Object.keys(found).length === 0) create.mutate();
  };
  const locked = event.status === "cancelled";
  return (
    <View className="gap-5">
      <Surface className="gap-4">
        <SectionTitle>{t("organizer.campaigns.title")}</SectionTitle>
        <Muted>{t("organizer.campaigns.help")}</Muted>
        {campaigns.isLoading ? <LoadingBlock /> : null}
        {campaigns.error ? (
          <ErrorBlock
            message={errorMessage(campaigns.error)}
            retry={() => void campaigns.refetch()}
          />
        ) : null}
        {campaigns.data?.length === 0 ? (
          <Muted>{t("organizer.campaigns.empty")}</Muted>
        ) : null}
        {campaigns.data?.map((campaign) => (
          <CampaignCard
            key={campaign.id}
            campaign={campaign}
            event={event}
            onDisabled={refresh}
          />
        ))}
      </Surface>

      {locked ? null : (
        <Surface className="gap-4">
          <SectionTitle>{t("organizer.campaigns.newTitle")}</SectionTitle>
          <Field
            label={t("organizer.campaigns.name")}
            value={values.name}
            onChangeText={(text) => set("name", text)}
            error={err("name")}
            testID="campaign-name"
          />
          <Field
            label={t("organizer.campaigns.code")}
            value={values.code}
            onChangeText={(text) => set("code", text)}
            autoCapitalize="characters"
            error={err("code")}
            testID="campaign-code"
          />
          <Muted>{t("organizer.campaigns.codeHelp")}</Muted>
          <ChoiceGroup
            label={t("organizer.campaigns.discountType")}
            value={values.discountType}
            onChange={(value) => set("discountType", value)}
            options={[
              {
                value: "percentage",
                label: t("organizer.campaigns.percentage"),
              },
              { value: "fixed_kzt", label: t("organizer.campaigns.fixed") },
            ]}
          />
          <Field
            label={
              values.discountType === "percentage"
                ? t("organizer.campaigns.percentValue")
                : t("organizer.campaigns.fixedValue")
            }
            value={values.discountValue}
            onChangeText={(text) => set("discountValue", text)}
            keyboardType="decimal-pad"
            error={err("discountValue")}
            testID="campaign-discount"
          />
          <Muted>
            {t("organizer.form.timesInZone", { zone: event.timezone })}
          </Muted>
          <View className="flex-row flex-wrap gap-3">
            <View className="min-w-60 flex-1">
              <DateTimeField
                label={t("organizer.campaigns.startsAt")}
                hint={t("organizer.campaigns.startsHelp")}
                value={values.startsAt}
                onChange={(text) => set("startsAt", text)}
                error={err("startsAt")}
                testID="campaign-starts"
              />
            </View>
            <View className="min-w-60 flex-1">
              <DateTimeField
                label={t("organizer.campaigns.endsAt")}
                hint={t("organizer.campaigns.endsHelp")}
                value={values.endsAt}
                onChange={(text) => set("endsAt", text)}
                error={err("endsAt")}
                testID="campaign-ends"
              />
            </View>
          </View>
          <Field
            label={t("organizer.campaigns.maxRedemptionsInput")}
            value={values.maxRedemptions}
            onChangeText={(text) => set("maxRedemptions", text)}
            keyboardType="number-pad"
            error={err("maxRedemptions")}
            testID="campaign-max"
          />
          {event.ticket_types.length > 0 ? (
            <MultiChoice
              label={t("organizer.campaigns.appliesTo")}
              hint={t("organizer.campaigns.appliesHelp")}
              options={event.ticket_types.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              values={values.ticketTypeIds}
              onChange={(ids) => set("ticketTypeIds", ids)}
            />
          ) : null}
          {created ? <SuccessText>{created}</SuccessText> : null}
          <ErrorText error={create.error} />
          <View className="flex-row">
            <Button
              label={t("organizer.campaigns.create")}
              loading={create.isPending}
              onPress={submit}
              testID="campaign-create"
            />
          </View>
        </Surface>
      )}
    </View>
  );
}
