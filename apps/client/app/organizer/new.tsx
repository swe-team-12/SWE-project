import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";
import { useTranslation } from "react-i18next";

import {
  EventForm,
  eventPayload,
  newEventValues,
  type EventFormValues,
} from "@/components/organizer/EventForm";
import { RequireAuth } from "@/components/RequireAuth";
import { ScreenHeader } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import type { EventItem } from "@/types";

function NewEventContent() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [initial] = useState(() => newEventValues());
  const create = useMutation({
    mutationFn: (values: EventFormValues) =>
      apiFetch<EventItem>("/events", {
        method: "POST",
        body: JSON.stringify(eventPayload(values)),
      }),
    onSuccess: async (event) => {
      await client.invalidateQueries({ queryKey: ["organizer-events"] });
      router.replace({
        pathname: "/organizer/events/[id]",
        params: { id: event.id },
      });
    },
  });
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerClassName="gap-6 pb-28"
    >
      <ScreenHeader
        kicker={t("ui.newDraft")}
        title={t("ui.createAnEvent")}
        subtitle={t("organizer.form.createHelp")}
        backHref="/organizer"
        backLabel={t("organizerUi.backToEvents")}
      />
      <EventForm
        initial={initial}
        submitLabel={t("ui.createDraft")}
        onSubmit={(values) => create.mutate(values)}
        pending={create.isPending}
        error={create.error}
      />
    </ScrollView>
  );
}

export default function NewEventPage() {
  const { t } = useTranslation();
  return (
    <RequireAuth
      title={t("ui.organizerSignIn")}
      message={t("ui.organizerSignInHelp")}
    >
      <NewEventContent />
    </RequireAuth>
  );
}
