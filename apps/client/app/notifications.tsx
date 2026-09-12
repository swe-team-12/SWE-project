import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ErrorBlock, LoadingBlock, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { case_id?: string; event_id?: string; order_id?: string };
  read_at?: string;
  created_at: string;
}

export default function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetch<NotificationItem[]>("/notifications"),
    enabled: !!user,
    refetchInterval: 15_000,
  });
  const read = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  if (!user) return <ErrorBlock message={t("ui.signInHelp")} />;
  if (query.isLoading) return <LoadingBlock />;
  if (query.error)
    return <ErrorBlock message={(query.error as Error).message} />;
  return (
    <ScrollView contentContainerClassName="mx-auto w-full max-w-4xl gap-5 pb-16">
      <View>
        <Text className="text-sm font-black uppercase tracking-wider text-brand">
          {t("ui.inbox")}
        </Text>
        <Text className="mt-1 text-4xl font-black text-ink">
          {t("ui.notificationsTitle")}
        </Text>
      </View>
      {query.data?.map((item) => {
        const href = item.data.case_id
          ? {
              pathname: "/support/[id]" as const,
              params: { id: item.data.case_id },
            }
          : item.data.event_id
            ? {
                pathname: "/events/[id]" as const,
                params: { id: item.data.event_id },
              }
            : undefined;
        const content = (
          <Surface
            className={`gap-2 ${item.read_at ? "opacity-70" : "border-aqua"}`}
          >
            <View className="flex-row items-start justify-between gap-3">
              <Text className="flex-1 text-lg font-black text-ink">
                {item.title}
              </Text>
              {!item.read_at ? (
                <View className="rounded-full bg-aqua px-2 py-1">
                  <Text className="text-xs font-black text-ink">
                    {t("ui.newBadge")}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text className="leading-6 text-muted">{item.body}</Text>
            <Text className="text-xs text-muted">
              {new Date(item.created_at).toLocaleString(i18n.language)}
            </Text>
          </Surface>
        );
        return href ? (
          <Link href={href} asChild key={item.id}>
            <Pressable
              onPress={() => {
                if (!item.read_at) read.mutate(item.id);
              }}
              accessibilityRole="link"
            >
              {content}
            </Pressable>
          </Link>
        ) : (
          <Pressable
            key={item.id}
            onPress={() => {
              if (!item.read_at) read.mutate(item.id);
            }}
            accessibilityRole="button"
          >
            {content}
          </Pressable>
        );
      })}
      {query.data?.length === 0 ? (
        <Surface>
          <Text className="text-muted">{t("common.noResults")}</Text>
        </Surface>
      ) : null}
    </ScrollView>
  );
}
