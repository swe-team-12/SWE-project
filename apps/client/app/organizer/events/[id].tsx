import { useLocalSearchParams } from "expo-router";

import { EventWorkspace } from "@/components/organizer/EventWorkspace";
import { RequireAuth } from "@/components/RequireAuth";

export default function OrganizerEventPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <RequireAuth>
      <EventWorkspace eventId={String(id ?? "")} />
    </RequireAuth>
  );
}
