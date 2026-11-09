import { useMutation, useQuery } from "@tanstack/react-query";
import { Image, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { RequireAuth } from "@/components/RequireAuth";
import {
  Button,
  ErrorBlock,
  LoadingBlock,
  StatusBadge,
  Surface,
} from "@/components/ui";
import i18n from "@/i18n";
import { API_URL, apiFetch, currentAccessToken } from "@/lib/api";
import { downloadAuthenticatedFile } from "@/lib/files";
import { useAuth } from "@/providers/AuthProvider";
import type { Ticket } from "@/types";

function downloadPdf(ticket: Ticket) {
  return downloadAuthenticatedFile(
    `/tickets/${ticket.id}/pdf`,
    `${ticket.ticket_code}.pdf`,
    "application/pdf",
    i18n.t("ui.openOrPrintTicket"),
  );
}

function TicketsContent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["tickets"],
    queryFn: () => apiFetch<Ticket[]>("/tickets"),
    enabled: !!user,
  });
  const download = useMutation({ mutationFn: downloadPdf });
  // RequireAuth renders the signed-out state before this mounts.
  if (!user) return null;
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
      {download.error ? (
        <ErrorBlock
          message={download.error.message}
          retry={() => {
            if (download.variables) download.mutate(download.variables);
          }}
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
              onPress={() => download.mutate(ticket)}
              loading={
                download.isPending && download.variables?.id === ticket.id
              }
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

export default function TicketsPage() {
  const { t } = useTranslation();
  return (
    <RequireAuth
      title={t("ui.protectedTickets")}
      message={t("ui.protectedTicketsHelp")}
    >
      <TicketsContent />
    </RequireAuth>
  );
}
