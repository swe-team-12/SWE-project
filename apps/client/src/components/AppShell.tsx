import { useQuery } from "@tanstack/react-query";
import { Link, router, usePathname } from "expo-router";
import { PropsWithChildren } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { Icon, type IconName, palette } from "@/components/icons";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";

const links = [
  { href: "/", key: "discover" },
  { href: "/tickets", key: "tickets" },
  { href: "/orders", key: "orders" },
  { href: "/organizer", key: "organizer" },
  { href: "/scanner", key: "scanner" },
  { href: "/support", key: "support" },
  { href: "/notifications", key: "notifications" },
  { href: "/admin", key: "admin" },
] as const;

type LinkKey = (typeof links)[number]["key"];

const linkIcons: Record<LinkKey, IconName> = {
  discover: "search",
  tickets: "ticket",
  orders: "receipt",
  organizer: "calendar",
  scanner: "qr",
  support: "help",
  notifications: "bell",
  admin: "lock",
};

/** Below this width the app uses the mobile layout with a bottom tab bar. */
export const DESKTOP_MIN_WIDTH = 768;

/**
 * Screens that render their own sticky bottom action bar (checkout totals)
 * hide the tab bar so the two never stack or overlap.
 */
export function hidesTabBar(pathname: string): boolean {
  return pathname === "/checkout" || pathname.startsWith("/checkout/");
}

export function isLinkActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Which navigation entries a user gets. Event-level access (staff, check-in)
 * is not a platform role, so it is passed in from the user's assignments.
 */
export function visibleLinkKeys(
  roles: readonly string[] | undefined,
  access: { canScan: boolean; hasOrganizerEvents: boolean },
): LinkKey[] {
  if (!roles) return ["discover"];
  const admin = roles.includes("platform_admin");
  const organizer = roles.includes("organizer");
  const attendee = roles.includes("attendee");
  const shown: Record<LinkKey, boolean> = {
    discover: true,
    tickets: attendee,
    orders: attendee,
    organizer: organizer || access.hasOrganizerEvents,
    scanner: admin || organizer || access.canScan,
    support: attendee,
    notifications: attendee,
    admin,
  };
  return links.filter((link) => shown[link.key]).map((link) => link.key);
}

function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" asChild>
      <Pressable
        accessibilityRole="link"
        className="min-h-11 flex-row items-center gap-2"
      >
        <View
          className={`items-center justify-center rounded-xl bg-ink ${compact ? "h-8 w-8" : "h-9 w-9"}`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Icon name="ticket" size={18} color={palette.mint} />
        </View>
        <Text
          className={`font-extrabold tracking-tight text-ink ${compact ? "text-lg" : "text-2xl"}`}
        >
          BiletFlow
        </Text>
      </Pressable>
    </Link>
  );
}

