import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import {
  Chips,
  ConfirmPanel,
  errorText,
  EscalatedChip,
  eventManageHref,
  eventPublicHref,
  Meta,
  Notice,
  TextLink,
} from "@/components/admin/shared";
import { RequireAuth } from "@/components/RequireAuth";
import { Icon, palette } from "@/components/icons";
import {
  Button,
  ErrorBlock,
  Field,
  IconButton,
  LoadingBlock,
  ScreenHeader,
  SectionTitle,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { apiFetch, currentAccessToken, WS_URL } from "@/lib/api";
import { fileForm } from "@/lib/files";
import {
  ATTACHMENT_TYPES,
  attachmentProblem,
  formatFileSize,
  SUPPORT_STATUSES,
  type SupportCaseDetail,
} from "@/lib/supportCase";
import { type CaseSocketStatus, connectCaseSocket } from "@/lib/supportSocket";
import { useAuth } from "@/providers/AuthProvider";
import { formatDateTime } from "@/utils/date";

interface Assignee {
  id: string;
  display_name: string;
  email: string;
  roles: string[];
}

function SupportDetailContent() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const client = useQueryClient();
  const [body, setBody] = useState("");
  const trimmedBody = body.trim();
  const [attachment, setAttachment] =
    useState<DocumentPicker.DocumentPickerAsset>();
  const [attachmentError, setAttachmentError] = useState<string>();
  const [escalating, setEscalating] = useState(false);
  const [escalationReason, setEscalationReason] = useState("");
  const [live, setLive] = useState<CaseSocketStatus>("connecting");
  const query = useQuery({
    queryKey: ["support-case", id],
    queryFn: () => apiFetch<SupportCaseDetail>(`/support/cases/${id}`),
    enabled: !!id,
    // Polling stays on as a fallback for when the live connection is down.
    refetchInterval: 15_000,
  });
  const loaded = !!query.data;
  useEffect(() => {
    // Connect only for a case the user can actually open.
    if (!id || !loaded) return;
    return connectCaseSocket({
      url: (token) =>
        `${WS_URL}/support/cases/${id}/ws?token=${encodeURIComponent(token)}`,
      getToken: currentAccessToken,
      onEvent: () => {
        void client.invalidateQueries({ queryKey: ["support-case", id] });
        void client.invalidateQueries({ queryKey: ["support-cases"] });
      },
      onStatus: setLive,
    });
  }, [client, id, loaded]);
  const canUpdate =
    query.data?.viewer?.can_update ??
    (!!query.data && user?.id !== query.data.requester_id);
  const assignees = useQuery({
    queryKey: ["support-assignees", id],
    queryFn: () => apiFetch<Assignee[]>(`/support/cases/${id}/assignees`),
    enabled: !!id && canUpdate,
  });
  const refresh = async () => {
    await query.refetch();
    void client.invalidateQueries({ queryKey: ["support-cases"] });
  };
  const upload = useMutation({
    mutationFn: async (input: {
      messageId: string;
      asset: DocumentPicker.DocumentPickerAsset;
    }) => {
      const form = await fileForm(input.asset);
      await apiFetch(`/support/messages/${input.messageId}/attachments`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: async () => {
      setAttachment(undefined);
      await refresh();
    },
  });
  const send = useMutation({
    mutationFn: async () => {
      upload.reset();
      const message = await apiFetch<{ id: string }>(
        `/support/cases/${id}/messages`,
        { method: "POST", body: JSON.stringify({ body: trimmedBody }) },
      );
      // The reply is stored at this point: clear the box so a failed upload
      // cannot lead to the same text being sent twice.
      setBody("");
      if (attachment)
        await upload
          .mutateAsync({ messageId: message.id, asset: attachment })
          .catch(() => undefined);
    },
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: (input: { status: string; assignee_id?: string }) =>
      apiFetch(`/support/cases/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: refresh,
  });
  const escalate = useMutation({
    mutationFn: () =>
      apiFetch(`/support/cases/${id}/escalate`, {
        method: "POST",
        body: JSON.stringify(
          escalationReason.trim() ? { reason: escalationReason.trim() } : {},
        ),
      }),
    onSuccess: async () => {
      setEscalating(false);
      setEscalationReason("");
      await refresh();
    },
    onError: () => void refresh(),
  });
  const download = useMutation({
    mutationFn: async (attachmentId: string) => {
      const result = await apiFetch<{ url: string }>(
        `/support/attachments/${attachmentId}/download`,
      );
      await Linking.openURL(result.url);
    },
  });
  const pickAttachment = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ATTACHMENT_TYPES,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const problem = attachmentProblem(asset);
    upload.reset();
    if (problem) {
      setAttachment(undefined);
      setAttachmentError(
        `${asset.name}: ${t(`apiErrors.${problem}`)}`,
      );
      return;
    }
    setAttachmentError(undefined);
    setAttachment(asset);
  };
  if (query.isLoading) return <LoadingBlock />;
  if (query.error || !query.data)
    return (
      <ErrorBlock
        message={query.error ? errorText(query.error) : t("ui.somethingWrong")}
        retry={() => void query.refetch()}
      />
    );
  const item = query.data;
  const isRequester =
    item.viewer?.is_requester ?? user?.id === item.requester_id;
  const platformCase = item.kind === "organizer_to_platform";
  const canEscalate =
    (item.viewer?.can_escalate ?? true) && !item.escalated && !platformCase;
  const date = (value: string) =>
    formatDateTime(value, i18n.language, "medium");
  const event = item.context?.event;
  const liveOn = live === "live";
  return (
    <View className="flex-1">
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="mx-auto w-full max-w-4xl gap-5 pb-8"
      >
        <ScreenHeader
          backHref="/support"
          backLabel={t("supportX.thread.back")}
          kicker={item.case_number}
          title={item.subject}
          right={
            <>
              {item.escalated ? <EscalatedChip /> : null}
              <StatusBadge status={item.status} />
            </>
          }
        />
        <View
          accessibilityLiveRegion="polite"
          className={`flex-row items-center gap-2 self-start rounded-full border px-3 py-1.5 ${liveOn ? "border-mintsoft bg-mintsoft" : "border-amber-200 bg-amber-50"}`}
        >
          <View
            className={`h-2 w-2 rounded-full ${liveOn ? "bg-brand" : "border border-warning bg-transparent"}`}
          />
          <Text
            className={`text-xs font-bold ${liveOn ? "text-success" : "text-warning"}`}
          >
            {t(`supportX.live.${live}`)}
          </Text>
        </View>
        <Surface className="gap-2">
          <SectionTitle title={t("supportX.details")} />
          <Meta>
            {t("supportX.field.kind", {
              value: t(`supportX.kind.${item.kind}`, {
                defaultValue: item.kind,
              }),
            })}
          </Meta>
          <Meta>
            {t("supportX.field.category", {
              value: t(`status.${item.category}`, {
                defaultValue: item.category,
              }),
            })}
          </Meta>
          {item.requester_name ? (
            <Meta>
              {t("supportX.requester", { name: item.requester_name })}
              {!isRequester && item.requester_email
                ? ` · ${item.requester_email}`
                : ""}
            </Meta>
          ) : null}
          <Meta>
            {item.assignee_name
              ? t("supportX.assignedTo", { name: item.assignee_name })
              : t("supportX.unassigned")}
          </Meta>
          {item.escalated ? (
            <Meta>
              {item.escalated_at
                ? t("supportX.escalatedAt", { date: date(item.escalated_at) })
                : t("supportX.escalatedHelp")}
            </Meta>
          ) : null}
          {event ? (
            <View className="flex-row flex-wrap items-center gap-2">
              <Meta>{t("supportX.field.event")}</Meta>
              <TextLink
                href={
                  isRequester
                    ? eventPublicHref(event.id)
                    : eventManageHref(event.id)
                }
                label={event.title}
                accessibilityLabel={t("supportX.openEvent", {
                  title: event.title,
                })}
              />
            </View>
          ) : null}
          {item.context?.order ? (
            <View className="flex-row flex-wrap items-center gap-2">
              <Meta>
                {t("supportX.context.order", {
                  number: item.context.order.number,
                })}
              </Meta>
              {isRequester ? (
                <TextLink href="/orders" label={t("supportX.openOrders")} />
              ) : null}
            </View>
          ) : null}
          {item.context?.ticket ? (
            <View className="flex-row flex-wrap items-center gap-2">
              <Meta>
                {t("supportX.context.ticket", {
                  code: item.context.ticket.code,
                })}
              </Meta>
              {isRequester ? (
                <TextLink href="/tickets" label={t("supportX.openTickets")} />
              ) : null}
            </View>
          ) : null}
          {item.created_at ? (
            <Meta>{t("supportX.opened", { date: date(item.created_at) })}</Meta>
          ) : null}
          <Meta>{t("supportX.updated", { date: date(item.updated_at) })}</Meta>
        </Surface>
        {canUpdate ? (
          <Surface className="gap-4">
            <SectionTitle title={t("supportX.staffTools")} />
            <Chips
              label={t("ui.staffStatus")}
              value={item.status}
              onChange={(status) => {
                if (status !== item.status) update.mutate({ status });
              }}
              options={SUPPORT_STATUSES.map((status) => ({
                value: status,
                label: t(`status.${status}`),
              }))}
            />
            {assignees.error ? (
              <Notice tone="danger">{errorText(assignees.error)}</Notice>
            ) : null}
            {assignees.data && assignees.data.length > 0 ? (
              <Chips
                label={t("supportX.assignee")}
                value={item.assignee_id ?? undefined}
                onChange={(assigneeId) => {
                  if (assigneeId !== item.assignee_id)
                    update.mutate({
                      status: item.status,
                      assignee_id: assigneeId,
                    });
                }}
                options={assignees.data.map((person) => ({
                  value: person.id,
                  label: `${person.display_name}${person.id === user?.id ? ` (${t("supportX.you")})` : ""} · ${person.roles
                    .map((role) =>
                      t(`supportX.assigneeRole.${role}`, {
                        defaultValue: role,
                      }),
                    )
                    .join(", ")}`,
                }))}
              />
            ) : assignees.data ? (
              <Meta>{t("supportX.noAssignees")}</Meta>
            ) : null}
            {update.isPending ? <Meta>{t("supportX.saving")}</Meta> : null}
            {update.error ? (
              <Notice tone="danger">{errorText(update.error)}</Notice>
            ) : null}
          </Surface>
        ) : null}
        {canEscalate ? (
          escalating ? (
            <ConfirmPanel
              title={t("supportX.escalateConfirmTitle")}
              message={t("supportX.escalateConfirmBody")}
              confirmLabel={t("supportX.escalate")}
              loading={escalate.isPending}
              error={escalate.error ? errorText(escalate.error) : undefined}
              onConfirm={() => escalate.mutate()}
              onCancel={() => {
                setEscalating(false);
                escalate.reset();
              }}
            >
              <Field
                label={t("supportX.escalateReason")}
                value={escalationReason}
                onChangeText={setEscalationReason}
                multiline
                numberOfLines={2}
                maxLength={2000}
              />
            </ConfirmPanel>
          ) : (
            <View className="flex-row flex-wrap items-center gap-3 rounded-3xl border border-line bg-white/70 p-4">
              <Button
                label={t("supportX.escalate")}
                variant="secondary"
                iconName="alert"
                size="sm"
                onPress={() => {
                  escalate.reset();
                  setEscalating(true);
                }}
              />
              <Text className="min-w-48 flex-1 text-sm text-muted">
                {t("supportX.escalateHelp")}
              </Text>
            </View>
          )
        ) : null}
        <View className="gap-3">
          <SectionTitle title={t("supportX.conversation")} />
          {item.messages.length === 0 ? (
            <View className="items-center gap-2 rounded-3xl border border-dashed border-line bg-white/60 px-4 py-8">
              <Icon name="mail" size={22} color={palette.muted} />
              <Text className="text-center text-muted">
                {t("supportX.noMessages")}
              </Text>
            </View>
          ) : null}
          {item.messages.map((message) => {
            const mine = message.sender_id === user?.id;
            const staff =
              message.sender_is_staff ??
              (message.sender_role !== undefined &&
                message.sender_role !== "requester");
            const staffLabel = staff
              ? t(
                  message.sender_role === "platform_admin"
                    ? "supportX.senderRole.platform_admin"
                    : "supportX.senderRole.staff",
                )
              : undefined;
            const sender = mine
              ? t("supportX.you")
              : (message.sender_name ?? t("supportX.unknownSender"));
            return (
              <View
                key={message.id}
                className={`max-w-[88%] gap-1.5 md:max-w-[75%] ${mine ? "ml-auto items-end" : "mr-auto items-start"}`}
              >
                <View
                  className={`flex-row flex-wrap items-center gap-2 px-1 ${mine ? "justify-end" : ""}`}
                >
                  <Text className="text-xs font-bold text-ink">{sender}</Text>
                  {staffLabel ? (
                    <View className="flex-row items-center gap-1 rounded-full border border-ink/10 bg-mintsoft px-2 py-0.5">
                      <Icon name="check" size={11} color={palette.brand} />
                      <Text className="text-[11px] font-bold text-ink">
                        {staffLabel}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View
                  accessibilityLabel={`${sender}${staffLabel ? ` (${staffLabel})` : ""}: ${message.body}`}
                  className={`gap-2 rounded-3xl px-4 py-3 ${mine ? "rounded-br-md bg-ink" : "rounded-bl-md border border-line bg-white shadow-panel"}`}
                >
                  <Text
                    className={`leading-6 ${mine ? "text-white" : "text-ink"}`}
                  >
                    {message.body}
                  </Text>
                  {message.attachments?.map((file) => (
                    <Button
                      key={file.id}
                      label={t("supportX.attachment.download", {
                        name: file.name,
                        size: formatFileSize(file.size_bytes, i18n.language),
                      })}
                      variant={mine ? "onDark" : "secondary"}
                      size="sm"
                      iconName="download"
                      onPress={() => download.mutate(file.id)}
                      loading={
                        download.isPending && download.variables === file.id
                      }
                    />
                  ))}
                </View>
                <Text className="px-1 text-[11px] text-muted">
                  {date(message.created_at)}
                </Text>
              </View>
            );
          })}
        </View>
        {download.error ? (
          <ErrorBlock
            message={errorText(download.error)}
            retry={() => {
              if (download.variables) download.mutate(download.variables);
            }}
          />
        ) : null}
      </ScrollView>
      <View className="mx-auto w-full max-w-4xl gap-2 rounded-t-[28px] border border-b-0 border-line bg-white px-4 pb-4 pt-3 shadow-float md:mb-2 md:rounded-[28px] md:border-b">
        {attachmentError ? (
          <Notice tone="danger">{attachmentError}</Notice>
        ) : null}
        {send.error ? (
          <Notice tone="danger">{errorText(send.error)}</Notice>
        ) : null}
        {upload.error && upload.variables ? (
          <View className="gap-2">
            <Notice tone="danger">
              {t("supportX.attachment.uploadFailed", {
                reason: errorText(upload.error),
              })}
            </Notice>
            <View className="self-start">
              <Button
                label={t("supportX.attachment.retry")}
                variant="secondary"
                size="sm"
                loading={upload.isPending}
                onPress={() => {
                  if (upload.variables) upload.mutate(upload.variables);
                }}
              />
            </View>
          </View>
        ) : null}
        {attachment ? (
          <View className="flex-row items-center gap-2 self-start rounded-full border border-line bg-canvas py-1 pl-3 pr-1">
            <Icon name="receipt" size={14} color={palette.ink} />
            <Text className="shrink text-sm font-bold text-ink" numberOfLines={1}>
              {attachment.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("supportX.attachment.remove")}
              onPress={() => {
                setAttachment(undefined);
                upload.reset();
              }}
              className="h-11 w-11 items-center justify-center rounded-full active:bg-white"
            >
              <Icon name="close" size={16} color={palette.ink} />
            </Pressable>
          </View>
        ) : null}
        <View className="flex-row items-end gap-2">
          <IconButton
            icon="plus"
            label={
              attachment
                ? t("ui.attached", { name: attachment.name })
                : t("ui.attachFile")
            }
            onPress={() => void pickAttachment()}
            size={48}
          />
          <TextInput
            accessibilityLabel={t("ui.reply")}
            placeholder={t("supportX.thread.placeholder")}
            placeholderTextColor="#7D8F85"
            value={body}
            onChangeText={setBody}
            multiline
            textAlignVertical="top"
            className="max-h-32 min-h-12 flex-1 rounded-2xl border border-line bg-canvas px-4 py-3 text-base leading-6 text-ink"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("ui.sendReply")}
            accessibilityState={{
              disabled: !trimmedBody || send.isPending,
              busy: send.isPending,
            }}
            disabled={!trimmedBody || send.isPending}
            onPress={() => {
              if (trimmedBody) send.mutate();
            }}
            className={`h-12 w-12 items-center justify-center rounded-2xl bg-mint ${!trimmedBody ? "opacity-50" : "active:opacity-80"}`}
          >
            {send.isPending ? (
              <ActivityIndicator color={palette.ink} />
            ) : (
              <Icon name="arrow-right" size={22} color={palette.ink} />
            )}
          </Pressable>
        </View>
        {body.length > 0 && !trimmedBody ? (
          <Text className="text-sm text-muted">
            {t("supportX.replyRequired")}
          </Text>
        ) : null}
        <Text className="text-xs text-muted">
          {t("supportX.attachment.rules")}
        </Text>
      </View>
    </View>
  );
}

export default function SupportDetailPage() {
  return (
    <RequireAuth>
      <SupportDetailContent />
    </RequireAuth>
  );
}
