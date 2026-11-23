import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  AdminActivations,
  AdminCampaigns,
  AdminPayments,
  AdminPayouts,
  AdminRefunds,
  AdminSupportCases,
} from "@/components/admin/AdminMonitoring";
import { AdminOverview } from "@/components/admin/AdminOverview";
import { AdminReports } from "@/components/admin/AdminReports";
import { AdminSearch } from "@/components/admin/AdminSearch";
import { AdminSettings } from "@/components/admin/AdminSettings";
import { Tabs } from "@/components/admin/shared";
import { RequireAuth } from "@/components/RequireAuth";
import { Icon, palette } from "@/components/icons";
import { Chip, ErrorBlock, ScreenHeader } from "@/components/ui";
import { useAuth } from "@/providers/AuthProvider";

const SECTIONS = [
  "settings",
  "search",
  "reports",
  "payments",
  "refunds",
  "activations",
  "payouts",
  "campaigns",
  "cases",
] as const;
type Section = (typeof SECTIONS)[number];

function AdminContent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [section, setSection] = useState<Section>("settings");
  // Cross-links between sections: a report opens the event in search, a search
  // hit opens the matching rows of the payment monitor.
  const [searchQuery, setSearchQuery] = useState<string>();
  const [paymentsQuery, setPaymentsQuery] = useState<string>();
  if (!user?.roles.includes("platform_admin"))
    return <ErrorBlock message={t("adminX.accessDenied")} />;
  const firstName = user.display_name?.trim().split(/\s+/)[0];
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerClassName="gap-6 pb-16"
    >
      <View className="flex-row items-center gap-3">
        <View
          className="h-12 w-12 items-center justify-center rounded-2xl bg-ink"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {firstName ? (
            <Text className="text-lg font-semibold text-mint">
              {firstName.slice(0, 1).toUpperCase()}
            </Text>
          ) : (
            <Icon name="lock" size={22} color={palette.mint} />
          )}
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-sm text-muted">
            {t("attendee.ux.greeting")}
          </Text>
          <Text className="text-lg font-semibold text-ink" numberOfLines={1}>
            {user.display_name || t("ui.platformOperations")}
          </Text>
        </View>
        <View className="hidden md:flex">
          <Chip label={t("ui.platformOperations")} tone="mint" icon="lock" />
        </View>
      </View>
      <ScreenHeader
        title={t("ui.administration")}
        subtitle={t("ui.administrationHelp")}
      />
      <AdminOverview onOpen={setSection} />
      <Tabs
        label={t("adminX.sectionsLabel")}
        value={section}
        onChange={setSection}
        options={SECTIONS.map((value) => ({
          value,
          label: t(`adminX.sections.${value}`),
        }))}
      />
      {section === "settings" ? <AdminSettings /> : null}
      {section === "search" ? (
        <AdminSearch
          key={searchQuery}
          initialQuery={searchQuery}
          onShowPayments={(query) => {
            setPaymentsQuery(query);
            setSection("payments");
          }}
        />
      ) : null}
      {section === "reports" ? (
        <AdminReports
          onFindEvent={(title) => {
            setSearchQuery(title);
            setSection("search");
          }}
        />
      ) : null}
      {section === "payments" ? (
        <AdminPayments key={paymentsQuery} initialQuery={paymentsQuery} />
      ) : null}
      {section === "refunds" ? <AdminRefunds /> : null}
      {section === "activations" ? <AdminActivations /> : null}
      {section === "payouts" ? <AdminPayouts /> : null}
      {section === "campaigns" ? <AdminCampaigns /> : null}
      {section === "cases" ? <AdminSupportCases /> : null}
    </ScrollView>
  );
}

export default function AdminPage() {
  return (
    <RequireAuth>
      <AdminContent />
    </RequireAuth>
  );
}
