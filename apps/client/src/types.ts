export type UserRole = "attendee" | "organizer" | "platform_admin";

export interface User {
  id: string;
  email: string;
  display_name: string;
  locale: "kk" | "ru" | "en";
  roles: UserRole[];
  is_email_verified: boolean;
  is_suspended: boolean;
}

export interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: string;
  token_type: "bearer";
  user: User;
}

export interface TicketType {
  id: string;
  name: string;
  description: string;
  price_tiyin: number;
  quantity: number;
  max_per_order: number;
  is_hidden: boolean;
  price_category?: string;
  /** Tickets still purchasable; present on single-event reads. */
  available?: number | null;
}

export interface EventItem {
  id: string;
  owner_id: string;
  slug: string;
  title: string;
  description: string;
  image_url?: string;
  category: string;
  venue_name: string;
  venue_address: string;
  city: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  registration_opens_at?: string;
  registration_closes_at?: string;
  capacity: number;
  status: "draft" | "published" | "unpublished" | "cancelled" | "suspended";
  visibility: "public" | "unlisted" | "private";
  seating_mode: "general_admission" | "assigned";
  refund_policy: string;
  paid_sales_active: boolean;
  paid_sales_suspended: boolean;
  cancellation_reason?: string | null;
  lifecycle_group?: "upcoming" | "active" | "completed" | "cancelled";
  ticket_types: TicketType[];
}

export interface Seat {
  id: string;
  section: string;
  row: string;
  number: string;
  price_category: string;
  is_accessible: boolean;
  x: number;
  y: number;
  status: "available" | "selected" | "held" | "sold" | "unavailable";
}

export interface Ticket {
  id: string;
  ticket_code: string;
  event_id: string;
  status: "valid" | "checked_in" | "cancelled" | "refunded";
  qr_token?: string;
}

export interface Problem {
  title: string;
  status: number;
  code: string;
  detail: string;
  errors?: { field: string; message: string }[];
}

// --- Attendee area (checkout, orders, ticket wallet, calendar, campaigns) ---

export type TicketTypeWithSales = TicketType & {
  sales_start_at?: string | null;
  sales_end_at?: string | null;
};

export interface CalendarLinks {
  available: boolean;
  reason?: "event_cancelled" | "ticket_not_valid" | "order_closed" | null;
  google?: string | null;
  outlook?: string | null;
  office365?: string | null;
  yahoo?: string | null;
  ics_path?: string | null;
}

export interface OrderItemInfo {
  id: string;
  ticket_type_id: string;
  ticket_type_name: string;
  unit_price_tiyin: number;
  attendee_name: string;
  attendee_email: string;
  seat_label?: string | null;
  ticket_id?: string | null;
  ticket_code?: string | null;
  ticket_status?: string | null;
}

export interface OrderInfo {
  id: string;
  order_number: string;
  event_id: string;
  status: string;
  subtotal_tiyin: number;
  discount_tiyin: number;
  processing_fee_tiyin: number;
  total_tiyin: number;
  created_at: string;
  event_title?: string | null;
  event_status?: string | null;
  event_starts_at?: string | null;
  event_timezone?: string | null;
  venue_name?: string | null;
  venue_address?: string | null;
  city?: string | null;
  ticket_count?: number;
  items?: OrderItemInfo[];
}

export interface OrderDetailInfo extends OrderInfo {
  refund_policy?: string | null;
  campaign?: { id: string; name: string; code: string } | null;
  payments?: {
    id: string;
    status: string;
    amount_tiyin: number;
    provider_reference?: string | null;
    failure_reason?: string | null;
    created_at: string;
  }[];
  refunds?: {
    id: string;
    amount_tiyin: number;
    status: string;
    reason?: string | null;
    created_at: string;
  }[];
  refunded_tiyin?: number;
  calendar?: CalendarLinks;
}

export interface TicketInfo extends Ticket {
  qr_available?: boolean;
  event_title?: string | null;
  event_status?: string | null;
  starts_at?: string | null;
  timezone?: string | null;
  venue_name?: string | null;
  venue_address?: string | null;
  city?: string | null;
  ticket_type_name?: string | null;
  attendee_name?: string | null;
  seat_label?: string | null;
  order_id?: string | null;
  order_number?: string | null;
  checked_in_at?: string | null;
  calendar?: CalendarLinks;
}

export interface CampaignResolution {
  event_id: string;
  event_title?: string;
  campaign_id: string;
  name?: string;
  state?: "active" | "disabled" | "not_started" | "expired" | "exhausted";
  promo_code: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
}
