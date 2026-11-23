import type { PropsWithChildren, ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { type Href, Link } from "expo-router";

import { Icon, type IconName, palette } from "../icons";

/*
 * AuthCard: centred white card used by sign-in, registration, verification,
 * password reset, campaign and invitation pages.
 *
 * Props: title (page heading), subtitle?, kicker?, icon? (IconName shown in a
 * mint badge), footer? (ReactNode under a divider), children.
 */
export function AuthCard({
  title,
  subtitle,
  kicker,
  icon = "ticket",
  footer,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  kicker?: string;
  icon?: IconName;
  footer?: ReactNode;
}>) {
  return (
    <ScrollView contentContainerClassName="flex-grow items-center justify-center px-0 py-6 md:py-12">
      <View className="w-full max-w-lg gap-6 rounded-3xl border border-white/80 bg-white p-6 shadow-float md:p-9">
        <View className="gap-4">
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-night">
            <Icon name={icon} size={26} color={palette.mint} />
          </View>
          <View className="gap-2">
            {kicker ? (
              <Text className="text-xs font-medium text-brand">
                {kicker}
              </Text>
            ) : null}
            <Text
              accessibilityRole="header"
              className="text-3xl font-semibold tracking-tight text-ink md:text-4xl"
            >
              {title}
            </Text>
            {subtitle ? (
              <Text className="text-base leading-6 text-muted">{subtitle}</Text>
            ) : null}
          </View>
        </View>
        {children}
        {footer ? (
          <View className="gap-2 border-t border-line pt-4">{footer}</View>
        ) : null}
      </View>
    </ScrollView>
  );
}

/** Quiet text link used under auth forms (ink text, brand underline). */
export function AuthLink({ href, label }: { href: Href; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable className="min-h-11 flex-row items-center justify-center gap-1 rounded-2xl active:opacity-70">
        <Text className="text-center font-medium text-brand underline">
          {label}
        </Text>
        <Icon name="arrow-right" size={16} color={palette.brand} />
      </Pressable>
    </Link>
  );
}
