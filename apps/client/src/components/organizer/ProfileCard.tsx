import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  Button,
  ErrorBlock,
  Field,
  LabeledValue,
  LoadingBlock,
  SectionTitle as UiSectionTitle,
  Surface,
} from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { isValidEmail } from "@/lib/email";
import { useAuth } from "@/providers/AuthProvider";

import {
  Badge,
  DemoNotice,
  ErrorText,
  errorMessage,
  isNotFound,
  SectionTitle,
  SuccessText,
} from "./common";
import { IconTile } from "./design";
import type { OrganizerProfile } from "./types";

export const PROFILE_KEY = ["organizer-profile"];

export function useOrganizerProfile(enabled = true) {
  return useQuery({
    queryKey: PROFILE_KEY,
    enabled,
    queryFn: async () => {
      try {
        return await apiFetch<OrganizerProfile>("/auth/organizer-profile");
      } catch (error) {
        // No profile yet is a normal state, not a failure.
        if (isNotFound(error)) return null;
        throw error;
      }
    },
  });
}

function VerificationState({
  label,
  verified,
}: {
  label: string;
  verified: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View className="min-w-52 flex-1 flex-row flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-canvas/60 p-3">
      <Text className="font-semibold text-ink">{label}</Text>
      <Badge
        status={verified ? "verified" : "missing"}
        label={
          verified
            ? t("organizer.profile.verified")
            : t("organizer.profile.notVerified")
        }
      />
    </View>
  );
}

function ProfileForm({
  profile,
  onDone,
  onCancel,
}: {
  profile: OrganizerProfile | null;
  onDone(saved: OrganizerProfile): void;
  onCancel?(): void;
}) {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState(profile?.organization_name ?? "");
  const [email, setEmail] = useState(
    profile?.contact_email ?? user?.email ?? "",
  );
  const [phone, setPhone] = useState(profile?.contact_phone ?? "");
  const [payout, setPayout] = useState(profile?.payout_account_label ?? "");
  const [submitted, setSubmitted] = useState(false);
  const nameError =
    name.trim().length < 2 ? t("organizer.validation.organizationShort") : "";
  const emailError = !isValidEmail(email) ? t("ui.invalidEmail") : "";
  const save = useMutation({
    mutationFn: () =>
      apiFetch<OrganizerProfile>("/auth/organizer-profile", {
        method: "PUT",
        body: JSON.stringify({
          organization_name: name.trim(),
          contact_email: email.trim(),
          contact_phone: phone.trim() || null,
          payout_account_label: payout.trim() || null,
        }),
      }),
    onSuccess: async (saved) => {
      client.setQueryData(PROFILE_KEY, saved);
      await refreshUser();
      await client.invalidateQueries({ queryKey: ["organizer-events"] });
      onDone(saved);
    },
  });
  return (
    <View className="gap-4">
      <Field
        label={t("ui.organizationName")}
        value={name}
        onChangeText={setName}
        error={submitted && nameError ? nameError : undefined}
      />
      <View className="flex-row flex-wrap gap-4">
        <View className="min-w-52 flex-1">
          <Field
            label={t("organizer.profile.contactEmail")}
            icon="mail"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            error={submitted && emailError ? emailError : undefined}
          />
        </View>
        <View className="min-w-52 flex-1">
          <Field
            label={t("ui.contactPhone")}
            icon="user"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
        </View>
      </View>
      <Field
        label={t("organizer.profile.payoutLabel")}
        icon="card"
        value={payout}
        onChangeText={setPayout}
        maxLength={100}
        hint={t("organizer.profile.payoutHelp")}
      />
      <ErrorText error={save.error} />
      <View className="flex-row flex-wrap gap-3">
        <Button
          iconName="check"
          label={
            profile
              ? t("organizer.profile.save")
              : t("ui.createOrganizerProfile")
          }
          loading={save.isPending}
          onPress={() => {
            setSubmitted(true);
            if (!nameError && !emailError) save.mutate();
          }}
        />
        {onCancel ? (
          <Button
            label={t("common.cancel")}
            variant="secondary"
            onPress={onCancel}
          />
        ) : null}
      </View>
    </View>
  );
}