export function AppShell({ children }: PropsWithChildren) {
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const desktop = width >= DESKTOP_MIN_WIDTH;
  const handleSignOut = async () => {
    await logout().catch(() => undefined);
    router.replace("/");
  };
  const roles = user?.roles;
  const privileged =
    !!roles?.includes("platform_admin") || !!roles?.includes("organizer");
  // Staff are assigned per event, so their access comes from the API rather
  // than from a platform role. Keys include the user so a new sign-in never
  // inherits the previous account's navigation.
  const scannable = useQuery({
    queryKey: ["nav-scanner-events", user?.id],
    queryFn: () => apiFetch<unknown[]>("/scanner/events"),
    enabled: !!user && !privileged,
    staleTime: 60_000,
  });
  const staffed = useQuery({
    queryKey: ["nav-organizer-events", user?.id],
    queryFn: () => apiFetch<unknown[]>("/organizer/events"),
    enabled: !!user && !privileged,
    staleTime: 60_000,
  });
  const shownKeys = visibleLinkKeys(roles, {
    canScan: (scannable.data?.length ?? 0) > 0,
    hasOrganizerEvents: (staffed.data?.length ?? 0) > 0,
  });
  const visible = links.filter((link) => shownKeys.includes(link.key));
  const showTabBar = !desktop && !hidesTabBar(pathname);

  const languagePicker = (
    <View
      accessibilityLabel={t("ui.language")}
      className="flex-row rounded-2xl border border-line bg-white/80 p-1"
    >
      {(["kk", "ru", "en"] as const).map((locale) => {
        const selected = i18n.language === locale;
        return (
          <Pressable
            key={locale}
            accessibilityRole="button"
            accessibilityLabel={locale}
            accessibilityState={{ selected }}
            onPress={() => void i18n.changeLanguage(locale)}
            className={`min-h-9 items-center justify-center rounded-xl ${desktop ? "min-w-9 px-2" : "min-w-8 px-1"} ${selected ? "bg-ink" : "bg-transparent"}`}
          >
            <Text
              className={`text-xs uppercase ${selected ? "font-extrabold text-white" : "font-bold text-muted"}`}
            >
              {locale}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const account = user ? (
    <Pressable
      accessibilityRole="button"
      onPress={() => void handleSignOut()}
      className={`min-h-11 justify-center rounded-2xl border border-line bg-white active:opacity-80 ${desktop ? "px-4" : "px-3"}`}
    >
      <Text className="font-bold text-ink">{t("common.signOut")}</Text>
    </Pressable>
  ) : (
    <Link href="/login" asChild>
      <Pressable
        className={`min-h-11 justify-center rounded-2xl bg-mint active:opacity-80 ${desktop ? "px-4" : "px-3"}`}
      >
        <Text className="font-bold text-ink">{t("common.signIn")}</Text>
      </Pressable>
    </Link>
  );

  const pillNavigation = (
    <View
      accessibilityLabel={t("ui.navigation")}
      className="flex-row flex-wrap gap-1 self-start rounded-2xl border border-line bg-white/70 p-1"
    >
      {visible.map((link) => {
        const active = isLinkActive(link.href, pathname);
        return (
          <Link href={link.href} asChild key={link.href}>
            <Pressable
              accessibilityRole="link"
              accessibilityState={{ selected: active }}
              className={`min-h-10 flex-row items-center gap-2 rounded-xl px-3 ${active ? "bg-ink" : "bg-transparent active:bg-mintsoft"}`}
            >
              <Icon
                name={linkIcons[link.key]}
                size={16}
                color={active ? palette.mint : palette.muted}
              />
              <Text
                className={`text-sm ${active ? "font-extrabold text-white" : "font-semibold text-ink"}`}
              >
                {t(`common.${link.key}`)}
              </Text>
            </Pressable>
          </Link>
        );
      })}
    </View>
  );

  const tabItems = visible.map((link) => {
    const active = isLinkActive(link.href, pathname);
    return (
      <Link href={link.href} asChild key={link.href}>
        <Pressable
          accessibilityRole="link"
          accessibilityState={{ selected: active }}
          className={`min-h-14 items-center justify-center gap-1 rounded-2xl px-1 py-1.5 ${visible.length > 5 ? "w-[72px]" : "min-w-0 flex-1"}`}
        >
          <View
            className={`h-8 w-11 items-center justify-center rounded-xl ${active ? "bg-ink" : "bg-transparent"}`}
          >
            <Icon
              name={linkIcons[link.key]}
              size={20}
              color={active ? palette.mint : palette.muted}
              strokeWidth={active ? 2.4 : 2}
            />
          </View>
          <Text
            numberOfLines={1}
            className={`text-[11px] ${active ? "font-extrabold text-ink" : "font-medium text-muted"}`}
          >
            {t(`common.${link.key}`)}
          </Text>
        </Pressable>
      </Link>
    );
  });

  return (
    <View
      className={`min-h-full flex-1 ${Platform.OS === "web" ? "bg-transparent" : "bg-canvas"}`}
    >
      {desktop ? (
        <View className="px-8 pt-5">
          <View className="mx-auto w-full max-w-[1100px] gap-3 rounded-[28px] border border-line bg-white/80 px-5 py-3 shadow-panel">
            <View className="flex-row items-center justify-between gap-4">
              <Wordmark />
              <View className="flex-row items-center gap-3">
                {languagePicker}
                <View className="hidden rounded-full border border-mint/60 bg-mintsoft px-3 py-2 md:flex">
                  <Text className="text-xs font-bold text-ink">
                    {t("common.demo")}
                  </Text>
                </View>
                {account}
              </View>
            </View>
            {pillNavigation}
          </View>
        </View>
      ) : (
        <View className="flex-row items-center justify-between gap-2 px-4 pb-1 pt-3">
          <Wordmark compact />
          <View className="flex-row items-center gap-2">
            {languagePicker}
            {account}
          </View>
        </View>
      )}
      <View
        className={`mx-auto w-full max-w-[1100px] flex-1 ${desktop ? "px-8 pb-4 pt-6" : "px-4 pt-3"}`}
      >
        {children}
      </View>
      {showTabBar ? (
        // In the layout flow (not overlaid), so page content and sticky bars
        // always end above the floating bar instead of underneath it.
        <View className="px-3 pb-3 pt-1">
          <View
            accessibilityLabel={t("ui.navigation")}
            className="rounded-3xl border border-line bg-white shadow-float"
          >
            {visible.length > 5 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="gap-1 p-1.5"
              >
                {tabItems}
              </ScrollView>
            ) : (
              <View className="flex-row gap-1 p-1.5">{tabItems}</View>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}
