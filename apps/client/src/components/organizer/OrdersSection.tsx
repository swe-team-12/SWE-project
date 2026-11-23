import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, ErrorBlock, Field, LoadingBlock, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/utils/date";
import { formatKzt, newIdempotencyKey } from "@/utils/format";

import {
  Badge,
  ChoiceGroup,
  ConfirmButton,
  errorMessage,
  ErrorText,
  Fact,
  isForbidden,
  Muted,
  Pager,
  PermissionNotice,
  SectionTitle,
  SuccessText,
} from "./common";
import type { EventOrder, OrgEvent, Paged, RefundRow } from "./types";
import { eventKey } from "./useEventAccess";

const PAGE = 20;
const ORDER_STATUSES = ["all", "paid", "free", "refunded", "cancelled"] as const;

/** Orders (buyer, items, full refund) and the refund ledger. */
export function OrdersSection({ event }: { event: OrgEvent }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const money = (value: number) => formatKzt(value, i18n.language);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof ORDER_STATUSES)[number]>("all");
  const [refundOffset, setRefundOffset] = useState(0);
  const [notice, setNotice] = useState("");
  const orders = useInfiniteQuery({
    queryKey: eventKey(event.id, "orders", query, status),
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (pageParam) params.set("cursor", pageParam);
      if (query) params.set("q", query);
      if (status !== "all") params.set("status", status);
      return apiFetch<{ items: EventOrder[]; next_cursor: string | null }>(
        `/events/${event.id}/orders?${params.toString()}`,
      );
    },
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
  const refunds = useQuery({
    queryKey: eventKey(event.id, "refunds", refundOffset),
    queryFn: () =>
      apiFetch<Paged<RefundRow> & { total_amount_tiyin: number }>(
        `/events/${event.id}/refunds?limit=${PAGE}&offset=${refundOffset}`,
      ),
    placeholderData: keepPreviousData,
  });
  const refund = useMutation({
    mutationFn: ({ order, reason }: { order: EventOrder; reason: string }) =>
      apiFetch<{ amount_tiyin: number }>(
        `/orders/${order.id}/refund?reason=${encodeURIComponent(reason)}&idempotency_key=${encodeURIComponent(newIdempotencyKey("refund"))}`,
        { method: "POST" },
      ),
    onSuccess: async (result, { order }) => {
      setNotice(
        t("organizer.orders.refundDone", {
          number: order.order_number,
          amount: money(result.amount_tiyin),
        }),
      );
      await client.invalidateQueries({ queryKey: eventKey(event.id) });
    },
  });
  if (isForbidden(orders.error)) return <PermissionNotice />;
  const rows = orders.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <View className="gap-5">
      <Surface className="gap-4">
        <SectionTitle>{t("common.orders")}</SectionTitle>
        <View className="flex-row flex-wrap items-end gap-3">
          <View className="min-w-60 flex-1">
            <Field
              label={t("organizer.orders.search")}
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={() => setQuery(search.trim())}
              returnKeyType="search"
              autoCapitalize="none"
              icon="search"
            />
          </View>
          <Button
            label={t("ui.search")}
            variant="dark"
            size="lg"
            onPress={() => setQuery(search.trim())}
          />
        </View>
        <ChoiceGroup
          label={t("organizer.common.filterStatus")}
          value={status}
          onChange={setStatus}
          options={ORDER_STATUSES.map((item) => ({
            value: item,
            label:
              item === "all" ? t("organizer.common.all") : t(`status.${item}`),
          }))}
        />
        {notice ? <SuccessText>{notice}</SuccessText> : null}
        <ErrorText error={refund.error} />
        {orders.isLoading ? <LoadingBlock /> : null}
        {orders.error ? (
          <ErrorBlock
            message={errorMessage(orders.error)}
            retry={() => void orders.refetch()}
          />
        ) : null}
        {orders.data && rows.length === 0 ? (
          <Muted>{t("ui.noOrders")}</Muted>
        ) : null}
        {rows.map((order) => (
          <View
            key={order.id}
            testID={`order-${order.id}`}
            className="gap-2 rounded-2xl border border-line bg-canvas/60 p-4"
          >
            <View className="flex-row flex-wrap items-start justify-between gap-3">
              <View className="min-w-60 flex-1 gap-1">
                <Text className="font-medium text-ink">{order.order_number}</Text>
                <Fact
                  label={t("organizer.orders.buyer")}
                  value={`${order.buyer_name ?? "—"} · ${order.buyer_email ?? "—"}`}
                />
                <Fact
                  label={t("organizer.orders.total")}
                  value={`${money(order.total_tiyin)} (${t("ui.organizerNet", { amount: money(order.organizer_net_tiyin) })})`}
                />
                {order.discount_tiyin > 0 ? (
                  <Fact
                    label={t("ui.discount")}
                    value={money(order.discount_tiyin)}
                  />
                ) : null}
                <Muted>
                  {formatDateTime(order.created_at, i18n.language, "medium")}
                </Muted>
              </View>
              <Badge status={order.status} />
            </View>
            {(order.items ?? []).map((line) => (
              <Text key={line.id} className="pl-3 text-sm text-ink">
                • {line.ticket_type_name} — {line.attendee_name} (
                {line.attendee_email})
                {line.seat_label ? ` · ${line.seat_label}` : ""}
                {line.ticket_code ? ` · ${line.ticket_code}` : ""}
              </Text>
            ))}
            {["paid", "free"].includes(order.status) &&
            event.status !== "cancelled" ? (
              <View className="flex-row flex-wrap">
                <ConfirmButton
                  label={t("organizer.orders.refund", {
                    number: order.order_number,
                  })}
                  message={t("organizer.orders.refundConfirm", {
                    number: order.order_number,
                    amount: money(order.total_tiyin),
                  })}
                  confirmLabel={t("ui.fullRefund")}
                  reason={{
                    label: t("organizer.orders.refundReason"),
                    minLength: 5,
                  }}
                  loading={
                    refund.isPending && refund.variables?.order.id === order.id
                  }
                  onConfirm={(reason) => {
                    setNotice("");
                    refund.mutate({ order, reason });
                  }}
                  testID={`refund-${order.id}`}
                />
              </View>
            ) : null}
          </View>
        ))}
        {orders.hasNextPage ? (
          <View className="flex-row">
            <Button
              label={t("organizer.common.loadMore")}
              variant="secondary"
              loading={orders.isFetchingNextPage}
              onPress={() => void orders.fetchNextPage()}
            />
          </View>
        ) : null}
      </Surface>

      <Surface className="gap-3">
        <SectionTitle>{t("organizer.orders.refunds")}</SectionTitle>
        {refunds.isLoading ? <LoadingBlock /> : null}
        {refunds.error ? (
          <ErrorBlock
            message={errorMessage(refunds.error)}
            retry={() => void refunds.refetch()}
          />
        ) : null}
        {refunds.data ? (
          <Fact
            label={t("organizer.orders.refundTotal", {
              count: refunds.data.total,
            })}
            value={money(refunds.data.total_amount_tiyin)}
          />
        ) : null}
        {refunds.data?.items.length === 0 ? (
          <Muted>{t("organizer.orders.noRefunds")}</Muted>
        ) : null}
        {refunds.data?.items.map((item) => (
          <View
            key={item.id}
            className="flex-row flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-canvas/60 p-4"
          >
            <View className="min-w-60 flex-1 gap-1">
              <Text className="font-medium text-ink">
                {money(item.amount_tiyin)} · {item.order_number ?? "—"}
              </Text>
              <Fact
                label={t("organizer.orders.buyer")}
                value={`${item.buyer_name ?? "—"} · ${item.buyer_email ?? "—"}`}
              />
              <Fact
                label={t("organizer.orders.refundReason")}
                value={item.reason}
              />
              <Fact
                label={t("organizer.orders.refundedBy")}
                value={item.initiated_by_name ?? t("organizer.history.system")}
              />
              <Muted>
                {formatDateTime(item.created_at, i18n.language, "medium")}
              </Muted>
            </View>
            <Badge status={item.status} />
          </View>
        ))}
        {refunds.data ? (
          <Pager
            offset={refundOffset}
            limit={PAGE}
            total={refunds.data.total}
            count={refunds.data.items.length}
            onChange={setRefundOffset}
          />
        ) : null}
      </Surface>
    </View>
  );
}
