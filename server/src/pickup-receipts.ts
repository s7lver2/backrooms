export interface PickupReceipt {
  by: string;
  at: number;
}

const PICKUP_RECEIPT_TTL = 30_000;

/** Los recibos solo cubren la ventana de reintentos del cliente. */
export function expirePickupReceipts(receipts: Map<string, PickupReceipt>, now: number) {
  for (const [id, receipt] of receipts) if (now - receipt.at >= PICKUP_RECEIPT_TTL) receipts.delete(id);
}
