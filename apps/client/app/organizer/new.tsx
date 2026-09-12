import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, Field, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import type { EventItem } from "@/types";

function isoInDays(days: number, hour = 10) {
  const value = new Date(Date.now() + days * 86_400_000);
  value.setHours(hour, 0, 0, 0);
  return value.toISOString();
}

export default function NewEventPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Community");
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [city, setCity] = useState("Almaty");
  const [startsAt, setStartsAt] = useState(isoInDays(14));
  const [endsAt, setEndsAt] = useState(isoInDays(14, 16));
  const [capacity, setCapacity] = useState("100");
  const [visibility, setVisibility] = useState<
    "public" | "unlisted" | "private"
  >("public");
  const [seatingMode, setSeatingMode] = useState<
    "general_admission" | "assigned"
  >("general_admission");
  const create = useMutation({
    mutationFn: () =>
      apiFetch<EventItem>("/events", {
        method: "POST",
        body: JSON.stringify({
          title,
          description,
          category,
          venue_name: venueName,
          venue_address: venueAddress,
          city,
          starts_at: startsAt,
          ends_at: endsAt,
          timezone: "Asia/Almaty",
          registration_opens_at: new Date().toISOString(),
          registration_closes_at: startsAt,
          capacity: Number(capacity),
          visibility,
          seating_mode: seatingMode,
          refund_policy: "Full refunds are available until the event starts.",
        }),
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
    <ScrollView contentContainerClassName="gap-6 pb-16">
      <View>
        <Text className="text-sm font-black uppercase text-brand">
          {t("ui.newDraft")}
        </Text>
        <Text className="mt-1 text-4xl font-black text-ink">
          {t("ui.createAnEvent")}
        </Text>
      </View>
      <Surface className="gap-5">
        <Field
          label={t("ui.eventTitle")}
          value={title}
          onChangeText={setTitle}
          placeholder="Almaty Design Week"
        />
        <Field
          label={t("ui.description")}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />
        <View className="flex-row flex-wrap gap-4">
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
        <View className="flex-row flex-wrap gap-4">
          <View className="min-w-52 flex-1">
            <Field
              label={t("ui.venueName")}
              value={venueName}
              onChangeText={setVenueName}
            />
          </View>
          <View className="min-w-52 flex-1">
            <Field
              label={t("ui.venueAddress")}
              value={venueAddress}
              onChangeText={setVenueAddress}
            />
          </View>
        </View>
        <View className="flex-row flex-wrap gap-4">
          <View className="min-w-52 flex-1">
            <Field
              label={t("ui.startsAt")}
              value={startsAt}
              onChangeText={setStartsAt}
            />
          </View>
          <View className="min-w-52 flex-1">
            <Field
              label={t("ui.endsAt")}
              value={endsAt}
              onChangeText={setEndsAt}
            />
          </View>
          <View className="min-w-32 flex-1">
            <Field
              label={t("ui.capacity")}
              value={capacity}
              onChangeText={setCapacity}
              keyboardType="number-pad"
            />
          </View>
        </View>
        <View className="gap-2">
          <Text className="text-sm font-bold text-ink">
            {t("ui.visibility")}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {(["public", "unlisted", "private"] as const).map((item) => (
              <Pressable
                key={item}
                onPress={() => setVisibility(item)}
                className={`min-h-11 justify-center rounded-xl border px-4 ${visibility === item ? "border-brand bg-teal-50" : "border-line bg-white"}`}
              >
                <Text className="font-bold capitalize text-ink">
                  {t(`status.${item}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View className="gap-2">
          <Text className="text-sm font-bold text-ink">
            {t("ui.admission")}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {(["general_admission", "assigned"] as const).map((item) => (
              <Pressable
                key={item}
                onPress={() => setSeatingMode(item)}
                className={`min-h-11 justify-center rounded-xl border px-4 ${seatingMode === item ? "border-brand bg-teal-50" : "border-line bg-white"}`}
              >
                <Text className="font-bold capitalize text-ink">
                  {t(`status.${item}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {create.error ? (
          <Text className="rounded-xl bg-red-50 p-3 text-danger">
            {(create.error as Error).message}
          </Text>
        ) : null}
        <Button
          label={t("ui.createDraft")}
          onPress={() => create.mutate()}
          loading={create.isPending}
          disabled={
            title.length < 3 ||
            description.length < 10 ||
            !venueName ||
            !venueAddress
          }
        />
      </Surface>
    </ScrollView>
  );
}
