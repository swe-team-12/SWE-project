import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, Field, StatusBadge, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { formatDateTime } from "@/utils/date";
import { formatKzt } from "@/utils/format";

import {
  Chips,
  ConfirmPanel,
  errorText,
  eventManageHref,
  eventPublicHref,
  ListState,
  Meta,
  Notice,
  Row,
  TextLink,
} from "./shared";

interface SearchUser {
  id: string;
  email: string;
  display_name: string;
  suspended: boolean;
  roles?: string[];
  is_email_verified?: boolean;
}

interface SearchEvent {
  id: string;
  title: string;
  status: string;
  starts_at?: string;
  owner_name?: string;
  owner_email?: string;
  paid_sales_active?: boolean;
  paid_sales_suspended?: boolean;
  paid_sales_suspension_reason?: string | null;
  suspension_reason?: string | null;
}

interface SearchOrder {
  id: string;
  number: string;
  status: string;
  total_tiyin?: number;
  created_at?: string;
  event_id?: string;
  event_title?: string;
  buyer_email?: string;
  buyer_name?: string;
}

interface SearchPayment {
  id: string;
  reference: string;
  status: string;
  kind?: string;
  amount_tiyin: number;
  failure_reason?: string | null;
  created_at?: string;
  event_id?: string;
  event_title?: string;
  order_number?: string | null;
  payer_email?: string;
}

interface SearchResults {
  users: SearchUser[];
  events: SearchEvent[];
  orders: SearchOrder[];
  payments: SearchPayment[];
}

type ActionKind =
  | "user_suspend"
  | "user_restore"
  | "event_suspend"
  | "event_restore"
  | "paid_suspend"
  | "paid_resume";

interface PendingAction {
  kind: ActionKind;
  id: string;
  name: string;
}

const NEEDS_REASON: ActionKind[] = [
  "user_suspend",
  "event_suspend",
  "paid_suspend",
];
const MIN_REASON = 3;

function runAction(
  action: PendingAction,
  reason: string,
  republish: boolean,
): Promise<unknown> {
  const text = encodeURIComponent(reason);
  switch (action.kind) {
    case "user_suspend":
      return apiFetch(
        `/admin/users/${action.id}/suspension?suspended=true&reason=${text}`,
        { method: "POST" },
      );
    case "user_restore":
      return apiFetch(
        `/admin/users/${action.id}/suspension?suspended=false&reason=${text}`,
        { method: "POST" },
      );
    case "event_suspend":
      return apiFetch(
        `/admin/events/${action.id}/suspension?suspended=true&reason=${text}`,
        { method: "POST" },
      );
    case "event_restore":
      return apiFetch(
        `/admin/events/${action.id}/suspension?suspended=false&reason=${text}&republish=${republish}`,
        { method: "POST" },
      );
    case "paid_suspend":
      return apiFetch(`/admin/events/${action.id}/paid-sales-suspension`, {
        method: "POST",
        body: JSON.stringify({ suspended: true, reason }),
      });
    case "paid_resume":
      return apiFetch(`/admin/events/${action.id}/paid-sales-suspension`, {
        method: "POST",
        body: JSON.stringify({ suspended: false }),
      });
  }
}

