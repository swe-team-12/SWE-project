import "react-native-gesture-handler";
import "../global.css";
import "@/i18n";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppShell } from "@/components/AppShell";
import { AuthProvider } from "@/providers/AuthProvider";

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
      }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="light" />
          <AppShell>
            <Stack screenOptions={{ headerShown: false }} />
          </AppShell>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
