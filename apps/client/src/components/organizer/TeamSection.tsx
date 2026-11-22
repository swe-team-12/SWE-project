import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Button, ErrorBlock, Field, LoadingBlock, Surface } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { isValidEmail } from "@/lib/email";
import { formatDateTime } from "@/utils/date";

import {
  Badge,
  ChoiceGroup,
  ConfirmButton,
  copyText,
  errorMessage,
  ErrorText,
  Fact,
  Muted,
  SectionTitle,
  SuccessText,
} from "./common";
import type { Invitation, OrgEvent, StaffMember, StaffRole } from "./types";
import { eventKey } from "./useEventAccess";

const ROLES: StaffRole[] = ["manager", "support", "finance", "check_in"];

/** State label of an invitation: accepted, expired or still pending. */
export function invitationState(
  invitation: Pick<Invitation, "accepted" | "expires_at">,
  now = new Date(),
): "accepted" | "expired" | "pending" {
  if (invitation.accepted) return "accepted";
  if (invitation.expires_at && new Date(invitation.expires_at) < now)
    return "expired";
  return "pending";
}

function StaffBlock({ event }: { event: OrgEvent }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("check_in");
  const [emailError, setEmailError] = useState("");
  const [notice, setNotice] = useState("");
  const staff = useQuery({
    queryKey: eventKey(event.id, "staff"),
    queryFn: () => apiFetch<StaffMember[]>(`/events/${event.id}/staff`),
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: eventKey(event.id, "staff") });
  const assign = useMutation({
    mutationFn: () =>
      apiFetch<StaffMember>(`/events/${event.id}/staff`, {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), role }),
      }),
    onSuccess: async () => {
      setNotice(t("organizer.team.assigned", { email: email.trim() }));
      setEmail("");
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (member: StaffMember) =>
      apiFetch(`/events/${event.id}/staff/${member.id}`, { method: "DELETE" }),
    onSuccess: async (_result, member) => {
      setNotice(t("organizer.team.removed", { name: member.display_name }));
      await refresh();
    },
  });
  const submit = () => {
    setNotice("");
    if (!isValidEmail(email.trim())) {
      setEmailError(t("ui.invalidEmail"));
      return;
    }
    setEmailError("");
    assign.mutate();
  };
  return (
    <Surface className="gap-4">
      <SectionTitle>{t("organizer.team.staffTitle")}</SectionTitle>
      <Muted>{t("organizer.team.staffHelp")}</Muted>
      {staff.isLoading ? <LoadingBlock /> : null}
      {staff.error ? (
        <ErrorBlock
          message={errorMessage(staff.error)}
          retry={() => void staff.refetch()}
        />
      ) : null}
      {staff.data?.length === 0 ? (
        <Muted>{t("organizer.team.noStaff")}</Muted>
      ) : null}
      {staff.data?.map((member) => (
        <View
          key={member.id}
          testID={`staff-${member.id}`}
          className="flex-row flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-canvas/60 p-4"
        >
          <View className="min-w-60 flex-1 gap-1">
            <Text className="font-bold text-ink">{member.display_name}</Text>
            <Text selectable className="text-sm text-muted">
              {member.email}
            </Text>
            <Fact
              label={t("organizer.team.role")}
              value={t(`organizer.team.roles.${member.role}`)}
            />
            {member.assigned_at ? (
              <Muted>
                {t("organizer.team.assignedMeta", {
                  date: formatDateTime(
                    member.assigned_at,
                    i18n.language,
                    "medium",
                  ),
                  name: member.assigned_by_name ?? "—",
                })}
              </Muted>
            ) : null}
          </View>
          <ConfirmButton
            label={t("organizer.team.remove", { name: member.display_name })}
            message={t("organizer.team.removeConfirm", {
              name: member.display_name,
              role: t(`organizer.team.roles.${member.role}`),
            })}
            confirmLabel={t("organizer.team.removeShort")}
            loading={remove.isPending && remove.variables?.id === member.id}
            onConfirm={() => {
              setNotice("");
              remove.mutate(member);
            }}
            testID={`staff-${member.id}-remove`}
          />
        </View>
      ))}
      {notice ? <SuccessText>{notice}</SuccessText> : null}
      <ErrorText error={remove.error} />
      <View className="gap-3 border-t border-line pt-4">
        <Text className="text-base font-extrabold text-ink">
          {t("organizer.team.assignTitle")}
        </Text>
        <Field
          label={t("organizer.team.email")}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          error={emailError || undefined}
          icon="mail"
          testID="staff-email"
        />
        <Muted>{t("organizer.team.emailHelp")}</Muted>
        <ChoiceGroup
          label={t("organizer.team.role")}
          value={role}
          onChange={setRole}
          options={ROLES.map((item) => ({
            value: item,
            label: t(`organizer.team.roles.${item}`),
          }))}
        />
        <Muted>{t(`organizer.team.roleHelp.${role}`)}</Muted>
        <ErrorText error={assign.error} />
        <View className="flex-row">
          <Button
            label={t("organizer.team.assign")}
            loading={assign.isPending}
            onPress={submit}
            iconName="plus"
            testID="staff-assign"
          />
        </View>
      </View>
    </Surface>
  );
}

