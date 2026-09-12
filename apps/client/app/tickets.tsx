import { useQuery } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import { Link } from "expo-router";
import * as Sharing from "expo-sharing";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import {
  Button,
  ErrorBlock,
  LoadingBlock,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { API_URL, apiFetch, currentAccessToken } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { Ticket } from "@/types";

async function downloadPdf(ticket: Ticket) {
  const response = await fetch(`${API_URL}/tickets/${ticket.id}/pdf`, {
    headers: { Authorization: `Bearer ${currentAccessToken()}` },
  });
  if (!response.ok) throw new Error("Could not generate the ticket PDF.");
  const blob = await response.blob();
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${ticket.ticket_code}.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, `${ticket.ticket_code}.pdf`);
  file.write(new Uint8Array(await blob.arrayBuffer()));
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/pdf",
    dialogTitle: "Open or print ticket",
  });
}

export default function TicketsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["tickets"],
    queryFn: () => apiFetch<Ticket[]>("/tickets"),
    enabled: !!user,
  });
  if (!user) {
    return (
      <Surface className="mx-auto mt-8 max-w-xl gap-4">
        <Text className="text-3xl font-black text-ink">
          {t("ui.protectedTickets")}
        </Text>
        <Text className="text-muted">{t("ui.protectedTicketsHelp")}</Text>
        <Link href="/login" asChild>
          <Pressable className="min-h-12 items-center justify-center rounded-2xl bg-brand">
            <Text className="font-bold text-white">{t("common.signIn")}</Text>
          </Pressable>
        </Link>
      </Surface>
    );
  }
  return (
    <ScrollView contentContainerClassName="gap-6 pb-16">
      <View>
        <Text className="text-sm font-black uppercase tracking-wider text-brand">
          {t("ui.wallet")}
        </Text>
        <Text className="mt-1 text-4xl font-black text-ink">
          {t("common.tickets")}
        </Text>
      </View>
      {query.isLoading ? <LoadingBlock /> : null}
      {query.error ? (
        <ErrorBlock
          message={(query.error as Error).message}
          retry={() => void query.refetch()}
        />
      ) : null}
      <View className="flex-row flex-wrap gap-5">
        {query.data?.map((ticket) => (
          <Surface className="min-w-72 flex-1 gap-5" key={ticket.id}>
            <View className="flex-row items-start justify-between gap-3">
              <View>
                <Text className="text-xs font-black uppercase text-muted">
                  {t("ui.admissionTicket")}
                </Text>
                <Text className="mt-1 text-xl font-black text-ink">
                  {ticket.ticket_code}
                </Text>
              </View>
              <StatusBadge status={ticket.status} />
            </View>
            <View className="items-center rounded-2xl bg-white p-4">
              <Image
                source={{
                  uri: `${API_URL}/tickets/${ticket.id}/qr.png`,
                  headers: { Authorization: `Bearer ${currentAccessToken()}` },
                }}
                className="h-56 w-56"
                accessibilityLabel={`Admission QR for ticket ${ticket.ticket_code}`}
              />
              <Text className="mt-2 text-center text-xs font-bold text-muted">
                {t("ui.keepPrivate")}
              </Text>
            </View>
            <Button
              label={t("ui.downloadPrint")}
              variant="secondary"
              onPress={() => void downloadPdf(ticket)}
            />
          </Surface>
        ))}
      </View>
      {query.data?.length === 0 ? (
        <Text className="py-16 text-center text-muted">
          {t("ui.noTickets")}
        </Text>
      ) : null}
    </ScrollView>
  );
}
