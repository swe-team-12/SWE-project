import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, router, useLocalSearchParams, usePathname } from "expo-router";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { CalendarActions } from "@/components/CalendarActions";
import { durationText } from "@/components/design/durationText";
import { shortDate, shortTime } from "@/components/design/time";
import { Icon, type IconName, palette } from "@/components/icons";
import {
  Button,
  Chip,
  ClassCard,
  DarkCard,
  ErrorBlock,
  Field,
  LoadingBlock,
  Notice,
  ScreenHeader,
  SectionTitle,
  StatusBadge,
  Surface,
  Timeline,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { captureAnalytics } from "@/lib/analytics";
import {
  availableSeatsByCategory,
  eventSalesState,
  ticketSalesState,
} from "@/lib/checkoutSelection";
import { localizedErrorMessage } from "@/lib/errorMessage";
import { eventContentText } from "@/lib/eventContentText";
import { formatEventDateTime } from "@/lib/eventTime";
import { loginHref } from "@/lib/loginRedirect";
import { placeText } from "@/lib/placeText";
import { useAuth } from "@/providers/AuthProvider";
import type {
  CalendarLinks,
  EventItem,
  Seat,
  TicketTypeWithSales,
} from "@/types";
import { formatKzt } from "@/utils/format";

const REPORT_CATEGORIES = [
  "fraud",
  "misleading_information",
  "inappropriate_content",
  "safety",
  "spam",
  "other",
] as const;
type ReportCategory = (typeof REPORT_CATEGORIES)[number];
const OTHER_DETAILS_MIN = 10;

interface EventReport {
  id: string;
  category: string;
  status: string;
  created_at: string;
}

function CardHeading({ icon, title }: { icon: IconName; title: string }) {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-10 w-10 items-center justify-center rounded-2xl bg-mintsoft">
        <Icon name={icon} size={18} color={palette.brand} />
      </View>
      <Text
        accessibilityRole="header"
        className="flex-1 text-lg font-extrabold tracking-tight text-ink"
      >
        {title}
      </Text>
    </View>
  );
}

