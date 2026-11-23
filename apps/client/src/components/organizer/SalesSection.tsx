import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  ErrorBlock,
  LabeledValue,
  LoadingBlock,
  Metric,
  Surface,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/utils/date";
import { formatKzt } from "@/utils/format";

import {
  Badge,
  ChoiceGroup,
  DemoNotice,
  errorMessage,
  Fact,
  isForbidden,
  Muted,
  Pager,
  PermissionNotice,
  SectionTitle,
} from "./common";
import { HeroStats } from "./design";
import type { Analytics, Paged, PaymentRow, PayoutSummary } from "./types";
import { eventKey } from "./useEventAccess";

const PAGE = 20;
const PAYMENT_STATUSES = [
  "all",
  "succeeded",
  "failed",
  "timed_out",
  "refunded",
  "pending",
] as const;

/** Sales figures, payouts and the payment ledger of one event. */
export function SalesSection({
  eventId,
  analytics,
  analyticsLoading,
}: {
  eventId: string;
  analytics: Analytics | undefined;
  analyticsLoading?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const money = (value: number | undefined) =>
    formatKzt(value ?? 0, i18n.language);
  const [status, setStatus] =
    useState<(typeof PAYMENT_STATUSES)[number]>("all");
  const [offset, setOffset] = useState(0);
  const payouts = useQuery({
    queryKey: eventKey(eventId, "payouts"),
    queryFn: () => apiFetch<PayoutSummary>(`/events/${eventId}/payouts`),
  });
  const payments = useQuery({
    queryKey: eventKey(eventId, "payments", status, offset),
    queryFn: () =>
      apiFetch<Paged<PaymentRow>>(
        `/events/${eventId}/payments?limit=${PAGE}&offset=${offset}${status === "all" ? "" : `&status=${status}`}`,
      ),
    placeholderData: keepPreviousData,
  });
  if (isForbidden(payouts.error)) return <PermissionNotice />;
  const kpi = analytics?.kpis;
  return (
    <View className="gap-5">
      {analyticsLoading ? <LoadingBlock /> : null}
      {kpi ? (
        <HeroStats
          kicker={t("organizer.sales.figures")}
          items={[
            {
              label: t("organizer.analytics.sold"),
              value: String(kpi.tickets_sold ?? 0),
            },
            {
              label: t("organizer.sales.gross"),
              value: money(kpi.gross_sales_tiyin),
            },
            {
              label: t("organizer.sales.net"),
              value: money(kpi.organizer_net_tiyin),
            },
          ]}
        >
          <Text className="text-xs text-white/60">
            {t("organizer.sales.netHint")}
          </Text>
        </HeroStats>
      ) : null}
      {kpi ? (
        <View className="flex-row flex-wrap gap-3">
          <Metric
            icon="receipt"
            label={t("organizer.sales.gross")}
            value={money(kpi.gross_sales_tiyin)}
          />
          <Metric
            icon="ticket"
            label={t("organizer.sales.discounts")}
            value={money(kpi.discounts_tiyin)}
          />
          <Metric
            icon="arrow-right"
            label={t("organizer.sales.refunds")}
            value={money(kpi.refunds_tiyin)}
          />
          <Metric
            icon="card"
            label={t("organizer.sales.fees")}
            value={money(kpi.processing_fees_tiyin)}
          />
          <Metric
            icon="check"
            label={t("organizer.sales.net")}
            value={money(kpi.organizer_net_tiyin)}
            hint={t("organizer.sales.netHint")}
          />
          <Metric
            icon="calendar"
            label={t("organizer.sales.estimatedPayout")}
            value={money(kpi.estimated_payout_tiyin)}
          />
        </View>
      ) : null}
      <DemoNotice />

      <Surface className="gap-3">
        <SectionTitle>{t("organizer.sales.payouts")}</SectionTitle>
        {payouts.isLoading ? <LoadingBlock /> : null}
        {payouts.error ? (
          <ErrorBlock
            message={errorMessage(payouts.error)}
            retry={() => void payouts.refetch()}
          />
        ) : null}
        {payouts.data ? (
          <>
            <View className="flex-row flex-wrap gap-x-6 gap-y-3">
              <LabeledValue
                size="lg"
                label={t("organizer.sales.estimatedPayout")}
                value={money(payouts.data.estimated_payout_tiyin)}
              />
              <LabeledValue
                size="lg"
                label={t("organizer.sales.scheduled")}
                value={money(payouts.data.scheduled_tiyin)}
              />
              <LabeledValue
                size="lg"
                label={t("organizer.sales.paidOut")}
                value={money(payouts.data.paid_tiyin)}
              />
              <LabeledValue
                size="lg"
                label={t("organizer.sales.eligibleAt")}
                value={
                  payouts.data.eligible_at
                    ? formatDateTime(
                        payouts.data.eligible_at,
                        i18n.language,
                        "medium",
                      )
                    : t("organizer.common.notSet")
                }
              />
            </View>
            {payouts.data.items.length === 0 ? (
              <Muted>{t("organizer.sales.noPayouts")}</Muted>
            ) : null}
            {payouts.data.items.map((item) => (
              <View
                key={item.id}
                className="flex-row flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-canvas/60 p-4"
              >
                <View className="min-w-52 flex-1 gap-1">
                  <Text className="font-medium text-ink">
                    {money(item.amount_tiyin)}
                  </Text>
                  <Fact
                    label={t("organizer.sales.eligibleAt")}
                    value={
                      item.eligible_at
                        ? formatDateTime(
                            item.eligible_at,
                            i18n.language,
                            "medium",
                          )
                        : t("organizer.common.notSet")
                    }
                  />
                  {item.paid_at ? (
                    <Fact
                      label={t("organizer.sales.paidAt")}
                      value={formatDateTime(
                        item.paid_at,
                        i18n.language,
                        "medium",
                      )}
                    />
                  ) : null}
                </View>
                <Badge
                  status={item.status}
                  tone={item.status.startsWith("paid") ? "good" : "warn"}
                />
              </View>
            ))}
          </>
        ) : null}
      </Surface>

      <Surface className="gap-3">
        <SectionTitle>{t("organizer.sales.payments")}</SectionTitle>
        <ChoiceGroup
          label={t("organizer.common.filterStatus")}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setOffset(0);
          }}
          options={PAYMENT_STATUSES.map((item) => ({
            value: item,
            label:
              item === "all"
                ? t("organizer.common.all")
                : t(`organizer.statuses.${item}`, {
                    defaultValue: t(`status.${item}`),
                  }),
          }))}
        />
        {payments.isLoading ? <LoadingBlock /> : null}
        {payments.error ? (
          <ErrorBlock
            message={errorMessage(payments.error)}
            retry={() => void payments.refetch()}
          />
        ) : null}
        {payments.data?.items.length === 0 ? (
          <Muted>{t("organizer.sales.noPayments")}</Muted>
        ) : null}
        {payments.data?.items.map((payment) => (
          <View
            key={payment.id}
            className="flex-row flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-canvas/60 p-4"
          >
            <View className="min-w-60 flex-1 gap-1">
              <Text className="font-medium text-ink">
                {money(payment.amount_tiyin)} ·{" "}
                {t(`organizer.sales.kinds.${payment.kind}`, {
                  defaultValue: payment.kind.replaceAll("_", " "),
                })}
              </Text>
              <Fact
                label={t("organizer.sales.payer")}
                value={`${payment.payer_name ?? "—"} · ${payment.payer_email ?? "—"}`}
              />
              <Fact
                label={t("organizer.sales.orderNumber")}
                value={payment.order_number ?? t("organizer.sales.noOrder")}
              />
              <Fact
                label={t("organizer.sales.reference")}
                value={payment.provider_reference}
              />
              {payment.failure_reason ? (
                <Fact
                  label={t("organizer.sales.failureReason")}
                  value={t(
                    `organizer.sales.failureReasons.${payment.failure_reason}`,
                    { defaultValue: payment.failure_reason },
                  )}
                />
              ) : null}
              <Muted>
                {formatDateTime(payment.created_at, i18n.language, "medium")}
              </Muted>
            </View>
            <Badge status={payment.status} />
          </View>
        ))}
        {payments.data ? (
          <Pager
            offset={offset}
            limit={PAGE}
            total={payments.data.total}
            count={payments.data.items.length}
            onChange={setOffset}
          />
        ) : null}
      </Surface>
    </View>
  );
}
