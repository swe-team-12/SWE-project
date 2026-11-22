import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { Image, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon, palette } from "@/components/icons";
import { Button, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fileForm } from "@/lib/files";

import { ErrorText, SectionTitle, SuccessText } from "./common";
import type { OrgEvent } from "./types";
import { eventKey } from "./useEventAccess";

/** Cover image preview and upload (JPEG or PNG). */
export function CoverSection({
  event,
  canEdit,
}: {
  event: OrgEvent;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const upload = useMutation({
    mutationFn: async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["image/jpeg", "image/png"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return null;
      const form = await fileForm(picked.assets[0]);
      return apiFetch<unknown>(`/events/${event.id}/image`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: async (result) => {
      if (result === null) return;
      await client.invalidateQueries({ queryKey: eventKey(event.id, "event") });
      await client.invalidateQueries({ queryKey: ["organizer-events"] });
    },
  });
  return (
    <Surface className="flex-row flex-wrap items-center gap-5">
      {event.image_url ? (
        <Image
          className="h-28 w-44 rounded-3xl"
          source={{ uri: event.image_url }}
          accessibilityLabel={t("organizer.cover.alt", { title: event.title })}
        />
      ) : (
        <View className="h-28 w-44 items-center justify-center gap-2 rounded-3xl bg-night">
          <Icon name="sparkle" size={20} color={palette.mint} />
          <Text className="font-bold text-white">{t("ui.noCover")}</Text>
        </View>
      )}
      <View className="min-w-60 flex-1 gap-2">
        <SectionTitle>{t("ui.eventCover")}</SectionTitle>
        <Text className="text-sm text-muted">{t("ui.eventCoverHelp")}</Text>
        {canEdit ? (
          <View className="flex-row">
            <Button
              label={t("ui.chooseCover")}
              variant="secondary"
              iconName="plus"
              loading={upload.isPending}
              onPress={() => upload.mutate()}
              testID="cover-upload"
            />
          </View>
        ) : null}
        {upload.isSuccess && upload.data !== null ? (
          <SuccessText>{t("organizer.cover.updated")}</SuccessText>
        ) : null}
        <ErrorText error={upload.error} />
      </View>
    </Surface>
  );
}
