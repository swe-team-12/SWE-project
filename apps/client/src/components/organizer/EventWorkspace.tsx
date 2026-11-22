import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  Button,
  ErrorBlock,
  LabeledValue,
  LoadingBlock,
  ScreenHeader,
  SectionTitle as UiSectionTitle,
  Surface,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { eventContentText } from "@/lib/eventContentText";
import { formatDateTime } from "@/utils/date";
import { formatKzt } from "@/utils/format";

import { ActivationSection } from "./ActivationSection";
import { AnalyticsSection } from "./AnalyticsSection";
import { AttendeesSection } from "./AttendeesSection";
import { CampaignsSection } from "./CampaignsSection";
import {
  Badge,
  errorMessage,
  isForbidden,
  isNotFound,
  PermissionNotice,
  SectionTitle,
  SuccessText,
  Tabs,
} from "./common";
import { CoverSection } from "./CoverSection";
import {
  changedEventFields,
  EventForm,
  eventToValues,
  type EventFormValues,
} from "./EventForm";
import { HeroStats } from "./design";
import { EventLifecycle } from "./EventLifecycle";
import { HistorySection } from "./HistorySection";
import { OrdersSection } from "./OrdersSection";
import { SalesSection } from "./SalesSection";
import { SupportCasesSection } from "./SupportCasesSection";
import { TeamSection } from "./TeamSection";
import { TicketTypesSection } from "./TicketTypesSection";
import type { Analytics, EventAccess, OrgEvent } from "./types";
import { eventKey, useEventAccess } from "./useEventAccess";

export type WorkspaceTab =
  | "overview"
  | "tickets"
  | "activation"
  | "sales"
  | "orders"
  | "attendees"
  | "analytics"
  | "campaigns"
  | "team"
  | "support"
  | "history";

/** Tabs the current person may open, in display order. */
export function visibleTabs(access: EventAccess): WorkspaceTab[] {
  const tabs: WorkspaceTab[] = ["overview"];
  if (access.manage || access.finance) tabs.push("tickets");
  if (access.finance) tabs.push("activation", "sales", "orders");
  if (access.attendees) tabs.push("attendees");
  if (access.finance) tabs.push("analytics", "campaigns");
  if (access.manage) tabs.push("team");
  if (access.support) tabs.push("support");
  if (access.finance) tabs.push("history");
  return tabs;
}

function ReadOnlySummary({ event }: { event: OrgEvent }) {
  const { t, i18n } = useTranslation();
  const date = (value: string | undefined) =>
    value
      ? formatDateTime(value, i18n.language, "medium")
      : t("organizer.common.notSet");
  const facts: [string, string][] = [
    [t("ui.category"), eventContentText(event.category, i18n.language)],
    [
      t("ui.venueName"),
      `${event.venue_name}, ${event.venue_address}, ${event.city}`,
    ],
    [t("organizer.form.startsAt"), date(event.starts_at)],
    [t("organizer.form.endsAt"), date(event.ends_at)],
    [t("organizer.form.registrationOpens"), date(event.registration_opens_at)],
    [
      t("organizer.form.registrationCloses"),
      date(event.registration_closes_at),
    ],
    [t("organizer.form.timezone"), event.timezone],
    [t("ui.capacity"), String(event.capacity)],
    [t("ui.visibility"), t(`status.${event.visibility}`)],
    [t("organizer.form.seatingMode"), t(`status.${event.seating_mode}`)],
  ];
  return (
    <Surface className="gap-4">
      <UiSectionTitle
        title={t("organizer.overview.details")}
        subtitle={t("organizer.overview.readOnly")}
      />
      <Text className="leading-6 text-ink">
        {eventContentText(event.description, i18n.language)}
      </Text>
      <View className="flex-row flex-wrap gap-3">
        {facts.map(([label, value]) => (
          <View
            key={label}
            className="min-w-40 flex-1 basis-48 rounded-2xl border border-line bg-canvas/60 p-3"
          >
            <LabeledValue label={label} value={value} />
          </View>
        ))}
      </View>
      <View className="rounded-2xl border border-line bg-canvas/60 p-3">
        <LabeledValue
          label={t("common.refundPolicy")}
          value={eventContentText(event.refund_policy, i18n.language)}
        />
      </View>
    </Surface>
  );
}

