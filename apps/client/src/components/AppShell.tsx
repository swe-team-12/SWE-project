import { Link, usePathname } from "expo-router";
import { PropsWithChildren } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/providers/AuthProvider";

const links = [
  { href: "/", key: "discover", roles: [] },
  { href: "/tickets", key: "tickets", roles: ["attendee"] },
  { href: "/orders", key: "orders", roles: ["attendee"] },
  { href: "/organizer", key: "organizer", roles: ["organizer"] },
  {
    href: "/scanner",
    key: "scanner",
    roles: ["attendee", "organizer", "platform_admin"],
  },
  { href: "/support", key: "support", roles: ["attendee"] },
  { href: "/notifications", key: "notifications", roles: ["attendee"] },
  { href: "/admin", key: "admin", roles: ["platform_admin"] },
] as const;

export function AppShell({ children }: PropsWithChildren) {
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const desktop = width >= 920;
  const visible = links.filter(
    (link) =>
      !link.roles.length ||
      link.roles.some((role) => user?.roles.includes(role as never)),
  );
  const languagePicker = (
    <View
      accessibilityLabel={t("ui.language")}
      className="flex-row rounded-xl border border-white/30 bg-ink p-1"
    >
      {(["kk", "ru", "en"] as const).map((locale) => (
        <Pressable
          key={locale}
          accessibilityRole="button"
          accessibilityState={{ selected: i18n.language === locale }}
          onPress={() => void i18n.changeLanguage(locale)}
          className={`min-h-9 justify-center rounded-lg px-2 ${i18n.language === locale ? "bg-aqua" : "bg-transparent"}`}
        >
          <Text
            className={`text-xs font-black uppercase ${i18n.language === locale ? "text-ink" : "text-white"}`}
          >
            {locale}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  const navigation = (
    <View
      className={`${desktop ? "w-60 gap-2" : "flex-row gap-1 overflow-x-auto"}`}
    >
      {visible.map((link) => {
        const active =
          link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link href={link.href} asChild key={link.href}>
            <Pressable
              accessibilityRole="link"
              className={`min-h-11 justify-center rounded-xl px-4 ${active ? "bg-brand" : "bg-transparent"}`}
            >
              <Text
                className={`font-bold ${active ? "text-white" : "text-ink"}`}
              >
                {t(`common.${link.key}`)}
              </Text>
            </Pressable>
          </Link>
        );
      })}
    </View>
  );

  return (
    <View className="min-h-full flex-1 bg-canvas">
      <View className="border-b border-line bg-ink px-5 py-3">
        <View className="mx-auto w-full max-w-7xl flex-row items-center justify-between gap-4">
          <Link href="/" asChild>
            <Pressable
              accessibilityRole="link"
              className="min-h-11 justify-center"
            >
              <Text className="text-2xl font-black tracking-tight text-white">
                BiletFlow
              </Text>
            </Pressable>
          </Link>
          <View className="flex-row items-center gap-3">
            {desktop ? languagePicker : null}
            <View className="hidden rounded-full bg-aqua/20 px-3 py-2 md:flex">
              <Text className="text-xs font-bold text-white">
                {t("common.demo")}
              </Text>
            </View>
            {user ? (
              <Pressable
                onPress={() => void logout()}
                className="min-h-11 justify-center rounded-xl border border-white/30 px-4"
              >
                <Text className="font-bold text-white">
                  {t("common.signOut")}
                </Text>
              </Pressable>
            ) : (
              <Link href="/login" asChild>
                <Pressable className="min-h-11 justify-center rounded-xl bg-aqua px-4">
                  <Text className="font-bold text-ink">
                    {t("common.signIn")}
                  </Text>
                </Pressable>
              </Link>
            )}
          </View>
        </View>
      </View>
      {!desktop ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="h-16 max-h-16 border-b border-line bg-white"
          contentContainerClassName="items-center gap-3 px-3 py-2"
        >
          {languagePicker}
          {navigation}
        </ScrollView>
      ) : null}
      <View
        className={`mx-auto w-full max-w-7xl flex-1 ${desktop ? "flex-row gap-8 p-8" : "p-4"}`}
      >
        {desktop ? <View className="pt-2">{navigation}</View> : null}
        <View className="min-w-0 flex-1">{children}</View>
      </View>
    </View>
  );
}
