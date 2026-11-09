import { Link, usePathname } from "expo-router";
import type { PropsWithChildren } from "react";
import { Pressable, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { LoadingBlock, Surface } from "@/components/ui";
import { useAuth } from "@/providers/AuthProvider";
import { loginHref } from "@/lib/loginRedirect";

interface SignInPromptProps {
  title?: string;
  message?: string;
}

/** Signed-out state for account-only pages: explains and links to sign-in. */
export function SignInPrompt({ title, message }: SignInPromptProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  return (
    <Surface className="mx-auto mt-8 w-full max-w-xl gap-4 p-7">
      <Text accessibilityRole="header" className="text-3xl font-black text-ink">
        {title ?? t("ui.signInRequired")}
      </Text>
      <Text className="text-muted">
        {message ?? t("ui.signInRequiredHelp")}
      </Text>
      <Link href={loginHref(pathname)} asChild>
        <Pressable
          accessibilityRole="button"
          className="min-h-12 items-center justify-center rounded-2xl bg-brand px-6"
        >
          <Text className="font-bold text-white">{t("common.signIn")}</Text>
        </Pressable>
      </Link>
    </Surface>
  );
}

/**
 * Renders children only for a signed-in user. While the stored session is
 * being restored it shows a loading state, so a returning user never sees the
 * sign-in prompt flash and the page never fires unauthenticated requests.
 */
export function RequireAuth({
  children,
  ...prompt
}: PropsWithChildren<SignInPromptProps>) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingBlock />;
  if (!user) return <SignInPrompt {...prompt} />;
  return <>{children}</>;
}
