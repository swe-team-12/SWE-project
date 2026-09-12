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
