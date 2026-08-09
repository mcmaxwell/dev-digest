/** The two orderings the Files-changed tab offers. */
export const DIFF_ORDERS = ["smart", "original"] as const;
export type DiffOrder = (typeof DIFF_ORDERS)[number];