export function AdminSearch({
  initialQuery,
  onShowPayments,
}: {
  initialQuery?: string;
  onShowPayments(query: string): void;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [search, setSearch] = useState(initialQuery ?? "");
  const [submitted, setSubmitted] = useState(initialQuery ?? "");
  const [pending, setPending] = useState<PendingAction>();
  const [reason, setReason] = useState("");
  const [republish, setRepublish] = useState<"unpublished" | "published">(
    "unpublished",
  );
  const [done, setDone] = useState<string>();
  const results = useQuery({
    queryKey: ["admin-search", submitted],
    queryFn: () =>
      apiFetch<SearchResults>(
        `/admin/search?q=${encodeURIComponent(submitted)}`,
      ),
    enabled: submitted.length >= 2,
  });
  const moderate = useMutation({
    mutationFn: (action: PendingAction) =>
      runAction(action, reason.trim(), republish === "published"),
    onSuccess: async (_result, action) => {
      setDone(t(`adminX.moderation.done.${action.kind}`, { name: action.name }));
      setPending(undefined);
      setReason("");
      await results.refetch();
    },
    // The record changed elsewhere (already suspended, cancelled...): show the
    // reason and reload so the row reflects the current state.
    onError: () => void results.refetch(),
  });
  const submit = (value = search) => {
    const next = value.trim();
    if (next.length < 2) return;
    setSearch(next);
    setSubmitted(next);
    setPending(undefined);
    setDone(undefined);
  };
  const begin = (kind: ActionKind, id: string, name: string) => {
    moderate.reset();
    setDone(undefined);
    setReason("");
    setRepublish("unpublished");
    setPending({ kind, id, name });
  };
  const needsReason = pending ? NEEDS_REASON.includes(pending.kind) : false;
  const reasonValid = reason.trim().length >= MIN_REASON;
  const confirmFor = (id: string) =>
    pending?.id === id ? (
      <ConfirmPanel
        title={t(`adminX.moderation.confirm.${pending.kind}`, {
          name: pending.name,
        })}
        message={t(`adminX.moderation.effect.${pending.kind}`)}
        confirmLabel={t(`adminX.moderation.action.${pending.kind}`)}
        danger={needsReason}
        loading={moderate.isPending}
        disabled={needsReason && !reasonValid}
        error={moderate.error ? errorText(moderate.error) : undefined}
        onConfirm={() => moderate.mutate(pending)}
        onCancel={() => {
          setPending(undefined);
          moderate.reset();
        }}
      >
        {needsReason ? (
          <Field
            label={t("adminX.moderation.reason")}
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={2}
            maxLength={2000}
            error={
              reason.length > 0 && !reasonValid
                ? t("apiErrors.reason_required")
                : undefined
            }
          />
        ) : null}
        {needsReason ? <Meta>{t("adminX.moderation.reasonHelp")}</Meta> : null}
        {pending.kind === "event_restore" ? (
          <Chips
            label={t("adminX.moderation.afterLift")}
            value={republish}
            onChange={setRepublish}
            options={[
              {
                value: "unpublished",
                label: t("adminX.moderation.leaveUnpublished"),
              },
              {
                value: "published",
                label: t("adminX.moderation.republish"),
              },
            ]}
          />
        ) : null}
      </ConfirmPanel>
    ) : null;
  const data = results.data;
  const total = data
    ? data.users.length +
      data.events.length +
      data.orders.length +
      data.payments.length
    : 0;
  return (
    <Surface className="gap-4">
      <Text accessibilityRole="header" className="text-xl font-extrabold tracking-tight text-ink">
        {t("ui.searchPlatform")}
      </Text>
      <Meta>{t("adminX.search.help")}</Meta>
      <View className="flex-row flex-wrap items-end gap-3">
        <View className="min-w-56 flex-1">
          <Field
            label={t("ui.searchPlatformField")}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => submit()}
            returnKeyType="search"
          />
        </View>
        <Button
          label={t("ui.search")}
          onPress={() => submit()}
          disabled={search.trim().length < 2}
        />
      </View>
      {done ? <Notice tone="success">{done}</Notice> : null}
      {submitted.length < 2 ? (
        <Text className="py-6 text-center text-muted">
          {t("adminX.search.prompt")}
        </Text>
      ) : (
        <ListState
          loading={results.isLoading}
          error={results.error}
          retry={() => void results.refetch()}
          empty={!!data && total === 0}
          emptyText={t("adminX.search.empty", { query: submitted })}
        />
      )}
      {data && data.users.length > 0 ? (
        <View>
          <Text accessibilityRole="header" className="text-lg font-extrabold tracking-tight text-ink">
            {t("adminX.search.users", { count: data.users.length })}
          </Text>
          {data.users.map((item) => (
            <Row
              key={item.id}
              aside={
                <>
                  <StatusBadge
                    status={item.suspended ? "suspended" : "active"}
                  />
                  <Button
                    size="sm"
                    label={t("adminX.search.userActivity")}
                    variant="ghost"
                    onPress={() => submit(item.email)}
                  />
                  {item.suspended ? (
                    <Button
                      size="sm"
                      label={t("adminX.moderation.action.user_restore")}
                      variant="secondary"
                      onPress={() =>
                        begin("user_restore", item.id, item.display_name)
                      }
                    />
                  ) : item.id === user?.id ? null : (
                    <Button
                      size="sm"
                      label={t("adminX.moderation.action.user_suspend")}
                      variant="danger"
                      onPress={() =>
                        begin("user_suspend", item.id, item.display_name)
                      }
                    />
                  )}
                </>
              }
              below={confirmFor(item.id)}
            >
              <Text className="font-bold text-ink">{item.display_name}</Text>
              <Meta>{item.email}</Meta>
              <Meta>
                {(item.roles ?? [])
                  .map((role) =>
                    t(`adminX.role.${role}`, { defaultValue: role }),
                  )
                  .join(", ")}
                {item.is_email_verified === undefined
                  ? ""
                  : ` · ${
                      item.is_email_verified
                        ? t("adminX.search.emailVerified")
                        : t("adminX.search.emailUnverified")
                    }`}
                {item.id === user?.id ? ` · ${t("adminX.search.you")}` : ""}
              </Meta>
            </Row>
          ))}
        </View>
      ) : null}
      {data && data.events.length > 0 ? (
        <View>
          <Text accessibilityRole="header" className="text-lg font-extrabold tracking-tight text-ink">
            {t("adminX.search.events", { count: data.events.length })}
          </Text>
          {data.events.map((item) => {
            const cancelled = item.status === "cancelled";
            return (
              <Row
                key={item.id}
                aside={
                  <>
                    <StatusBadge status={item.status} />
                    {item.status === "suspended" ? (
                      <Button
                        size="sm"
                        label={t("adminX.moderation.action.event_restore")}
                        variant="secondary"
                        onPress={() =>
                          begin("event_restore", item.id, item.title)
                        }
                      />
                    ) : cancelled ? null : (
                      <Button
                        size="sm"
                        label={t("adminX.moderation.action.event_suspend")}
                        variant="danger"
                        onPress={() =>
                          begin("event_suspend", item.id, item.title)
                        }
                      />
                    )}
                    {cancelled ? null : item.paid_sales_suspended ? (
                      <Button
                        size="sm"
                        label={t("adminX.moderation.action.paid_resume")}
                        variant="secondary"
                        onPress={() =>
                          begin("paid_resume", item.id, item.title)
                        }
                      />
                    ) : (
                      <Button
                        size="sm"
                        label={t("adminX.moderation.action.paid_suspend")}
                        variant="secondary"
                        onPress={() =>
                          begin("paid_suspend", item.id, item.title)
                        }
                      />
                    )}
                  </>
                }
                below={confirmFor(item.id)}
              >
                <TextLink
                  href={eventManageHref(item.id)}
                  label={item.title}
                  accessibilityLabel={t("adminX.common.manageEvent", {
                    title: item.title,
                  })}
                />
                <Meta>
                  {t("adminX.common.organizer", {
                    name: item.owner_name ?? "—",
                    email: item.owner_email ?? "—",
                  })}
                </Meta>
                {item.starts_at ? (
                  <Meta>
                    {t("adminX.common.starts", {
                      date: formatDateTime(
                        item.starts_at,
                        i18n.language,
                        "medium",
                      ),
                    })}
                  </Meta>
                ) : null}
                <Meta>
                  {item.paid_sales_suspended
                    ? t("adminX.paidSales.suspended")
                    : item.paid_sales_active
                      ? t("adminX.paidSales.active")
                      : t("adminX.paidSales.inactive")}
                </Meta>
                {item.suspension_reason ? (
                  <Text className="text-sm text-danger">
                    {t("adminX.moderation.eventReason", {
                      reason: item.suspension_reason,
                    })}
                  </Text>
                ) : null}
                {item.paid_sales_suspension_reason ? (
                  <Text className="text-sm text-danger">
                    {t("adminX.moderation.paidReason", {
                      reason: item.paid_sales_suspension_reason,
                    })}
                  </Text>
                ) : null}
                <TextLink
                  href={eventPublicHref(item.id)}
                  label={t("adminX.common.publicPage")}
                  accessibilityLabel={t("adminX.common.publicPageOf", {
                    title: item.title,
                  })}
                />
              </Row>
            );
          })}
        </View>
      ) : null}
      {data && data.orders.length > 0 ? (
        <View>
          <Text accessibilityRole="header" className="text-lg font-extrabold tracking-tight text-ink">
            {t("adminX.search.orders", { count: data.orders.length })}
          </Text>
          {data.orders.map((item) => (
            <Row
              key={item.id}
              aside={
                <>
                  <StatusBadge status={item.status} />
                  <Button
                    size="sm"
                    label={t("adminX.search.orderPayments")}
                    variant="ghost"
                    onPress={() => onShowPayments(item.number)}
                  />
                </>
              }
            >
              <Text className="font-mono font-bold text-ink">
                {item.number}
              </Text>
              <Meta>
                {item.total_tiyin !== undefined
                  ? formatKzt(item.total_tiyin, i18n.language)
                  : ""}
                {item.created_at
                  ? ` · ${formatDateTime(item.created_at, i18n.language, "medium")}`
                  : ""}
              </Meta>
              {item.buyer_email ? (
                <Meta>
                  {t("adminX.common.buyer", {
                    name: item.buyer_name ?? "—",
                    email: item.buyer_email,
                  })}
                </Meta>
              ) : null}
              {item.event_id ? (
                <TextLink
                  href={eventManageHref(item.event_id)}
                  label={item.event_title ?? t("adminX.common.openEvent")}
                  accessibilityLabel={t("adminX.common.manageEvent", {
                    title: item.event_title ?? "",
                  })}
                />
              ) : null}
            </Row>
          ))}
        </View>
      ) : null}
      {data && data.payments.length > 0 ? (
        <View>
          <Text accessibilityRole="header" className="text-lg font-extrabold tracking-tight text-ink">
            {t("adminX.search.payments", { count: data.payments.length })}
          </Text>
          {data.payments.map((item) => (
            <Row
              key={item.id}
              aside={
                <>
                  <StatusBadge status={item.status} />
                  <Button
                    size="sm"
                    label={t("adminX.search.openInPayments")}
                    variant="ghost"
                    onPress={() => onShowPayments(item.reference)}
                  />
                </>
              }
            >
              <Text className="font-mono font-bold text-ink">
                {item.reference}
              </Text>
              <Meta>
                {formatKzt(item.amount_tiyin, i18n.language)}
                {item.kind
                  ? ` · ${t(`adminX.paymentKind.${item.kind}`, { defaultValue: item.kind })}`
                  : ""}
                {item.created_at
                  ? ` · ${formatDateTime(item.created_at, i18n.language, "medium")}`
                  : ""}
              </Meta>
              {item.order_number || item.payer_email ? (
                <Meta>
                  {[item.order_number, item.payer_email]
                    .filter(Boolean)
                    .join(" · ")}
                </Meta>
              ) : null}
              {item.event_id ? (
                <TextLink
                  href={eventManageHref(item.event_id)}
                  label={item.event_title ?? t("adminX.common.openEvent")}
                  accessibilityLabel={t("adminX.common.manageEvent", {
                    title: item.event_title ?? "",
                  })}
                />
              ) : null}
            </Row>
          ))}
        </View>
      ) : null}
    </Surface>
  );
}
