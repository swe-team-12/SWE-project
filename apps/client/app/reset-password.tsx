import { useMutation } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AuthCard, AuthLink } from "@/components/design/AuthCard";
import { Button, Field, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/api";

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [password, setPassword] = useState("");
  const reset = useMutation({
    mutationFn: () =>
      apiFetch<{ message: string }>("/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token, password }),
        skipRefresh: true,
      }),
  });
  return (
    <AuthCard
      icon="lock"
      title={t("ui.choosePassword")}
      subtitle={t("ui.passwordHint")}
    >
      {!token ? (
        <Notice tone="danger" role="alert">
          {t("attendee.auth.resetMissingToken")}
        </Notice>
      ) : null}
      <Field
        label={t("ui.newPassword")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        icon="lock"
      />
      <Button
        label={t("ui.updatePassword")}
        onPress={() => reset.mutate()}
        loading={reset.isPending}
        disabled={!token || password.length < 10}
        size="lg"
        fullWidth
      />
      {reset.data ? (
        <>
          <Notice tone="success" role="status" bold>
            {t("attendee.auth.passwordUpdated")}
          </Notice>
          <AuthLink href="/login" label={t("common.signIn")} />
        </>
      ) : null}
      {reset.error ? (
        <Notice tone="danger" role="alert">
          {(reset.error as Error).message || t("ui.somethingWrong")}
        </Notice>
      ) : null}
    </AuthCard>
  );
}
