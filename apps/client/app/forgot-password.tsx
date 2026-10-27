import { useMutation } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, Field, Surface } from "@/components/ui";
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
    <Surface className="mx-auto mt-8 w-full max-w-lg gap-5 p-7">
      <View>
        <Text className="text-3xl font-black text-ink">
          {t("ui.resetTitle")}
        </Text>
        <Text className="mt-2 text-muted">{t("ui.resetHelp")}</Text>
      </View>
      <Field
        label={t("common.email")}
        value={email}
        onChangeText={setEmail}
        onBlur={() => setShowValidation(true)}
        error={emailError}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      <Button
        label={t("ui.sendReset")}
        onPress={submit}
        loading={request.isPending}
        disabled={!trimmedEmail}
      />
      {request.data ? (
        <Text className="rounded-xl bg-emerald-50 p-3 font-bold text-success">
          {request.data.message}
        </Text>
      ) : null}
      {request.error ? (
        <Text className="text-danger">{(request.error as Error).message}</Text>
      ) : null}
      <Link href="/login" asChild>
        <Pressable className="min-h-11 items-center justify-center">
          <Text className="font-bold text-brand">{t("ui.signInAgain")}</Text>
        </Pressable>
      </Link>
    </Surface>
  );
}
