import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BarChart, Funnel, LineChart } from "@/components/Charts";
import { Button, ErrorBlock, LoadingBlock, Metric, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { formatKzt } from "@/utils/format";

import {
  ChoiceGroup,
  DemoNotice,
  errorMessage,
  ErrorText,
  Fact,
  isForbidden,
  Muted,
  PermissionNotice,
  SectionTitle,
} from "./common";
import { DateTimeField } from "./DateTimeField";
import { parseDateInput } from "./dateTime";
import { HeroStats, ProgressMeter } from "./design";
import type { Analytics, OrgEvent } from "./types";
import { eventKey } from "./useEventAccess";

export interface AnalyticsFilter {
  start: string;
  end: string;
  ticketTypeId: string;
}

/** Query string for the analytics endpoint; empty when nothing is filtered. */
export function analyticsQuery(filter: AnalyticsFilter): string {
  const params = new URLSearchParams();
  if (filter.start) params.set("start", filter.start);
  if (filter.end) params.set("end", filter.end);
  if (filter.ticketTypeId && filter.ticketTypeId !== "all")
    params.set("ticket_type_id", filter.ticketTypeId);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The API reports percentages on a 0-100 scale; show one decimal at most. */
export function percentText(value: number | undefined): string {
  const number = Number(value ?? 0);
  return `${Math.round((Number.isFinite(number) ? number : 0) * 10) / 10}%`;
}

const EMPTY: AnalyticsFilter = { start: "", end: "", ticketTypeId: "all" };

/** KPI tiles, charts and tables with date-range and ticket-type filters. */
export function AnalyticsSection({ event }: { event: OrgEvent }) {
  const { t, i18n } = useTranslation();
  const money = (value: number | undefined) =>
    formatKzt(value ?? 0, i18n.language);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [ticketTypeId, setTicketTypeId] = useState("all");
  const [applied, setApplied] = useState<AnalyticsFilter>(EMPTY);
  const [rangeError, setRangeError] = useState("");
  const analytics = useQuery({
    queryKey: eventKey(
      event.id,
      "analytics",
      applied.start,
      applied.end,
      applied.ticketTypeId,
    ),
    queryFn: () =>
      apiFetch<Analytics>(
        `/events/${event.id}/analytics${analyticsQuery(applied)}`,
      ),
    placeholderData: keepPreviousData,
  });
  if (isForbidden(analytics.error)) return <PermissionNotice />;
  const apply = (nextTicketType = ticketTypeId) => {
    const from = start ? parseDateInput(start) : "";
    const to = end ? parseDateInput(end) : "";
    if (from === null || to === null) {
      setRangeError(t("organizer.validation.dateInvalid"));
      return;
    }
    if (from && to && from > to) {
      setRangeError(t("organizer.validation.rangeOrder"));
      return;
    }
    setRangeError("");
    setApplied({ start: from, end: to, ticketTypeId: nextTicketType });
  };
  const reset = () => {
    setStart("");
    setEnd("");
    setTicketTypeId("all");
    setRangeError("");
    setApplied(EMPTY);
  };
  const data = analytics.data;
  const kpi = data?.kpis;
  const filtered =
    !!applied.start || !!applied.end || applied.ticketTypeId !== "all";
  return (
    <View className="gap-5">
      <Surface className="gap-4">
        <SectionTitle>{t("organizer.analytics.filters")}</SectionTitle>
        <View className="flex-row flex-wrap gap-3">
          <View className="min-w-52 flex-1">
            <DateTimeField
              mode="date"
              label={t("organizer.common.from")}
              value={start}
              onChange={setStart}
              testID="analytics-start"
            />
          </View>
          <View className="min-w-52 flex-1">
            <DateTimeField
              mode="date"
              label={t("organizer.common.to")}
              value={end}
              onChange={setEnd}
              testID="analytics-end"
            />
          </View>
        </View>
        {event.ticket_types.length > 0 ? (
          <ChoiceGroup
            label={t("organizer.common.ticketType")}
            value={ticketTypeId}
            onChange={(value) => {
              setTicketTypeId(value);
              apply(value);
            }}
            options={[
              { value: "all", label: t("organizer.common.all") },
              ...event.ticket_types.map((item) => ({
                value: item.id,
                label: item.name,
              })),
            ]}
          />
        ) : null}
        {rangeError ? <ErrorText error={new Error(rangeError)} /> : null}
        <View className="flex-row flex-wrap gap-3">
          <Button
            iconName="filter"
            label={t("organizer.common.apply")}
            onPress={() => apply()}
            testID="analytics-apply"
          />
          {filtered ? (
            <Button
              label={t("organizer.common.reset")}
              variant="secondary"
              onPress={reset}
            />
          ) : null}
        </View>
        <Muted>
          {filtered
            ? t("organizer.analytics.filteredNote")
            : t("organizer.analytics.allTimeNote")}
        </Muted>
      </Surface>

      {analytics.isLoading ? <LoadingBlock /> : null}
      {analytics.error ? (
        <ErrorBlock
          message={errorMessage(analytics.error)}
          retry={() => void analytics.refetch()}
        />
      ) : null}

      {kpi ? (
        <View className="gap-4">
          <HeroStats
            kicker={t("organizer.analytics.kpis")}
            items={[
              {
                label: t("organizer.analytics.sold"),
                value: `${kpi.tickets_sold ?? 0} / ${kpi.capacity ?? 0}`,
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
            <ProgressMeter
              tone="dark"
              label={t("organizer.analytics.percentSold")}
              value={kpi.tickets_sold ?? 0}
              max={kpi.capacity ?? 0}
              valueText={percentText(kpi.percentage_sold)}
            />
          </HeroStats>
          <DemoNotice />
          <View className="flex-row flex-wrap gap-3" testID="analytics-kpis">
            <Metric
              icon="user"
              label={t("organizer.analytics.capacity")}
              value={String(kpi.capacity ?? 0)}
            />
            <Metric
              icon="ticket"
              label={t("organizer.analytics.sold")}
              value={String(kpi.tickets_sold ?? 0)}
            />
            <Metric
              icon="plus"
              label={t("organizer.analytics.remaining")}
              value={String(kpi.tickets_remaining ?? 0)}
            />
            <Metric
              icon="sparkle"
              label={t("organizer.analytics.percentSold")}
              value={percentText(kpi.percentage_sold)}
            />
            <Metric
              icon="receipt"
              label={t("organizer.sales.gross")}
              value={money(kpi.gross_sales_tiyin)}
            />
            <Metric
              icon="card"
              label={t("organizer.sales.discounts")}
              value={money(kpi.discounts_tiyin)}
            />
            <Metric
              icon="arrow-right"
              label={t("organizer.sales.refunds")}
              value={money(kpi.refunds_tiyin)}
            />
            <Metric
              icon="check"
              label={t("organizer.sales.net")}
              value={money(kpi.organizer_net_tiyin)}
            />
            <Metric
              icon="qr"
              label={t("organizer.analytics.checkedIn")}
              value={String(kpi.checked_in ?? 0)}
            />
            <Metric
              icon="close"
              label={t("organizer.analytics.absent")}
              value={String(kpi.absent ?? 0)}
            />
            <Metric
              icon="clock"
              label={t("organizer.analytics.checkInRate")}
              value={percentText(kpi.check_in_rate)}
            />
          </View>
        </View>
      ) : null}

      {data ? (
        <>
          <Surface className="gap-3">
            <SectionTitle>{t("organizer.analytics.salesOverTime")}</SectionTitle>
            {data.sales_over_time.length === 0 ? (
              <Muted>{t("organizer.analytics.noSales")}</Muted>
            ) : (
              <LineChart
                points={data.sales_over_time.map((point) => ({
                  label: point.date,
                  value: point.revenue_tiyin,
                  formatted: `${money(point.revenue_tiyin)} · ${t("organizer.analytics.ticketsCount", { count: point.tickets })}`,
                }))}
              />
            )}
          </Surface>

          <Surface className="gap-3">
            <SectionTitle>
              {t("organizer.analytics.revenueByTicketType")}
            </SectionTitle>
            {data.ticket_types.length === 0 ? (
              <Muted>{t("organizer.tickets.empty")}</Muted>
            ) : (
              <>
                <BarChart
                  rows={data.ticket_types.map((row) => ({
                    label: row.name,
                    value: row.gross_revenue_tiyin ?? row.revenue_tiyin ?? 0,
                    formatted: money(
                      row.gross_revenue_tiyin ?? row.revenue_tiyin,
                    ),
                  }))}
                />
                {data.ticket_types.map((row) => (
                  <View
                    key={row.ticket_type_id ?? row.id}
                    className="gap-1 rounded-2xl border border-line bg-canvas/60 p-4"
                  >
                    <Text className="font-bold text-ink">{row.name}</Text>
                    <ProgressMeter
                      label={t("organizer.analytics.sold")}
                      value={row.sold}
                      max={row.quantity ?? row.capacity}
                      valueText={`${row.sold} / ${row.quantity ?? row.capacity} (${percentText(row.percent_sold)})`}
                    />
                    <View className="flex-row flex-wrap gap-x-5 gap-y-1">
                      <Fact
                        label={t("organizer.analytics.sold")}
                        value={`${row.sold} / ${row.quantity ?? row.capacity} (${percentText(row.percent_sold)})`}
                      />
                      <Fact
                        label={t("organizer.sales.gross")}
                        value={money(
                          row.gross_revenue_tiyin ?? row.revenue_tiyin,
                        )}
                      />
                      <Fact
                        label={t("status.refunded")}
                        value={String(row.refunded)}
                      />
                      <Fact
                        label={t("organizer.tickets.checkedIn")}
                        value={String(row.checked_in)}
                      />
                    </View>
                  </View>
                ))}
              </>
            )}
          </Surface>

          <Surface className="gap-3">
            <SectionTitle>
              {t("organizer.analytics.campaignPerformance")}
            </SectionTitle>
            {data.campaigns.length === 0 ? (
              <Muted>{t("organizer.campaigns.empty")}</Muted>
            ) : (
              <>
                <BarChart
                  rows={data.campaigns.map((row) => ({
                    label: row.name,
                    value: row.gross_tiyin,
                    formatted: money(row.gross_tiyin),
                  }))}
                />
                {data.campaigns.map((row) => (
                  <View
                    key={row.id}
                    className="gap-1 rounded-2xl border border-line bg-canvas/60 p-4"
                  >
                    <Text className="font-bold text-ink">
                      {row.name} · {row.code}
                    </Text>
                    <View className="flex-row flex-wrap gap-x-5 gap-y-1">
                      <Fact
                        label={t("organizer.campaigns.tickets")}
                        value={String(row.tickets)}
                      />
                      <Fact
                        label={t("organizer.sales.gross")}
                        value={money(row.gross_tiyin)}
                      />
                      <Fact
                        label={t("organizer.campaigns.discountGiven")}
                        value={money(row.discount_tiyin)}
                      />
                      <Fact
                        label={t("organizer.analytics.views")}
                        value={String(row.views)}
                      />
                      <Fact
                        label={t("organizer.analytics.conversion")}
                        value={percentText(row.conversion_rate)}
                      />
                    </View>
                  </View>
                ))}
              </>
            )}
          </Surface>

          <Surface className="gap-3">
            <SectionTitle>{t("organizer.analytics.funnel")}</SectionTitle>
            <Funnel
              values={[
                {
                  label: t("organizer.analytics.eventViews"),
                  value: data.traffic_funnel.event_views,
                },
                {
                  label: t("organizer.analytics.campaignViews"),
                  value: data.traffic_funnel.campaign_views,
                },
                {
                  label: t("organizer.analytics.checkoutStarts"),
                  value: data.traffic_funnel.checkout_starts,
                },
                {
                  label: t("organizer.analytics.purchases"),
                  value: data.traffic_funnel.demo_purchases,
                },
              ]}
            />
            <Muted>{t("organizer.analytics.funnelNote")}</Muted>
          </Surface>
        </>
      ) : null}
    </View>
  );
}
