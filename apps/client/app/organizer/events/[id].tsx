import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BarChart, Funnel, LineChart } from "@/components/Charts";
import {
  Button,
  ErrorBlock,
  Field,
  LoadingBlock,
  Metric,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { API_URL, apiFetch, currentAccessToken } from "@/lib/api";
import { fileForm } from "@/lib/files";
import type { EventItem } from "@/types";
import { formatKzt, newIdempotencyKey } from "@/utils/format";

interface Analytics {
  kpis: Record<string, number>;
  ticket_types: {
    name: string;
    capacity: number;
    available: number;
    reserved: number;
    sold: number;
    refunded: number;
    cancelled: number;
    checked_in: number;
    revenue_tiyin: number;
  }[];
  campaigns: { name: string; redemptions: number; net_tiyin: number }[];
  sales_over_time: {
    date: string;
    orders: number;
    tickets: number;
    revenue_tiyin: number;
  }[];
  traffic_funnel: {
    event_views: number;
    campaign_views: number;
    checkout_starts: number;
    demo_purchases: number;
  };
}

interface EventOrder {
  id: string;
  order_number: string;
  status: string;
  total_tiyin: number;
  organizer_net_tiyin: number;
  created_at: string;
}

interface StaffMember {
  id: string;
  email: string;
  display_name: string;
  role: "manager" | "support" | "finance" | "check_in";
}

export default function ManageEventPage() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useQueryClient();
  const events = useQuery({
    queryKey: ["organizer-events"],
    queryFn: () => apiFetch<EventItem[]>("/organizer/events"),
  });
  const event = events.data?.find((item) => item.id === id);
  const analytics = useQuery({
    queryKey: ["analytics", id],
    queryFn: () => apiFetch<Analytics>(`/events/${id}/analytics`),
    enabled: !!event,
  });
  const history = useQuery({
    queryKey: ["history", id],
    queryFn: () =>
      apiFetch<
        { id: string; timestamp: string; action: string; description: string }[]
      >(`/events/${id}/history`),
    enabled: !!event,
  });
  const campaigns = useQuery({
    queryKey: ["campaigns", id],
    queryFn: () =>
      apiFetch<
        { id: string; name: string; code: string; is_enabled: boolean }[]
      >(`/events/${id}/campaigns`),
    enabled: !!event,
  });
  const orders = useQuery({
    queryKey: ["event-orders", id],
    queryFn: () => apiFetch<{ items: EventOrder[] }>(`/events/${id}/orders`),
    enabled: !!event,
  });
  const staff = useQuery({
    queryKey: ["event-staff", id],
    queryFn: () => apiFetch<StaffMember[]>(`/events/${id}/staff`),
    enabled: !!event,
  });
  const [ticketName, setTicketName] = useState("");
  const [ticketPrice, setTicketPrice] = useState("0");
  const [ticketQuantity, setTicketQuantity] = useState("100");
  const [ticketCategory, setTicketCategory] = useState("standard");
  const [campaignName, setCampaignName] = useState("");
  const [campaignCode, setCampaignCode] = useState("");
  const [campaignDiscountType, setCampaignDiscountType] = useState<
    "percentage" | "fixed_kzt"
  >("percentage");
  const [campaignDiscountValue, setCampaignDiscountValue] = useState("20");
  const [campaignMaxRedemptions, setCampaignMaxRedemptions] = useState("100");
  const [campaignStartsAt, setCampaignStartsAt] = useState("");
  const [campaignEndsAt, setCampaignEndsAt] = useState("");
  const [campaignTicketTypes, setCampaignTicketTypes] = useState<string[]>([]);
  const [staffEmail, setStaffEmail] = useState("");
  const [staffRole, setStaffRole] = useState<StaffMember["role"]>("check_in");
  const [invitationEmail, setInvitationEmail] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ["organizer-events"] });
    await client.invalidateQueries({ queryKey: ["analytics", id] });
    await client.invalidateQueries({ queryKey: ["history", id] });
  };
  const action = useMutation({
    mutationFn: (name: string) =>
      apiFetch(`/events/${id}/${name}`, {
        method: "POST",
        body:
          name === "activation/simulate"
            ? JSON.stringify({
                outcome: "success",
                idempotency_key: newIdempotencyKey("activation"),
                terms_accepted: true,
                organizer_verification_confirmed: true,
              })
            : undefined,
      }),
    onSuccess: invalidate,
  });
  const ticket = useMutation({
    mutationFn: () =>
      apiFetch(`/events/${id}/ticket-types`, {
        method: "POST",
        body: JSON.stringify({
          name: ticketName,
          description: `${ticketName} admission`,
          price_tiyin: Math.round(Number(ticketPrice) * 100),
          quantity: Number(ticketQuantity),
          max_per_order: 6,
          price_category:
            event?.seating_mode === "assigned" ? ticketCategory : null,
        }),
      }),
    onSuccess: async () => {
      setTicketName("");
      await invalidate();
    },
  });
  const campaign = useMutation({
    mutationFn: () =>
      apiFetch(`/events/${id}/campaigns`, {
        method: "POST",
        body: JSON.stringify({
          name: campaignName,
          code: campaignCode || null,
          discount_type: campaignDiscountType,
          discount_value:
            campaignDiscountType === "fixed_kzt"
              ? Math.round(Number(campaignDiscountValue) * 100)
              : Number(campaignDiscountValue),
          starts_at: campaignStartsAt || null,
          ends_at: campaignEndsAt || null,
          max_redemptions: campaignMaxRedemptions
            ? Number(campaignMaxRedemptions)
            : null,
          applicable_ticket_type_ids: campaignTicketTypes,
        }),
      }),
    onSuccess: async () => {
      setCampaignName("");
      setCampaignCode("");
      setCampaignTicketTypes([]);
      await client.invalidateQueries({ queryKey: ["campaigns", id] });
    },
  });
  const disableCampaign = useMutation({
    mutationFn: (campaignId: string) =>
      apiFetch("/campaigns/" + campaignId + "/disable", { method: "PATCH" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["campaigns", id] }),
  });
  const image = useMutation({
    mutationFn: async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["image/jpeg", "image/png"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return null;
      const asset = picked.assets[0];
      const form = await fileForm(asset);
      return apiFetch(`/events/${id}/image`, { method: "POST", body: form });
    },
    onSuccess: () => events.refetch(),
  });
  const assignStaff = useMutation({
    mutationFn: () =>
      apiFetch(`/events/${id}/staff`, {
        method: "POST",
        body: JSON.stringify({ email: staffEmail, role: staffRole }),
      }),
    onSuccess: async () => {
      setStaffEmail("");
      await staff.refetch();
    },
  });
  const invite = useMutation({
    mutationFn: () =>
      apiFetch<{ url: string }>(
        "/events/" +
          id +
          "/invitations?email=" +
          encodeURIComponent(invitationEmail),
        { method: "POST" },
      ),
    onSuccess: () => setInvitationEmail(""),
  });
  const refund = useMutation({
    mutationFn: (orderId: string) =>
      apiFetch(
        `/orders/${orderId}/refund?reason=${encodeURIComponent("Organizer approved full refund")}&idempotency_key=${encodeURIComponent(newIdempotencyKey("refund"))}`,
        { method: "POST" },
      ),
    onSuccess: async () => {
      await orders.refetch();
      await invalidate();
    },
  });
  const cancelEvent = useMutation({
    mutationFn: () =>
      apiFetch(
        `/events/${id}/cancel?reason=${encodeURIComponent(cancellationReason)}`,
        { method: "POST" },
      ),
    onSuccess: invalidate,
  });
  const toggleTicket = useMutation({
    mutationFn: (item: EventItem["ticket_types"][number]) =>
      apiFetch(`/events/${id}/ticket-types/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_hidden: !item.is_hidden }),
      }),
    onSuccess: invalidate,
  });
  if (events.isLoading) return <LoadingBlock />;
  if (!event) return <ErrorBlock message={t("ui.eventNotFound")} />;
  const kpi = analytics.data?.kpis;
  return (
    <ScrollView contentContainerClassName="gap-7 pb-16">
      <View className="flex-row flex-wrap items-start justify-between gap-4">
        <View className="max-w-3xl">
          <Text className="text-sm font-black uppercase text-brand">
            {t("ui.eventOperations")}
          </Text>
          <Text className="mt-1 text-4xl font-black text-ink">
            {event.title}
          </Text>
          <Text className="mt-2 text-muted">
            {new Date(event.starts_at).toLocaleString(i18n.language)} ·{" "}
            {event.venue_name}
          </Text>
        </View>
        <StatusBadge status={event.status} />
      </View>
      <Surface className="flex-row flex-wrap items-center gap-5">
        {event.image_url ? (
          <Image
            className="h-28 w-44 rounded-2xl"
            source={{ uri: event.image_url }}
            accessibilityLabel={event.title}
          />
        ) : (
          <View className="h-28 w-44 items-center justify-center rounded-2xl bg-ink">
            <Text className="font-bold text-white">{t("ui.noCover")}</Text>
          </View>
        )}
        <View className="min-w-60 flex-1 gap-2">
          <Text className="text-lg font-black text-ink">
            {t("ui.eventCover")}
          </Text>
          <Text className="text-sm text-muted">{t("ui.eventCoverHelp")}</Text>
          <Button
            label={t("ui.chooseCover")}
            variant="secondary"
            onPress={() => image.mutate()}
            loading={image.isPending}
          />
          {image.error ? (
            <Text className="text-danger">
              {(image.error as Error).message}
            </Text>
          ) : null}
        </View>
      </Surface>
      <EventSettings event={event} onSaved={invalidate} />
      <Surface className="gap-4">
        <Text className="text-lg font-black text-ink">
          {t("ui.lifecycleSales")}
        </Text>
        <View className="flex-row flex-wrap gap-3">
          {event.status !== "published" ? (
            <Button
              label={t("ui.publish")}
              onPress={() => action.mutate("publish")}
            />
          ) : (
            <Button
              label={t("ui.unpublish")}
              variant="secondary"
              onPress={() => action.mutate("unpublish")}
            />
          )}
          {!event.paid_sales_active ? (
            <Button
              label={t("ui.activateDemo")}
              variant="secondary"
              onPress={() => action.mutate("activation/simulate")}
            />
          ) : (
            <StatusBadge status="active" />
          )}
          <Button
            label={t("ui.duplicateDraft")}
            variant="secondary"
            onPress={() => action.mutate("duplicate")}
          />
          <Button
            label={t("ui.preview")}
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: "/events/[id]",
                params: { id: event.id },
              })
            }
          />
        </View>
        {action.error ? (
          <Text className="text-danger">{(action.error as Error).message}</Text>
        ) : null}
      </Surface>
      <View className="flex-row flex-wrap gap-4">
        <Metric
          label={t("ui.capacity")}
          value={kpi?.capacity ?? event.capacity}
        />
        <Metric label={t("ui.ticketsSold")} value={kpi?.tickets_sold ?? 0} />
        <Metric
          label={t("ui.netRevenue")}
          value={formatKzt(kpi?.net_demo_revenue_tiyin ?? 0, i18n.language)}
        />
        <Metric
          label={t("ui.checkedIn")}
          value={`${kpi?.check_in_percentage ?? 0}%`}
        />
      </View>
      <View className="flex-row flex-wrap items-start gap-5">
        <Surface className="min-w-72 flex-1 gap-4">
          <Text className="text-xl font-black text-ink">
            {t("ui.salesOverTime")}
          </Text>
          <LineChart
            points={(analytics.data?.sales_over_time ?? []).map((row) => ({
              label: row.date,
              value: row.tickets,
              formatted: `${row.tickets} · ${formatKzt(row.revenue_tiyin, i18n.language)}`,
            }))}
          />
        </Surface>
        <Surface className="min-w-72 flex-1 gap-4">
          <Text className="text-xl font-black text-ink">
            {t("ui.campaignPerformance")}
          </Text>
          <BarChart
            rows={(analytics.data?.campaigns ?? []).map((row) => ({
              label: row.name,
              value: row.redemptions,
              formatted: `${row.redemptions} · ${formatKzt(row.net_tiyin, i18n.language)}`,
            }))}
          />
        </Surface>
        <Surface className="min-w-72 flex-1 gap-4">
          <Text className="text-xl font-black text-ink">
            {t("ui.privacyFunnel")}
          </Text>
          <Funnel
            values={[
              {
                label: t("ui.eventViews"),
                value: analytics.data?.traffic_funnel.event_views ?? 0,
              },
              {
                label: t("ui.campaignViews"),
                value: analytics.data?.traffic_funnel.campaign_views ?? 0,
              },
              {
                label: t("ui.checkoutStarts"),
                value: analytics.data?.traffic_funnel.checkout_starts ?? 0,
              },
              {
                label: t("ui.demoPurchases"),
                value: analytics.data?.traffic_funnel.demo_purchases ?? 0,
              },
            ]}
          />
        </Surface>
      </View>
      <View className="flex-row flex-wrap items-start gap-5">
        <Surface className="min-w-80 flex-1 gap-4">
          <Text className="text-xl font-black text-ink">
            {t("ui.addTicketType")}
          </Text>
          <Field
            label={t("common.name")}
            value={ticketName}
            onChangeText={setTicketName}
          />
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Field
                label={t("ui.priceKzt")}
                value={ticketPrice}
                onChangeText={setTicketPrice}
                keyboardType="numeric"
              />
            </View>
            <View className="flex-1">
              <Field
                label={t("ui.quantity")}
                value={ticketQuantity}
                onChangeText={setTicketQuantity}
                keyboardType="number-pad"
              />
            </View>
          </View>
          {event.seating_mode === "assigned" ? (
            <Field
              label={t("ui.seatCategory")}
              value={ticketCategory}
              onChangeText={setTicketCategory}
            />
          ) : null}
          <Button
            label={t("ui.addTicketType")}
            onPress={() => ticket.mutate()}
            loading={ticket.isPending}
            disabled={!ticketName}
          />
          {ticket.error ? (
            <Text className="text-danger">
              {(ticket.error as Error).message}
            </Text>
          ) : null}
        </Surface>
        <Surface className="min-w-80 flex-1 gap-4">
          <Text className="text-xl font-black text-ink">
            {t("ui.createCampaign")}
          </Text>
          <Field
            label={t("ui.campaignName")}
            value={campaignName}
            onChangeText={setCampaignName}
          />
          <Field
            label={t("ui.promoCodeOptional")}
            value={campaignCode}
            onChangeText={(value) => setCampaignCode(value.toUpperCase())}
          />
          <View className="flex-row gap-2">
            {(["percentage", "fixed_kzt"] as const).map((kind) => (
              <Button
                key={kind}
                label={kind === "percentage" ? "%" : "KZT"}
                variant={
                  campaignDiscountType === kind ? "primary" : "secondary"
                }
                onPress={() => setCampaignDiscountType(kind)}
              />
            ))}
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Field
                label={t("ui.discount")}
                value={campaignDiscountValue}
                onChangeText={setCampaignDiscountValue}
                keyboardType="numeric"
              />
            </View>
            <View className="flex-1">
              <Field
                label={t("ui.quantity")}
                value={campaignMaxRedemptions}
                onChangeText={setCampaignMaxRedemptions}
                keyboardType="number-pad"
              />
            </View>
          </View>
          <View className="flex-row flex-wrap gap-3">
            <View className="min-w-56 flex-1">
              <Field
                label={t("ui.startsAt")}
                value={campaignStartsAt}
                onChangeText={setCampaignStartsAt}
              />
            </View>
            <View className="min-w-56 flex-1">
              <Field
                label={t("ui.endsAt")}
                value={campaignEndsAt}
                onChangeText={setCampaignEndsAt}
              />
            </View>
          </View>
          <Text className="font-bold text-ink">{t("ui.eventTickets")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {event.ticket_types.map((item) => {
              const selected = campaignTicketTypes.includes(item.id);
              return (
                <Button
                  key={item.id}
                  label={item.name}
                  variant={selected ? "primary" : "secondary"}
                  onPress={() =>
                    setCampaignTicketTypes((current) =>
                      selected
                        ? current.filter((value) => value !== item.id)
                        : [...current, item.id],
                    )
                  }
                />
              );
            })}
          </View>
          <Button
            label={t("ui.createCampaignQr")}
            onPress={() => campaign.mutate()}
            loading={campaign.isPending}
            disabled={!campaignName || Number(campaignDiscountValue) <= 0}
          />
          {campaign.error ? (
            <Text className="text-danger">
              {(campaign.error as Error).message}
            </Text>
          ) : null}
          {campaigns.data?.map((item) => (
            <View
              key={item.id}
              className="flex-row flex-wrap items-center gap-4 rounded-2xl border border-line p-3"
            >
              <Image
                className="h-20 w-20"
                source={{
                  uri: `${API_URL}/campaigns/${item.id}/qr.png`,
                  headers: { Authorization: `Bearer ${currentAccessToken()}` },
                }}
              />
              <View className="min-w-36 flex-1">
                <Text className="font-black text-ink">{item.name}</Text>
                <Text className="font-mono text-brand">{item.code}</Text>
                <StatusBadge status={item.is_enabled ? "active" : "disabled"} />
              </View>
              {item.is_enabled ? (
                <Button
                  label={t("ui.suspend")}
                  variant="secondary"
                  onPress={() => disableCampaign.mutate(item.id)}
                  loading={disableCampaign.isPending}
                />
              ) : null}
            </View>
          ))}
        </Surface>
      </View>
      <View className="flex-row flex-wrap items-start gap-5">
        <Surface className="min-w-80 flex-1 gap-4">
          <Text className="text-xl font-black text-ink">
            {t("ui.eventStaff")}
          </Text>
          <Field
            label={t("ui.registeredStaffEmail")}
            value={staffEmail}
            onChangeText={setStaffEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <View className="flex-row flex-wrap gap-2">
            {(["manager", "support", "finance", "check_in"] as const).map(
              (role) => (
                <Button
                  key={role}
                  label={t(`status.${role}`)}
                  variant={staffRole === role ? "primary" : "secondary"}
                  onPress={() => setStaffRole(role)}
                />
              ),
            )}
          </View>
          <Button
            label={t("ui.assignPermission")}
            onPress={() => assignStaff.mutate()}
            loading={assignStaff.isPending}
            disabled={!staffEmail.includes("@")}
          />
          {assignStaff.error ? (
            <Text className="text-danger">
              {(assignStaff.error as Error).message}
            </Text>
          ) : null}
          {staff.data?.map((member) => (
            <View key={member.id} className="border-b border-line py-2">
              <Text className="font-bold text-ink">{member.display_name}</Text>
              <Text className="text-sm text-muted">
                {member.email} · {t(`status.${member.role}`)}
              </Text>
            </View>
          ))}
          {event.visibility === "private" ? (
            <View className="mt-2 gap-3 border-t border-line pt-4">
              <Text className="text-lg font-black text-ink">
                {t("ui.privateInvitation")}
              </Text>
              <Field
                label={t("common.email")}
                value={invitationEmail}
                onChangeText={setInvitationEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <Button
                label={t("ui.privateInvitation")}
                variant="secondary"
                onPress={() => invite.mutate()}
                loading={invite.isPending}
                disabled={!invitationEmail.includes("@")}
              />
              {invite.data ? (
                <Text selectable className="text-sm text-brand">
                  {invite.data.url}
                </Text>
              ) : null}
              {invite.error ? (
                <Text className="text-danger">
                  {(invite.error as Error).message}
                </Text>
              ) : null}
            </View>
          ) : null}
        </Surface>
        <Surface className="min-w-80 flex-1 gap-4">
          <Text className="text-xl font-black text-ink">
            {t("ui.ticketInventory")}
          </Text>
          {event.ticket_types.map((item) => {
            const row = analytics.data?.ticket_types.find(
              (entry) => entry.name === item.name,
            );
            return (
              <View
                key={item.id}
                className="flex-row flex-wrap items-center justify-between gap-3 border-b border-line py-2"
              >
                <View>
                  <Text className="font-bold text-ink">{item.name}</Text>
                  <Text className="text-sm text-muted">
                    {t("ui.configured", { count: item.quantity })} ·{" "}
                    {formatKzt(item.price_tiyin, i18n.language)}
                  </Text>
                  {row ? (
                    <Text className="text-xs text-muted">
                      {t("status.available")}: {row.available} ·{" "}
                      {t("status.held")}: {row.reserved} · {t("status.sold")}:{" "}
                      {row.sold} · {t("status.refunded")}: {row.refunded}
                    </Text>
                  ) : null}
                </View>
                <Button
                  label={item.is_hidden ? t("ui.show") : t("ui.hide")}
                  variant="secondary"
                  onPress={() => toggleTicket.mutate(item)}
                />
              </View>
            );
          })}
        </Surface>
      </View>
      <Surface className="gap-4">
        <Text className="text-xl font-black text-ink">
          {t("ui.recentOrders")}
        </Text>
        {orders.data?.items.map((order) => (
          <View
            key={order.id}
            className="flex-row flex-wrap items-center justify-between gap-3 border-b border-line py-3"
          >
            <View>
              <Text className="font-bold text-ink">{order.order_number}</Text>
              <Text className="text-sm text-muted">
                {formatKzt(order.total_tiyin, i18n.language)} ·{" "}
                {t("ui.organizerNet", {
                  amount: formatKzt(order.organizer_net_tiyin, i18n.language),
                })}
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              <StatusBadge status={order.status} />
              {["paid", "free"].includes(order.status) &&
              event.status !== "cancelled" ? (
                <Button
                  label={t("ui.fullRefund")}
                  variant="danger"
                  onPress={() => refund.mutate(order.id)}
                  loading={refund.isPending}
                />
              ) : null}
            </View>
          </View>
        ))}
        {orders.data?.items.length === 0 ? (
          <Text className="text-muted">{t("ui.noOrders")}</Text>
        ) : null}
      </Surface>
      {event.status !== "cancelled" ? (
        <Surface className="gap-4 border-red-200">
          <Text className="text-xl font-black text-danger">
            {t("ui.cancelEvent")}
          </Text>
          <Text className="text-muted">{t("ui.cancelEventHelp")}</Text>
          <Field
            label={t("ui.cancellationReason")}
            value={cancellationReason}
            onChangeText={setCancellationReason}
          />
          <Button
            label={t("ui.cancelRefund")}
            variant="danger"
            onPress={() => cancelEvent.mutate()}
            loading={cancelEvent.isPending}
            disabled={cancellationReason.length < 5}
          />
          {cancelEvent.error ? (
            <Text className="text-danger">
              {(cancelEvent.error as Error).message}
            </Text>
          ) : null}
        </Surface>
      ) : null}
      <Surface className="gap-4">
        <Text className="text-xl font-black text-ink">
          {t("ui.activityTimeline")}
        </Text>
        {history.data?.map((entry) => (
          <View key={entry.id} className="border-l-2 border-aqua pl-4">
            <Text className="font-bold text-ink">
              {entry.action.replaceAll(".", " · ")}
            </Text>
            <Text className="text-muted">{entry.description}</Text>
            <Text className="text-xs text-muted">
              {new Date(entry.timestamp).toLocaleString(i18n.language)}
            </Text>
          </View>
        ))}
      </Surface>
    </ScrollView>
  );
}

function EventSettings({
  event,
  onSaved,
}: {
  event: EventItem;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [category, setCategory] = useState(event.category);
  const [city, setCity] = useState(event.city);
  const [venueName, setVenueName] = useState(event.venue_name);
  const [venueAddress, setVenueAddress] = useState(event.venue_address);
  const [startsAt, setStartsAt] = useState(event.starts_at);
  const [endsAt, setEndsAt] = useState(event.ends_at);
  const [timezone, setTimezone] = useState(event.timezone);
  const [registrationOpensAt, setRegistrationOpensAt] = useState(
    event.registration_opens_at ?? "",
  );
  const [registrationClosesAt, setRegistrationClosesAt] = useState(
    event.registration_closes_at ?? "",
  );
  const [capacity, setCapacity] = useState(String(event.capacity));
  const [visibility, setVisibility] = useState(event.visibility);
  const [seatingMode, setSeatingMode] = useState(event.seating_mode);
  const [refundPolicy, setRefundPolicy] = useState(event.refund_policy);
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/events/${event.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title,
          description,
          category,
          city,
          venue_name: venueName,
          venue_address: venueAddress,
          starts_at: startsAt,
          ends_at: endsAt,
          timezone,
          registration_opens_at: registrationOpensAt || null,
          registration_closes_at: registrationClosesAt || null,
          capacity: Number(capacity),
          visibility,
          seating_mode: seatingMode,
          refund_policy: refundPolicy,
        }),
      }),
    onSuccess: onSaved,
  });
  return (
    <Surface className="gap-4">
      <Text className="text-xl font-black text-ink">{t("ui.editEvent")}</Text>
      <View className="flex-row flex-wrap gap-3">
        <View className="min-w-64 flex-1">
          <Field
            label={t("ui.eventTitle")}
            value={title}
            onChangeText={setTitle}
          />
        </View>
        <View className="min-w-40 flex-1">
          <Field
            label={t("ui.capacity")}
            value={capacity}
            onChangeText={setCapacity}
            keyboardType="number-pad"
            editable={seatingMode !== "assigned"}
          />
        </View>
      </View>
      <Field
        label={t("ui.description")}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />
      <View className="flex-row flex-wrap gap-3">
        <View className="min-w-52 flex-1">
          <Field
            label={t("ui.category")}
            value={category}
            onChangeText={setCategory}
          />
        </View>
        <View className="min-w-52 flex-1">
          <Field label={t("ui.city")} value={city} onChangeText={setCity} />
        </View>
      </View>
      <View className="flex-row flex-wrap gap-3">
        <View className="min-w-64 flex-1">
          <Field
            label={t("common.venue")}
            value={venueName}
            onChangeText={setVenueName}
          />
        </View>
        <View className="min-w-64 flex-1">
          <Field
            label={t("ui.address")}
            value={venueAddress}
            onChangeText={setVenueAddress}
          />
        </View>
      </View>
      <View className="flex-row flex-wrap gap-3">
        <View className="min-w-64 flex-1">
          <Field
            label={t("ui.startsAt")}
            value={startsAt}
            onChangeText={setStartsAt}
          />
        </View>
        <View className="min-w-64 flex-1">
          <Field
            label={t("ui.endsAt")}
            value={endsAt}
            onChangeText={setEndsAt}
          />
        </View>
        <View className="min-w-48 flex-1">
          <Field
            label={t("ui.timezone")}
            value={timezone}
            onChangeText={setTimezone}
          />
        </View>
      </View>
      <View className="flex-row flex-wrap gap-3">
        <View className="min-w-64 flex-1">
          <Field
            label={t("ui.registrationOpens")}
            value={registrationOpensAt}
            onChangeText={setRegistrationOpensAt}
          />
        </View>
        <View className="min-w-64 flex-1">
          <Field
            label={t("ui.registrationCloses")}
            value={registrationClosesAt}
            onChangeText={setRegistrationClosesAt}
          />
        </View>
      </View>
      <View className="gap-2">
        <Text className="text-sm font-bold text-ink">{t("ui.visibility")}</Text>
        <View className="flex-row flex-wrap gap-2">
          {(["public", "unlisted", "private"] as const).map((item) => (
            <Button
              key={item}
              label={t(`status.${item}`)}
              variant={visibility === item ? "primary" : "secondary"}
              onPress={() => setVisibility(item)}
            />
          ))}
        </View>
      </View>
      <View className="gap-2">
        <Text className="text-sm font-bold text-ink">{t("ui.admission")}</Text>
        <View className="flex-row flex-wrap gap-2">
          {(["general_admission", "assigned"] as const).map((item) => (
            <Button
              key={item}
              label={t(`status.${item}`)}
              variant={seatingMode === item ? "primary" : "secondary"}
              onPress={() => setSeatingMode(item)}
            />
          ))}
        </View>
      </View>
      <Field
        label={t("common.refundPolicy")}
        value={refundPolicy}
        onChangeText={setRefundPolicy}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
      />
      <Button
        label={t("ui.saveEvent")}
        onPress={() => save.mutate()}
        loading={save.isPending}
      />
      {save.error ? (
        <Text className="text-danger">{(save.error as Error).message}</Text>
      ) : null}
    </Surface>
  );
}