function InvitationsBlock({ event }: { event: OrgEvent }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const invitations = useQuery({
    queryKey: eventKey(event.id, "invitations"),
    queryFn: () => apiFetch<Invitation[]>(`/events/${event.id}/invitations`),
  });
  const invite = useMutation({
    mutationFn: () =>
      apiFetch<{ url: string; email: string; reissued?: boolean }>(
        `/events/${event.id}/invitations?email=${encodeURIComponent(email.trim().toLowerCase())}`,
        { method: "POST" },
      ),
    onSuccess: async (result) => {
      setLink({ url: result.url, email: result.email ?? email.trim() });
      setCopied(null);
      setEmail("");
      await client.invalidateQueries({
        queryKey: eventKey(event.id, "invitations"),
      });
    },
  });
  const submit = () => {
    if (!isValidEmail(email.trim())) {
      setEmailError(t("ui.invalidEmail"));
      return;
    }
    setEmailError("");
    invite.mutate();
  };
  return (
    <Surface className="gap-4">
      <SectionTitle>{t("organizer.team.invitationsTitle")}</SectionTitle>
      <Muted>{t("organizer.team.invitationsHelp")}</Muted>
      {invitations.isLoading ? <LoadingBlock /> : null}
      {invitations.error ? (
        <ErrorBlock
          message={errorMessage(invitations.error)}
          retry={() => void invitations.refetch()}
        />
      ) : null}
      {invitations.data?.length === 0 ? (
        <Muted>{t("organizer.team.noInvitations")}</Muted>
      ) : null}
      {invitations.data?.map((item) => {
        const state = invitationState(item);
        return (
          <View
            key={item.id}
            className="flex-row flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-canvas/60 p-4"
          >
            <View className="min-w-60 flex-1 gap-1">
              <Text selectable className="font-bold text-ink">
                {item.email}
              </Text>
              <Muted>
                {t("organizer.team.invitedAt", {
                  date: formatDateTime(item.created_at, i18n.language, "medium"),
                })}
              </Muted>
              {item.expires_at && state !== "accepted" ? (
                <Muted>
                  {t("organizer.team.expiresAt", {
                    date: formatDateTime(
                      item.expires_at,
                      i18n.language,
                      "medium",
                    ),
                  })}
                </Muted>
              ) : null}
            </View>
            <Badge
              status={state}
              tone={
                state === "accepted" ? "good" : state === "expired" ? "bad" : "warn"
              }
            />
          </View>
        );
      })}
      <View className="gap-3 border-t border-line pt-4">
        <Field
          label={t("organizer.team.inviteEmail")}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          error={emailError || undefined}
          icon="mail"
          testID="invite-email"
        />
        <ErrorText error={invite.error} />
        <View className="flex-row">
          <Button
            label={t("organizer.team.invite")}
            loading={invite.isPending}
            onPress={submit}
            iconName="mail"
            testID="invite-send"
          />
        </View>
        {link ? (
          <View className="gap-2 rounded-2xl bg-canvas p-4">
            <SuccessText>
              {t("organizer.team.inviteCreated", { email: link.email })}
            </SuccessText>
            <Text selectable className="text-sm text-brand">
              {link.url}
            </Text>
            <View className="flex-row">
              <Button
                label={t("organizer.team.copyLink")}
                variant="secondary"
                onPress={() => {
                  void copyText(link.url).then(setCopied);
                }}
              />
            </View>
            {copied === true ? (
              <SuccessText>{t("organizer.common.copied")}</SuccessText>
            ) : null}
            {copied === false ? (
              <Muted>{t("organizer.common.copyManually")}</Muted>
            ) : null}
          </View>
        ) : null}
      </View>
    </Surface>
  );
}

/** Event staff and, for private events, attendee invitations. */
export function TeamSection({ event }: { event: OrgEvent }) {
  const { t } = useTranslation();
  return (
    <View className="gap-5">
      <StaffBlock event={event} />
      {event.visibility === "private" ? (
        <InvitationsBlock event={event} />
      ) : (
        <Surface className="gap-2">
          <SectionTitle>{t("organizer.team.invitationsTitle")}</SectionTitle>
          <Muted>{t("organizer.team.invitationsPrivateOnly")}</Muted>
        </Surface>
      )}
    </View>
  );
}
