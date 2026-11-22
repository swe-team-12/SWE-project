import { useQuery } from "@tanstack/react-query";
import { type Href, Link, useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { CalendarActions } from "@/components/CalendarActions";
import { RequireAuth } from "@/components/RequireAuth";
import { Icon, type IconName, palette } from "@/components/icons";
import {
  DarkCard,
  ErrorBlock,
  LoadingBlock,
  ScreenHeader,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { eventContentText } from "@/lib/eventContentText";
import { formatEventDateTime } from "@/lib/eventTime";
import { placeText } from "@/lib/placeText";
import { useAuth } from "@/providers/AuthProvider";
import type { OrderDetailInfo } from "@/types";
import { formatDateTime } from "@/utils/date";
import { formatKzt } from "@/utils/format";

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <View className="flex-row flex-wrap justify-between gap-3">
      <Text className={strong ? "text-lg font-black text-ink" : "text-muted"}>
        {label}
      </Text>
      <Text
        className={strong ? "text-xl font-black text-ink" : "font-bold text-ink"}
      >
        {value}
      </Text>
    </View>
  );
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

function LinkButton({
  href,
  label,
  primary,
}: {
  href: Href;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        className={`min-h-12 items-center justify-center rounded-2xl border px-5 active:opacity-80 ${primary ? "border-mint bg-mint" : "border-line bg-white"}`}
      >
        <Text className="text-center font-bold text-ink">
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}

function OrderContent() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { id, confirmed } = useLocalSearchParams<{
    id: string;
    confirmed?: string;
  }>();
  const query = useQuery({
    queryKey: ["order", id],
    queryFn: () => apiFetch<OrderDetailInfo>(`/orders/${id}`),
    enabled: !!user && !!id,
  });
  // RequireAuth renders the signed-out state before this mounts.
  if (!user) return null;
  if (query.isLoading) return <LoadingBlock />;
  const order = query.data;
  if (query.error || !order)
    return (
      <ErrorBlock
        message={
          (query.error as Error)?.message ?? t("attendee.orders.notFound")
        }
        retry={() => void query.refetch()}
      />
    );
  const money = (value: number) => formatKzt(value, i18n.language);
  const closed = order.status === "refunded" || order.status === "cancelled";
  const completed = order.status === "paid" || order.status === "free";
  const items = order.items ?? [];
  const payments = order.payments ?? [];
  const refunds = order.refunds ?? [];
  return (
    <ScrollView contentContainerClassName="gap-6 pb-28">
      <ScreenHeader
        backHref="/orders"
        backLabel={t("attendee.orders.backToOrders")}
        kicker={
          confirmed && completed
            ? t("attendee.orders.confirmationKicker")
            : t("attendee.orders.detailKicker")
        }
        title={t("attendee.orders.orderNumber", { number: order.order_number })}
        right={<StatusBadge status={order.status} />}
        subtitle={t("attendee.orders.placedOn", {
          date: formatDateTime(order.created_at, i18n.language, "medium"),
        })}
      />
      {confirmed && completed ? (
        <DarkCard className="gap-4 p-6" accessibilityRole="alert">
          <View className="flex-row flex-wrap items-center gap-4">
            <View className="h-16 w-16 items-center justify-center rounded-3xl bg-mint">
              <Icon name="check" size={32} strokeWidth={3} />
            </View>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-3xl font-extrabold tracking-tight text-white">
                {t("attendee.orders.confirmedTitle")}
              </Text>
              <Text className="text-white/80">
                {t("attendee.orders.confirmedBody", { count: items.length })}
              </Text>
            </View>
          </View>
          <View className="flex-row flex-wrap items-center justify-between gap-3 rounded-3xl bg-white/10 p-4">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-bold text-white">
                {order.event_title ?? t("attendee.orders.unknownEvent")}
              </Text>
              <Text className="text-xs text-white/65">{t("common.demo")}</Text>
            </View>
            <Link href="/tickets" asChild>
              <Pressable
                accessibilityRole="link"
                className="min-h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-mint px-5 active:opacity-80"
              >
                <Icon name="ticket" size={18} />
                <Text className="font-bold text-ink">
                  {t("attendee.orders.viewTickets")}
                </Text>
              </Pressable>
            </Link>
          </View>
        </DarkCard>
      ) : null}
      {closed ? (
        <Surface className="gap-2 border-red-100 bg-red-50">
          <Text className="text-lg font-extrabold text-danger">
            {t(`attendee.orders.closedTitle.${order.status}`)}
          </Text>
          <Text className="text-ink">
            {t(`attendee.orders.closedNote.${order.status}`)}
          </Text>
          {order.event_status === "cancelled" ? (
            <Text className="text-ink">
              {t("attendee.orders.eventCancelled")}
            </Text>
          ) : null}
        </Surface>
      ) : null}
      <View className="flex-row flex-wrap items-start gap-6">
        <View className="min-w-0 flex-[2] basis-80 gap-6">
          <Surface className="gap-3">
            <CardHeading icon="calendar" title={t("attendee.orders.eventSection")} />
            <Text className="text-2xl font-extrabold tracking-tight text-ink">
              {order.event_title ?? t("attendee.orders.unknownEvent")}
            </Text>
            {order.event_status && order.event_status !== "published" ? (
              <StatusBadge status={order.event_status} />
            ) : null}
            {order.event_starts_at ? (
              <Text className="text-ink">
                {formatEventDateTime(
                  order.event_starts_at,
                  order.event_timezone,
                  i18n.language,
                  "full",
                )}
              </Text>
            ) : null}
            {order.venue_name ? (
              <Text className="text-muted">
                {order.venue_name}
                {order.venue_address
                  ? ` · ${placeText(order.venue_address, i18n.language)}`
                  : ""}
              </Text>
            ) : null}
            <View className="self-start">
              <LinkButton
                href={{
                  pathname: "/events/[id]",
                  params: { id: order.event_id },
                }}
                label={t("common.viewEvent")}
              />
            </View>
          </Surface>
          <Surface className="gap-4">
            <CardHeading
              icon="ticket"
              title={t("attendee.orders.itemsSection", { count: items.length })}
            />
            {items.map((item) => (
              <View key={item.id} className="gap-1 rounded-2xl bg-canvas p-4">
                <View className="flex-row flex-wrap justify-between gap-3">
                  <Text className="min-w-40 flex-1 font-bold text-ink">
                    {item.ticket_type_name}
                  </Text>
                  <Text className="font-bold text-ink">
                    {item.unit_price_tiyin
                      ? money(item.unit_price_tiyin)
                      : t("common.free")}
                  </Text>
                </View>
                <Text className="text-sm text-ink">
                  {t("attendee.attendeeLine", { name: item.attendee_name })}
                </Text>
                {item.seat_label ? (
                  <Text className="text-sm text-ink">
                    {t("attendee.seatLine", { seat: item.seat_label })}
                  </Text>
                ) : null}
                {item.ticket_code ? (
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="font-mono text-xs text-muted">
                      {item.ticket_code}
                    </Text>
                    {item.ticket_status ? (
                      <StatusBadge status={item.ticket_status} />
                    ) : null}
                  </View>
                ) : null}
              </View>
            ))}
            {items.length === 0 ? (
              <Text className="text-muted">{t("attendee.orders.noItems")}</Text>
            ) : null}
          </Surface>
          <Surface className="gap-3">
            <CardHeading icon="card" title={t("attendee.orders.paymentSection")} />
            <Text className="text-sm text-muted">{t("common.demo")}</Text>
            {payments.length === 0 ? (
              <Text className="text-ink">
                {order.total_tiyin
                  ? t("attendee.orders.noPayments")
                  : t("attendee.orders.freeNoPayment")}
              </Text>
            ) : null}
            {payments.map((payment) => (
              <View
                key={payment.id}
                className="flex-row flex-wrap items-center justify-between gap-3"
              >
                <View className="min-w-40 flex-1">
                  <Text className="font-bold text-ink">
                    {money(payment.amount_tiyin)}
                  </Text>
                  <Text className="text-xs text-muted">
                    {formatDateTime(payment.created_at, i18n.language, "medium")}
                    {payment.provider_reference
                      ? ` · ${payment.provider_reference}`
                      : ""}
                  </Text>
                </View>
                <StatusBadge status={payment.status} />
              </View>
            ))}
            {refunds.length ? (
              <View className="gap-2 border-t border-line pt-3">
                <Text className="font-black text-ink">
                  {t("attendee.orders.refundsTitle")}
                </Text>
                {refunds.map((refund) => (
                  <View key={refund.id} className="gap-1">
                    <View className="flex-row flex-wrap items-center justify-between gap-3">
                      <Text className="font-bold text-ink">
                        {money(refund.amount_tiyin)}
                      </Text>
                      <StatusBadge status={refund.status} />
                    </View>
                    <Text className="text-xs text-muted">
                      {formatDateTime(refund.created_at, i18n.language, "medium")}
                    </Text>
                    {refund.reason ? (
                      <Text className="text-sm text-ink">
                        {t("attendee.orders.refundReason", {
                          reason: refund.reason,
                        })}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </Surface>
          {order.refund_policy ? (
            <Surface className="gap-2">
              <CardHeading icon="receipt" title={t("common.refundPolicy")} />
              <Text className="leading-6 text-muted">
                {eventContentText(order.refund_policy, i18n.language)}
              </Text>
            </Surface>
          ) : null}
        </View>
        <View className="min-w-72 flex-1 gap-6">
          <Surface className="gap-3">
            <CardHeading icon="receipt" title={t("attendee.orders.totalsSection")} />
            <Row label={t("ui.subtotal")} value={money(order.subtotal_tiyin)} />
            <Row
              label={
                order.campaign?.code
                  ? `${t("ui.discount")} (${order.campaign.code})`
                  : t("ui.discount")
              }
              value={`− ${money(order.discount_tiyin)}`}
            />
            <Row
              label={t("attendee.orders.processingFee")}
              value={money(order.processing_fee_tiyin)}
            />
            <Text className="text-xs text-muted">
              {t("attendee.orders.processingFeeHelp")}
            </Text>
            <View className="border-t border-dashed border-line pt-3">
              <Row
                strong
                label={t("attendee.orders.total")}
                value={money(order.total_tiyin)}
              />
            </View>
            {order.refunded_tiyin ? (
              <Row
                label={t("attendee.orders.refunded")}
                value={money(order.refunded_tiyin)}
              />
            ) : null}
          </Surface>
          {completed ? (
            <Surface className="gap-3">
              <CardHeading icon="qr" title={t("attendee.orders.ticketsSection")} />
              <Text className="text-sm text-muted">
                {t("attendee.orders.ticketsHelp")}
              </Text>
              <LinkButton
                primary
                href="/tickets"
                label={t("attendee.orders.viewTickets")}
              />
            </Surface>
          ) : null}
          <Surface className="gap-3">
            <CardHeading icon="calendar" title={t("common.calendar")} />
            <CalendarActions
              calendar={order.calendar}
              icsPath={`/orders/${order.id}/calendar.ics`}
              filename={`${order.order_number}.ics`}
            />
          </Surface>
          <Surface className="gap-3">
            <CardHeading icon="help" title={t("attendee.needHelp")} />
            <Text className="text-sm text-muted">
              {t("attendee.orders.supportHelp")}
            </Text>
            <LinkButton
              href={{
                pathname: "/support",
                params: { order_id: order.id, event_id: order.event_id },
              }}
              label={t("attendee.contactSupport")}
            />
          </Surface>
        </View>
      </View>
    </ScrollView>
  );
}

export default function OrderPage() {
  return (
    <RequireAuth>
      <OrderContent />
    </RequireAuth>
  );
}
