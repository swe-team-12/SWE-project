import { useQuery } from "@tanstack/react-query";
import { type Href, Link } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { RequireAuth } from "@/components/RequireAuth";
import { Icon, palette } from "@/components/icons";
import {
  ErrorBlock,
  LoadingBlock,
  Notice,
  ScreenHeader,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { formatEventDateTime } from "@/lib/eventTime";
import { summarizeOrderItems } from "@/lib/orderSummary";
import { useAuth } from "@/providers/AuthProvider";
import type { OrderInfo } from "@/types";
import { formatDateTime } from "@/utils/date";
import { formatKzt } from "@/utils/format";

function OrdersContent() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiFetch<OrderInfo[]>("/orders"),
    enabled: !!user,
  });
  // RequireAuth renders the signed-out state before this mounts.
  if (!user) return null;
  return (
    <ScrollView contentContainerClassName="gap-6 pb-28">
      <ScreenHeader kicker={t("ui.account")} title={t("ui.orderHistory")} />
      {query.isLoading ? <LoadingBlock /> : null}
      {query.error ? (
        <ErrorBlock
          message={(query.error as Error).message}
          retry={() => void query.refetch()}
        />
      ) : null}
      <View className="flex-row flex-wrap gap-5">
        {query.data?.map((order) => {
          const closed =
            order.status === "refunded" || order.status === "cancelled";
          return (
            <Surface key={order.id} className="min-w-72 flex-1 basis-96 gap-4">
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <View className="flex-row items-center gap-2 rounded-full bg-canvas px-3 py-1">
                  <Icon name="receipt" size={14} color={palette.muted} />
                  <Text className="font-mono text-xs font-bold text-ink">
                    {order.order_number}
                  </Text>
                </View>
                <StatusBadge status={order.status} />
              </View>
              <Text className="text-2xl font-extrabold leading-tight tracking-tight text-ink">
                {order.event_title ?? t("attendee.orders.unknownEvent")}
              </Text>
              <View className="gap-2">
                {order.event_starts_at ? (
                  <View className="flex-row items-center gap-2">
                    <Icon name="calendar" size={16} color={palette.brand} />
                    <Text className="flex-1 text-muted">
                      {formatEventDateTime(
                        order.event_starts_at,
                        order.event_timezone,
                        i18n.language,
                      )}
                    </Text>
                  </View>
                ) : null}
                {order.venue_name ? (
                  <View className="flex-row items-center gap-2">
                    <Icon name="pin" size={16} color={palette.brand} />
                    <Text className="flex-1 text-muted">{order.venue_name}</Text>
                  </View>
                ) : null}
              </View>
              <View className="gap-1 rounded-2xl bg-canvas p-4">
                {summarizeOrderItems(order.items ?? []).map((line) => (
                  <Text key={line.name} className="font-semibold text-ink">
                    {line.count} × {line.name}
                  </Text>
                ))}
                <Text className="text-sm text-muted">
                  {t("attendee.orders.placedOn", {
                    date: formatDateTime(
                      order.created_at,
                      i18n.language,
                      "medium",
                    ),
                  })}
                </Text>
              </View>
              {closed ? (
                <Notice tone="danger">
                  {t(`attendee.orders.closedNote.${order.status}`)}
                </Notice>
              ) : null}
              {order.event_status === "cancelled" ? (
                <Notice tone="danger">
                  {t("attendee.orders.eventCancelled")}
                </Notice>
              ) : null}
              <View className="flex-row flex-wrap items-center justify-between gap-3 border-t border-dashed border-line pt-4">
                <View>
                  <Text className="text-xs text-muted">
                    {t("attendee.orders.total")}
                  </Text>
                  <Text className="text-2xl font-extrabold tracking-tight text-ink">
                    {formatKzt(order.total_tiyin, i18n.language)}
                  </Text>
                </View>
                <Link href={`/orders/${order.id}` as Href} asChild>
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={t("attendee.orders.viewOrderLabel", {
                      number: order.order_number,
                    })}
                    className="min-h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-ink px-5 active:opacity-80"
                  >
                    <Text className="font-bold text-white">
                      {t("attendee.orders.viewOrder")}
                    </Text>
                    <Icon name="arrow-right" size={18} color={palette.white} />
                  </Pressable>
                </Link>
              </View>
            </Surface>
          );
        })}
      </View>
      {query.data?.length === 0 ? (
        <Surface tone="plain" className="items-center gap-4 py-12">
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-mintsoft">
            <Icon name="receipt" size={26} color={palette.brand} />
          </View>
          <Text className="text-center text-muted">{t("ui.noOrders")}</Text>
          <Link href="/" asChild>
            <Pressable
              accessibilityRole="link"
              className="min-h-12 justify-center rounded-2xl bg-mint px-5 active:opacity-80"
            >
              <Text className="font-bold text-ink">
                {t("attendee.browseEvents")}
              </Text>
            </Pressable>
          </Link>
        </Surface>
      ) : null}
    </ScrollView>
  );
}

export default function OrdersPage() {
  return (
    <RequireAuth>
      <OrdersContent />
    </RequireAuth>
  );
}
