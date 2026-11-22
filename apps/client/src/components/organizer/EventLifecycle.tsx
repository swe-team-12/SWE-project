import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon, palette } from "@/components/icons";
import { Button, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { formatKzt } from "@/utils/format";

import {
  Badge,
  ConfirmButton,
  ErrorText,
  SectionTitle,
  SuccessText,
} from "./common";
import type { ActivationState, EventAccess, OrgEvent } from "./types";
import { eventKey } from "./useEventAccess";

/** Status, moderation reasons and publish/unpublish/duplicate/cancel/preview. */
export function EventLifecycle({
  event,
  access,
  activation,
}: {
  event: OrgEvent;
  access: EventAccess;
  activation?: ActivationState;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [notice, setNotice] = useState("");
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: eventKey(event.id) });
    await client.invalidateQueries({ queryKey: ["organizer-events"] });
  };
  const publish = useMutation({
    mutationFn: (name: "publish" | "unpublish") =>
      apiFetch<OrgEvent>(`/events/${event.id}/${name}`, { method: "POST" }),
    onSuccess: async (_data, name) => {
      setNotice(t(`organizer.lifecycle.${name}Done`));
      await refresh();
    },
  });
  const duplicate = useMutation({
    mutationFn: () =>
      apiFetch<OrgEvent>(`/events/${event.id}/duplicate`, { method: "POST" }),
    onSuccess: async (copy) => {
      await client.invalidateQueries({ queryKey: ["organizer-events"] });
      router.push({
        pathname: "/organizer/events/[id]",
        params: { id: copy.id },
      });
    },
  });
  const cancel = useMutation({
    mutationFn: (reason: string) =>
      apiFetch<{ refunded_orders: number; refunded_tiyin?: number }>(
        `/events/${event.id}/cancel?reason=${encodeURIComponent(reason)}`,
        { method: "POST" },
      ),
    onSuccess: async (result) => {
      setNotice(
        t("organizer.lifecycle.cancelDone", {
          count: result.refunded_orders,
          amount: formatKzt(result.refunded_tiyin ?? 0, i18n.language),
        }),
      );
      await refresh();
    },
  });
  const moderated = event.status === "suspended";
  const cancelled = event.status === "cancelled";
  const error = publish.error ?? duplicate.error ?? cancel.error;
  return (
    <Surface className="gap-4">
      <SectionTitle>{t("organizer.lifecycle.title")}</SectionTitle>
      <View className="flex-row flex-wrap items-center gap-3 rounded-2xl border border-line bg-canvas/60 p-4">
        <Badge status={event.status} />
        <Text className="min-w-52 flex-1 leading-6 text-ink">
          {t(`organizer.lifecycle.statusHelp.${event.status}`)}
        </Text>
      </View>
      {moderated ? (
        <View
          accessibilityRole="alert"
          className="gap-1 rounded-2xl border border-red-100 bg-red-50 p-4"
        >
          <View className="flex-row items-center gap-2">
            <Icon name="alert" size={18} color={palette.danger} />
            <Text className="flex-1 font-bold text-danger">
              {t("organizer.lifecycle.suspendedTitle")}
            </Text>
          </View>
          <Text className="text-ink">
            {activation?.suspension_reason
              ? t("organizer.lifecycle.reason", {
                  reason: activation.suspension_reason,
                })
              : t("organizer.lifecycle.reasonUnknown")}
          </Text>
          <Text className="text-sm text-ink">
            {t("organizer.lifecycle.suspendedHelp")}
          </Text>
        </View>
      ) : null}
      {event.paid_sales_suspended ? (
        <View
          accessibilityRole="alert"
          className="gap-1 rounded-2xl border border-red-100 bg-red-50 p-4"
        >
          <View className="flex-row items-center gap-2">
            <Icon name="alert" size={18} color={palette.danger} />
            <Text className="flex-1 font-bold text-danger">
              {t("organizer.activation.suspendedTitle")}
            </Text>
          </View>
          <Text className="text-ink">
            {activation?.paid_sales_suspension_reason
              ? t("organizer.lifecycle.reason", {
                  reason: activation.paid_sales_suspension_reason,
                })
              : t("organizer.lifecycle.reasonUnknown")}
          </Text>
        </View>
      ) : null}
      {notice ? <SuccessText>{notice}</SuccessText> : null}
      <View className="flex-row flex-wrap gap-3">
        {access.manage && !moderated && !cancelled ? (
          event.status === "published" ? (
            <ConfirmButton
              label={t("ui.unpublish")}
              variant="secondary"
              message={t("organizer.lifecycle.unpublishConfirm")}
              confirmLabel={t("ui.unpublish")}
              loading={publish.isPending}
              onConfirm={() => {
                setNotice("");
                publish.mutate("unpublish");
              }}
              testID="unpublish"
            />
          ) : (
            <Button
              iconName="sparkle"
              label={t("ui.publish")}
              loading={publish.isPending}
              onPress={() => {
                setNotice("");
                publish.mutate("publish");
              }}
              testID="publish"
            />
          )
        ) : null}
        <Button
          label={t("ui.preview")}
          variant="secondary"
          iconName="search"
          onPress={() =>
            router.push({ pathname: "/events/[id]", params: { id: event.id } })
          }
        />
        {access.manage ? (
          <Button
            label={t("ui.duplicateDraft")}
            variant="secondary"
            iconName="plus"
            loading={duplicate.isPending}
            onPress={() => duplicate.mutate()}
          />
        ) : null}
      </View>
      {event.status !== "published" && !cancelled ? (
        <Text className="text-xs text-muted">
          {t("organizer.lifecycle.previewHelp")}
        </Text>
      ) : null}
      <ErrorText error={error} />
      {access.manage && !cancelled ? (
        <View className="gap-3 rounded-2xl border border-red-100 bg-red-50/60 p-4">
          <View className="flex-row items-center gap-2">
            <Icon name="alert" size={18} color={palette.danger} />
            <Text className="flex-1 text-lg font-extrabold text-danger">
              {t("ui.cancelEvent")}
            </Text>
          </View>
          <Text className="leading-6 text-muted">{t("ui.cancelEventHelp")}</Text>
          <View className="flex-row flex-wrap">
            <ConfirmButton
              label={t("ui.cancelRefund")}
              message={t("organizer.lifecycle.cancelConfirm", {
                title: event.title,
              })}
              confirmLabel={t("organizer.lifecycle.cancelConfirmButton")}
              reason={{ label: t("ui.cancellationReason"), minLength: 5 }}
              loading={cancel.isPending}
              onConfirm={(reason) => {
                setNotice("");
                cancel.mutate(reason);
              }}
              testID="cancel-event"
            />
          </View>
        </View>
      ) : null}
    </Surface>
  );
}
