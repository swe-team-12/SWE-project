import { useMutation } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { RequireAuth } from "@/components/RequireAuth";
import { AuthCard } from "@/components/design/AuthCard";
import { Icon, palette } from "@/components/icons";
import { Button, ErrorBlock } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { EventItem } from "@/types";

function InvitationContent() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { user } = useAuth();
  const accept = useMutation({
    mutationFn: () =>
      apiFetch<EventItem>(`/invitations/${token}/accept`, { method: "POST" }),
    onSuccess: (event) =>
      router.replace({ pathname: "/events/[id]", params: { id: event.id } }),
  });
  // RequireAuth renders the signed-out state before this mounts.
  if (!user) return null;
  return (
    <AuthCard
      icon="mail"
      title={t("ui.privateInvitation")}
      subtitle={t("ui.invitationHelp")}
    >
      <View className="flex-row items-center gap-3 rounded-2xl bg-canvas p-4">
        <Icon name="user" size={18} color={palette.brand} />
        <Text className="flex-1 font-bold text-ink">{user.email}</Text>
      </View>
      <Button
        label={t("ui.acceptInvitation")}
        onPress={() => accept.mutate()}
        loading={accept.isPending}
        size="lg"
        fullWidth
      />
      {accept.error ? (
        <ErrorBlock message={(accept.error as Error).message} />
      ) : null}
    </AuthCard>
  );
}

export default function InvitationPage() {
  const { t } = useTranslation();
  return (
    <RequireAuth
      title={t("ui.privateInvitation")}
      message={t("ui.invitationHelp")}
    >
      <InvitationContent />
    </RequireAuth>
  );
}
