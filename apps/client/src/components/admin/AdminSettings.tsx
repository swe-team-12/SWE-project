import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, ErrorBlock, Field, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { downloadAuthenticatedFile } from "@/lib/files";
import { formatDateTime } from "@/utils/date";
import { formatKzt } from "@/utils/format";

import { ConfirmPanel, errorText, ListState, Meta, Notice } from "./shared";

export interface PlatformSettings {
  activation_fee_tiyin: number;
  activation_fee_source: "configured" | "default";
  default_activation_fee_tiyin: number;
  processor_fee_bps: number;
  checkout_hold_minutes: number;
  currency: string;
  mode: string;
  updated_at: string | null;
  updated_by: { id: string; display_name: string; email: string } | null;
}

// Mirrors the server bound (PUT /admin/settings/activation-fee).
const MAX_FEE_TIYIN = 100_000_000_00;

/** Parses a KZT amount typed by the admin into tiyin, or null when invalid. */
export function parseFeeKzt(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const tiyin = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(tiyin) || tiyin < 0 || tiyin > MAX_FEE_TIYIN)
    return null;
  return tiyin;
}

function feeInputValue(tiyin: number): string {
  return String(tiyin / 100);
}

export function AdminSettings() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [draft, setDraft] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const settings = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => apiFetch<PlatformSettings>("/admin/settings"),
  });
  const current = settings.data?.activation_fee_tiyin;
  const value =
    draft ?? (current !== undefined ? feeInputValue(current) : "");
  const parsed = parseFeeKzt(value);
  const changed = parsed !== null && parsed !== current;
  const save = useMutation({
    mutationFn: (amountTiyin: number) =>
      apiFetch<PlatformSettings>(
        `/admin/settings/activation-fee?amount_tiyin=${amountTiyin}`,
        { method: "PUT" },
      ),
    onSuccess: async () => {
      setConfirming(false);
      setDraft(undefined);
      await client.invalidateQueries({ queryKey: ["admin-settings"] });
    },
  });
  const report = useMutation({
    mutationFn: () =>
      downloadAuthenticatedFile(
        "/admin/reports/operations.csv",
        "biletflow-operations.csv",
        "text/csv",
      ),
  });
  const data = settings.data;
  return (
    <View className="flex-row flex-wrap items-start gap-5">
      <Surface className="min-w-80 flex-[2] gap-4">
        <Text accessibilityRole="header" className="text-xl font-extrabold tracking-tight text-ink">
          {t("ui.platformSettings")}
        </Text>
        <ListState
          loading={settings.isLoading}
          error={settings.error}
          retry={() => void settings.refetch()}
          empty={false}
          emptyText=""
        />
        {data ? (
          <>
            <View className="gap-1">
              <Text className="text-ink">
                {t("adminX.settings.currentFee", {
                  amount: formatKzt(data.activation_fee_tiyin, i18n.language),
                })}
              </Text>
              <Meta>
                {data.activation_fee_source === "configured"
                  ? t("adminX.settings.sourceConfigured")
                  : t("adminX.settings.sourceDefault")}
                {" · "}
                {t("adminX.settings.defaultFee", {
                  amount: formatKzt(
                    data.default_activation_fee_tiyin,
                    i18n.language,
                  ),
                })}
              </Meta>
              {data.updated_at ? (
                <Meta>
                  {t("adminX.settings.updated", {
                    date: formatDateTime(
                      data.updated_at,
                      i18n.language,
                      "medium",
                    ),
                    name: data.updated_by?.display_name ?? "—",
                  })}
                </Meta>
              ) : null}
            </View>
            <Field
              label={t("ui.activationFee")}
              value={value}
              onChangeText={(next) => {
                setDraft(next);
                setConfirming(false);
                save.reset();
              }}
              keyboardType="numeric"
              inputMode="decimal"
              error={
                parsed === null ? t("adminX.settings.feeInvalid") : undefined
              }
            />
            <Meta>{t("adminX.settings.feeHelp")}</Meta>
            {confirming && parsed !== null ? (
              <ConfirmPanel
                title={t("adminX.settings.confirmTitle")}
                message={t("adminX.settings.confirmBody", {
                  from: formatKzt(data.activation_fee_tiyin, i18n.language),
                  to: formatKzt(parsed, i18n.language),
                })}
                confirmLabel={t("adminX.settings.confirmSave")}
                loading={save.isPending}
                error={save.error ? errorText(save.error) : undefined}
                onConfirm={() => save.mutate(parsed)}
                onCancel={() => {
                  setConfirming(false);
                  save.reset();
                }}
              />
            ) : (
              <Button
                label={t("ui.saveActivationFee")}
                variant="secondary"
                onPress={() => setConfirming(true)}
                disabled={!changed}
              />
            )}
            {save.isSuccess && !confirming ? (
              <Notice tone="success">{t("ui.settingSaved")}</Notice>
            ) : null}
            <View className="gap-1 border-t border-line pt-3">
              <Text className="font-bold text-ink">
                {t("adminX.settings.readOnlyTitle")}
              </Text>
              <Meta>
                {t("adminX.settings.processorFee", {
                  percent: (data.processor_fee_bps / 100).toLocaleString(
                    i18n.language,
                  ),
                })}
              </Meta>
              <Meta>
                {t("adminX.settings.checkoutHold", {
                  count: data.checkout_hold_minutes,
                })}
              </Meta>
              <Meta>
                {t("adminX.settings.currency", { currency: data.currency })}
              </Meta>
              <Meta>{t("adminX.settings.demoMode")}</Meta>
            </View>
          </>
        ) : null}
      </Surface>
      <Surface className="min-w-72 flex-1 gap-4">
        <Text accessibilityRole="header" className="text-xl font-extrabold tracking-tight text-ink">
          {t("ui.operationalReport")}
        </Text>
        <Text className="text-muted">{t("ui.reportHelp")}</Text>
        <Button
          label={t("ui.downloadCsv")}
          variant="secondary"
          onPress={() => report.mutate()}
          loading={report.isPending}
        />
        {report.isSuccess ? (
          <Notice tone="success">{t("adminX.settings.reportReady")}</Notice>
        ) : null}
        {report.error ? (
          <ErrorBlock
            message={report.error.message}
            retry={() => report.mutate()}
          />
        ) : null}
      </Surface>
    </View>
  );
}
