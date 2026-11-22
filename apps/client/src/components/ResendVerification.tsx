import { useMutation } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon, palette } from "@/components/icons";
import { Button, Field, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { localizedErrorMessage } from "@/lib/errorMessage";

/**
 * Requests a fresh verification link. The API never reveals whether the
 * address has an account, so the confirmation is intentionally neutral.
 * Outside production the API also returns the token, which is offered as a
 * clearly labelled demonstration shortcut.
 */
export function ResendVerification({
  defaultEmail = "",
  lockEmail = false,
}: {
  defaultEmail?: string;
  lockEmail?: boolean;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(defaultEmail);
  const [touched, setTouched] = useState(false);
  const normalized = normalizeEmail(email);
  const valid = isValidEmail(normalized);
  const resend = useMutation({
    mutationFn: (value: string) =>
      apiFetch<{ development_verification_token?: string }>(
        "/auth/verify-email/resend",
        {
          method: "POST",
          body: JSON.stringify({ email: value }),
          skipRefresh: true,
        },
      ),
  });
  const submit = () => {
    setTouched(true);
    if (valid) resend.mutate(normalized);
  };
  return (
    <View className="gap-3">
      {lockEmail ? null : (
        <Field
          label={t("common.email")}
          value={email}
          onChangeText={setEmail}
          onBlur={() => setTouched(true)}
          error={
            touched && normalized && !valid ? t("ui.invalidEmail") : undefined
          }
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          icon="mail"
        />
      )}
      <Button
        label={t("attendee.auth.resendVerification")}
        variant="secondary"
        onPress={submit}
        loading={resend.isPending}
        disabled={!normalized}
        iconName="mail"
      />
      {resend.isSuccess ? (
        <Notice tone="success" role="status" bold>
          {t("attendee.auth.resendQueued")}
        </Notice>
      ) : null}
      {resend.data?.development_verification_token ? (
        <Link
          href={{
            pathname: "/verify-email",
            params: { token: resend.data.development_verification_token },
          }}
          asChild
        >
          <Pressable
            accessibilityRole="link"
            className="min-h-11 flex-row items-center justify-center gap-2 rounded-2xl border border-line bg-mintsoft px-3 active:opacity-80"
          >
            <Icon name="sparkle" size={16} color={palette.brand} />
            <Text className="text-center font-bold text-ink">
              {t("attendee.auth.openDemoVerification")}
            </Text>
          </Pressable>
        </Link>
      ) : null}
      {resend.error ? (
        <Notice tone="danger" role="alert">
          {localizedErrorMessage(resend.error, t("ui.somethingWrong"))}
        </Notice>
      ) : null}
    </View>
  );
}