function ReportEvent({ event }: { event: EventItem }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState("");
  const mine = useQuery({
    queryKey: ["event-reports-mine", event.id],
    queryFn: () => apiFetch<EventReport[]>(`/events/${event.id}/reports/mine`),
    enabled: !!user && user.id !== event.owner_id,
  });
  const submit = useMutation({
    mutationFn: () =>
      apiFetch<EventReport>(`/events/${event.id}/reports`, {
        method: "POST",
        body: JSON.stringify({ category, details: details.trim() }),
      }),
    onSuccess: () => {
      setOpen(false);
      setConfirming(false);
      setDetails("");
      setCategory(null);
      void queryClient.invalidateQueries({
        queryKey: ["event-reports-mine", event.id],
      });
    },
    onError: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({
        queryKey: ["event-reports-mine", event.id],
      });
    },
  });
  if (user && user.id === event.owner_id) return null;
  const openReport = mine.data?.find((report) => report.status === "open");
  const detailsMissing =
    category === "other" && details.trim().length < OTHER_DETAILS_MIN;
  return (
    <Surface className="gap-3">
      <CardHeading icon="alert" title={t("attendee.report.title")} />
      <Text className="text-sm text-muted">{t("attendee.report.help")}</Text>
      {!user ? (
        <Link href={loginHref(pathname)} asChild>
          <Pressable
            accessibilityRole="link"
            className="min-h-11 flex-row items-center gap-1 self-start"
          >
            <Text className="font-bold text-brand">
              {t("attendee.report.signIn")}
            </Text>
            <Icon name="chevron-right" size={16} color={palette.brand} />
          </Pressable>
        </Link>
      ) : submit.isSuccess || openReport ? (
        <Notice tone="success" role="status">
          {submit.isSuccess
            ? t("attendee.report.submitted")
            : t("attendee.report.alreadyOpen")}
        </Notice>
      ) : !open ? (
        <View className="self-start">
          <Button
            label={t("attendee.report.open")}
            variant="secondary"
            iconName="alert"
            onPress={() => {
              submit.reset();
              setOpen(true);
            }}
          />
        </View>
      ) : (
        <View className="gap-4">
          <View accessibilityRole="radiogroup" className="gap-2">
            <Text className="text-sm font-bold text-ink">
              {t("attendee.report.category")}
            </Text>
            {REPORT_CATEGORIES.map((item) => {
              const selected = category === item;
              return (
                <Pressable
                  key={item}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  disabled={confirming}
                  onPress={() => setCategory(item)}
                  className={`min-h-12 flex-row items-center gap-3 rounded-2xl border px-4 ${selected ? "border-ink bg-ink" : "border-line bg-white"}`}
                >
                  <View
                    className={`h-5 w-5 items-center justify-center rounded-full border-2 ${selected ? "border-mint" : "border-muted"}`}
                  >
                    {selected ? (
                      <View className="h-2.5 w-2.5 rounded-full bg-mint" />
                    ) : null}
                  </View>
                  <Text
                    className={`flex-1 ${selected ? "font-bold text-white" : "text-ink"}`}
                  >
                    {t(`attendee.report.categories.${item}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Field
            label={
              category === "other"
                ? t("attendee.report.detailsRequired")
                : t("attendee.report.details")
            }
            value={details}
            onChangeText={setDetails}
            editable={!confirming}
            multiline
            numberOfLines={4}
            maxLength={4000}
            error={
              detailsMissing && details.length > 0
                ? t("attendee.report.detailsTooShort", {
                    count: OTHER_DETAILS_MIN,
                  })
                : undefined
            }
          />
          {submit.error ? (
            <Notice tone="danger" role="alert">
              {localizedErrorMessage(submit.error, t("ui.somethingWrong"))}
            </Notice>
          ) : null}
          {confirming ? (
            <View className="gap-3 rounded-2xl border border-red-100 bg-red-50 p-4">
              <Text className="font-bold text-ink">
                {t("attendee.report.confirmTitle")}
              </Text>
              <Text className="text-sm text-muted">
                {t("attendee.report.confirmBody")}
              </Text>
              <View className="flex-row flex-wrap gap-3">
                <Button
                  label={t("attendee.report.confirm")}
                  variant="danger"
                  loading={submit.isPending}
                  onPress={() => submit.mutate()}
                />
                <Button
                  label={t("common.cancel")}
                  variant="secondary"
                  disabled={submit.isPending}
                  onPress={() => setConfirming(false)}
                />
              </View>
            </View>
          ) : (
            <View className="flex-row flex-wrap gap-3">
              <Button
                label={t("attendee.report.submit")}
                disabled={!category || detailsMissing}
                onPress={() => setConfirming(true)}
              />
              <Button
                label={t("common.cancel")}
                variant="ghost"
                onPress={() => setOpen(false)}
              />
            </View>
          )}
        </View>
      )}
    </Surface>
  );
}

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

export default function EventPage() {
  const { id, promo } = useLocalSearchParams<{ id: string; promo?: string }>();
  const { t, i18n } = useTranslation();
  const [now] = useState(() => Date.now());
  const [chosenType, setChosenType] = useState<string>();
  const query = useQuery({
    queryKey: ["event", id],
    queryFn: () => apiFetch<EventItem>(`/events/${id}`),
    enabled: !!id,
  });
  const event = query.data;
  const cancelled = event?.status === "cancelled";
  const calendars = useQuery({
    queryKey: ["calendar-links", id],
    queryFn: () => apiFetch<CalendarLinks>(`/events/${id}/calendar-links`),
    enabled: !!event && !cancelled,
  });
  const seats = useQuery({
    queryKey: ["seats", id],
    queryFn: () => apiFetch<Seat[]>(`/events/${id}/seats`),
    enabled: !!event && event.seating_mode === "assigned" && !cancelled,
  });
  useEffect(() => {
    if (event?.id) {
      void captureAnalytics("event_view", {
        eventId: event.id,
        source: promo ? "campaign" : "discovery",
        route: "/events/[id]",
        locale: i18n.language,
      });
    }
  }, [event?.id, i18n.language, promo]);
  if (query.isLoading) return <LoadingBlock />;
  if (query.error || !event)
    return (
      <ErrorBlock
        message={(query.error as Error)?.message ?? t("ui.eventNotFound")}
        retry={() => void query.refetch()}
      />
    );
  const salesState = eventSalesState(event, now);
  const types = (event.ticket_types as TicketTypeWithSales[]).filter(
    (item) => !item.is_hidden,
  );
  const seatsLeft = seats.data ? availableSeatsByCategory(seats.data) : null;
  const totalSeatsLeft = seatsLeft
    ? Object.values(seatsLeft).reduce((sum, value) => sum + value, 0)
    : null;
  const remainingFor = (type: TicketTypeWithSales): number | null => {
    if (event?.seating_mode !== "assigned")
      return typeof type.available === "number" ? type.available : null;
    if (!seatsLeft || totalSeatsLeft === null) return null;
    return type.price_category
      ? (seatsLeft[type.price_category] ?? 0)
      : totalSeatsLeft;
  };
  const rows = types.map((type) => {
    const remaining = remainingFor(type);
    const soldOut = type.quantity <= 0 || remaining === 0;
    const sales = ticketSalesState(type, event, now);
    return { type, remaining, soldOut, sales };
  });
  const anyPurchasable = rows.some(
    (row) => !row.soldOut && row.sales === "on_sale",
  );
  const allSoldOut = rows.length > 0 && rows.every((row) => row.soldOut);
  const paidSuspended = event.paid_sales_suspended;
  const stateDate = formatEventDateTime(
    salesState === "registration_not_open"
      ? event.registration_opens_at
      : event.registration_closes_at,
    event.timezone,
    i18n.language,
  );
  const active =
    rows.find((row) => row.type.id === chosenType) ??
    rows.find((row) => !row.soldOut && row.sales === "on_sale") ??
    rows[0];
  const priceText = (value: number) =>
    value ? formatKzt(value, i18n.language) : t("common.free");
  const sameDay =
    shortDate(event.starts_at, event.timezone, i18n.language) ===
    shortDate(event.ends_at, event.timezone, i18n.language);
  return (
    <ScrollView contentContainerClassName="gap-6 pb-28">
      <DarkCard className="gap-6 p-6 md:p-10">
        {event.image_url ? (
          <Image
            source={{ uri: event.image_url }}
            className="absolute inset-0 h-full w-full"
            style={{ opacity: 0.25 }}
            accessibilityLabel={t("attendee.coverImageLabel", {
              title: event.title,
            })}
          />
        ) : null}
        <ScreenHeader
          tone="dark"
          titleSize="xl"
          onBack={goBack}
          kicker={formatEventDateTime(
            event.starts_at,
            event.timezone,
            i18n.language,
          )}
          title={event.title}
          right={
            <>
              <Chip label={event.category} tone="outlineMint" />
              <StatusBadge status={event.status} tone="dark" />
            </>
          }
        />
        <View className="max-w-2xl gap-5">
          <Timeline
            tone="dark"
            start={shortTime(event.starts_at, event.timezone)}
            end={shortTime(event.ends_at, event.timezone)}
            startCaption={shortDate(
              event.starts_at,
              event.timezone,
              i18n.language,
            )}
            endCaption={
              sameDay
                ? placeText(event.timezone, i18n.language)
                : shortDate(event.ends_at, event.timezone, i18n.language)
            }
            middle={durationText(event.starts_at, event.ends_at, t)}
          />
          <View className="flex-row flex-wrap items-center gap-2">
            <Icon name="pin" size={16} color={palette.mint} />
            <Text className="flex-1 text-white/80">
              {event.venue_name} · {placeText(event.city, i18n.language)}
            </Text>
            {event.seating_mode === "assigned" ? (
              <Chip label={t("ui.assignedSeating")} tone="dark" />
            ) : null}
          </View>
        </View>
        {promo && salesState === "open" ? (
          <View className="flex-row items-center gap-2 self-start rounded-2xl bg-mint px-4 py-3">
            <Icon name="sparkle" size={18} />
            <Text className="font-bold text-ink">
              {t("ui.promoApplied", { code: promo })}
            </Text>
          </View>
        ) : null}
      </DarkCard>

      {salesState !== "open" ? (
        <Surface className="gap-2 border-red-100 bg-red-50">
          <Text
            accessibilityRole="header"
            className="text-lg font-extrabold text-danger"
          >
            {t(`attendee.event.stateTitle.${salesState}`)}
          </Text>
          <Text className="text-ink">
            {t(`checkout.eventState.${salesState}`, { date: stateDate })}
          </Text>
          {cancelled && event?.cancellation_reason ? (
            <Text className="text-ink">
              {t("attendee.event.cancelReason", {
                reason: event.cancellation_reason,
              })}
            </Text>
          ) : null}
          {cancelled ? (
            <Text className="text-sm text-muted">
              {t("attendee.event.cancelledHelp")}
            </Text>
          ) : null}
        </Surface>
      ) : null}

      <View className="flex-row flex-wrap items-start gap-6">
        <View className="min-w-0 flex-[3] basis-80 gap-6">
          <Surface className="gap-5">
            <SectionTitle
              title={t("ui.eventTickets")}
              subtitle={t("attendee.ux.ticketClassesHelp")}
            />
            {paidSuspended && salesState === "open" ? (
              <Notice tone="warning">{t("attendee.event.paidSuspended")}</Notice>
            ) : null}
            {rows.length === 0 ? (
              <Text className="text-muted">{t("checkout.noTicketTypes")}</Text>
            ) : (
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={t("attendee.ux.ticketClasses")}
                className="flex-row flex-wrap gap-3"
              >
                {rows.map(({ type, remaining, soldOut, sales }) => (
                  <ClassCard
                    key={type.id}
                    title={type.name}
                    price={priceText(type.price_tiyin)}
                    selected={active?.type.id === type.id}
                    onPress={() => setChosenType(type.id)}
                    accessibilityLabel={`${type.name}, ${priceText(type.price_tiyin)}`}
                    subtitle={
                      soldOut
                        ? t("common.soldOut")
                        : remaining !== null
                          ? t("attendee.event.seatsLeft", { count: remaining })
                          : sales !== "on_sale"
                            ? t("attendee.ux.notOnSale")
                            : undefined
                    }
                  />
                ))}
              </View>
            )}
            {active ? (
              <View className="gap-1.5 rounded-2xl bg-canvas p-4">
                <Text className="font-extrabold text-ink">
                  {active.type.name}
                </Text>
                {active.type.description ? (
                  <Text className="text-muted">
                    {eventContentText(active.type.description, i18n.language)}
                  </Text>
                ) : null}
                <Text className="text-sm text-muted">
                  {t("checkout.maxPerOrder", {
                    count: active.type.max_per_order,
                  })}
                </Text>
                {active.soldOut ? (
                  <Text className="text-sm font-bold text-danger">
                    {t("common.soldOut")}
                  </Text>
                ) : active.remaining !== null ? (
                  <Text className="text-sm font-bold text-success">
                    {t("attendee.event.seatsLeft", { count: active.remaining })}
                  </Text>
                ) : null}
                {active.sales !== "on_sale" && salesState === "open" ? (
                  <Text className="text-sm font-bold text-danger">
                    {t(`checkout.salesState.${active.sales}`, {
                      date: formatEventDateTime(
                        active.type.sales_start_at,
                        event.timezone,
                        i18n.language,
                      ),
                    })}
                  </Text>
                ) : null}
                {active.sales === "on_sale" && active.type.sales_end_at ? (
                  <Text className="text-sm text-muted">
                    {t("attendee.event.salesEndAt", {
                      date: formatEventDateTime(
                        active.type.sales_end_at,
                        event.timezone,
                        i18n.language,
                      ),
                    })}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {salesState !== "open" ? (
              <Text className="rounded-2xl bg-canvas p-4 text-center font-bold text-muted">
                {t("attendee.event.salesClosed")}
              </Text>
            ) : allSoldOut ? (
              <Text className="rounded-2xl bg-canvas p-4 text-center font-bold text-muted">
                {t("attendee.event.allSoldOut")}
              </Text>
            ) : !anyPurchasable ? (
              <Text className="rounded-2xl bg-canvas p-4 text-center font-bold text-muted">
                {t("attendee.event.nothingOnSale")}
              </Text>
            ) : (
              <Link
                href={{
                  pathname: "/checkout/[eventId]",
                  params: { eventId: event.id, promo: promo ?? "" },
                }}
                asChild
              >
                <Pressable
                  accessibilityRole="link"
                  className="min-h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-mint px-6 active:opacity-80"
                >
                  <Icon name="ticket" size={20} />
                  <Text className="text-lg font-extrabold text-ink">
                    {t("common.buyTickets")}
                  </Text>
                </Pressable>
              </Link>
            )}
          </Surface>
          <Surface className="gap-3">
            <CardHeading icon="sparkle" title={t("attendee.ux.about")} />
            <Text className="leading-6 text-ink">
              {event.description}
            </Text>
          </Surface>
        </View>

        <View className="min-w-0 flex-[2] basis-72 gap-6">
          <Surface className="gap-4">
            <CardHeading icon="calendar" title={t("common.date")} />
            <Text className="text-lg font-bold text-ink">
              {formatEventDateTime(
                event.starts_at,
                event.timezone,
                i18n.language,
                "full",
              )}
            </Text>
            <Text className="text-muted">
              {t("attendee.event.endsAt", {
                date: formatEventDateTime(
                  event.ends_at,
                  event.timezone,
                  i18n.language,
                ),
              })}
            </Text>
            <View className="h-px bg-line" />
            <CardHeading icon="pin" title={t("common.venue")} />
            <Text className="text-lg font-bold text-ink">
              {event.venue_name}
            </Text>
            <Text className="text-muted">
              {placeText(event.venue_address, i18n.language)}
            </Text>
          </Surface>
          {cancelled ? null : (
            <Surface className="gap-3">
              <CardHeading icon="calendar" title={t("common.calendar")} />
              <CalendarActions
                calendar={calendars.data}
                icsPath={`/events/${event.id}/calendar.ics`}
                filename={`${event.slug}.ics`}
              />
            </Surface>
          )}
          <Surface className="gap-3">
            <CardHeading icon="receipt" title={t("common.refundPolicy")} />
            <Text className="leading-6 text-muted">
              {eventContentText(event.refund_policy, i18n.language)}
            </Text>
          </Surface>
          <Surface className="gap-3">
            <CardHeading icon="help" title={t("attendee.event.contactTitle")} />
            <Text className="text-sm text-muted">
              {t("attendee.event.contactHelp")}
            </Text>
            <Link
              href={{ pathname: "/support", params: { event_id: event.id } }}
              asChild
            >
              <Pressable
                accessibilityRole="link"
                className="min-h-12 flex-row items-center justify-center gap-2 self-start rounded-2xl border border-line bg-white px-4 active:opacity-80"
              >
                <Icon name="mail" size={18} />
                <Text className="font-bold text-ink">
                  {t("attendee.event.contactOrganizer")}
                </Text>
              </Pressable>
            </Link>
          </Surface>
          <ReportEvent event={event} />
        </View>
      </View>
    </ScrollView>
  );
}
