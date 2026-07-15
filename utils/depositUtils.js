// utils/depositUtils.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for Fixed Deposit (FD) and Recurring Deposit (RD).
//   - numberToWordsIndian : ₹ amount → "Rupees ... Only" (Indian lakh/crore)
//   - addDays / addMonths  : date math used for maturity dates
//   - computeFDInterest    : simple interest on the FD principal
//   - computeRDInterest    : interest on the RD's total paid, pro-rated by months
//   - nextDepositNumber    : generates the next FDR/RD number for a year
// All money is handled in whole rupees and rounded to 2 decimals where needed.
// ─────────────────────────────────────────────────────────────────────────────

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? " " + ONES[o] : "");
}

function threeDigits(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  let str = "";
  if (h) str += ONES[h] + " Hundred";
  if (rest) str += (h ? " " : "") + twoDigits(rest);
  return str;
}

// Convert a rupee amount to Indian-format words. Paise are included if present.
function numberToWordsIndian(amount) {
  const num = Math.max(0, Math.round(Number(amount || 0) * 100) / 100);
  let rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  if (rupees === 0 && paise === 0) return "Rupees Zero Only";

  const parts = [];
  const crore = Math.floor(rupees / 10000000);
  rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000);
  rupees %= 100000;
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  const hundred = rupees; // 0-999

  if (crore) parts.push(threeDigits(crore) + " Crore");
  if (lakh) parts.push(twoDigits(lakh) + " Lakh");
  if (thousand) parts.push(twoDigits(thousand) + " Thousand");
  if (hundred) parts.push(threeDigits(hundred));

  let words = "Rupees " + parts.join(" ").trim();
  if (paise) words += " and " + twoDigits(paise) + " Paise";
  words += " Only";
  return words.replace(/\s+/g, " ").trim();
}

// Add whole days to a date, returning a new Date.
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

// Add whole calendar months, clamping the day (Jan 31 + 1mo -> Feb 28/29).
function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + Number(months || 0));
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

function daysBetween(a, b) {
  const ms = new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0);
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Legacy constant kept for backward compatibility. FD maturity is no longer a
// fixed number of days — see fdMaturityDate below.
const FD_TENURE_DAYS = 367;

// FD maturity = issue date + tenure (calendar months) + a fixed grace of 2 days.
// Using calendar-month math means the span is automatically leap-year aware:
//   12 months in a normal year  → 365 days, +2 = 367 days
//   12 months across a Feb-29   → 366 days, +2 = 368 days
//   24 months                   → ~730/731 days, +2, etc.
// The exact day count is whatever daysBetween(issueDate, maturityDate) returns.
function fdMaturityDate(issueDate, tenureMonths, graceDays = 2) {
  const base = addMonths(issueDate, Number(tenureMonths) || 12);
  return addDays(base, graceDays);
}

// Fixed Deposit — simple interest on the principal for the FD period.
//   interest = principal × rate% × (days / 365)
// days defaults to the 367-day FD term but is derived from the actual
// paid-date → maturity-date span so it always matches what's stored.
function computeFDInterest(principal, ratePercent, days = FD_TENURE_DAYS) {
  const p = Number(principal) || 0;
  const r = Number(ratePercent) || 0;
  const d = Number(days) || FD_TENURE_DAYS;
  const interest = (p * r * (d / 365)) / 100;
  return {
    interestAmount: round2(interest),
    maturityAmount: round2(p + interest),
    days: d,
  };
}

// Recurring Deposit — interest on the total amount paid so far, pro-rated for
// the number of COMPLETED months.
//   interest = totalPaid × rate% × (monthsCompleted / 12)
function computeRDInterest(totalPaid, ratePercent, monthsCompleted) {
  const t = Number(totalPaid) || 0;
  const r = Number(ratePercent) || 0;
  const m = Math.max(0, Number(monthsCompleted) || 0);
  const interest = (t * r * (m / 12)) / 100;
  return {
    interestAmount: round2(interest),
    maturityAmount: round2(t + interest),
    monthsCompleted: m,
  };
}

// Generate the next deposit number for a Model, e.g. FDR2026001 / RD2026001.
// Finds the highest existing sequence for `${prefix}${year}` and adds 1.
// (Low-volume admin flow — a find-max-and-increment is sufficient here.)
async function nextDepositNumber(Model, field, prefix, year) {
  const yr = year || new Date().getFullYear();
  const stem = `${prefix}${yr}`;
  const rx = new RegExp(`^${prefix}${yr}(\\d{3,})$`);
  const latest = await Model.find({ [field]: { $regex: rx } })
    .sort({ [field]: -1 })
    .limit(1)
    .lean();

  let seq = 1;
  if (latest && latest.length) {
    const m = String(latest[0][field]).match(rx);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${stem}${String(seq).padStart(3, "0")}`;
}

module.exports = {
  numberToWordsIndian,
  addDays,
  addMonths,
  daysBetween,
  round2,
  FD_TENURE_DAYS,
  fdMaturityDate,
  computeFDInterest,
  computeRDInterest,
  nextDepositNumber,
};