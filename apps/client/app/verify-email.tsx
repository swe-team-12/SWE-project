import { useMutation } from "@tanstack/react-query";
import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";

export default function VerifyEmailPage() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const verify = useMutation({
    mutationFn: (value: string) =>
      apiFetch("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ token: value }),
        skipRefresh: true,
      }),
  });
  const { mutate } = verify;
  // Tokens are single-use: submit each token at most once automatically,
  // even when React StrictMode runs effects twice in development.
  const submittedToken = useRef<string | null>(null);
  useEffect(() => {
    if (!token || submittedToken.current === token) return;
    submittedToken.current = token;
    mutate(token);
  }, [token, mutate]);
  return (
    <Surface className="mx-auto mt-8 w-full max-w-lg gap-5 p-7">
      <View>
        <Text className="text-3xl font-black text-ink">
          {t("ui.verifyTitle")}
        </Text>
        <Text className="mt-2 text-muted">{t("ui.verifyHelp")}</Text>
      </View>
      {!token ? (
        <Text className="text-danger">{t("ui.verifyMissingToken")}</Text>
      ) : null}
      {token && (verify.isIdle || verify.isPending) ? (
        <Text className="text-muted" accessibilityLiveRegion="polite">
          {t("ui.verifying")}
        </Text>
      ) : null}
      {verify.isSuccess ? (
        <>
          <Text className="rounded-xl bg-emerald-50 p-3 font-bold text-success">
            {t("ui.verified")}
          </Text>
          <Link href="/login" asChild>
            <Pressable className="min-h-11 items-center justify-center rounded-xl border border-brand">
              <Text className="font-bold text-brand">{t("common.signIn")}</Text>
            </Pressable>
          </Link>
        </>
      ) : null}
      {verify.error ? (
        <>
          <Text className="text-danger">{(verify.error as Error).message}</Text>
          <Button
            label={t("common.tryAgain")}
            onPress={() => token && verify.mutate(token)}
            loading={verify.isPending}
            disabled={!token}
          />
        </>
      ) : null}
    </Surface>
  );
}
