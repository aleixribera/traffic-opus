// What a click will cost, called out when it is a large share of the company's cash (play-test 2026-11-09, C5: one
// click on a 2.8 km road was $16,722 with nothing to say that was a third of the bank). Pure, so the line is a test.

/** From this share of the company's cash, and this much money, one click's cost is called out. */
export const DEAR_SHARE = 0.25, DEAR_MIN = 2000;

/** The share of the cash a cost is (whole %), when it is large enough to call out; else 0. */
export function dearShare(cost: number, money: number): number {
  return cost >= DEAR_MIN && money > 0 && cost >= money * DEAR_SHARE ? Math.round((cost / money) * 100) : 0;
}
