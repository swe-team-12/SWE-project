import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AuthCard, AuthLink } from "@/components/design/AuthCard";
import { Button, Field, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { isValidEmail, normalizeEmail } from "@/lib/email";

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const trimmedEmail = normalizeEmail(email);
  const emailValid = isValidEmail(trimmedEmail);
  const emailError =
    showValidation && trimmedEmail && !emailValid
      ? t("ui.invalidEmail")
      : undefined;
  const request = useMutation({
    mutationFn: (value: string) =>
      apiFetch<{ message: string }>("/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: value }),
        skipRefresh: true,
      }),
  });
  const submit = () => {
    setShowValidation(true);
    if (!emailValid) return;
    setEmail(trimmedEmail);
    request.mutate(trimmedEmail);
  };
  return (
    <AuthCard
      icon="lock"
      title={t("ui.resetTitle")}
      subtitle={t("ui.resetHelp")}
      footer={<AuthLink href="/login" label={t("ui.signInAgain")} />}
    >
      <Field
        label={t("common.email")}
        value={email}
        onChangeText={setEmail}
        onBlur={() => setShowValidation(true)}
        error={emailError}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        icon="mail"
      />
      <Button
        label={t("ui.sendReset")}
        onPress={submit}
        loading={request.isPending}
        disabled={!trimmedEmail}
        size="lg"
        fullWidth
      />
      {request.data ? (
        <Notice tone="success" role="status" bold>
          {t("attendee.auth.resetRequested")}
        </Notice>
      ) : null}
      {request.error ? (
        <Notice tone="danger" role="alert">
          {(request.error as Error).message || t("ui.somethingWrong")}
        </Notice>
      ) : null}
    </AuthCard>
  );
}
