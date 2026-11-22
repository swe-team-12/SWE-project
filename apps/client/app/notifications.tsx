import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { errorText, Notice } from "@/components/admin/shared";
import { Icon, type IconName, palette } from "@/components/icons";
import { RequireAuth } from "@/components/RequireAuth";
import {
  Button,
  Chip,
  ErrorBlock,
  LoadingBlock,
  ScreenHeader,
  SegmentedControl,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { notificationTarget } from "@/lib/notificationHref";
import { notificationText } from "@/lib/notificationText";
import { useAuth } from "@/providers/AuthProvider";
import { formatDateTime } from "@/utils/date";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  read_at?: string | null;
  created_at: string;
}

type Filter = "all" | "unread";

/** Icon per notification type; the title always states the type in words. */
function notificationIcon(type: string): IconName {
  if (type.startsWith("support_")) return "help";
  if (type === "ticket_delivered") return "ticket";
  if (type === "order_confirmed" || type === "refund_completed")
    return "receipt";
  if (type === "payment_failed" || type === "event_report") return "alert";
  if (type === "payout_status" || type === "activation_status") return "card";
  if (type === "account_verification") return "mail";
  if (type.startsWith("event_")) return "calendar";
  return "bell";
}

function NotificationsContent() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const query = useQuery({
    queryKey: ["notifications", filter],
    queryFn: () =>
      apiFetch<NotificationItem[]>(
        filter === "unread"
          ? "/notifications?unread_only=true"
          : "/notifications",
      ),
    enabled: !!user,
    refetchInterval: 15_000,
  });
  const read = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/notifications/${id}/read`, { method: "POST" }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  // RequireAuth renders the signed-out state before this mounts.
  if (!user) return null;
  const unreadCount = query.data?.filter((item) => !item.read_at).length ?? 0;
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerClassName="mx-auto w-full max-w-3xl gap-5 pb-16"
    >
      <ScreenHeader
        kicker={t("ui.inbox")}
        title={t("ui.notificationsTitle")}
        right={
          filter === "all" && unreadCount > 0 ? (
            <Chip
              label={`${unreadCount} · ${t("ui.newBadge")}`}
              tone="mint"
              icon="bell"
            />
          ) : undefined
        }
      />
      <SegmentedControl<Filter>
        label={t("notify.filter.label")}
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: t("notify.filter.all") },
          { value: "unread", label: t("notify.filter.unread") },
        ]}
      />
      {read.error ? (
        <Notice tone="danger">{errorText(read.error)}</Notice>
      ) : null}
      {query.isLoading ? <LoadingBlock /> : null}
      {query.error ? (
        <ErrorBlock
          message={errorText(query.error)}
          retry={() => void query.refetch()}
        />
      ) : null}
      {query.data?.map((item) => {
        const target = notificationTarget(item);
        const message = notificationText(item, i18n.language);
        const unread = !item.read_at;
        const markRead = () => {
          if (unread) read.mutate(item.id);
        };
        return (
          <View
            key={item.id}
            className={`gap-3 rounded-[28px] border bg-white p-5 shadow-panel ${unread ? "border-mint" : "border-line"}`}
          >
            <View className="flex-row items-start gap-3">
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className={`h-11 w-11 items-center justify-center rounded-2xl ${unread ? "bg-ink" : "bg-mintsoft"}`}
              >
                <Icon
                  name={notificationIcon(item.type)}
                  size={20}
                  color={unread ? palette.mint : palette.brand}
                />
              </View>
              <View className="min-w-0 flex-1 gap-1">
                <View className="flex-row items-start justify-between gap-3">
                  <Text
                    accessibilityRole="header"
                    className="flex-1 text-lg font-extrabold leading-snug tracking-tight text-ink"
                  >
                    {message.title}
                  </Text>
                  {unread ? (
                    <View className="flex-row items-center gap-1.5 pt-1">
                      <View
                        className="h-2.5 w-2.5 rounded-full bg-mint"
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      />
                      <Text className="text-xs font-extrabold uppercase tracking-wide text-ink">
                        {t("ui.newBadge")}
                      </Text>
                    </View>
                  ) : (
                    <Text className="pt-1 text-xs font-semibold text-muted">
                      {t("notify.read")}
                    </Text>
                  )}
                </View>
                <Text className="leading-6 text-ink">{message.body}</Text>
                <Text className="text-xs text-muted">
                  {formatDateTime(item.created_at, i18n.language, "medium")}
                </Text>
              </View>
            </View>
            {target || unread ? (
              <View className="flex-row flex-wrap items-center gap-2 border-t border-dashed border-line pt-3">
                {target ? (
                  <Link href={target.href} asChild>
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={`${t(`notify.open.${target.kind}`)}: ${message.title}`}
                      onPress={markRead}
                      className="min-h-11 flex-row items-center gap-2 rounded-2xl bg-mint px-4 active:opacity-80"
                    >
                      <Text className="font-bold text-ink">
                        {t(`notify.open.${target.kind}`)}
                      </Text>
                      <Icon name="arrow-right" size={16} color={palette.ink} />
                    </Pressable>
                  </Link>
                ) : null}
                {unread ? (
                  <Button
                    label={t("notify.markRead")}
                    accessibilityLabel={`${t("notify.markRead")}: ${message.title}`}
                    variant="secondary"
                    size="sm"
                    iconName="check"
                    onPress={markRead}
                    loading={read.isPending && read.variables === item.id}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
      {query.data?.length === 0 ? (
        <View className="items-center gap-3 rounded-[28px] border border-dashed border-line bg-white/60 px-4 py-10">
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-white">
            <Icon name="bell" size={22} color={palette.muted} />
          </View>
          <Text className="text-center text-muted">
            {t(filter === "unread" ? "notify.emptyUnread" : "notify.empty")}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

export default function NotificationsPage() {
  return (
    <RequireAuth>
      <NotificationsContent />
    </RequireAuth>
  );
}
