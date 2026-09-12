import { useMutation } from "@tanstack/react-query";
import { Link, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, Field, Surface } from "@/components/ui";
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
    <Surface className="mx-auto mt-8 w-full max-w-lg gap-5 p-7">
      <View>
        <Text className="text-3xl font-black text-ink">
          {t("ui.choosePassword")}
        </Text>
        <Text className="mt-2 text-muted">{t("ui.passwordHint")}</Text>
      </View>
      <Field
        label={t("ui.newPassword")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
      />
      <Button
        label={t("ui.updatePassword")}
        onPress={() => reset.mutate()}
        loading={reset.isPending}
        disabled={password.length < 10}
      />
      {reset.data ? (
        <>
          <Text className="rounded-xl bg-emerald-50 p-3 font-bold text-success">
            {reset.data.message}
          </Text>
          <Link href="/login" asChild>
            <Pressable className="min-h-11 items-center justify-center rounded-xl border border-brand">
              <Text className="font-bold text-brand">{t("common.signIn")}</Text>
            </Pressable>
          </Link>
        </>
      ) : null}
      {reset.error ? (
        <Text className="text-danger">{(reset.error as Error).message}</Text>
      ) : null}
    </Surface>
  );
}
