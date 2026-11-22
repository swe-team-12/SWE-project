import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";

import { isForbidden } from "./common";
import type {
  ActivationState,
  AttendeeRow,
  EventAccess,
  OrgEvent,
  Paged,
  StaffMember,
  SupportCaseRow,
} from "./types";

export const eventKey = (id: string, ...rest: unknown[]) => [
  "org-event",
  id,
  ...rest,
];

/**
 * The API has no "my role on this event" endpoint, so access is derived from
 * what it lets the caller read: the staff list is manager-only, the activation
 * state is manager/finance, attendees are manager/support/check-in and the
 * event's support cases are manager/support. Owners and platform admins pass
 * every check.
 */
export function useEventAccess(event: OrgEvent | undefined) {
  const { user } = useAuth();
  const id = event?.id ?? "";
  const isOwner = !!event && !!user && event.owner_id === user.id;
  const isAdmin = !!user?.roles.includes("platform_admin");
  const full = isOwner || isAdmin;
  const retry = (count: number, error: unknown) =>
    !isForbidden(error) && count < 1;
  const staff = useQuery({
    queryKey: eventKey(id, "staff"),
    queryFn: () => apiFetch<StaffMember[]>(`/events/${id}/staff`),
    enabled: !!event,
    retry,
  });
  const activation = useQuery({
    queryKey: eventKey(id, "activation"),
    queryFn: () => apiFetch<ActivationState>(`/events/${id}/activation`),
    enabled: !!event,
    retry,
  });
  const attendeeProbe = useQuery({
    queryKey: eventKey(id, "probe", "attendees"),
    queryFn: () =>
      apiFetch<Paged<AttendeeRow>>(`/events/${id}/attendees?limit=1`),
    enabled: !!event && !full,
    retry,
  });
  const supportProbe = useQuery({
    queryKey: eventKey(id, "probe", "support"),
    queryFn: () =>
      apiFetch<SupportCaseRow[]>(`/events/${id}/support-cases?status=open`),
    enabled: !!event && !full,
    retry,
  });
  const loading =
    !event ||
    (!full &&
      (staff.isLoading ||
        activation.isLoading ||
        attendeeProbe.isLoading ||
        supportProbe.isLoading));
  const manage = full || staff.isSuccess;
  const finance = manage || activation.isSuccess;
  const attendees = manage || attendeeProbe.isSuccess;
  const support = manage || supportProbe.isSuccess;
  const access: EventAccess = {
    loading,
    isOwner,
    isAdmin,
    manage,
    finance,
    attendees,
    support,
    any: manage || finance || attendees || support,
  };
  return { access, staff, activation };
}
