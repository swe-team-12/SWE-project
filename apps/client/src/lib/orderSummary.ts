import type { OrderItemInfo } from "@/types";

export interface OrderItemLine {
  name: string;
  count: number;
  total_tiyin: number;
}

/** Groups order items by ticket type, keeping first-seen order. */
export function summarizeOrderItems(
  items: Pick<OrderItemInfo, "ticket_type_name" | "unit_price_tiyin">[],
): OrderItemLine[] {
  const lines = new Map<string, OrderItemLine>();
  for (const item of items) {
    const line = lines.get(item.ticket_type_name) ?? {
      name: item.ticket_type_name,
      count: 0,
      total_tiyin: 0,
    };
    line.count += 1;
    line.total_tiyin += item.unit_price_tiyin;
    lines.set(item.ticket_type_name, line);
  }
  return [...lines.values()];
}
