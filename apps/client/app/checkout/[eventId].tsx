import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Href, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { RequireAuth } from "@/components/RequireAuth";
import { ResendVerification } from "@/components/ResendVerification";
import { Icon, palette } from "@/components/icons";
import { SeatMap } from "@/components/SeatMap";
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
  StickyActionBar,
  Surface,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { captureAnalytics } from "@/lib/analytics";
import {
  clearCheckoutDraft,
  loadCheckoutDraft,
  restorablePicks,
  saveCheckoutDraft,
} from "@/lib/checkoutDraft";
import {
  type Attendee,
  attendeeFor,
  buildLines,
  estimatedSubtotal,
  eventSalesState,
  formatCountdown,
  maxSelectable,
  type Quantities,
  type SeatPick,
  secondsRemaining,
  setQuantity,
  ticketSalesState,
  ticketSlots,
  ticketTypesForSeat,
  toggleSeat,
} from "@/lib/checkoutSelection";
import { isValidEmail } from "@/lib/email";
import { errorCode } from "@/lib/errorMessage";
import { eventContentText } from "@/lib/eventContentText";
import { formatEventDateTime } from "@/lib/eventTime";
import { useAuth } from "@/providers/AuthProvider";
import type { EventItem, Seat, TicketTypeWithSales } from "@/types";
import { formatDateTime } from "@/utils/date";
import { formatKzt, newIdempotencyKey } from "@/utils/format";

interface CheckoutSession {
  id: string;
  status: string;
  expires_at: string;
  subtotal_tiyin: number;
  discount_tiyin: number;
  processing_fee_tiyin: number;
  total_tiyin: number;
}

type PaymentOutcome = "success" | "failure" | "timeout";

// Keep client-generated notices as translation keys so they re-render in the
// active language; API errors arrive already localized by ApiError.
type CheckoutNotice = (
  { key: string; values?: Record<string, string | number> } | { text: string }
) & { tone?: "error" | "info" };

class CheckoutValidationError extends Error {
  constructor(readonly key: string) {
    super(key);
  }
}

function toNotice(error: unknown, fallbackKey: string): CheckoutNotice {
  if (error instanceof CheckoutValidationError) return { key: error.key };
  if (error instanceof Error && error.message) return { text: error.message };
  return { key: fallbackKey };
}

// Sessions the API has already closed: nothing is left to pay or release.
const CLOSED_SESSION_CODES = [
  "demo_payment_failed",
  "checkout_expired",
  "checkout_not_found",
  "payment_incomplete",
];

function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

function MoneyRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className={strong ? "text-lg font-semibold text-ink" : "text-muted"}>
        {label}
      </Text>
      <Text
        className={
          strong ? "text-2xl font-semibold text-ink" : "font-medium text-ink"
        }
      >
        {value}
      </Text>
    </View>
  );
}

