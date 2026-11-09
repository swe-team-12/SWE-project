import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { RequireAuth } from "@/components/RequireAuth";
import {
  ErrorBlock,
  LoadingBlock,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { formatDateTime } from "@/utils/date";
import { formatKzt } from "@/utils/format";

interface Order {
  id: string;
  order_number: string;
  event_id: string;
  status: string;
  total_tiyin: number;
  created_at: string;
}

function OrdersContent() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiFetch<Order[]>("/orders"),
    enabled: !!user,
  });
  // RequireAuth renders the signed-out state before this mounts.
  if (!user) return null;
  return (
    <ScrollView contentContainerClassName="gap-6 pb-16">
      <View>
        <Text className="text-sm font-black uppercase tracking-wider text-brand">
          {t("ui.account")}
        </Text>
        <Text className="mt-1 text-4xl font-black text-ink">
          {t("ui.orderHistory")}
        </Text>
      </View>
      {query.isLoading ? <LoadingBlock /> : null}
      {query.error ? (
        <ErrorBlock message={(query.error as Error).message} />
      ) : null}
      {query.data?.map((order) => (
        <Surface
          key={order.id}
          className="flex-row flex-wrap items-center justify-between gap-4"
        >
          <View className="gap-1">
            <Text className="font-mono text-xs font-bold text-brand">
              {order.order_number}
            </Text>
            <Text className="font-bold text-ink">
              {formatDateTime(order.created_at, i18n.language)}
            </Text>
            <Text className="text-sm text-muted">
              {t("ui.eventLabel", { id: order.event_id })}
            </Text>
          </View>
          <View className="items-end gap-2">
            <StatusBadge status={order.status} />
            <Text className="text-xl font-black text-ink">
              {formatKzt(order.total_tiyin)}
            </Text>
          </View>
        </Surface>
      ))}
      {query.data?.length === 0 ? (
        <Text className="py-16 text-center text-muted">{t("ui.noOrders")}</Text>
      ) : null}
    </ScrollView>
  );
}

export default function OrdersPage() {
  return (
    <RequireAuth>
      <OrdersContent />
    </RequireAuth>
  );
}
