import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  Button,
  ErrorBlock,
  Field,
  LoadingBlock,
  StatusBadge,
  Surface,
} from "@/components/ui";
import { apiFetch, currentAccessToken, WS_URL } from "@/lib/api";
import { fileForm } from "@/lib/files";
import { useAuth } from "@/providers/AuthProvider";

interface CaseDetail {
  id: string;
  case_number: string;
  status: string;
  subject: string;
  requester_id: string;
  messages: {
    id: string;
    sender_id: string;
    body: string;
    created_at: string;
    attachments: {
      id: string;
      name: string;
      mime_type: string;
      size_bytes: number;
    }[];
  }[];
}

export default function SupportDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const client = useQueryClient();
  const [body, setBody] = useState("");
  const [attachment, setAttachment] =
    useState<DocumentPicker.DocumentPickerAsset>();
  const query = useQuery({
    queryKey: ["support-case", id],
    queryFn: () => apiFetch<CaseDetail>(`/support/cases/${id}`),
    enabled: !!id,
    refetchInterval: 15_000,
  });
  useEffect(() => {
    const token = currentAccessToken();
    if (!id || !token) return;
    const socket = new WebSocket(
      `${WS_URL}/support/cases/${id}/ws?token=${encodeURIComponent(token)}`,
    );
    socket.onmessage = () =>
      void client.invalidateQueries({ queryKey: ["support-case", id] });
    const interval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send("ping");
    }, 20_000);
    return () => {
      clearInterval(interval);
      socket.close();
    };
  }, [client, id]);
  const send = useMutation({
    mutationFn: async () => {
      const message = await apiFetch<{ id: string }>(
        `/support/cases/${id}/messages`,
        { method: "POST", body: JSON.stringify({ body }) },
      );
      if (attachment) {
        const form = await fileForm(attachment);
        await apiFetch(`/support/messages/${message.id}/attachments`, {
          method: "POST",
          body: form,
        });
      }
    },
    onSuccess: async () => {
      setBody("");
      setAttachment(undefined);
      await query.refetch();
    },
  });
  const update = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/support/cases/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => query.refetch(),
  });
  const download = async (attachmentId: string) => {
    const result = await apiFetch<{ url: string }>(
      `/support/attachments/${attachmentId}/download`,
    );
    await Linking.openURL(result.url);
  };
  if (query.isLoading) return <LoadingBlock />;
  if (query.error || !query.data)
    return (
      <ErrorBlock
        message={(query.error as Error)?.message ?? t("ui.somethingWrong")}
      />
    );
  const item = query.data;
  const staff = user?.id !== item.requester_id;
  return (
    <ScrollView contentContainerClassName="mx-auto w-full max-w-4xl gap-5 pb-16">
      <View className="flex-row flex-wrap items-start justify-between gap-3">
        <View>
          <Text className="font-mono text-sm font-bold text-brand">
            {item.case_number}
          </Text>
          <Text className="mt-1 text-3xl font-black text-ink">
            {item.subject}
          </Text>
        </View>
        <StatusBadge status={item.status} />
      </View>
      {staff ? (
        <Surface className="gap-3">
          <Text className="font-bold text-ink">{t("ui.staffStatus")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {["open", "in_progress", "waiting_for_customer", "resolved"].map(
              (status) => (
                <Button
                  key={status}
                  label={t(`status.${status}`)}
                  variant={item.status === status ? "primary" : "secondary"}
                  onPress={() => update.mutate(status)}
                />
              ),
            )}
          </View>
        </Surface>
      ) : null}
      <Surface className="gap-4">
        {item.messages.map((message) => {
          const mine = message.sender_id === user?.id;
          return (
            <View
              key={message.id}
              className={`max-w-[85%] gap-2 rounded-2xl p-4 ${mine ? "ml-auto bg-brand" : "mr-auto bg-slate-100"}`}
            >
              <Text className={`leading-6 ${mine ? "text-white" : "text-ink"}`}>
                {message.body}
              </Text>
              {message.attachments?.map((item) => (
                <Button
                  key={item.id}
                  label={item.name}
                  variant="secondary"
                  onPress={() => void download(item.id)}
                />
              ))}
              <Text
                className={`text-xs ${mine ? "text-teal-100" : "text-muted"}`}
              >
                {new Date(message.created_at).toLocaleString(i18n.language)}
              </Text>
            </View>
          );
        })}
      </Surface>
      <Surface className="gap-4">
        <Field
          label={t("ui.reply")}
          value={body}
          onChangeText={setBody}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
        <View className="flex-row flex-wrap gap-3">
          <Button
            label={
              attachment
                ? t("ui.attached", { name: attachment.name })
                : t("ui.attachFile")
            }
            variant="secondary"
            onPress={async () => {
              const result = await DocumentPicker.getDocumentAsync({
                type: ["image/jpeg", "image/png", "application/pdf"],
                copyToCacheDirectory: true,
              });
              if (!result.canceled) setAttachment(result.assets[0]);
            }}
          />
          <Button
            label={t("ui.sendReply")}
            onPress={() => send.mutate()}
            loading={send.isPending}
            disabled={!body}
          />
        </View>
        {send.error ? (
          <Text className="text-danger">{(send.error as Error).message}</Text>
        ) : null}
      </Surface>
    </ScrollView>
  );
}
