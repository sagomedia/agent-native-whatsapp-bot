export const formatMoney = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
// Quantities are validated to three decimals; line amounts round half up to paise.
export function lineTotal(pricePaise: number, quantity: number): number {
  const units = Math.round(quantity * 1000);
  const value = (BigInt(pricePaise) * BigInt(units) + 500n) / 1000n;
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('Amount exceeds supported range');
  return result;
}