/** Organizer profile: view, edit and the simulated verification. */
export function ProfileCard() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const profile = useOrganizerProfile();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const verify = useMutation({
    mutationFn: (target: { identity: boolean; payout: boolean }) =>
      apiFetch<OrganizerProfile>("/auth/organizer-profile/verification/simulate", {
        method: "POST",
        body: JSON.stringify(target),
      }),
    onSuccess: (saved) => {
      client.setQueryData(PROFILE_KEY, saved);
      void client.invalidateQueries({ queryKey: ["org-event"] });
      setNotice(t("organizer.profile.verificationDone"));
    },
  });
  if (profile.isLoading) return <LoadingBlock />;
  if (profile.error) {
    return (
      <ErrorBlock
        message={errorMessage(profile.error)}
        retry={() => void profile.refetch()}
      />
    );
  }
  const data = profile.data ?? null;
  if (!data || editing) {
    return (
      <Surface className="gap-5">
        <View className="flex-row items-start gap-3">
          <IconTile name="user" />
          <View className="min-w-0 flex-1">
            <UiSectionTitle
              title={
                data
                  ? t("organizer.profile.editTitle")
                  : t("ui.createOrganizerProfile")
              }
              subtitle={!data ? t("ui.freeEventsHelp") : undefined}
            />
          </View>
        </View>
        <ProfileForm
          profile={data}
          onCancel={data ? () => setEditing(false) : undefined}
          onDone={(saved) => {
            setEditing(false);
            setNotice(
              saved.payout_verification_reset
                ? t("organizer.profile.savedPayoutReset")
                : t("organizer.profile.saved"),
            );
          }}
        />
      </Surface>
    );
  }
  const hasPayout = !!data.payout_account_label?.trim();
  const target = {
    identity: !data.identity_verified,
    payout: !data.payout_verified && hasPayout,
  };
  const allVerified = data.identity_verified && data.payout_verified;
  return (
    <Surface className="gap-5">
      <View className="flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-0 flex-1 basis-60 flex-row items-start gap-3">
          <IconTile name="user" />
          <View className="min-w-0 flex-1 gap-0.5">
            <SectionTitle>{t("organizer.profile.title")}</SectionTitle>
            <Text className="text-base font-semibold text-muted">
              {data.organization_name}
            </Text>
          </View>
        </View>
        <Button
          label={t("organizer.profile.edit")}
          variant="secondary"
          size="sm"
          onPress={() => {
            setNotice("");
            setEditing(true);
          }}
        />
      </View>
      <View className="flex-row flex-wrap gap-x-6 gap-y-3">
        <LabeledValue
          label={t("organizer.profile.contactEmail")}
          value={data.contact_email}
        />
        <LabeledValue
          label={t("organizer.profile.contactPhone")}
          value={data.contact_phone || t("organizer.common.notSet")}
        />
        <LabeledValue
          label={t("organizer.profile.payoutLabel")}
          value={data.payout_account_label || t("organizer.common.notSet")}
        />
      </View>
      <View className="flex-row flex-wrap gap-3">
        <VerificationState
          label={t("organizer.profile.identity")}
          verified={data.identity_verified}
        />
        <VerificationState
          label={t("organizer.profile.payout")}
          verified={data.payout_verified}
        />
      </View>
      {notice ? <SuccessText>{notice}</SuccessText> : null}
      {allVerified ? null : (
        <View className="gap-3">
          <DemoNotice>{t("organizer.profile.verificationHelp")}</DemoNotice>
          {!hasPayout ? (
            <Text className="text-sm text-ink">
              {t("organizer.profile.payoutNeeded")}
            </Text>
          ) : null}
          <View className="flex-row">
            <Button
              label={t("organizer.profile.simulateVerification")}
              variant="secondary"
              loading={verify.isPending}
              disabled={!target.identity && !target.payout}
              onPress={() => {
                setNotice("");
                verify.mutate(target);
              }}
            />
          </View>
          <ErrorText error={verify.error} />
        </View>
      )}
    </Surface>
  );
}
