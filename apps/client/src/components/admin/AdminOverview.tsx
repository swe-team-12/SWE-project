import { useQuery } from "@tanstack/react-query";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { IconName } from "@/components/icons";
import { Metric } from "@/components/ui";
import { apiFetch } from "@/lib/api";

type OverviewSection = "cases" | "payments" | "reports" | "payouts";

interface WithStatus {
  status: string;
}

/** Counts shown on the KPI tiles; `undefined` while loading or on error. */
export function overviewCounts(data: {
  cases?: WithStatus[];
  payments?: unknown[];
  reports?: unknown[];
  payouts?: WithStatus[];
}): Record<OverviewSection, number | undefined> {
  return {
    cases: data.cases?.filter((item) => item.status !== "resolved").length,
    payments: data.payments?.length,
    reports: data.reports?.length,
    payouts: data.payouts?.filter(
      (item) => item.status !== "paid" && item.status !== "paid_demo",
    ).length,
  };
}

/**
 * KPI tiles at the top of the console. Query keys and URLs match the ones the
 * monitoring sections use for their default filters, so opening a section
 * reuses the cached list instead of loading it again.
 */
export function AdminOverview({
  onOpen,
}: {
  onOpen(section: OverviewSection): void;
}) {
  const { t } = useTranslation();
  const cases = useQuery({
    queryKey: ["admin-support-cases", "platform", "all"],
    queryFn: () =>
      apiFetch<WithStatus[]>("/admin/support-cases?scope=platform"),
  });
  const payments = useQuery({
    queryKey: ["admin-payments", "problems", "all", ""],
    queryFn: () => apiFetch<unknown[]>("/admin/payments?problems_only=true"),
  });
  const reports = useQuery({
    queryKey: ["admin-reports", "open"],
    queryFn: () => apiFetch<unknown[]>("/admin/reports/events?status=open"),
  });
  const payouts = useQuery({
    queryKey: ["admin-payouts"],
    queryFn: () => apiFetch<WithStatus[]>("/admin/payouts"),
  });
  const counts = overviewCounts({
    cases: cases.data,
    payments: payments.data,
    reports: reports.data,
    payouts: payouts.data,
  });
  const tiles: { section: OverviewSection; icon: IconName }[] = [
    { section: "cases", icon: "help" },
    { section: "payments", icon: "card" },
    { section: "reports", icon: "alert" },
    { section: "payouts", icon: "receipt" },
  ];
  return (
    <View
      accessibilityLabel={t("adminX.overview.label")}
      className="flex-row flex-wrap gap-3"
    >
      {tiles.map(({ section, icon }) => {
        const value = counts[section];
        const label = t(`adminX.overview.${section}`);
        const shown = value === undefined ? "—" : String(value);
        return (
          <Pressable
            key={section}
            accessibilityRole="button"
            accessibilityLabel={t("adminX.overview.open", {
              label,
              value: value === undefined ? t("common.loading") : shown,
            })}
            onPress={() => onOpen(section)}
            className="min-w-40 flex-1 basis-40 active:opacity-80"
          >
            <Metric
              label={label}
              value={shown}
              icon={icon}
              tone={section === "cases" ? "night" : "light"}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
