import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { SeatMap } from "@/components/SeatMap";
import {
  Button,
  ErrorBlock,
  Field,
  LoadingBlock,
  Surface,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { captureAnalytics } from "@/lib/analytics";
import { useAuth } from "@/providers/AuthProvider";
import type { EventItem, Seat } from "@/types";
import { formatKzt, newIdempotencyKey } from "@/utils/format";

interface CheckoutSession {
  id: string;
  expires_at: string;
  subtotal_tiyin: number;
  discount_tiyin: number;
  processing_fee_tiyin: number;
  total_tiyin: number;
}

export default function CheckoutPage() {
  const { t, i18n } = useTranslation();
  const { eventId, promo: initialPromo } = useLocalSearchParams<{
    eventId: string;
    promo?: string;
  }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [ticketTypeId, setTicketTypeId] = useState<string>();
  const [seatId, setSeatId] = useState<string>();
  const [attendeeName, setAttendeeName] = useState(user?.display_name ?? "");
  const [attendeeEmail, setAttendeeEmail] = useState(user?.email ?? "");
  const [promo, setPromo] = useState(initialPromo ?? "");
  const [session, setSession] = useState<CheckoutSession>();
  const [message, setMessage] = useState<string>();
  const eventQuery = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => apiFetch<EventItem>(`/events/${eventId}`),
    enabled: !!eventId,
  });
  const seatsQuery = useQuery({
    queryKey: ["seats", eventId],
    queryFn: () => apiFetch<Seat[]>(`/events/${eventId}/seats`),
    enabled: eventQuery.data?.seating_mode === "assigned",
  });
  const event = eventQuery.data;
  const selectedSeat = seatsQuery.data?.find((seat) => seat.id === seatId);
  const selectedType = event?.ticket_types.find(
    (item) => item.id === ticketTypeId,
  );

  const reserve = useMutation({
    mutationFn: async () => {
      if (!event || !ticketTypeId) throw new Error(t("ui.chooseTicketType"));
      if (event.seating_mode === "assigned" && !seatId)
        throw new Error(t("ui.chooseSeat"));
      return apiFetch<CheckoutSession>("/checkout/sessions", {
        method: "POST",
        body: JSON.stringify({
          event_id: event.id,
          promo_code: promo.trim() || null,
          idempotency_key: newIdempotencyKey("checkout"),
          lines: [
            {
              ticket_type_id: ticketTypeId,
              quantity: 1,
              seat_id: seatId ?? null,
              attendee_name: attendeeName,
              attendee_email: attendeeEmail,
            },
          ],
        }),
      });
    },
    onSuccess: (created) => {
      setSession(created);
      void captureAnalytics("checkout_start", {
        eventId: event?.id,
        source: promo.trim() ? "campaign" : "direct",
        route: "/checkout/[eventId]",
      });
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : "Reservation failed"),
  });

  const confirm = useMutation({
    mutationFn: (outcome: "success" | "failure" | "timeout") =>
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
    onSuccess: async () => {
      await captureAnalytics("purchase_demo", {
        eventId: event?.id,
        source: promo.trim() ? "campaign" : "direct",
        route: "/checkout/[eventId]",
      });
      await queryClient.invalidateQueries({ queryKey: ["tickets"] });
      router.replace("/tickets");
    },
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Payment simulation failed",
      );
      setSession(undefined);
    },
  });

  if (!user) {
    return (
      <Surface className="mx-auto mt-8 w-full max-w-xl items-start gap-5 p-7">
        <Text className="text-3xl font-black text-ink">
          {t("common.signIn")}
        </Text>
        <Text className="text-muted">{t("ui.protectedTicketsHelp")}</Text>
        <Link href="/login" asChild>
          <Pressable className="min-h-12 justify-center rounded-2xl bg-brand px-6">
            <Text className="font-bold text-white">{t("common.signIn")}</Text>
          </Pressable>
        </Link>
      </Surface>
    );
  }
  if (eventQuery.isLoading) return <LoadingBlock />;
  if (eventQuery.error || !event)
    return (
      <ErrorBlock
        message={(eventQuery.error as Error)?.message ?? t("ui.eventNotFound")}
      />
    );

  return (
    <ScrollView contentContainerClassName="gap-6 pb-16">
      <View className="gap-2">
        <Text className="text-sm font-black uppercase tracking-wider text-brand">
          {t("ui.chooseTicketType")}
        </Text>
        <Text className="text-4xl font-black text-ink">{event.title}</Text>
        <Text className="text-muted">{t("ui.demoPaymentNotice")}</Text>
      </View>
      <View className="flex-row flex-wrap items-start gap-6">
        <View className="min-w-0 flex-[2] gap-6">
          {!session ? (
            <>
              <Surface className="gap-4">
                <Text className="text-xl font-black text-ink">
                  1. {t("ui.chooseTicketType")}
                </Text>
                <View className="gap-3">
                  {event.ticket_types
                    .filter((item) => !item.is_hidden)
                    .map((item) => {
                      const compatible =
                        !selectedSeat ||
                        !item.price_category ||
                        item.price_category === selectedSeat.price_category;
                      return (
                        <Pressable
                          key={item.id}
                          disabled={!compatible}
                          onPress={() => setTicketTypeId(item.id)}
                          accessibilityRole="radio"
                          accessibilityState={{
                            checked: ticketTypeId === item.id,
                            disabled: !compatible,
                          }}
                          className={`min-h-16 flex-row items-center justify-between gap-4 rounded-2xl border p-4 ${ticketTypeId === item.id ? "border-brand bg-teal-50" : "border-line bg-white"} ${compatible ? "" : "opacity-40"}`}
                        >
                          <View className="flex-1">
                            <Text className="font-bold text-ink">
                              {item.name}
                            </Text>
                            <Text className="text-sm text-muted">
                              {item.description}
                            </Text>
                          </View>
                          <Text className="font-black text-ink">
                            {formatKzt(item.price_tiyin, i18n.language)}
                          </Text>
                        </Pressable>
                      );
                    })}
                </View>
              </Surface>
              {event.seating_mode === "assigned" ? (
                <Surface className="gap-4">
                  <Text className="text-xl font-black text-ink">
                    2. {t("ui.chooseSeat")}
                  </Text>
                  {seatsQuery.isLoading ? (
                    <LoadingBlock />
                  ) : (
                    <SeatMap
                      seats={seatsQuery.data ?? []}
                      selected={seatId ? [seatId] : []}
                      onSelect={(seat) => {
                        setSeatId(seat.id === seatId ? undefined : seat.id);
                        const matching = event.ticket_types.find(
                          (item) => item.price_category === seat.price_category,
                        );
                        if (matching) setTicketTypeId(matching.id);
                      }}
                    />
                  )}
                </Surface>
              ) : null}
              <Surface className="gap-4">
                <Text className="text-xl font-black text-ink">
                  {event.seating_mode === "assigned" ? "3" : "2"}.{" "}
                  {t("ui.attendeeDetails")}
                </Text>
                <Field
                  label={t("ui.attendeeName")}
                  value={attendeeName}
                  onChangeText={setAttendeeName}
                />
                <Field
                  label={t("ui.attendeeEmail")}
                  value={attendeeEmail}
                  onChangeText={setAttendeeEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <Field
                  label={t("ui.promoOptional")}
                  value={promo}
                  onChangeText={(value) => setPromo(value.toUpperCase())}
                  autoCapitalize="characters"
                />
              </Surface>
            </>
          ) : (
            <Surface className="gap-5 border-brand bg-teal-50">
              <View className="gap-1">
                <Text className="text-sm font-black uppercase text-brand">
                  {t("ui.inventoryReserved")}
                </Text>
                <Text className="text-2xl font-black text-ink">
                  {t("ui.completeDemoPayment")}
                </Text>
              </View>
              <Text className="text-muted">
                {new Date(session.expires_at).toLocaleTimeString(i18n.language)}{" "}
                · {t("ui.demoPaymentNotice")}
              </Text>
              <View className="gap-3 border-y border-teal-200 py-4">
                <View className="flex-row justify-between">
                  <Text className="text-muted">{t("ui.subtotal")}</Text>
                  <Text className="font-bold text-ink">
                    {formatKzt(session.subtotal_tiyin, i18n.language)}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-muted">{t("ui.discount")}</Text>
                  <Text className="font-bold text-success">
                    − {formatKzt(session.discount_tiyin, i18n.language)}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-muted">
                    {t("ui.processorDeduction")}
                  </Text>
                  <Text className="text-muted">
                    {formatKzt(session.processing_fee_tiyin, i18n.language)}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-lg font-black text-ink">
                    {t("ui.yourTotal")}
                  </Text>
                  <Text className="text-2xl font-black text-ink">
                    {formatKzt(session.total_tiyin, i18n.language)}
                  </Text>
                </View>
              </View>
              <Button
                label={
                  session.total_tiyin
                    ? t("ui.simulateSuccess")
                    : t("ui.confirmFree")
                }
                onPress={() => confirm.mutate("success")}
                loading={confirm.isPending}
              />
              {session.total_tiyin ? (
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Button
                      label={t("ui.simulateFailure")}
                      variant="secondary"
                      onPress={() => confirm.mutate("failure")}
                    />
                  </View>
                  <View className="flex-1">
                    <Button
                      label={t("ui.simulateTimeout")}
                      variant="secondary"
                      onPress={() => confirm.mutate("timeout")}
                    />
                  </View>
                </View>
              ) : null}
            </Surface>
          )}
        </View>
        <Surface className="min-w-72 flex-1 gap-4">
          <Text className="text-lg font-black text-ink">
            {t("ui.yourTotal")}
          </Text>
          <Text className="font-bold text-ink">
            {selectedType?.name ?? t("ui.chooseTicket")}
          </Text>
          {selectedSeat ? (
            <Text className="text-muted">
              {t("ui.selectedSeat")}: {selectedSeat.section}-{selectedSeat.row}-
              {selectedSeat.number}
              {selectedSeat.is_accessible ? " · ♿" : ""}
            </Text>
          ) : null}
          {promo ? (
            <Text className="rounded-xl bg-emerald-50 p-3 font-bold text-success">
              {t("ui.promoOptional")}: {promo}
            </Text>
          ) : null}
          {message ? (
            <Text className="rounded-xl bg-red-50 p-3 text-danger">
              {message}
            </Text>
          ) : null}
          {!session ? (
            <Button
              label={t("ui.reserveTenMinutes")}
              onPress={() => reserve.mutate()}
              loading={reserve.isPending}
              disabled={
                !ticketTypeId ||
                !attendeeName ||
                !attendeeEmail ||
                (event.seating_mode === "assigned" && !seatId)
              }
            />
          ) : null}
        </Surface>
      </View>
    </ScrollView>
  );
}
