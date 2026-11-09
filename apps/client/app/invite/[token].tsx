import { useMutation } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { RequireAuth } from "@/components/RequireAuth";
import { Button, ErrorBlock, Surface } from "@/components/ui";
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
    <Surface className="mx-auto mt-8 max-w-xl gap-4">
      <Text className="text-3xl font-black text-ink">
        {t("ui.privateInvitation")}
      </Text>
      <Text className="text-muted">{user.email}</Text>
      <Button
        label={t("ui.acceptInvitation")}
        onPress={() => accept.mutate()}
        loading={accept.isPending}
      />
      {accept.error ? (
        <ErrorBlock message={(accept.error as Error).message} />
      ) : null}
    </Surface>
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
