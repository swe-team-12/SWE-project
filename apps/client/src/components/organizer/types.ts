import type { EventItem, TicketType } from "@/types";

export interface OrgTicketType extends TicketType {
  sales_start_at?: string | null;
  sales_end_at?: string | null;
}

export interface OrgEvent extends Omit<EventItem, "ticket_types"> {
  ticket_types: OrgTicketType[];
}

export type StaffRole = "manager" | "support" | "finance" | "check_in";

/** What the signed-in person may do on one event (derived from the API). */
export interface EventAccess {
  loading: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  /** Owner, platform admin or manager: edit, publish, tickets, team. */
  manage: boolean;
  /** Manager or finance: sales, analytics, campaigns, refunds, history. */
  finance: boolean;
  /** Manager, support or check-in: attendee list. */
  attendees: boolean;
  /** Manager or support: support cases of the event. */
  support: boolean;
  any: boolean;
}

export interface ChecklistItem {
  key: string;
  done: boolean;
  error_code: string;
}

export interface ActivationPayment {
  id: string;
  status: string;
  amount_tiyin: number;
  reference: string;
  failure_reason: string | null;
  created_at: string;
  paid_by?: { id: string; display_name: string } | null;
}

export interface ActivationState {
  event_id: string;
  event_status: string;
  mode: string;
  activation_fee_tiyin: number;
  activation_paid: boolean;
  terms_accepted: boolean;
  paid_sales_active: boolean;
  paid_sales_suspended: boolean;
  paid_sales_suspension_reason: string | null;
  suspension_reason: string | null;
  can_sell_paid_tickets: boolean;
  ready_for_payment: boolean;
  checklist: ChecklistItem[];
  organizer?: {
    user_id: string;
    display_name: string;
    email_verified: boolean;
    organization_name: string | null;
    identity_verified: boolean;
    payout_account_label: string | null;
    payout_verified: boolean;
  } | null;
  payments: ActivationPayment[];
}

export interface OrganizerProfile {
  id: string;
  user_id: string;
  organization_name: string;
  contact_email: string;
  contact_phone: string | null;
  payout_account_label: string | null;
  identity_verified: boolean;
  payout_verified: boolean;
  verification_mode?: string;
  updated_at?: string;
  payout_verification_reset?: boolean;
  completed?: string[];
}

export interface AnalyticsTicketType {
  id: string;
  ticket_type_id: string;
  name: string;
  price_tiyin: number;
  quantity: number;
  capacity: number;
  available: number;
  reserved: number;
  held: number;
  sold: number;
  refunded: number;
  cancelled: number;
  checked_in: number;
  percent_sold: number;
  revenue_tiyin: number;
  gross_revenue_tiyin: number;
  is_hidden: boolean;
}

export interface AnalyticsCampaign {
  id: string;
  name: string;
  code: string;
  is_enabled: boolean;
  views: number;
  checkouts: number;
  purchases: number;
  redemptions: number;
  orders: number;
  tickets: number;
  gross_tiyin: number;
  discount_tiyin: number;
  refund_tiyin: number;
  net_tiyin: number;
  conversion_rate: number;
  checkout_conversion_rate: number;
}

export interface Analytics {
  range?: { start: string | null; end: string | null; all_time: boolean };
  kpis: Record<string, number>;
  ticket_types: AnalyticsTicketType[];
  campaigns: AnalyticsCampaign[];
  sales_over_time: {
    date: string;
    orders: number;
    tickets: number;
    revenue_tiyin: number;
  }[];
  traffic_funnel: {
    event_views: number;
    campaign_views: number;
    checkout_starts: number;
    demo_purchases: number;
  };
}

export interface OrderLine {
  id: string;
  ticket_type_id: string;
  ticket_type_name: string;
  unit_price_tiyin: number;
  attendee_name: string;
  attendee_email: string;
  seat_label: string | null;
  ticket_id: string | null;
  ticket_code: string | null;
  ticket_status: string | null;
}

export interface EventOrder {
  id: string;
  order_number: string;
  status: string;
  subtotal_tiyin: number;
  discount_tiyin: number;
  processing_fee_tiyin: number;
  total_tiyin: number;
  organizer_net_tiyin: number;
  created_at: string;
  ticket_count?: number;
  buyer_name?: string | null;
  buyer_email?: string | null;
  items?: OrderLine[];
}

export interface AttendeeRow {
  ticket_id: string;
  ticket_code: string;
  ticket_status: string;
  attendee_name: string;
  attendee_email: string;
  ticket_type_id: string;
  ticket_type_name: string;
  seat_label: string | null;
  checked_in: boolean;
  checked_in_at: string | null;
  order_id: string;
  order_number: string;
  order_status: string;
}

export interface RefundRow {
  id: string;
  order_id: string;
  amount_tiyin: number;
  status: string;
  reason: string;
  created_at: string;
  order_number: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  initiated_by_name: string | null;
}

export interface PaymentRow {
  id: string;
  order_id: string | null;
  kind: string;
  status: string;
  amount_tiyin: number;
  provider_reference: string;
  failure_reason: string | null;
  created_at: string;
  order_number: string | null;
  payer_name: string | null;
  payer_email: string | null;
}

export interface Paged<T> {
  total: number;
  limit: number;
  offset: number;
  items: T[];
}

export interface PayoutSummary {
  organizer_net_tiyin: number;
  estimated_payout_tiyin: number;
  scheduled_tiyin: number;
  paid_tiyin: number;
  eligible_at: string | null;
  items: {
    id: string;
    amount_tiyin: number;
    status: string;
    eligible_at: string | null;
    paid_at: string | null;
    created_at: string;
  }[];
}

export interface Campaign {
  id: string;
  name: string;
  code: string;
  discount_type: "percentage" | "fixed_kzt";
  discount_value: number;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  is_enabled: boolean;
  applicable_ticket_type_ids: string[];
  campaign_url: string | null;
  state: string | null;
  redemptions: number;
  redemptions_remaining: number | null;
  orders: number;
  tickets_sold: number;
  gross_tiyin: number;
  discount_tiyin: number;
  refunded_orders: number;
}

export interface StaffMember {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: StaffRole;
  assigned_at?: string | null;
  assigned_by_name?: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  accepted: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface SupportCaseRow {
  id: string;
  case_number: string;
  category: string;
  status: string;
  subject: string;
  requester_name: string | null;
  requester_email: string | null;
  assignee_name: string | null;
  escalated: boolean;
  updated_at: string;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  description: string;
}
