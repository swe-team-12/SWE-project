import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  Button,
  ErrorBlock,
  Field,
  LoadingBlock,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { API_URL, apiFetch, currentAccessToken } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { formatKzt } from "@/utils/format";

interface SearchResults {
  users: {
    id: string;
    email: string;
    display_name: string;
    suspended: boolean;
  }[];
  events: { id: string; title: string; status: string }[];
  orders: { id: string; number: string; status: string }[];
  payments: {
    id: string;
    reference: string;
    status: string;
    amount_tiyin: number;
  }[];
}

interface PayoutItem {
  id: string;
  event_id: string;
  amount_tiyin: number;
  eligible_at: string;
  status: string;
  paid_at?: string;
}

interface ActivationItem {
  id: string;
  event_id: string;
  amount_tiyin: number;
  status: string;
  created_at: string;
}

async function downloadReport() {
  const response = await fetch(`${API_URL}/admin/reports/operations.csv`, {
    headers: { Authorization: `Bearer ${currentAccessToken()}` },
  });
  if (!response.ok) throw new Error("Report download failed");
  if (Platform.OS === "web") {
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "biletflow-operations.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
}

export default function AdminPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [activationFee, setActivationFee] = useState("5000");
  const results = useQuery({
    queryKey: ["admin-search", submitted],
    queryFn: () =>
      apiFetch<SearchResults>(
        `/admin/search?q=${encodeURIComponent(submitted)}`,
      ),
    enabled: submitted.length >= 2,
  });
  const payouts = useQuery({
    queryKey: ["admin-payouts"],
    queryFn: () => apiFetch<PayoutItem[]>("/admin/payouts"),
    enabled: !!user?.roles.includes("platform_admin"),
  });
  const activations = useQuery({
    queryKey: ["admin-activations"],
    queryFn: () => apiFetch<ActivationItem[]>("/admin/activation-payments"),
    enabled: !!user?.roles.includes("platform_admin"),
  });
  const userSuspension = useMutation({
    mutationFn: ({ id, suspended }: { id: string; suspended: boolean }) =>
      apiFetch(
        `/admin/users/${id}/suspension?suspended=${suspended}&reason=${encodeURIComponent("Academic moderation demo")}`,
        { method: "POST" },
      ),
    onSuccess: () => results.refetch(),
  });
  const eventSuspension = useMutation({
    mutationFn: ({ id, suspended }: { id: string; suspended: boolean }) =>
      apiFetch(
        `/admin/events/${id}/suspension?suspended=${suspended}&reason=${encodeURIComponent("Academic moderation demo")}`,
        { method: "POST" },
      ),
    onSuccess: () => results.refetch(),
  });
  const fee = useMutation({
    mutationFn: () =>
      apiFetch(
        `/admin/settings/activation-fee?amount_tiyin=${Math.round(Number(activationFee) * 100)}`,
        { method: "PUT" },
      ),
  });
  const markPaid = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/admin/payouts/${id}/mark-paid`, { method: "POST" }),
    onSuccess: () => payouts.refetch(),
  });
  if (!user?.roles.includes("platform_admin"))
    return <ErrorBlock message={t("ui.administration")} />;
  return (
    <ScrollView contentContainerClassName="gap-7 pb-16">
      <View>
        <Text className="text-sm font-black uppercase tracking-wider text-brand">
          {t("ui.platformOperations")}
        </Text>
        <Text className="mt-1 text-4xl font-black text-ink">
          {t("ui.administration")}
        </Text>
        <Text className="mt-2 text-muted">{t("ui.administrationHelp")}</Text>
      </View>
      <View className="flex-row flex-wrap items-start gap-5">
        <Surface className="min-w-80 flex-[2] gap-4">
          <Text className="text-xl font-black text-ink">
            {t("ui.searchPlatform")}
          </Text>
          <View className="flex-row items-end gap-3">
            <View className="flex-1">
              <Field
                label={t("ui.searchPlatformField")}
                value={search}
                onChangeText={setSearch}
              />
            </View>
            <Button
              label={t("ui.search")}
              onPress={() => setSubmitted(search)}
              disabled={search.length < 2}
            />
          </View>
          {results.isLoading ? <LoadingBlock /> : null}
          {results.error ? (
            <ErrorBlock message={(results.error as Error).message} />
          ) : null}
          {results.data?.users.map((item) => (
            <View
              key={item.id}
              className="flex-row flex-wrap items-center justify-between gap-3 border-b border-line py-3"
            >
              <View>
                <Text className="font-bold text-ink">{item.display_name}</Text>
                <Text className="text-sm text-muted">{item.email}</Text>
              </View>
              <View className="flex-row items-center gap-2">
                <StatusBadge status={item.suspended ? "suspended" : "active"} />
                <Button
                  label={item.suspended ? t("ui.restore") : t("ui.suspend")}
                  variant={item.suspended ? "secondary" : "danger"}
                  onPress={() =>
                    userSuspension.mutate({
                      id: item.id,
                      suspended: !item.suspended,
                    })
                  }
                />
              </View>
            </View>
          ))}
          {results.data?.events.map((item) => (
            <View
              key={item.id}
              className="flex-row flex-wrap items-center justify-between gap-3 border-b border-line py-3"
            >
              <View>
                <Text className="font-bold text-ink">{item.title}</Text>
                <Text className="text-sm text-muted">
                  {t("ui.eventLabel", { id: item.id })}
                </Text>
              </View>
              <View className="flex-row items-center gap-2">
                <StatusBadge status={item.status} />
                <Button
                  label={
                    item.status === "suspended"
                      ? t("ui.restore")
                      : t("ui.suspend")
                  }
                  variant={item.status === "suspended" ? "secondary" : "danger"}
                  onPress={() =>
                    eventSuspension.mutate({
                      id: item.id,
                      suspended: item.status !== "suspended",
                    })
                  }
                />
              </View>
            </View>
          ))}
          {results.data?.orders.map((item) => (
            <View
              key={item.id}
              className="flex-row justify-between border-b border-line py-3"
            >
              <Text className="font-bold text-ink">{item.number}</Text>
              <StatusBadge status={item.status} />
            </View>
          ))}
          {results.data?.payments.map((item) => (
            <View
              key={item.id}
              className="flex-row justify-between border-b border-line py-3"
            >
              <View>
                <Text className="font-bold text-ink">{item.reference}</Text>
                <Text className="text-sm text-muted">
                  {formatKzt(item.amount_tiyin, i18n.language)}
                </Text>
              </View>
              <StatusBadge status={item.status} />
            </View>
          ))}
        </Surface>
        <View className="min-w-72 flex-1 gap-5">
          <Surface className="gap-4">
            <Text className="text-xl font-black text-ink">
              {t("ui.platformSettings")}
            </Text>
            <Field
              label={t("ui.activationFee")}
              value={activationFee}
              onChangeText={setActivationFee}
              keyboardType="numeric"
            />
            <Button
              label={t("ui.saveActivationFee")}
              variant="secondary"
              onPress={() => fee.mutate()}
              loading={fee.isPending}
            />
            {fee.isSuccess ? (
              <Text className="font-bold text-success">
                {t("ui.settingSaved")}
              </Text>
            ) : null}
          </Surface>
          <Surface className="gap-4">
            <Text className="text-xl font-black text-ink">
              {t("ui.operationalReport")}
            </Text>
            <Text className="text-muted">{t("ui.reportHelp")}</Text>
            <Button
              label={t("ui.downloadCsv")}
              variant="secondary"
              onPress={() => void downloadReport()}
            />
          </Surface>
        </View>
      </View>
      <View className="flex-row flex-wrap items-start gap-5">
        <Surface className="min-w-80 flex-1 gap-4">
          <Text className="text-xl font-black text-ink">
            {t("ui.payoutLedger")}
          </Text>
          {payouts.data?.map((item) => (
            <View
              key={item.id}
              className="flex-row flex-wrap items-center justify-between gap-3 border-b border-line py-3"
            >
              <View>
                <Text className="font-bold text-ink">
                  {formatKzt(item.amount_tiyin, i18n.language)}
                </Text>
                <Text className="text-xs text-muted">
                  {t("ui.eligible", {
                    date: new Date(item.eligible_at).toLocaleString(
                      i18n.language,
                    ),
                  })}
                </Text>
              </View>
              <View className="flex-row items-center gap-2">
                <StatusBadge status={item.status} />
                {item.status !== "paid_demo" ? (
                  <Button
                    label={t("ui.markPaid")}
                    variant="secondary"
                    onPress={() => markPaid.mutate(item.id)}
                  />
                ) : null}
              </View>
            </View>
          ))}
          {payouts.data?.length === 0 ? (
            <Text className="text-muted">{t("ui.noPayouts")}</Text>
          ) : null}
        </Surface>
        <Surface className="min-w-80 flex-1 gap-4">
          <Text className="text-xl font-black text-ink">
            {t("ui.activationReview")}
          </Text>
          {activations.data?.map((item) => (
            <View
              key={item.id}
              className="flex-row items-center justify-between gap-3 border-b border-line py-3"
            >
              <View>
                <Text className="font-bold text-ink">
                  {formatKzt(item.amount_tiyin, i18n.language)}
                </Text>
                <Text className="text-xs text-muted">
                  {new Date(item.created_at).toLocaleString(i18n.language)}
                </Text>
              </View>
              <StatusBadge status={item.status} />
            </View>
          ))}
          {activations.data?.length === 0 ? (
            <Text className="text-muted">{t("ui.noActivations")}</Text>
          ) : null}
        </Surface>
      </View>
    </ScrollView>
  );
}