function CheckoutContent() {
  const { t, i18n } = useTranslation();
  const {
    eventId,
    promo: initialPromo,
    session: sessionId,
  } = useLocalSearchParams<{
    eventId: string;
    promo?: string;
    session?: string;
  }>();
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const [draft] = useState(() =>
    loadCheckoutDraft<CheckoutSession>(user?.id, eventId),
  );
  const [quantities, setQuantities] = useState<Quantities>(
    draft.quantities ?? {},
  );
  const [chosenPicks, setPicks] = useState<SeatPick[]>(draft.picks ?? []);
  const [buyerName, setBuyerName] = useState(user?.display_name ?? "");
  const [buyerEmail, setBuyerEmail] = useState(user?.email ?? "");
  const [sameForAll, setSameForAll] = useState(true);
  const [attendees, setAttendees] = useState<Record<string, Attendee>>({});
  const [promo, setPromo] = useState(initialPromo ?? "");
  const [createdSession, setSession] = useState(draft.session);
  const [closedSessionId, setClosedSessionId] = useState<string>();
  const [message, setMessage] = useState<CheckoutNotice>();
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  // The session id lives in the URL so a reload can resume the held reservation.
  const restoredQuery = useQuery({
    queryKey: ["checkout-session", sessionId],
    queryFn: () => apiFetch<CheckoutSession>(`/checkout/sessions/${sessionId}`),
    enabled: !!user && !!sessionId && !createdSession,
    retry: false,
  });
  const restored = restoredQuery.data;
  const knownSession =
    createdSession ?? (restored?.status === "open" ? restored : undefined);
  const session =
    knownSession && knownSession.id !== closedSessionId
      ? knownSession
      : undefined;
  const now = useNow(!!session);
  const secondsLeft = session ? secondsRemaining(session.expires_at, now) : 0;
  const holdExpired = !!session && secondsLeft <= 0;
  const activeSession = holdExpired ? undefined : session;
  const restoredMessage: CheckoutNotice | undefined = restoredQuery.error
    ? { text: restoredQuery.error.message }
    : restored && restored.status !== "open" && restored.id !== closedSessionId
      ? {
          key:
            restored.status === "expired"
              ? "ui.checkoutExpired"
              : "ui.checkoutClosed",
        }
      : undefined;
  const notice: CheckoutNotice | undefined = holdExpired
    ? { key: "ui.checkoutExpired" }
    : (message ?? restoredMessage);
  const eventQuery = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => apiFetch<EventItem>(`/events/${eventId}`),
    enabled: !!eventId,
  });
  const event = eventQuery.data;
  const assigned = event?.seating_mode === "assigned";
  const seatsQuery = useQuery({
    queryKey: ["seats", eventId],
    queryFn: () => apiFetch<Seat[]>(`/events/${eventId}/seats`),
    enabled: assigned,
  });
  const seats = seatsQuery.data;
  // Remembered seats without an active hold are only kept while the API still
  // reports them as available; held seats are shown as the user's selection.
  const picks =
    session || !seats || seatsQuery.isFetching
      ? chosenPicks
      : restorablePicks(chosenPicks, seats);
  const types: TicketTypeWithSales[] = (event?.ticket_types ?? []).filter(
    (item) => !item.is_hidden,
  );
  const slots = ticketSlots(!!assigned, types, quantities, picks);
  const buyer = { name: buyerName, email: buyerEmail };
  const typeById = (id: string) => types.find((item) => item.id === id);
  const seatById = (id?: string) => seats?.find((seat) => seat.id === id);
  const seatText = (seat: Seat | undefined) =>
    seat
      ? t("checkout.seatLabel", {
          section: seat.section,
          row: seat.row,
          number: seat.number,
        }) + (seat.is_accessible ? ` · ${t("checkout.accessibleSeat")}` : "")
      : "";
  const attendeesValid = slots.every((slot) => {
    const attendee = attendeeFor(slot, attendees, buyer, sameForAll);
    return attendee.name.length >= 2 && isValidEmail(attendee.email);
  });

  const picksKey = picks
    .map((pick) => `${pick.seatId}:${pick.ticketTypeId}`)
    .join();
  useEffect(() => {
    saveCheckoutDraft(user?.id, eventId, {
      quantities,
      picks,
      session: activeSession,
    });
    // `picks` is re-derived on every render; `picksKey` identifies its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, eventId, quantities, picksKey, activeSession]);

  const analyticsOptions = {
    eventId: event?.id,
    source: promo.trim() ? "campaign" : "direct",
    route: "/checkout/[eventId]",
  };

  const closeSession = (id: string | undefined) => {
    setClosedSessionId(id);
    setSession(undefined);
    setConfirmingRelease(false);
    router.setParams({ session: undefined });
    void queryClient.invalidateQueries({ queryKey: ["seats", eventId] });
  };

  const reserve = useMutation({
    mutationFn: async () => {
      if (!event || !slots.length)
        throw new CheckoutValidationError(
          assigned ? "ui.chooseSeat" : "ui.chooseTicketType",
        );
      if (!attendeesValid)
        throw new CheckoutValidationError("checkout.attendeeDetailsRequired");
      return apiFetch<CheckoutSession>("/checkout/sessions", {
        method: "POST",
        body: JSON.stringify({
          event_id: event.id,
          promo_code: promo.trim() || null,
          idempotency_key: newIdempotencyKey("checkout"),
          lines: buildLines(slots, attendees, buyer, sameForAll),
        }),
      });
    },
    onMutate: () => {
      // A lapsed hold is gone on the server; forget it before reserving again.
      if (holdExpired) closeSession(session?.id);
      setMessage(undefined);
    },
    onSuccess: (created) => {
      setClosedSessionId(undefined);
      setSession(created);
      router.setParams({ session: created.id });
      void captureAnalytics("checkout_start", analyticsOptions);
    },
    onError: (error) => {
      setMessage(toNotice(error, "ui.reservationFailed"));
      // Someone else may have taken a seat or the last tickets meanwhile.
      void queryClient.invalidateQueries({ queryKey: ["seats", eventId] });
    },
  });

  const confirm = useMutation({
    mutationFn: (outcome: PaymentOutcome) =>
      apiFetch<{ order_id: string }>(
        `/checkout/sessions/${session?.id}/confirm`,
        {
          method: "POST",
          body: JSON.stringify({
            outcome,
            idempotency_key: newIdempotencyKey("payment"),
          }),
        },
      ),
    onSuccess: (result) => {
      // Analytics is best-effort and must never delay the confirmation page.
      void captureAnalytics("purchase_demo", analyticsOptions);
      clearCheckoutDraft(user?.id, eventId);
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["seats", eventId] });
      router.replace(`/orders/${result.order_id}?confirmed=1` as Href);
    },
    onError: (error, outcome) => {
      const code = errorCode(error);
      setMessage(
        code === "demo_payment_failed"
          ? {
              key:
                outcome === "timeout"
                  ? "checkout.paymentTimedOut"
                  : "checkout.paymentFailed",
            }
          : toNotice(error, "ui.paymentSimulationFailed"),
      );
      if (code && CLOSED_SESSION_CODES.includes(code))
        closeSession(session?.id);
    },
  });

  const release = useMutation({
    mutationFn: () =>
      apiFetch<CheckoutSession>(`/checkout/sessions/${session?.id}/abandon`, {
        method: "POST",
      }),
    onSuccess: (closed) => {
      closeSession(closed.id);
      setMessage({ key: "checkout.released", tone: "info" });
    },
    onError: (error) => {
      setConfirmingRelease(false);
      setMessage(toNotice(error, "checkout.releaseFailed"));
    },
  });

  const startOver = () => {
    closeSession(session?.id ?? restored?.id);
    setQuantities({});
    setPicks([]);
    setAttendees({});
    setMessage(undefined);
  };

  // RequireAuth renders the signed-out state before this mounts.
  if (!user) return null;
  if (eventQuery.isLoading || restoredQuery.isLoading) return <LoadingBlock />;
  if (eventQuery.error || !event)
    return (
      <ErrorBlock
        message={(eventQuery.error as Error)?.message ?? t("ui.eventNotFound")}
        retry={() => void eventQuery.refetch()}
      />
    );

  const salesState = eventSalesState(event, now);
  const unverified = user.is_email_verified === false;
  const onSeatSelect = (seat: Seat) => {
    const result = toggleSeat(picks, seat, types, event, now);
    if (result.error) {
      const { reason, ...values } = result.error;
      setMessage({ key: `checkout.seatError.${reason}`, values });
      return;
    }
    setMessage(undefined);
    setPicks(result.picks);
  };
  const setAttendee = (key: string, patch: Partial<Attendee>) =>
    setAttendees((current) => ({
      ...current,
      [key]: { ...buyer, ...current[key], ...patch },
    }));
  const salesStateText = (type: TicketTypeWithSales) => {
    const state = ticketSalesState(type, event, now);
    if (state === "on_sale") return undefined;
    if (state === "not_started")
      return t("checkout.salesState.not_started", {
        date: formatDateTime(
          type.sales_start_at ?? "",
          i18n.language,
          "medium",
        ),
      });
    return t(`checkout.salesState.${state}`);
  };
  const noticeBlock = notice ? (
    <Text
      role="alert"
      accessibilityLiveRegion="assertive"
      className={`w-full rounded-2xl p-3 ${notice.tone === "info" ? "bg-mintsoft font-medium text-success" : "bg-red-50 text-danger"}`}
    >
      {"key" in notice ? t(notice.key, notice.values) : notice.text}
    </Text>
  ) : null;
  const summaryLines = types
    .map((type) => ({
      type,
      count: slots.filter((slot) => slot.ticketTypeId === type.id).length,
    }))
    .filter((line) => line.count > 0);
  const subtotal = estimatedSubtotal(slots, types);
  const canReserve =
    salesState === "open" && !unverified && slots.length > 0 && attendeesValid;
  const priceText = (value: number) =>
    value ? formatKzt(value, i18n.language) : t("common.free");
  const shortSeat = (seat: Seat | undefined) =>
    seat ? `${seat.section}-${seat.row}-${seat.number}` : "";
  const pickedSeatsText = picks
    .map((pick) => shortSeat(seatById(pick.seatId)))
    .filter(Boolean)
    .join(", ");
  const showBar = !!activeSession || (!unverified && salesState === "open");
  const barCount = slots.length;

  return (
    <View className="flex-1">
      <ScrollView className="flex-1" contentContainerClassName="gap-6 pb-10">
        <ScreenHeader
          backHref={{ pathname: "/events/[id]", params: { id: event.id } }}
          backLabel={t("checkout.backToEvent")}
          kicker={`${formatEventDateTime(
            event.starts_at,
            event.timezone,
            i18n.language,
            "medium",
          )}${event.venue_name ? ` · ${event.venue_name}` : ""}`}
          title={event.title}
          right={
            <Chip
              label={assigned ? t("ui.chooseSeat") : t("checkout.title")}
              icon={assigned ? "ticket" : "receipt"}
            />
          }
        />
        <Notice icon="card">{t("ui.demoPaymentNotice")}</Notice>
        <View className="flex-row flex-wrap items-start gap-6">
          <View className="min-w-0 flex-[2] basis-80 gap-6">
            {activeSession ? (
              <DarkCard className="gap-5">
                <View className="flex-row flex-wrap items-center justify-between gap-3">
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-sm font-medium text-mint">
                      {t("ui.inventoryReserved")}
                    </Text>
                    <Text className="text-2xl font-semibold tracking-tight text-white">
                      {t("ui.completeDemoPayment")}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2 rounded-2xl bg-white/10 px-4 py-3">
                    <Icon name="clock" size={18} color={palette.mint} />
                    <View>
                      <Text
                        className="text-lg font-semibold text-white"
                        accessibilityLabel={t("checkout.holdRemainingLabel", {
                          minutes: Math.floor(secondsLeft / 60),
                          seconds: secondsLeft % 60,
                        })}
                      >
                        {t("checkout.holdRemaining", {
                          time: formatCountdown(secondsLeft),
                        })}
                      </Text>
                      <Text className="text-xs text-white/65">
                        {t("checkout.holdUntil", {
                          time: formatDateTime(
                            activeSession.expires_at,
                            i18n.language,
                            "time",
                          ),
                        })}
                      </Text>
                    </View>
                  </View>
                </View>
                <View className="gap-3 rounded-3xl bg-white p-4">
                  <MoneyRow
                    label={t("ui.subtotal")}
                    value={formatKzt(
                      activeSession.subtotal_tiyin,
                      i18n.language,
                    )}
                  />
                  <MoneyRow
                    label={t("ui.discount")}
                    value={`− ${formatKzt(activeSession.discount_tiyin, i18n.language)}`}
                  />
                  <MoneyRow
                    label={t("ui.processorDeduction")}
                    value={formatKzt(
                      activeSession.processing_fee_tiyin,
                      i18n.language,
                    )}
                  />
                  <View className="border-t border-dashed border-line pt-3">
                    <MoneyRow
                      strong
                      label={t("ui.yourTotal")}
                      value={formatKzt(
                        activeSession.total_tiyin,
                        i18n.language,
                      )}
                    />
                  </View>
                </View>
                {activeSession.total_tiyin ? (
                  <View className="gap-1 rounded-2xl border border-amber-200/40 bg-amber-400/10 p-4">
                    <Text className="font-semibold text-white">
                      {t("checkout.simulationTitle")}
                    </Text>
                    <Text className="text-sm text-white/75">
                      {t("checkout.simulationHelp")}
                    </Text>
                  </View>
                ) : null}
                {activeSession.total_tiyin ? (
                  <View className="flex-row flex-wrap gap-3">
                    <View className="min-w-40 flex-1">
                      <Button
                        label={t("ui.simulateFailure")}
                        variant="onDark"
                        onPress={() => confirm.mutate("failure")}
                        loading={
                          confirm.isPending && confirm.variables === "failure"
                        }
                        disabled={confirm.isPending || release.isPending}
                      />
                    </View>
                    <View className="min-w-40 flex-1">
                      <Button
                        label={t("ui.simulateTimeout")}
                        variant="onDark"
                        onPress={() => confirm.mutate("timeout")}
                        loading={
                          confirm.isPending && confirm.variables === "timeout"
                        }
                        disabled={confirm.isPending || release.isPending}
                      />
                    </View>
                  </View>
                ) : null}
                {confirmingRelease ? (
                  <View
                    className="gap-3 rounded-2xl border border-red-200 bg-white p-4"
                    accessibilityRole="alert"
                  >
                    <Text className="font-medium text-ink">
                      {t("checkout.releaseConfirmTitle")}
                    </Text>
                    <Text className="text-sm text-muted">
                      {t("checkout.releaseConfirmBody")}
                    </Text>
                    <View className="flex-row flex-wrap gap-3">
                      <Button
                        label={t("checkout.releaseConfirm")}
                        variant="danger"
                        onPress={() => release.mutate()}
                        loading={release.isPending}
                      />
                      <Button
                        label={t("checkout.keepReservation")}
                        variant="secondary"
                        onPress={() => setConfirmingRelease(false)}
                        disabled={release.isPending}
                      />
                    </View>
                  </View>
                ) : (
                  <View className="self-start">
                    <Button
                      label={t("checkout.release")}
                      variant="onDark"
                      size="sm"
                      iconName="close"
                      onPress={() => setConfirmingRelease(true)}
                      disabled={confirm.isPending}
                    />
                  </View>
                )}
              </DarkCard>
            ) : unverified ? (
              <Surface className="gap-4 border-amber-200 bg-amber-50">
                <Text className="text-xl font-semibold text-ink">
                  {t("checkout.verifyTitle")}
                </Text>
                <Text className="text-ink">
                  {t("checkout.verifyBody", { email: user.email })}
                </Text>
                <ResendVerification defaultEmail={user.email} lockEmail />
                <Button
                  label={t("checkout.verifyRefresh")}
                  variant="ghost"
                  onPress={() => void refreshUser().catch(() => undefined)}
                />
              </Surface>
            ) : salesState !== "open" ? (
              <Surface className="gap-3 border-amber-200 bg-amber-50">
                <Text className="text-xl font-semibold text-ink">
                  {t("checkout.unavailableTitle")}
                </Text>
                <Text className="text-ink">
                  {t(`checkout.eventState.${salesState}`, {
                    date: formatDateTime(
                      (salesState === "registration_not_open"
                        ? event.registration_opens_at
                        : event.registration_closes_at) ?? "",
                      i18n.language,
                      "medium",
                    ),
                  })}
                </Text>
              </Surface>
            ) : (
              <>
                {assigned ? (
                  <Surface className="gap-5">
                    <StepTitle number={1} title={t("checkout.chooseSeats")} />
                    <View className="flex-row flex-wrap gap-3">
                      {types.map((type) => (
                        <ClassCard
                          key={type.id}
                          title={type.name}
                          price={priceText(type.price_tiyin)}
                          selected={picks.some(
                            (pick) => pick.ticketTypeId === type.id,
                          )}
                          subtitle={`${t("checkout.maxPerOrder", {
                            count: maxSelectable(type),
                          })}${
                            salesStateText(type)
                              ? ` · ${salesStateText(type)}`
                              : ""
                          }`}
                        />
                      ))}
                    </View>
                    {seatsQuery.isLoading ? (
                      <LoadingBlock />
                    ) : seatsQuery.error ? (
                      <ErrorBlock
                        message={(seatsQuery.error as Error).message}
                        retry={() => void seatsQuery.refetch()}
                      />
                    ) : (
                      <SeatMap
                        seats={seats ?? []}
                        selected={picks.map((pick) => pick.seatId)}
                        onSelect={onSeatSelect}
                      />
                    )}
                    {picks.length ? (
                      <View className="gap-2">
                        <Text className="font-semibold text-ink">
                          {t("checkout.selectedSeats")}
                        </Text>
                        {picks.map((pick) => {
                          const seat = seatById(pick.seatId);
                          const options = seat
                            ? ticketTypesForSeat(seat, types)
                            : [];
                          const type = typeById(pick.ticketTypeId);
                          return (
                            <View
                              key={pick.seatId}
                              className="gap-3 rounded-3xl border border-line bg-canvas p-3"
                            >
                              <View className="flex-row flex-wrap items-center justify-between gap-2">
                                <View className="min-w-40 flex-1 flex-row items-center gap-3">
                                  <View className="h-11 w-11 flex-row items-center justify-center rounded-xl bg-ink">
                                    <Text className="font-semibold text-white">
                                      {seat?.number}
                                    </Text>
                                    <View className="absolute bottom-2 right-1 top-2 w-1 rounded-full bg-mint" />
                                  </View>
                                  <View className="min-w-0 flex-1">
                                    <Text className="font-medium text-ink">
                                      {seatText(seat)}
                                    </Text>
                                    <Text className="text-sm text-muted">
                                      {type?.name} ·{" "}
                                      {type?.price_tiyin
                                        ? formatKzt(
                                            type.price_tiyin,
                                            i18n.language,
                                          )
                                        : t("common.free")}
                                    </Text>
                                  </View>
                                </View>
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={t("checkout.removeSeat", {
                                    seat: seatText(seat),
                                  })}
                                  onPress={() =>
                                    setPicks(
                                      picks.filter(
                                        (item) => item.seatId !== pick.seatId,
                                      ),
                                    )
                                  }
                                  className="min-h-11 flex-row items-center justify-center gap-1 rounded-2xl border border-line bg-white px-3 active:opacity-80"
                                >
                                  <Icon
                                    name="close"
                                    size={16}
                                    color={palette.danger}
                                  />
                                  <Text className="font-medium text-danger">
                                    {t("checkout.remove")}
                                  </Text>
                                </Pressable>
                              </View>
                              {options.length > 1 ? (
                                <View
                                  accessibilityRole="radiogroup"
                                  accessibilityLabel={t(
                                    "checkout.ticketTypeForSeat",
                                    { seat: seatText(seat) },
                                  )}
                                  className="flex-row flex-wrap gap-2"
                                >
                                  {options.map((option) => {
                                    const checked =
                                      option.id === pick.ticketTypeId;
                                    const blocked =
                                      !checked &&
                                      (ticketSalesState(option, event, now) !==
                                        "on_sale" ||
                                        picks.filter(
                                          (item) =>
                                            item.ticketTypeId === option.id,
                                        ).length >= maxSelectable(option));
                                    return (
                                      <Pressable
                                        key={option.id}
                                        disabled={blocked}
                                        accessibilityRole="radio"
                                        accessibilityState={{
                                          checked,
                                          disabled: blocked,
                                        }}
                                        onPress={() =>
                                          setPicks(
                                            picks.map((item) =>
                                              item.seatId === pick.seatId
                                                ? {
                                                    ...item,
                                                    ticketTypeId: option.id,
                                                  }
                                                : item,
                                            ),
                                          )
                                        }
                                        className={`min-h-11 flex-row items-center gap-1.5 rounded-xl border px-4 ${checked ? "border-ink bg-ink" : "border-line bg-white"} ${blocked ? "opacity-40" : ""}`}
                                      >
                                        {checked ? (
                                          <Icon name="check" size={16} color={palette.mint} />
                                        ) : null}
                                        <Text
                                          className={`font-medium ${checked ? "text-white" : "text-ink"}`}
                                        >
                                          {option.name}
                                        </Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </Surface>
                ) : (
                  <Surface className="gap-5">
                    <StepTitle number={1} title={t("checkout.chooseTickets")} />
                    {types.length === 0 ? (
                      <Text className="text-muted">
                        {t("checkout.noTicketTypes")}
                      </Text>
                    ) : null}
                    <View className="flex-row flex-wrap gap-3">
                      {types.map((type) => {
                        const count = quantities[type.id] ?? 0;
                        const stateText = salesStateText(type);
                        const limit = setQuantity(
                          quantities,
                          type,
                          Number.MAX_SAFE_INTEGER,
                        )[type.id];
                        const canAdd = !stateText && count < (limit ?? 0);
                        const on = count > 0;
                        return (
                          <ClassCard
                            key={type.id}
                            title={type.name}
                            price={priceText(type.price_tiyin)}
                            selected={on}
                            subtitle={
                              type.description
                                ? eventContentText(
                                    type.description,
                                    i18n.language,
                                  )
                                : undefined
                            }
                            meta={
                              <View className="gap-3">
                                <Text
                                  className={`text-xs ${on ? "text-white/65" : "text-muted"}`}
                                >
                                  {t("checkout.maxPerOrder", {
                                    count: maxSelectable(type),
                                  })}
                                </Text>
                                {stateText ? (
                                  <Text className="rounded-2xl bg-amber-50 p-3 font-medium text-ink">
                                    {stateText}
                                  </Text>
                                ) : (
                                  <View className="flex-row flex-wrap items-center gap-3">
                                    <StepperButton
                                      icon="minus"
                                      dark={on}
                                      label={t("checkout.decrease", {
                                        name: type.name,
                                      })}
                                      disabled={count === 0}
                                      onPress={() =>
                                        setQuantities(
                                          setQuantity(
                                            quantities,
                                            type,
                                            count - 1,
                                          ),
                                        )
                                      }
                                    />
                                    <Text
                                      className={`min-w-10 text-center text-2xl font-semibold ${on ? "text-white" : "text-ink"}`}
                                      accessibilityLiveRegion="polite"
                                      accessibilityLabel={t(
                                        "checkout.quantityOf",
                                        { name: type.name, count },
                                      )}
                                    >
                                      {count}
                                    </Text>
                                    <StepperButton
                                      icon="plus"
                                      dark={on}
                                      label={t("checkout.increase", {
                                        name: type.name,
                                      })}
                                      disabled={!canAdd}
                                      onPress={() =>
                                        setQuantities(
                                          setQuantity(
                                            quantities,
                                            type,
                                            count + 1,
                                          ),
                                        )
                                      }
                                    />
                                    {count > 0 && !canAdd ? (
                                      <Text
                                        className={`flex-1 text-xs ${on ? "text-white/65" : "text-muted"}`}
                                      >
                                        {t("checkout.limitReached")}
                                      </Text>
                                    ) : null}
                                  </View>
                                )}
                              </View>
                            }
                          />
                        );
                      })}
                    </View>
                  </Surface>
                )}
                <Surface className="gap-4">
                  <StepTitle number={2} title={t("ui.attendeeDetails")} />
                  <Text className="text-sm text-muted">
                    {t("checkout.buyerHelp")}
                  </Text>
                  <Field
                    label={t("ui.attendeeName")}
                    value={buyerName}
                    onChangeText={setBuyerName}
                    autoComplete="name"
                    icon="user"
                  />
                  <Field
                    label={t("ui.attendeeEmail")}
                    value={buyerEmail}
                    onChangeText={setBuyerEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    icon="mail"
                    error={
                      buyerEmail && !isValidEmail(buyerEmail)
                        ? t("ui.invalidEmail")
                        : undefined
                    }
                  />
                  {slots.length > 1 ? (
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityState={{ checked: sameForAll }}
                      aria-checked={sameForAll}
                      onPress={() => setSameForAll((value) => !value)}
                      className="min-h-12 flex-row items-center gap-3 rounded-2xl bg-canvas px-3"
                    >
                      <View
                        className={`h-7 w-12 justify-center rounded-full px-1 ${sameForAll ? "items-end bg-ink" : "items-start bg-line"}`}
                      >
                        <View
                          className={`h-5 w-5 items-center justify-center rounded-full ${sameForAll ? "bg-mint" : "bg-white"}`}
                        >
                          {sameForAll ? <Icon name="check" size={12} /> : null}
                        </View>
                      </View>
                      <Text className="flex-1 font-medium text-ink">
                        {t("checkout.sameForAll")}
                      </Text>
                    </Pressable>
                  ) : null}
                  {slots.length > 1 && !sameForAll
                    ? slots.map((slot, index) => {
                        const own = attendees[slot.key] ?? buyer;
                        const seat = seatById(slot.seatId);
                        const title = [
                          t("checkout.ticketNumber", { number: index + 1 }),
                          typeById(slot.ticketTypeId)?.name,
                          seat ? seatText(seat) : undefined,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <View
                            key={slot.key}
                            className="gap-3 rounded-3xl border border-line bg-canvas p-4"
                          >
                            <Text className="font-semibold text-ink">
                              {title}
                            </Text>
                            <Field
                              label={t("checkout.attendeeNameFor", {
                                number: index + 1,
                              })}
                              value={own.name}
                              onChangeText={(name) =>
                                setAttendee(slot.key, { name })
                              }
                              error={
                                own.name.trim().length < 2
                                  ? t("checkout.nameRequired")
                                  : undefined
                              }
                            />
                            <Field
                              label={t("checkout.attendeeEmailFor", {
                                number: index + 1,
                              })}
                              value={own.email}
                              onChangeText={(email) =>
                                setAttendee(slot.key, { email })
                              }
                              autoCapitalize="none"
                              keyboardType="email-address"
                              error={
                                !isValidEmail(own.email)
                                  ? t("ui.invalidEmail")
                                  : undefined
                              }
                            />
                          </View>
                        );
                      })
                    : null}
                  <Field
                    label={t("ui.promoOptional")}
                    value={promo}
                    onChangeText={(value) => setPromo(value.toUpperCase())}
                    autoCapitalize="characters"
                    icon="ticket"
                  />
                </Surface>
              </>
            )}
          </View>
          <Surface className="min-w-72 flex-1 gap-4">
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-2xl bg-mintsoft">
                <Icon name="receipt" size={18} color={palette.brand} />
              </View>
              <Text
                accessibilityRole="header"
                className="flex-1 text-lg font-semibold text-ink"
              >
                {t("checkout.orderSummary")}
              </Text>
            </View>
            {summaryLines.length === 0 ? (
              <Text className="text-muted">
                {activeSession
                  ? t("checkout.summaryRestored")
                  : assigned
                    ? t("checkout.summaryEmptySeats")
                    : t("checkout.summaryEmpty")}
              </Text>
            ) : (
              <View className="gap-3">
                {summaryLines.map(({ type, count }) => (
                  <View key={type.id} className="gap-1">
                    <View className="flex-row justify-between gap-3">
                      <Text className="flex-1 font-medium text-ink">
                        {count} × {type.name}
                      </Text>
                      <Text className="font-medium text-ink">
                        {formatKzt(type.price_tiyin * count, i18n.language)}
                      </Text>
                    </View>
                    {picks
                      .filter((pick) => pick.ticketTypeId === type.id)
                      .map((pick) => (
                        <Text key={pick.seatId} className="text-sm text-muted">
                          {seatText(seatById(pick.seatId))}
                        </Text>
                      ))}
                  </View>
                ))}
                {activeSession ? null : (
                  <View className="gap-1 border-t border-dashed border-line pt-3">
                    <MoneyRow
                      label={t("checkout.estimatedSubtotal")}
                      value={formatKzt(subtotal, i18n.language)}
                    />
                    <Text className="text-xs text-muted">
                      {t("checkout.totalsAfterReserve")}
                    </Text>
                  </View>
                )}
              </View>
            )}
            {promo ? (
              <Chip
                label={`${t("ui.promoOptional")}: ${promo}`}
                icon="ticket"
                tone="mint"
              />
            ) : null}
            {!activeSession && !unverified && salesState === "open" ? (
              <>
                {slots.length > 0 && !attendeesValid ? (
                  <Text className="text-sm text-muted">
                    {t("checkout.attendeeDetailsRequired")}
                  </Text>
                ) : null}
                {slots.length > 0 ? (
                  <Button
                    label={t("checkout.startOver")}
                    variant="ghost"
                    onPress={startOver}
                    disabled={reserve.isPending}
                  />
                ) : null}
              </>
            ) : null}
          </Surface>
        </View>
        {!showBar ? noticeBlock : null}
      </ScrollView>
      {showBar ? (
        <StickyActionBar>
          {noticeBlock}
          <View className="min-w-0 flex-1 basis-40">
            <Text
              className="text-3xl font-semibold tracking-tight text-ink"
              accessibilityLabel={`${activeSession ? t("ui.yourTotal") : t("checkout.estimatedSubtotal")}: ${formatKzt(activeSession ? activeSession.total_tiyin : subtotal, i18n.language)}`}
            >
              {formatKzt(
                activeSession ? activeSession.total_tiyin : subtotal,
                i18n.language,
              )}
            </Text>
            <Text className="text-sm text-muted" numberOfLines={1}>
              {activeSession
                ? t("checkout.holdRemaining", {
                    time: formatCountdown(secondsLeft),
                  })
                : barCount
                  ? `${t("checkout.barTickets", { count: barCount })}${pickedSeatsText ? ` (${pickedSeatsText})` : ""}`
                  : assigned
                    ? t("checkout.summaryEmptySeats")
                    : t("checkout.summaryEmpty")}
            </Text>
          </View>
          <View className="min-w-0 grow basis-56">
            {activeSession ? (
              <Button
                size="lg"
                fullWidth
                iconName="check"
                label={
                  activeSession.total_tiyin
                    ? t("ui.simulateSuccess")
                    : t("ui.confirmFree")
                }
                onPress={() => confirm.mutate("success")}
                loading={confirm.isPending && confirm.variables === "success"}
                disabled={confirm.isPending || release.isPending}
              />
            ) : (
              <Button
                size="lg"
                fullWidth
                iconName="ticket"
                label={t("ui.reserveTenMinutes")}
                onPress={() => reserve.mutate()}
                loading={reserve.isPending}
                disabled={!canReserve}
              />
            )}
          </View>
        </StickyActionBar>
      ) : null}
    </View>
  );
}

function StepTitle({ number, title }: { number: number; title: string }) {
  return (
    <View className="flex-row items-center gap-3">
      <View
        className="h-9 w-9 items-center justify-center rounded-xl bg-ink"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text className="font-semibold text-mint">{number}</Text>
      </View>
      <Text
        accessibilityRole="header"
        className="flex-1 text-xl font-semibold text-ink"
      >
        {number}. {title}
      </Text>
    </View>
  );
}

function StepperButton({
  icon,
  label,
  disabled,
  dark,
  onPress,
}: {
  icon: "plus" | "minus";
  label: string;
  disabled: boolean;
  dark: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`h-12 w-12 items-center justify-center rounded-2xl ${dark ? "bg-mint" : "border border-line bg-white"} ${disabled ? "opacity-40" : "active:opacity-80"}`}
    >
      <Icon name={icon} size={20} color={palette.ink} />
    </Pressable>
  );
}

export default function CheckoutPage() {
  const { t } = useTranslation();
  return (
    <RequireAuth
      title={t("common.signIn")}
      message={t("ui.protectedTicketsHelp")}
    >
      <CheckoutContent />
    </RequireAuth>
  );
}
