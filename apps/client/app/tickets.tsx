import { useMutation, useQuery } from "@tanstack/react-query";
import { type Href, Link } from "expo-router";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { CalendarActions } from "@/components/CalendarActions";
import { durationText } from "@/components/design/durationText";
import { shortDate, shortTime } from "@/components/design/time";
import { Icon, palette } from "@/components/icons";
import { RequireAuth } from "@/components/RequireAuth";
import {
  Button,
  DarkCard,
  ErrorBlock,
  LabeledValue,
  LoadingBlock,
  ScreenHeader,
  StatusBadge,
  Surface,
  TicketStub,
  Timeline,
} from "@/components/ui";
import i18n from "@/i18n";
import { apiFetch, apiFetchBlob } from "@/lib/api";
import { localizedErrorMessage } from "@/lib/errorMessage";
import { formatEventDateTime } from "@/lib/eventTime";
import { downloadAuthenticatedFile } from "@/lib/files";
import { placeText } from "@/lib/placeText";
import { useAuth } from "@/providers/AuthProvider";
import type { TicketInfo } from "@/types";
import { formatDateTime } from "@/utils/date";

/** The wallet endpoint also returns these fields (see TicketOut). */
type WalletTicket = TicketInfo & {
  ends_at?: string | null;
  section?: string | null;
  row?: string | null;
  seat_number?: string | null;
};

function downloadPdf(ticket: TicketInfo) {
  return downloadAuthenticatedFile(
    `/tickets/${ticket.id}/pdf`,
    `${ticket.ticket_code}.pdf`,
    "application/pdf",
    i18n.t("ui.openOrPrintTicket"),
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("unreadable image"));
    reader.onerror = () => reject(new Error("unreadable image"));
    reader.readAsDataURL(blob);
  });
}

/**
 * The QR endpoint needs the bearer token, which an <img> on web cannot send,
 * so the image is fetched through the API client and shown as a data URL.
 */
function TicketQr({ ticket }: { ticket: TicketInfo }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["ticket-qr", ticket.id],
    queryFn: async () =>
      blobToDataUrl(await apiFetchBlob(`/tickets/${ticket.id}/qr.png`)),
    staleTime: 5 * 60_000,
  });
  return (
    <View className="items-center">
      {query.data ? (
        <Image
          source={{ uri: query.data }}
          className="h-56 w-56"
          accessibilityLabel={t("attendee.tickets.qrLabel", {
            code: ticket.ticket_code,
          })}
        />
      ) : (
        <View className="h-56 w-56 items-center justify-center gap-3 rounded-2xl bg-canvas p-3">
          {query.error ? (
            <>
              <Text className="text-center text-danger" role="alert">
                {localizedErrorMessage(
                  query.error,
                  t("attendee.tickets.qrFailed"),
                )}
              </Text>
              <Button
                label={t("common.tryAgain")}
                variant="ghost"
                onPress={() => void query.refetch()}
              />
            </>
          ) : (
            <>
              <Icon name="qr" size={40} color={palette.muted} />
              <Text className="text-muted">{t("common.loading")}</Text>
            </>
          )}
        </View>
      )}
      <Text className="mt-2 text-center text-xs font-bold tracking-wide text-muted">
        {t("ui.keepPrivate")}
      </Text>
    </View>
  );
}

function TextLink({ href, label }: { href: Href; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        className="min-h-11 flex-row items-center gap-1 self-start"
      >
        <Text className="font-bold text-brand">{label}</Text>
        <Icon name="chevron-right" size={16} color={palette.brand} />
      </Pressable>
    </Link>
  );
}