function DetailsEditor({
  event,
  seatingLocked,
}: {
  event: OrgEvent;
  seatingLocked: boolean;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [saved, setSaved] = useState("");
  const save = useMutation({
    mutationFn: async (values: EventFormValues) => {
      const changes = changedEventFields(values, event);
      if (Object.keys(changes).length === 0) return null;
      return apiFetch<OrgEvent>(`/events/${event.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
    },
    onSuccess: async (result) => {
      setSaved(
        result === null
          ? t("organizer.overview.noChanges")
          : t("organizer.overview.saved"),
      );
      if (result === null) return;
      await client.invalidateQueries({ queryKey: eventKey(event.id) });
      await client.invalidateQueries({ queryKey: ["organizer-events"] });
    },
  });
  if (event.status === "cancelled")
    return <ReadOnlySummary event={event} />;
  return (
    <View className="gap-4">
      <SectionTitle>{t("organizer.overview.editTitle")}</SectionTitle>
      <EventForm
        key={JSON.stringify(eventToValues(event))}
        initial={eventToValues(event)}
        submitLabel={t("organizer.overview.save")}
        onSubmit={(values) => {
          setSaved("");
          save.mutate(values);
        }}
        pending={save.isPending}
        error={save.error}
        seatingLocked={seatingLocked}
      />
      {saved ? <SuccessText>{saved}</SuccessText> : null}
    </View>
  );
}

/** Organizer/staff workspace for one event, split into role-aware tabs. */
export function EventWorkspace({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const eventQuery = useQuery({
    queryKey: eventKey(eventId, "event"),
    queryFn: () => apiFetch<OrgEvent>(`/events/${eventId}`),
    enabled: !!eventId,
    retry: (count, error) =>
      !isForbidden(error) && !isNotFound(error) && count < 1,
  });
  const event = eventQuery.data;
  const { access, activation } = useEventAccess(event);
  const analytics = useQuery({
    queryKey: eventKey(eventId, "analytics", "", "", "all"),
    queryFn: () => apiFetch<Analytics>(`/events/${eventId}/analytics`),
    enabled: !!event && access.finance,
    retry: (count, error) => !isForbidden(error) && count < 1,
  });

  if (eventQuery.isLoading) return <LoadingBlock />;
  if (isForbidden(eventQuery.error)) return <PermissionNotice />;
  if (isNotFound(eventQuery.error) || (!event && !eventQuery.error))
    return <ErrorBlock message={t("ui.eventNotFound")} />;
  if (!event)
    return (
      <ErrorBlock
        message={errorMessage(eventQuery.error)}
        retry={() => void eventQuery.refetch()}
      />
    );
  if (access.loading) return <LoadingBlock />;
  if (!access.any)
    return (
      <View className="gap-4">
        <ScreenHeader
          title={eventContentText(event.title, i18n.language)}
          backHref="/organizer"
          backLabel={t("organizerUi.backToEvents")}
        />
        <PermissionNotice />
        <Link
          href={{ pathname: "/events/[id]", params: { id: event.id } }}
          accessibilityRole="link"
          className="font-bold text-brand underline"
        >
          {t("organizer.access.openPublicPage")}
        </Link>
      </View>
    );

  const tabs = visibleTabs(access);
  const current = tabs.includes(tab) ? tab : "overview";
  const orders = analytics.data?.kpis.orders;
  const seatingLocked =
    orders === undefined ? event.status !== "draft" : orders > 0;
  const roleLine = access.isOwner
    ? t("organizer.access.owner")
    : access.isAdmin
      ? t("organizer.access.admin")
      : access.manage
        ? t("organizer.access.manager")
        : t("organizer.access.limited");
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerClassName="gap-6 pb-28"
    >
      <ScreenHeader
        kicker={t("ui.eventOperations")}
        title={eventContentText(event.title, i18n.language)}
        backHref="/organizer"
        backLabel={t("organizerUi.backToEvents")}
        right={<Badge status={event.status} />}
        subtitle={
          <View className="gap-1">
            <Text className="text-base leading-6 text-muted">
              {formatDateTime(event.starts_at, i18n.language)} ·{" "}
              {event.venue_name}
            </Text>
            <Text className="text-sm text-muted">{roleLine}</Text>
          </View>
        }
      />

      <Tabs
        label={t("organizer.tabs.label")}
        tabs={tabs.map((value) => ({
          value,
          label: t(`organizer.tabs.${value}`),
        }))}
        value={current}
        onChange={setTab}
      />

      {current === "overview" ? (
        <View className="gap-5">
          {analytics.data ? (
            <HeroStats
              kicker={t("organizerUi.headline")}
              testID="overview-headline"
              items={[
                {
                  label: t("organizer.analytics.sold"),
                  value: `${analytics.data.kpis.tickets_sold ?? 0} / ${analytics.data.kpis.capacity ?? event.capacity}`,
                },
                {
                  label: t("organizer.sales.gross"),
                  value: formatKzt(
                    analytics.data.kpis.gross_sales_tiyin ?? 0,
                    i18n.language,
                  ),
                },
                {
                  label: t("organizer.sales.net"),
                  value: formatKzt(
                    analytics.data.kpis.organizer_net_tiyin ?? 0,
                    i18n.language,
                  ),
                },
              ]}
            >
              <View className="flex-row flex-wrap gap-2">
                {tabs.includes("analytics") ? (
                  <Button
                    label={t("organizer.tabs.analytics")}
                    variant="primary"
                    size="sm"
                    iconName="arrow-right"
                    onPress={() => setTab("analytics")}
                  />
                ) : null}
                {tabs.includes("sales") ? (
                  <Button
                    label={t("organizer.tabs.sales")}
                    variant="onDark"
                    size="sm"
                    onPress={() => setTab("sales")}
                  />
                ) : null}
              </View>
            </HeroStats>
          ) : null}
          <EventLifecycle
            event={event}
            access={access}
            activation={activation.data}
          />
          <CoverSection
            event={event}
            canEdit={access.manage && event.status !== "cancelled"}
          />
          {access.manage ? (
            <DetailsEditor event={event} seatingLocked={seatingLocked} />
          ) : (
            <ReadOnlySummary event={event} />
          )}
        </View>
      ) : null}
      {current === "tickets" ? (
        <TicketTypesSection
          event={event}
          access={access}
          inventory={analytics.data?.ticket_types}
          inventoryLoading={analytics.isLoading}
        />
      ) : null}
      {current === "activation" ? (
        activation.data ? (
          <ActivationSection
            eventId={event.id}
            access={access}
            state={activation.data}
          />
        ) : activation.isLoading ? (
          <LoadingBlock />
        ) : isForbidden(activation.error) ? (
          <PermissionNotice />
        ) : (
          <ErrorBlock
            message={errorMessage(activation.error)}
            retry={() => void activation.refetch()}
          />
        )
      ) : null}
      {current === "sales" ? (
        <SalesSection
          eventId={event.id}
          analytics={analytics.data}
          analyticsLoading={analytics.isLoading}
        />
      ) : null}
      {current === "orders" ? <OrdersSection event={event} /> : null}
      {current === "attendees" ? <AttendeesSection event={event} /> : null}
      {current === "analytics" ? <AnalyticsSection event={event} /> : null}
      {current === "campaigns" ? <CampaignsSection event={event} /> : null}
      {current === "team" ? <TeamSection event={event} /> : null}
      {current === "support" ? (
        <SupportCasesSection eventId={event.id} />
      ) : null}
      {current === "history" ? (
        <HistorySection eventId={event.id} timeZone={event.timezone} />
      ) : null}
    </ScrollView>
  );
}
