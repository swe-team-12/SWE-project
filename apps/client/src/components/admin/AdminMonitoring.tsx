import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, Field, StatusBadge, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/utils/date";
import { formatKzt } from "@/utils/format";

import {
  Chips,
  ConfirmPanel,
  errorText,
  EscalatedChip,
  eventManageHref,
  ListState,
  Meta,
  Notice,
  problemCode,
  Row,
  supportCaseHref,
  TextLink,
} from "./shared";

interface Person {
  id: string;
  display_name: string;
  email: string;
}

function useDate() {
  const { i18n } = useTranslation();
  return (value: string) => formatDateTime(value, i18n.language, "medium");
}

function EventLink({ id, title }: { id: string; title: string }) {
  const { t } = useTranslation();
  return (
    <TextLink
      href={eventManageHref(id)}
      label={title}
      accessibilityLabel={t("adminX.common.manageEvent", { title })}
    />
  );
}

function FailureReason({ reason }: { reason?: string | null }) {
  const { t } = useTranslation();
  if (!reason) return null;
  return (
    <Text className="text-sm font-medium text-danger">
      {t("adminX.payments.failure", {
        reason: t(`adminX.failureReason.${reason}`, { defaultValue: reason }),
      })}
    </Text>
  );
}

/** Text filter applied on submit so each keystroke does not hit the API. */
function SearchBox({
  label,
  initial,
  onSubmit,
}: {
  label: string;
  initial?: string;
  onSubmit(value: string): void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial ?? "");
  return (
    <View className="flex-row flex-wrap items-end gap-3">
      <View className="min-w-56 flex-1">
        <Field
          label={label}
          value={value}
          onChangeText={setValue}
          onSubmitEditing={() => onSubmit(value.trim())}
          returnKeyType="search"
        />
      </View>
      <Button
        label={t("adminX.common.apply")}
        variant="secondary"
        onPress={() => onSubmit(value.trim())}
      />
    </View>
  );
}

