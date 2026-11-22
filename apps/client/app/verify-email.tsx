import { useMutation } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { ResendVerification } from "@/components/ResendVerification";
import { AuthCard, AuthLink } from "@/components/design/AuthCard";
import { Button, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { localizedErrorMessage } from "@/lib/errorMessage";
import { useAuth } from "@/providers/AuthProvider";

export default function VerifyEmailPage() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { user, refreshUser } = useAuth();
  const verify = useMutation({
    mutationFn: (value: string) =>
      apiFetch("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ token: value }),
        skipRefresh: true,
      }),
    // A signed-in user sees the verified state without signing in again.
    onSuccess: () => {
      if (user) void refreshUser().catch(() => undefined);
    },
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
    <AuthCard
      icon="mail"
      title={t("ui.verifyTitle")}
      subtitle={t("ui.verifyHelp")}
    >
      {!token ? (
        <>
          <Notice tone="danger">{t("ui.verifyMissingToken")}</Notice>
          {user?.is_email_verified ? (
            <Notice tone="success" bold>
              {t("attendee.auth.alreadyVerified")}
            </Notice>
          ) : (
            <ResendVerification
              defaultEmail={user?.email}
              lockEmail={!!user}
            />
          )}
        </>
      ) : null}
      {token && (verify.isIdle || verify.isPending) ? (
        <Notice role="status">{t("ui.verifying")}</Notice>
      ) : null}
      {verify.isSuccess ? (
        <>
          <Notice tone="success" bold>
            {t("ui.verified")}
          </Notice>
          <AuthLink
            href={user ? "/" : "/login"}
            label={user ? t("attendee.browseEvents") : t("common.signIn")}
          />
        </>
      ) : null}
      {verify.error ? (
        <>
          <Notice tone="danger" role="alert">
            {localizedErrorMessage(verify.error, t("ui.somethingWrong"))}
          </Notice>
          <Button
            label={t("common.tryAgain")}
            onPress={() => token && verify.mutate(token)}
            loading={verify.isPending}
            disabled={!token}
            size="lg"
            fullWidth
          />
          <Text className="text-sm text-muted">
            {t("attendee.auth.resendHelp")}
          </Text>
          <ResendVerification defaultEmail={user?.email} lockEmail={!!user} />
        </>
      ) : null}
    </AuthCard>
  );
}