function TicketCard({
  ticket,
  onDownload,
  downloading,
}: {
  ticket: WalletTicket;
  onDownload: () => void;
  downloading: boolean;
}) {
  const { t, i18n: active } = useTranslation();
  const usable = ticket.qr_available ?? ticket.status === "valid";
  const venueLine = [
    ticket.venue_address
      ? placeText(ticket.venue_address, active.language)
      : null,
    ticket.city ? placeText(ticket.city, active.language) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const seatValues = ticket.seat_number
    ? [
        { label: t("attendee.ux.section"), value: ticket.section ?? "–" },
        { label: t("attendee.ux.row"), value: ticket.row ?? "–" },
        { label: t("attendee.tickets.seat"), value: ticket.seat_number },
      ]
    : null;
  const hasEnd = !!ticket.ends_at;
  return (
    <DarkCard className="min-w-72 max-w-xl flex-1 basis-80 gap-5 p-4 md:p-5">
      <View className="flex-row items-start justify-between gap-3 px-1 pt-1">
        <View className="min-w-0 flex-1 gap-1">
          {ticket.starts_at ? (
            <Text className="text-sm text-white/65">
              {formatEventDateTime(
                ticket.starts_at,
                ticket.timezone,
                active.language,
              )}
            </Text>
          ) : null}
          <Text
            accessibilityRole="header"
            className="text-2xl font-extrabold leading-tight tracking-tight text-white"
          >
            {ticket.event_title ?? t("attendee.orders.unknownEvent")}
          </Text>
        </View>
        <StatusBadge status={ticket.status} tone="dark" />
      </View>
      <TicketStub
        footer={
          <>
            {ticket.event_status === "cancelled" ? (
              <Text className="rounded-2xl bg-red-50 p-3 text-danger">
                {t("attendee.orders.eventCancelled")}
              </Text>
            ) : null}
            {usable ? (
              <>
                <TicketQr ticket={ticket} />
                <View className="items-center">
                  <Button
                    label={t("ui.downloadPrint")}
                    iconName="download"
                    onPress={onDownload}
                    loading={downloading}
                  />
                </View>
              </>
            ) : (
              <View className="gap-1 rounded-2xl bg-canvas p-4">
                <Text className="font-extrabold text-ink">
                  {t(`attendee.tickets.inactiveTitle.${ticket.status}`, {
                    defaultValue: t("attendee.tickets.inactiveTitle.other"),
                  })}
                </Text>
                <Text className="text-sm text-muted">
                  {t(`attendee.tickets.inactiveBody.${ticket.status}`, {
                    defaultValue: t("attendee.tickets.inactiveBody.other"),
                  })}
                </Text>
              </View>
            )}
            {ticket.status === "valid" || ticket.status === "checked_in" ? (
              <View className="gap-2">
                <Text className="text-sm font-bold text-ink">
                  {t("common.calendar")}
                </Text>
                <CalendarActions
                  calendar={ticket.calendar}
                  icsPath={
                    ticket.calendar?.ics_path ??
                    `/tickets/${ticket.id}/calendar.ics`
                  }
                  filename={`${ticket.ticket_code}.ics`}
                />
              </View>
            ) : null}
            <View className="flex-row flex-wrap gap-x-6">
              {ticket.order_id ? (
                <TextLink
                  href={`/orders/${ticket.order_id}` as Href}
                  label={t("attendee.orders.viewOrder")}
                />
              ) : null}
              <TextLink
                href={{ pathname: "/support", params: { ticket_id: ticket.id } }}
                label={t("attendee.contactSupport")}
              />
            </View>
          </>
        }
      >
        <View className="flex-row flex-wrap items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <LabeledValue
              label={t("attendee.tickets.attendee")}
              value={ticket.attendee_name || t("ui.admissionTicket")}
              size="lg"
            />
          </View>
          {ticket.ticket_type_name ? (
            <View className="rounded-full bg-mintsoft px-3 py-1">
              <Text className="text-xs font-bold text-ink">
                {ticket.ticket_type_name}
              </Text>
            </View>
          ) : null}
        </View>
        {ticket.starts_at ? (
          <Timeline
            start={shortTime(ticket.starts_at, ticket.timezone)}
            end={hasEnd ? shortTime(ticket.ends_at, ticket.timezone) : "—"}
            startCaption={shortDate(
              ticket.starts_at,
              ticket.timezone,
              active.language,
            )}
            endCaption={
              hasEnd
                ? shortDate(ticket.ends_at, ticket.timezone, active.language)
                : undefined
            }
            middle={durationText(ticket.starts_at, ticket.ends_at, t)}
          />
        ) : null}
        {ticket.venue_name || venueLine ? (
          <View className="gap-0.5">
            <Text className="text-xs text-muted">
              {t("attendee.tickets.where")}
            </Text>
            {ticket.venue_name ? (
              <Text className="text-lg font-extrabold text-ink">
                {ticket.venue_name}
              </Text>
            ) : null}
            {venueLine ? (
              <Text className="text-sm text-muted">{venueLine}</Text>
            ) : null}
          </View>
        ) : null}
        <LabeledValue
          label={t("attendee.ux.bookingReference")}
          value={ticket.order_number ?? ticket.ticket_code}
          size="lg"
        />
        {seatValues ? (
          <View className="flex-row justify-between gap-2 rounded-2xl bg-canvas px-4 py-3">
            {seatValues.map((item) => (
              <LabeledValue
                key={item.label}
                label={item.label}
                value={item.value}
                align="center"
                size="xl"
              />
            ))}
          </View>
        ) : ticket.seat_label ? (
          <LabeledValue
            label={t("attendee.tickets.seat")}
            value={ticket.seat_label}
          />
        ) : null}
        <View className="flex-row flex-wrap gap-x-6 gap-y-2">
          <LabeledValue
            label={t("attendee.ux.ticketCode")}
            value={ticket.ticket_code}
            mono
          />
          {ticket.checked_in_at ? (
            <LabeledValue
              label={t("attendee.tickets.checkedInAt")}
              value={formatDateTime(
                ticket.checked_in_at,
                active.language,
                "medium",
              )}
            />
          ) : null}
        </View>
      </TicketStub>
    </DarkCard>
  );
}

function TicketsContent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["tickets"],
    queryFn: () => apiFetch<WalletTicket[]>("/tickets"),
    enabled: !!user,
  });
  const download = useMutation({ mutationFn: downloadPdf });
  // RequireAuth renders the signed-out state before this mounts.
  if (!user) return null;
  return (
    <ScrollView contentContainerClassName="gap-6 pb-28">
      <ScreenHeader
        kicker={t("ui.wallet")}
        title={t("common.tickets")}
        subtitle={
          query.data?.length
            ? t("attendee.ux.ticketCount", { count: query.data.length })
            : undefined
        }
      />
      {query.isLoading ? <LoadingBlock /> : null}
      {query.error ? (
        <ErrorBlock
          message={(query.error as Error).message}
          retry={() => void query.refetch()}
        />
      ) : null}
      {download.error ? (
        <ErrorBlock
          message={localizedErrorMessage(
            download.error,
            t("ui.downloadFailed"),
          )}
          retry={() => {
            if (download.variables) download.mutate(download.variables);
          }}
        />
      ) : null}
      <View className="flex-row flex-wrap gap-5">
        {query.data?.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            onDownload={() => download.mutate(ticket)}
            downloading={
              download.isPending && download.variables?.id === ticket.id
            }
          />
        ))}
      </View>
      {query.data?.length === 0 ? (
        <Surface tone="plain" className="items-center gap-4 py-12">
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-mintsoft">
            <Icon name="ticket" size={26} color={palette.brand} />
          </View>
          <Text className="max-w-md text-center text-muted">
            {t("ui.noTickets")}
          </Text>
          <TextLink href="/" label={t("attendee.browseEvents")} />
        </Surface>
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