function queryString(params: Record<string, string | undefined>): string {
  const parts = Object.entries(params)
    .filter((entry): entry is [string, string] => !!entry[1])
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

// ---------------------------------------------------------------- payments

interface PaymentItem {
  id: string;
  kind: string;
  status: string;
  amount_tiyin: number;
  reference: string;
  failure_reason: string | null;
  created_at: string;
  event_id: string;
  event_title: string;
  order_number: string | null;
  payer_name: string;
  payer_email: string;
}

type PaymentStatus =
  | "all"
  | "problems"
  | "pending"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "refunded";
type PaymentKind = "all" | "ticket_purchase" | "event_activation";

export function AdminPayments({ initialQuery }: { initialQuery?: string }) {
  const { t, i18n } = useTranslation();
  const date = useDate();
  const [status, setStatus] = useState<PaymentStatus>("all");
  const [kind, setKind] = useState<PaymentKind>("all");
  const [q, setQ] = useState(initialQuery ?? "");
  const payments = useQuery({
    queryKey: ["admin-payments", status, kind, q],
    queryFn: () =>
      apiFetch<PaymentItem[]>(
        `/admin/payments${queryString({
          status:
            status === "all" || status === "problems" ? undefined : status,
          problems_only: status === "problems" ? "true" : undefined,
          kind: kind === "all" ? undefined : kind,
          q: q || undefined,
        })}`,
      ),
  });
  return (
    <Surface className="gap-4">
      <Text accessibilityRole="header" className="text-xl font-semibold text-ink">
        {t("adminX.payments.title")}
      </Text>
      <Meta>{t("adminX.payments.help")}</Meta>
      <Chips
        label={t("adminX.common.statusFilter")}
        value={status}
        onChange={setStatus}
        options={(
          [
            "all",
            "problems",
            "failed",
            "timed_out",
            "pending",
            "succeeded",
            "refunded",
          ] as const
        ).map((value) => ({
          value,
          label:
            value === "all"
              ? t("adminX.common.all")
              : value === "problems"
                ? t("adminX.payments.problemsOnly")
                : t(`status.${value}`),
        }))}
      />
      <Chips
        label={t("adminX.payments.kindFilter")}
        value={kind}
        onChange={setKind}
        options={(["all", "ticket_purchase", "event_activation"] as const).map(
          (value) => ({
            value,
            label:
              value === "all"
                ? t("adminX.common.all")
                : t(`adminX.paymentKind.${value}`),
          }),
        )}
      />
      <SearchBox
        key={initialQuery}
        label={t("adminX.payments.search")}
        initial={q}
        onSubmit={setQ}
      />
      <ListState
        loading={payments.isLoading}
        error={payments.error}
        retry={() => void payments.refetch()}
        empty={payments.data?.length === 0}
        emptyText={t("adminX.payments.empty")}
      />
      {payments.data?.map((item) => (
        <Row key={item.id} aside={<StatusBadge status={item.status} />}>
          <Text className="font-medium text-ink">
            {formatKzt(item.amount_tiyin, i18n.language)}
            {" · "}
            {t(`adminX.paymentKind.${item.kind}`, { defaultValue: item.kind })}
          </Text>
          <Text className="font-mono text-sm text-ink">{item.reference}</Text>
          <FailureReason reason={item.failure_reason} />
          <EventLink id={item.event_id} title={item.event_title} />
          {item.order_number ? (
            <Meta>
              {t("adminX.common.order", { number: item.order_number })}
            </Meta>
          ) : null}
          <Meta>
            {t("adminX.common.payer", {
              name: item.payer_name,
              email: item.payer_email,
            })}
          </Meta>
          <Meta>{date(item.created_at)}</Meta>
        </Row>
      ))}
    </Surface>
  );
}

// ----------------------------------------------------------------- refunds

interface RefundItem {
  id: string;
  status: string;
  amount_tiyin: number;
  reason: string;
  created_at: string;
  order_number: string;
  order_status: string;
  event_id: string;
  event_title: string;
  buyer_name: string;
  buyer_email: string;
  initiated_by: Person | null;
}

export function AdminRefunds() {
  const { t, i18n } = useTranslation();
  const date = useDate();
  const [q, setQ] = useState("");
  const refunds = useQuery({
    queryKey: ["admin-refunds", q],
    queryFn: () =>
      apiFetch<RefundItem[]>(
        `/admin/refunds${queryString({ q: q || undefined })}`,
      ),
  });
  return (
    <Surface className="gap-4">
      <Text accessibilityRole="header" className="text-xl font-semibold text-ink">
        {t("adminX.refunds.title")}
      </Text>
      <Meta>{t("adminX.refunds.help")}</Meta>
      <SearchBox label={t("adminX.refunds.search")} onSubmit={setQ} />
      <ListState
        loading={refunds.isLoading}
        error={refunds.error}
        retry={() => void refunds.refetch()}
        empty={refunds.data?.length === 0}
        emptyText={t("adminX.refunds.empty")}
      />
      {refunds.data?.map((item) => (
        <Row key={item.id} aside={<StatusBadge status={item.status} />}>
          <Text className="font-medium text-ink">
            {formatKzt(item.amount_tiyin, i18n.language)}
            {" · "}
            {t("adminX.common.order", { number: item.order_number })}
          </Text>
          <View className="flex-row flex-wrap items-center gap-2">
            <Meta>{t("adminX.refunds.orderStatus")}</Meta>
            <StatusBadge status={item.order_status} />
          </View>
          {item.reason ? (
            <Text className="text-ink">
              {t("adminX.refunds.reason", { reason: item.reason })}
            </Text>
          ) : null}
          <EventLink id={item.event_id} title={item.event_title} />
          <Meta>
            {t("adminX.common.buyer", {
              name: item.buyer_name,
              email: item.buyer_email,
            })}
          </Meta>
          <Meta>
            {t("adminX.refunds.initiatedBy", {
              name: item.initiated_by?.display_name ?? "—",
              date: date(item.created_at),
            })}
          </Meta>
        </Row>
      ))}
    </Surface>
  );
}

// ------------------------------------------------------------- activations

interface ActivationItem {
  id: string;
  event_id: string;
  event_title?: string;
  organizer_name?: string;
  organizer_email?: string;
  payer_name?: string;
  payer_email?: string;
  amount_tiyin: number;
  status: string;
  reference?: string;
  failure_reason?: string | null;
  paid_sales_active?: boolean;
  paid_sales_suspended?: boolean;
  created_at: string;
}

export function AdminActivations() {
  const { t, i18n } = useTranslation();
  const date = useDate();
  const activations = useQuery({
    queryKey: ["admin-activations"],
    queryFn: () => apiFetch<ActivationItem[]>("/admin/activation-payments"),
  });
  return (
    <Surface className="gap-4">
      <Text accessibilityRole="header" className="text-xl font-semibold text-ink">
        {t("ui.activationReview")}
      </Text>
      <Meta>{t("adminX.activations.help")}</Meta>
      <ListState
        loading={activations.isLoading}
        error={activations.error}
        retry={() => void activations.refetch()}
        empty={activations.data?.length === 0}
        emptyText={t("ui.noActivations")}
      />
      {activations.data?.map((item) => (
        <Row key={item.id} aside={<StatusBadge status={item.status} />}>
          <Text className="font-medium text-ink">
            {formatKzt(item.amount_tiyin, i18n.language)}
          </Text>
          <EventLink
            id={item.event_id}
            title={item.event_title ?? t("adminX.common.openEvent")}
          />
          <Meta>
            {t("adminX.common.organizer", {
              name: item.organizer_name ?? "—",
              email: item.organizer_email ?? "—",
            })}
          </Meta>
          {item.payer_email && item.payer_email !== item.organizer_email ? (
            <Meta>
              {t("adminX.common.payer", {
                name: item.payer_name ?? "—",
                email: item.payer_email,
              })}
            </Meta>
          ) : null}
          <FailureReason reason={item.failure_reason} />
          <Meta>
            {item.paid_sales_suspended
              ? t("adminX.paidSales.suspended")
              : item.paid_sales_active
                ? t("adminX.paidSales.active")
                : t("adminX.paidSales.inactive")}
          </Meta>
          {item.reference ? (
            <Text className="font-mono text-xs text-muted">
              {item.reference}
            </Text>
          ) : null}
          <Meta>{date(item.created_at)}</Meta>
        </Row>
      ))}
    </Surface>
  );
}

// ----------------------------------------------------------------- payouts

interface PayoutItem {
  id: string;
  event_id: string;
  event_title?: string;
  organizer_name?: string;
  organizer_email?: string;
  organization_name?: string | null;
  payout_account_label?: string | null;
  amount_tiyin: number;
  eligible_at: string;
  status: string;
  paid_at?: string | null;
  marked_paid_by?: Person | null;
}

export function AdminPayouts() {
  const { t, i18n } = useTranslation();
  const date = useDate();
  const [pending, setPending] = useState<string>();
  const [done, setDone] = useState(false);
  const payouts = useQuery({
    queryKey: ["admin-payouts"],
    queryFn: () => apiFetch<PayoutItem[]>("/admin/payouts"),
  });
  const markPaid = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/admin/payouts/${id}/mark-paid`, { method: "POST" }),
    onSuccess: async () => {
      setPending(undefined);
      setDone(true);
      await payouts.refetch();
    },
    onError: (error) => {
      // Someone else already paid it: the list is stale, reload it.
      if (problemCode(error) === "payout_already_paid") void payouts.refetch();
    },
  });
  return (
    <Surface className="gap-4">
      <Text accessibilityRole="header" className="text-xl font-semibold text-ink">
        {t("ui.payoutLedger")}
      </Text>
      <Meta>{t("adminX.payouts.help")}</Meta>
      {done ? (
        <Notice tone="success">{t("adminX.payouts.markedPaid")}</Notice>
      ) : null}
      <ListState
        loading={payouts.isLoading}
        error={payouts.error}
        retry={() => void payouts.refetch()}
        empty={payouts.data?.length === 0}
        emptyText={t("ui.noPayouts")}
      />
      {payouts.data?.map((item) => {
        const paid = item.status === "paid_demo" || item.status === "paid";
        return (
          <Row
            key={item.id}
            aside={
              <>
                <StatusBadge status={item.status} />
                {!paid ? (
                  <Button
                    size="sm"
                    label={t("ui.markPaid")}
                    variant="secondary"
                    onPress={() => {
                      markPaid.reset();
                      setDone(false);
                      setPending(item.id);
                    }}
                  />
                ) : null}
              </>
            }
            below={
              pending === item.id ? (
                <ConfirmPanel
                  title={t("adminX.payouts.confirmTitle", {
                    amount: formatKzt(item.amount_tiyin, i18n.language),
                  })}
                  message={t("adminX.payouts.confirmBody")}
                  confirmLabel={t("ui.markPaid")}
                  loading={markPaid.isPending}
                  error={markPaid.error ? errorText(markPaid.error) : undefined}
                  onConfirm={() => markPaid.mutate(item.id)}
                  onCancel={() => {
                    setPending(undefined);
                    markPaid.reset();
                  }}
                />
              ) : null
            }
          >
            <Text className="font-medium text-ink">
              {formatKzt(item.amount_tiyin, i18n.language)}
            </Text>
            <EventLink
              id={item.event_id}
              title={item.event_title ?? t("adminX.common.openEvent")}
            />
            <Meta>
              {t("adminX.common.organizer", {
                name: item.organization_name || item.organizer_name || "—",
                email: item.organizer_email ?? "—",
              })}
            </Meta>
            <Meta>
              {item.payout_account_label
                ? t("adminX.payouts.account", {
                    label: item.payout_account_label,
                  })
                : t("adminX.payouts.noAccount")}
            </Meta>
            <Meta>{t("ui.eligible", { date: date(item.eligible_at) })}</Meta>
            {item.paid_at ? (
              <Meta>
                {t("adminX.payouts.paidAt", {
                  date: date(item.paid_at),
                  name: item.marked_paid_by?.display_name ?? "—",
                })}
              </Meta>
            ) : null}
          </Row>
        );
      })}
    </Surface>
  );
}

// --------------------------------------------------------------- campaigns

interface CampaignItem {
  id: string;
  name: string;
  code: string;
  discount_type: "percentage" | "fixed_kzt";
  discount_value: number;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  is_enabled: boolean;
  redemptions: number;
  total_discount_tiyin: number;
  last_redeemed_at: string | null;
  event_id: string;
  event_title: string;
  event_status: string;
  organizer_name: string;
  organizer_email: string;
}

type EnabledFilter = "all" | "true" | "false";

export function AdminCampaigns() {
  const { t, i18n } = useTranslation();
  const date = useDate();
  const [enabled, setEnabled] = useState<EnabledFilter>("all");
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<string>();
  const [done, setDone] = useState<string>();
  const campaigns = useQuery({
    queryKey: ["admin-campaigns", enabled, q],
    queryFn: () =>
      apiFetch<CampaignItem[]>(
        `/admin/campaigns${queryString({
          enabled: enabled === "all" ? undefined : enabled,
          q: q || undefined,
        })}`,
      ),
  });
  const disable = useMutation({
    mutationFn: (item: CampaignItem) =>
      apiFetch(`/campaigns/${item.id}/disable`, { method: "PATCH" }),
    onSuccess: async (_result, item) => {
      setPending(undefined);
      setDone(t("adminX.campaigns.disabled", { code: item.code }));
      await campaigns.refetch();
    },
  });
  return (
    <Surface className="gap-4">
      <Text accessibilityRole="header" className="text-xl font-semibold text-ink">
        {t("adminX.campaigns.title")}
      </Text>
      <Meta>{t("adminX.campaigns.help")}</Meta>
      <Chips
        label={t("adminX.common.statusFilter")}
        value={enabled}
        onChange={setEnabled}
        options={[
          { value: "all", label: t("adminX.common.all") },
          { value: "true", label: t("adminX.campaigns.enabled") },
          { value: "false", label: t("status.disabled") },
        ]}
      />
      <SearchBox label={t("adminX.campaigns.search")} onSubmit={setQ} />
      {done ? <Notice tone="success">{done}</Notice> : null}
      <ListState
        loading={campaigns.isLoading}
        error={campaigns.error}
        retry={() => void campaigns.refetch()}
        empty={campaigns.data?.length === 0}
        emptyText={t("adminX.campaigns.empty")}
      />
      {campaigns.data?.map((item) => (
        <Row
          key={item.id}
          aside={
            <>
              <StatusBadge status={item.is_enabled ? "active" : "disabled"} />
              {item.is_enabled ? (
                <Button
                  size="sm"
                  label={t("adminX.campaigns.disable")}
                  variant="danger"
                  onPress={() => {
                    disable.reset();
                    setDone(undefined);
                    setPending(item.id);
                  }}
                />
              ) : null}
            </>
          }
          below={
            pending === item.id ? (
              <ConfirmPanel
                title={t("adminX.campaigns.confirmTitle", { code: item.code })}
                message={t("adminX.campaigns.confirmBody")}
                confirmLabel={t("adminX.campaigns.disable")}
                danger
                loading={disable.isPending}
                error={disable.error ? errorText(disable.error) : undefined}
                onConfirm={() => disable.mutate(item)}
                onCancel={() => {
                  setPending(undefined);
                  disable.reset();
                }}
              />
            ) : null
          }
        >
          <Text className="font-medium text-ink">
            {item.name} · <Text className="font-mono">{item.code}</Text>
          </Text>
          <Meta>
            {item.discount_type === "percentage"
              ? t("adminX.campaigns.percentOff", { value: item.discount_value })
              : t("adminX.campaigns.amountOff", {
                  amount: formatKzt(item.discount_value, i18n.language),
                })}
          </Meta>
          <Meta>
            {item.max_redemptions === null
              ? t("adminX.campaigns.redemptionsUnlimited", {
                  used: item.redemptions,
                })
              : t("adminX.campaigns.redemptions", {
                  used: item.redemptions,
                  max: item.max_redemptions,
                })}
            {" · "}
            {t("adminX.campaigns.totalDiscount", {
              amount: formatKzt(item.total_discount_tiyin, i18n.language),
            })}
          </Meta>
          {item.starts_at || item.ends_at ? (
            <Meta>
              {t("adminX.campaigns.window", {
                from: item.starts_at ? date(item.starts_at) : "—",
                to: item.ends_at ? date(item.ends_at) : "—",
              })}
            </Meta>
          ) : null}
          <Meta>
            {item.last_redeemed_at
              ? t("adminX.campaigns.lastUsed", {
                  date: date(item.last_redeemed_at),
                })
              : t("adminX.campaigns.neverUsed")}
          </Meta>
          <View className="flex-row flex-wrap items-center gap-2">
            <EventLink id={item.event_id} title={item.event_title} />
            <StatusBadge status={item.event_status} />
          </View>
          <Meta>
            {t("adminX.common.organizer", {
              name: item.organizer_name,
              email: item.organizer_email,
            })}
          </Meta>
        </Row>
      ))}
    </Surface>
  );
}

// ----------------------------------------------------------- support cases

interface AdminCase {
  id: string;
  case_number: string;
  kind: string;
  category: string;
  status: string;
  subject: string;
  requester_name: string;
  requester_email: string;
  assignee_name: string | null;
  escalated: boolean;
  context?: { event?: { id: string; title: string } | null } | null;
  updated_at: string;
}

type CaseScope = "platform" | "escalated" | "organizer_to_platform" | "all";
type CaseStatus =
  | "all"
  | "open"
  | "in_progress"
  | "waiting_for_customer"
  | "resolved";

export function AdminSupportCases() {
  const { t } = useTranslation();
  const date = useDate();
  const [scope, setScope] = useState<CaseScope>("platform");
  const [status, setStatus] = useState<CaseStatus>("all");
  const cases = useQuery({
    queryKey: ["admin-support-cases", scope, status],
    queryFn: () =>
      apiFetch<AdminCase[]>(
        `/admin/support-cases${queryString({
          scope,
          status: status === "all" ? undefined : status,
        })}`,
      ),
    refetchInterval: 30_000,
  });
  return (
    <Surface className="gap-4">
      <Text accessibilityRole="header" className="text-xl font-semibold text-ink">
        {t("adminX.cases.title")}
      </Text>
      <Meta>{t("adminX.cases.help")}</Meta>
      <Chips
        label={t("adminX.cases.scopeFilter")}
        value={scope}
        onChange={setScope}
        options={(
          ["platform", "escalated", "organizer_to_platform", "all"] as const
        ).map((value) => ({
          value,
          label: t(`adminX.cases.scope.${value}`),
        }))}
      />
      <Chips
        label={t("adminX.common.statusFilter")}
        value={status}
        onChange={setStatus}
        options={(
          [
            "all",
            "open",
            "in_progress",
            "waiting_for_customer",
            "resolved",
          ] as const
        ).map((value) => ({
          value,
          label:
            value === "all" ? t("adminX.common.all") : t(`status.${value}`),
        }))}
      />
      <ListState
        loading={cases.isLoading}
        error={cases.error}
        retry={() => void cases.refetch()}
        empty={cases.data?.length === 0}
        emptyText={t("adminX.cases.empty")}
      />
      {cases.data?.map((item) => (
        <Row
          key={item.id}
          aside={
            <>
              {item.escalated ? <EscalatedChip /> : null}
              <StatusBadge status={item.status} />
            </>
          }
        >
          <TextLink
            href={supportCaseHref(item.id)}
            label={`${item.case_number} · ${item.subject}`}
            accessibilityLabel={t("adminX.cases.open", {
              number: item.case_number,
            })}
          />
          <Meta>
            {t(`supportX.kind.${item.kind}`, { defaultValue: item.kind })}
            {" · "}
            {t(`status.${item.category}`, { defaultValue: item.category })}
          </Meta>
          {item.context?.event ? (
            <EventLink
              id={item.context.event.id}
              title={item.context.event.title}
            />
          ) : null}
          <Meta>
            {t("adminX.cases.requester", {
              name: item.requester_name,
              email: item.requester_email,
            })}
          </Meta>
          <Meta>
            {item.assignee_name
              ? t("supportX.assignedTo", { name: item.assignee_name })
              : t("supportX.unassigned")}
            {" · "}
            {t("supportX.updated", { date: date(item.updated_at) })}
          </Meta>
        </Row>
      ))}
    </Surface>
  );
}
