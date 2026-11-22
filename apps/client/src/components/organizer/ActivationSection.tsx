import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon, palette } from "@/components/icons";
import {
  Button,
  DarkCard,
  LabeledValue,
  Surface,
  TicketStub,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/utils/date";
import { formatKzt, newIdempotencyKey } from "@/utils/format";

import {
  Badge,
  Checkbox,
  ChoiceGroup,
  DemoNotice,
  ErrorText,
  Fact,
  Muted,
  SectionTitle,
  SuccessText,
} from "./common";
import { ProgressMeter, RowCard } from "./design";
import type { ActivationState, EventAccess } from "./types";
import { eventKey } from "./useEventAccess";

type Outcome = "success" | "failure" | "timeout";

/** Paid-sales activation: real checklist, terms, simulated fee payment. */
export function ActivationSection({
  eventId,
  access,
  state,
}: {
  eventId: string;
  access: EventAccess;
  state: ActivationState;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [terms, setTerms] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("success");
  const [done, setDone] = useState(false);
  const pay = useMutation({
    mutationFn: () =>
      apiFetch<{ payment_status: string }>(
        `/events/${eventId}/activation/simulate`,
        {
          method: "POST",
          body: JSON.stringify({
            outcome,
            // A failed attempt cannot be replayed, so every attempt is new.
            idempotency_key: newIdempotencyKey("activation"),
            terms_accepted: terms,
          }),
        },
      ),
    onSuccess: () => setDone(true),
    onSettled: async () => {
      // Failed and timed-out attempts are recorded too: reload the history.
      await client.invalidateQueries({ queryKey: eventKey(eventId) });
      await client.invalidateQueries({ queryKey: ["organizer-events"] });
    },
  });
  const fee = formatKzt(state.activation_fee_tiyin, i18n.language);
  const status = state.paid_sales_suspended
    ? "suspended"
    : state.paid_sales_active
      ? "active"
      : "inactive";
  const needsProfile = state.checklist.some(
    (item) =>
      !item.done &&
      [
        "organizer_profile",
        "identity_verified",
        "payout_account",
        "payout_verified",
      ].includes(item.key),
  );
  const doneCount = state.checklist.filter((item) => item.done).length;
  return (
    <View className="gap-5">
      <DarkCard className="gap-4">
        <Text
          accessibilityRole="header"
          className="text-2xl font-extrabold tracking-tight text-white"
        >
          {t("organizer.activation.title")}
        </Text>
        <View className="flex-row flex-wrap items-center gap-3">
          <Text className="font-semibold text-white/75">
            {t("organizer.activation.state")}:
          </Text>
          <Badge
            status={status}
            onDark
            tone={status === "inactive" ? "warn" : undefined}
            label={t(`organizer.activation.states.${status}`)}
          />
        </View>
        <Text className="leading-6 text-white/80">
          {t(`organizer.activation.stateHelp.${status}`)}
        </Text>
        <View className="flex-row flex-wrap items-end justify-between gap-4 rounded-3xl bg-white/10 p-4">
          <LabeledValue
            label={t("organizer.activation.fee")}
            value={fee}
            size="xl"
            tone="dark"
          />
          <View className="min-w-40 flex-1">
            <ProgressMeter
              tone="dark"
              label={t("organizer.activation.checklist")}
              value={doneCount}
              max={state.checklist.length}
              valueText={t("organizerUi.checklistProgress", {
                done: doneCount,
                total: state.checklist.length,
              })}
            />
          </View>
        </View>
      </DarkCard>
      <Surface className="gap-4">
        <DemoNotice>{t("organizer.activation.demoHelp")}</DemoNotice>
        {state.paid_sales_suspended ? (
          <View
            accessibilityRole="alert"
            className="gap-1 rounded-2xl border border-red-100 bg-red-50 p-3"
          >
            <View className="flex-row items-center gap-2">
              <Icon name="alert" size={18} color={palette.danger} />
              <Text className="flex-1 font-bold text-danger">
                {t("organizer.activation.suspendedTitle")}
              </Text>
            </View>
            <Text className="text-ink">
              {state.paid_sales_suspension_reason
                ? t("organizer.lifecycle.reason", {
                    reason: state.paid_sales_suspension_reason,
                  })
                : t("organizer.lifecycle.reasonUnknown")}
            </Text>
          </View>
        ) : null}
        {state.paid_sales_active &&
        !state.paid_sales_suspended &&
        !state.can_sell_paid_tickets ? (
          <Muted>{t("organizer.activation.publishToSell")}</Muted>
        ) : null}
      </Surface>

      <TicketStub
        notchClassName="bg-canvas"
        className="border border-line shadow-panel"
        footer={
          state.organizer || needsProfile ? (
            <View className="gap-2">
              {state.organizer ? (
                <Muted>
                  {t("organizer.activation.ownerLine", {
                    name:
                      state.organizer.organization_name ??
                      state.organizer.display_name,
                  })}
                </Muted>
              ) : null}
              {needsProfile && access.isOwner ? (
                <Link
                  href="/organizer"
                  className="font-bold text-brand underline"
                >
                  {t("organizer.activation.openProfile")}
                </Link>
              ) : null}
              {needsProfile && !access.isOwner ? (
                <Muted>{t("organizer.activation.ownerMustVerify")}</Muted>
              ) : null}
            </View>
          ) : undefined
        }
      >
        <View className="flex-row flex-wrap items-end justify-between gap-2">
          <SectionTitle>{t("organizer.activation.checklist")}</SectionTitle>
          <Text className="text-sm font-bold text-muted">
            {t("organizerUi.checklistProgress", {
              done: doneCount,
              total: state.checklist.length,
            })}
          </Text>
        </View>
        {state.checklist.map((item) => (
          <View
            key={item.key}
            testID={`checklist-${item.key}`}
            className="flex-row items-start gap-3"
          >
            <View
              className={`mt-0.5 h-8 w-8 items-center justify-center rounded-full ${item.done ? "bg-ink" : "border-2 border-dashed border-danger bg-red-50"}`}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Icon
                name={item.done ? "check" : "close"}
                size={16}
                color={item.done ? palette.mint : palette.danger}
              />
            </View>
            <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row flex-wrap items-center justify-between gap-2">
              <Text className="min-w-40 flex-1 font-semibold text-ink">
                {t(`organizer.activation.items.${item.key}`, {
                  defaultValue: item.key.replaceAll("_", " "),
                  fee,
                })}
              </Text>
              <Badge
                status={item.done ? "done" : "missing"}
                label={
                  item.done
                    ? t("organizer.activation.done")
                    : t("organizer.activation.missing")
                }
              />
            </View>
            {!item.done ? (
              <Text className="text-sm text-danger">
                {t(`apiErrors.${item.error_code}`, {
                  defaultValue: item.error_code.replaceAll("_", " "),
                })}
              </Text>
            ) : null}
            </View>
          </View>
        ))}
      </TicketStub>

      {state.activation_paid ? (
        <Surface>
          <SuccessText>{t("organizer.activation.alreadyPaid")}</SuccessText>
        </Surface>
      ) : (
        <Surface className="gap-4">
          <SectionTitle>{t("organizer.activation.payTitle", { fee })}</SectionTitle>
          <DemoNotice>{t("organizer.activation.payHelp")}</DemoNotice>
          {!state.ready_for_payment ? (
            <Text className="text-ink">
              {t("organizer.activation.notReady")}
            </Text>
          ) : null}
          <Checkbox
            label={t("organizer.activation.terms", { fee })}
            checked={terms}
            onChange={setTerms}
            testID="activation-terms"
          />
          <ChoiceGroup
            label={t("organizer.activation.outcome")}
            value={outcome}
            onChange={setOutcome}
            options={(["success", "failure", "timeout"] as const).map(
              (item) => ({
                value: item,
                label: t(`organizer.activation.outcomes.${item}`),
              }),
            )}
          />
          <View className="flex-row flex-wrap">
            <Button
              iconName="card"
              label={t("organizer.activation.run", { fee })}
              loading={pay.isPending}
              disabled={!terms || !state.ready_for_payment}
              testID="activation-run"
              onPress={() => {
                setDone(false);
                pay.mutate();
              }}
            />
          </View>
          {!terms ? (
            <Muted>{t("organizer.activation.termsRequired")}</Muted>
          ) : null}
          {done ? (
            <SuccessText>{t("organizer.activation.success")}</SuccessText>
          ) : null}
          <ErrorText error={pay.error} />
        </Surface>
      )}

      <Surface className="gap-3">
        <SectionTitle>{t("organizer.activation.history")}</SectionTitle>
        {state.payments.length === 0 ? (
          <Muted>{t("organizer.activation.noPayments")}</Muted>
        ) : null}
        {state.payments.map((payment) => (
          <RowCard
            key={payment.id}
            className="flex-row flex-wrap items-start justify-between gap-3"
          >
            <View className="min-w-60 flex-1 gap-1">
              <Text className="font-bold text-ink">
                {formatKzt(payment.amount_tiyin, i18n.language)} ·{" "}
                {formatDateTime(payment.created_at, i18n.language, "medium")}
              </Text>
              <Fact
                label={t("organizer.sales.reference")}
                value={payment.reference}
              />
              {payment.paid_by ? (
                <Fact
                  label={t("organizer.activation.paidBy")}
                  value={payment.paid_by.display_name}
                />
              ) : null}
              {payment.failure_reason ? (
                <Fact
                  label={t("organizer.sales.failureReason")}
                  value={t(
                    `organizer.sales.failureReasons.${payment.failure_reason}`,
                    { defaultValue: payment.failure_reason },
                  )}
                />
              ) : null}
            </View>
            <Badge status={payment.status} />
          </RowCard>
        ))}
      </Surface>
    </View>
  );
}
