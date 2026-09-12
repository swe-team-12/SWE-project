import { useMutation } from "@tanstack/react-query";
import { Link, router, useLocalSearchParams } from "expo-router";
import { Pressable, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, ErrorBlock, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { EventItem } from "@/types";

export default function InvitationPage() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { user } = useAuth();
  const accept = useMutation({
    mutationFn: () =>
      apiFetch<EventItem>(`/invitations/${token}/accept`, { method: "POST" }),
    onSuccess: (event) =>
      router.replace({ pathname: "/events/[id]", params: { id: event.id } }),
  });
  if (!user) {
    return (
      <Surface className="mx-auto mt-8 max-w-xl gap-4">
        <Text className="text-3xl font-black text-ink">
          {t("ui.privateInvitation")}
        </Text>
        <Text className="text-muted">{t("ui.invitationHelp")}</Text>
        <Link href="/login" asChild>
          <Pressable className="min-h-12 items-center justify-center rounded-2xl bg-brand">
            <Text className="font-bold text-white">{t("common.signIn")}</Text>
          </Pressable>
        </Link>
      </Surface>
    );
  }
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
