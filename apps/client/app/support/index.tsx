import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  Chips,
  errorText,
  EscalatedChip,
  ListState,
  Notice,
  supportCaseHref,
} from "@/components/admin/shared";
import { RequireAuth } from "@/components/RequireAuth";
import { Icon, palette } from "@/components/icons";
import {
  Button,
  Chip,
  Field,
  ScreenHeader,
  SectionTitle,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import {
  SUPPORT_CATEGORIES,
  type SupportCase,
  type SupportContexts,
  type SupportKind,
  caseContextLine,
  contextOptions,
  resolveInitialContext,
} from "@/lib/supportCase";
import { useAuth } from "@/providers/AuthProvider";
import { formatDateTime } from "@/utils/date";

const NONE = "none";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value || undefined;
}

function SupportContent() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const client = useQueryClient();
  const params = useLocalSearchParams<{
    event_id?: string;
    order_id?: string;
    ticket_id?: string;
  }>();
  const linked = useMemo(
    () => ({
      eventId: firstParam(params.event_id),
      orderId: firstParam(params.order_id),
      ticketId: firstParam(params.ticket_id),
    }),
    [params.event_id, params.order_id, params.ticket_id],
  );
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<string>("technical");
  const [kind, setKind] = useState<SupportKind>("attendee_to_organizer");
  const [eventId, setEventId] = useState<string | undefined>(linked.eventId);
  const [orderId, setOrderId] = useState<string | undefined>(linked.orderId);
  const [ticketId, setTicketId] = useState<string | undefined>(
    linked.ticketId,
  );
  const [created, setCreated] = useState<SupportCase>();
  const trimmedSubject = subject.trim();
  const trimmedMessage = message.trim();
  const textValid = trimmedSubject.length >= 3 && trimmedMessage.length > 0;
  const showTextHint = (subject.length > 0 || message.length > 0) && !textValid;
  const isOrganizer = !!user?.roles.includes("organizer");
  const platformCase = kind === "organizer_to_platform";
  const cases = useQuery({
    queryKey: ["support-cases"],
    queryFn: () => apiFetch<SupportCase[]>("/support/cases"),
    enabled: !!user,
    refetchInterval: 15_000,
  });
  const contexts = useQuery({
    queryKey: ["support-contexts"],
    queryFn: () => apiFetch<SupportContexts>("/support/contexts"),
    enabled: !!user,
  });
  // A deep link may point at an event the user has not bought for (a public
  // event page links here); its title is loaded separately in that case.
  const linkedEventKnown =
    !linked.eventId ||
    !contexts.data ||
    [...contexts.data.events, ...contexts.data.managed_events].some(
      (item) => item.id === linked.eventId,
    );
  const linkedEvent = useQuery({
    queryKey: ["support-linked-event", linked.eventId],
    queryFn: () =>
      apiFetch<{ id: string; title: string }>(`/events/${linked.eventId}`),
    enabled: !!user && !linkedEventKnown,
    retry: false,
  });
  // Derive the event (and order) from a linked order or ticket once the
  // user's contexts are known.
  // Applied once per link (adjusted during render, not in an effect), so a
  // background refetch never resets the form.
  const [appliedLink, setAppliedLink] = useState<typeof linked>();
  if (contexts.data && appliedLink !== linked) {
    setAppliedLink(linked);
    if (linked.eventId || linked.orderId || linked.ticketId) {
      const initial = resolveInitialContext(contexts.data, linked);
      setKind("attendee_to_organizer");
      setEventId(initial.eventId);
      setOrderId(initial.orderId);
      setTicketId(initial.ticketId);
    }
  }
  const options = useMemo(
    () =>
      contextOptions(contexts.data, {
        kind,
        eventId,
        orderId,
        extraEvent:
          linked.eventId && !linkedEventKnown
            ? {
                id: linked.eventId,
                title: linkedEvent.data?.title ?? t("supportX.linkedEvent"),
              }
            : undefined,
      }),
    [
      contexts.data,
      kind,
      eventId,
      orderId,
      linked.eventId,
      linkedEventKnown,
      linkedEvent.data,
      t,
    ],
  );
  const create = useMutation({
    mutationFn: () =>
      apiFetch<SupportCase>("/support/cases", {
        method: "POST",
        body: JSON.stringify({
          kind,
          category,
          subject: trimmedSubject,
          message: trimmedMessage,
          event_id: eventId ?? null,
          order_id: platformCase ? null : (orderId ?? null),
          ticket_id: platformCase ? null : (ticketId ?? null),
        }),
      }),
    onSuccess: async (result) => {
      setCreated(result);
      setSubject("");
      setMessage("");
      await client.invalidateQueries({ queryKey: ["support-cases"] });
    },
  });
  // RequireAuth renders the signed-out state before this mounts.
  if (!user) return null;
  const contextMissing = !platformCase && !eventId && !orderId && !ticketId;
  const changeKind = (next: SupportKind) => {
    setKind(next);
    setEventId(undefined);
    setOrderId(undefined);
    setTicketId(undefined);
    create.reset();
  };
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerClassName="gap-6 pb-16"
    >
      <ScreenHeader
        kicker={t("ui.helpCenter")}
        title={t("ui.supportConversations")}
        subtitle={t("ui.supportHelp")}
      />
      <View className="flex-row flex-wrap items-start gap-5">
        <Surface className="min-w-72 flex-1 basis-80 gap-4">
          <SectionTitle title={t("ui.openCase")} />
          {isOrganizer ? (
            <Chips
              label={t("supportX.kindLabel")}
              value={kind}
              onChange={changeKind}
              options={[
                {
                  value: "attendee_to_organizer",
                  label: t("supportX.kind.attendee_to_organizer"),
                },
                {
                  value: "organizer_to_platform",
                  label: t("supportX.kind.organizer_to_platform"),
                },
              ]}
            />
          ) : null}
          <Text className="text-sm text-muted">
            {platformCase
              ? t("supportX.kindHelp.organizer_to_platform")
              : t("supportX.kindHelp.attendee_to_organizer")}
          </Text>
          {contexts.isLoading ? (
            <Text className="text-muted">{t("common.loading")}</Text>
          ) : null}
          {contexts.error ? (
            <Notice tone="danger">{errorText(contexts.error)}</Notice>
          ) : null}
          {options.events.length > 0 ? (
            <Chips
              label={
                platformCase
                  ? t("supportX.relatedEventOptional")
                  : t("ui.relatedEvent")
              }
              value={eventId ?? (platformCase ? NONE : undefined)}
              onChange={(next) => {
                setEventId(next === NONE ? undefined : next);
                setOrderId(undefined);
                setTicketId(undefined);
              }}
              options={[
                ...(platformCase
                  ? [{ value: NONE, label: t("supportX.noContext") }]
                  : []),
                ...options.events.map((item) => ({
                  value: item.id,
                  label: item.status
                    ? `${item.title} · ${t(`status.${item.status}`, { defaultValue: item.status })}`
                    : item.title,
                })),
              ]}
            />
          ) : contexts.data && !platformCase ? (
            <Text className="text-sm text-muted">
              {t("supportX.noContexts")}
            </Text>
          ) : null}
          {!platformCase && options.orders.length > 0 ? (
            <Chips
              label={t("supportX.relatedOrder")}
              value={orderId ?? NONE}
              onChange={(next) => {
                setOrderId(next === NONE ? undefined : next);
                setTicketId(undefined);
              }}
              options={[
                { value: NONE, label: t("supportX.noContext") },
                ...options.orders.map((item) => ({
                  value: item.id,
                  label: `${item.order_number} · ${t(`status.${item.status}`, { defaultValue: item.status })}`,
                })),
              ]}
            />
          ) : null}
          {!platformCase && options.tickets.length > 0 ? (
            <Chips
              label={t("supportX.relatedTicket")}
              value={ticketId ?? NONE}
              onChange={(next) => setTicketId(next === NONE ? undefined : next)}
              options={[
                { value: NONE, label: t("supportX.noContext") },
                ...options.tickets.map((item) => ({
                  value: item.id,
                  label: `${item.ticket_code} · ${item.attendee_name} · ${t(`status.${item.status}`, { defaultValue: item.status })}`,
                })),
              ]}
            />
          ) : null}
          <Chips
            label={t("ui.issueCategory")}
            value={category}
            onChange={setCategory}
            options={SUPPORT_CATEGORIES.map((item) => ({
              value: item,
              label: t(`status.${item}`),
            }))}
          />
          <Field
            label={t("ui.subject")}
            value={subject}
            onChangeText={setSubject}
            maxLength={200}
          />
          <Field
            label={t("ui.message")}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
          {showTextHint ? (
            <Text className="text-sm text-muted">
              {t("ui.supportTextRequired")}
            </Text>
          ) : null}
          {contextMissing && contexts.data ? (
            <Text className="text-sm text-muted">
              {t("apiErrors.event_context_required")}
            </Text>
          ) : null}
          {create.error ? (
            <Notice tone="danger">{errorText(create.error)}</Notice>
          ) : null}
          {created ? (
            <View className="gap-2">
              <Notice tone="success">
                {t("supportX.created", { number: created.case_number })}
              </Notice>
              <Link href={supportCaseHref(created.id)} asChild>
                <Pressable
                  accessibilityRole="link"
                  className="min-h-11 justify-center self-start"
                >
                  <Text className="font-medium text-brand underline">
                    {t("supportX.openCreated", {
                      number: created.case_number,
                    })}
                  </Text>
                </Pressable>
              </Link>
            </View>
          ) : null}
          <Button
            label={t("ui.submitCase")}
            onPress={() => {
              if (!textValid || contextMissing) return;
              setCreated(undefined);
              create.mutate();
            }}
            loading={create.isPending}
            disabled={!textValid || contextMissing}
          />
        </Surface>
        <View className="min-w-72 flex-[1.4] basis-80 gap-3">
          <SectionTitle
            title={t("ui.yourCases")}
            action={
              cases.data && cases.data.length > 0 ? (
                <Chip label={String(cases.data.length)} tone="mint" />
              ) : undefined
            }
          />
          <ListState
            loading={cases.isLoading}
            error={cases.error}
            retry={() => void cases.refetch()}
            empty={cases.data?.length === 0}
            emptyText={t("ui.noCases")}
          />
          {cases.data?.map((item) => {
            const context = caseContextLine(item, t);
            return (
              <Link key={item.id} href={supportCaseHref(item.id)} asChild>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`${item.case_number}, ${item.subject}, ${t(`status.${item.status}`, { defaultValue: item.status })}${item.escalated ? `, ${t("supportX.escalated")}` : ""}`}
                  className="gap-3 rounded-3xl border border-line bg-white p-5 shadow-panel active:opacity-90"
                >
                  <View className="flex-row items-start gap-3">
                    <View
                      className="h-11 w-11 items-center justify-center rounded-2xl bg-mintsoft"
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      <Icon name="help" size={20} color={palette.brand} />
                    </View>
                    <View className="min-w-0 flex-1 gap-0.5">
                      <Text className="font-mono text-xs font-medium text-brand">
                        {item.case_number}
                      </Text>
                      <Text
                        className="text-lg font-semibold text-ink"
                        numberOfLines={2}
                      >
                        {item.subject}
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={20} color={palette.muted} />
                  </View>
                  <View className="flex-row flex-wrap items-center gap-2">
                    <StatusBadge status={item.status} />
                    {item.escalated ? <EscalatedChip /> : null}
                    <Chip
                      label={t(`status.${item.category}`, {
                        defaultValue: item.category,
                      })}
                    />
                  </View>
                  <View className="gap-1 border-t border-dashed border-line pt-3">
                    <Text className="text-sm text-muted">
                      {t(`supportX.kind.${item.kind}`, {
                        defaultValue: item.kind,
                      })}
                    </Text>
                    {context ? (
                      <Text className="text-sm text-muted">{context}</Text>
                    ) : null}
                    <Text className="text-sm text-muted">
                      {item.requester_id !== user.id && item.requester_name
                        ? `${t("supportX.requester", { name: item.requester_name })} · `
                        : ""}
                      {item.assignee_name
                        ? t("supportX.assignedTo", { name: item.assignee_name })
                        : t("supportX.unassigned")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {t("supportX.updated", {
                        date: formatDateTime(
                          item.updated_at,
                          i18n.language,
                          "medium",
                        ),
                      })}
                    </Text>
                  </View>
                </Pressable>
              </Link>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

export default function SupportPage() {
  return (
    <RequireAuth>
      <SupportContent />
    </RequireAuth>
  );
}
