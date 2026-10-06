// ─────────────────────────────────────────────────────────────────────────
// Phone helpers — one place that decides India vs UK (vs other) format.
//
// Rules:
//   • India: 10 digits starting 6-9, optionally prefixed +91 / 91 / 0.
//     Shown as "+91 98765 43210". Stored key = the 10-digit local number
//     (keeps existing records / duplicate checks working).
//   • UK: must be entered with the country code (+44 / 0044 / 44).
//     Shown as "+44 7911 123456". Stored key = full digits "447911123456".
//   • Any other country (entered with +code): shown as "+<digits>".
//
// NOTE: a UK local number like "07911123456" can't be told apart from an
// Indian "0" + 7911123456, so UK numbers MUST carry +44.
// ─────────────────────────────────────────────────────────────────────────

const digitsOf = (v) =>
  String(v ?? "")
    .replace(/\D/g, "")
    .replace(/^00/, "");

// Returns the 10-digit Indian local number, or null if not Indian.
const indianLocal = (d) => {
  if (/^[6-9]\d{9}$/.test(d)) return d;
  if (/^0[6-9]\d{9}$/.test(d)) return d.slice(1);
  if (/^91[6-9]\d{9}$/.test(d)) return d.slice(2);
  return null;
};

// Human-readable display: "+91 98765 43210" / "+44 7911 123456".
const formatPhone = (v) => {
  const d = digitsOf(v);
  if (!d) return "";
  const local = indianLocal(d);
  if (local) return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  if (/^447\d{9}$/.test(d)) return `+44 ${d.slice(2, 6)} ${d.slice(6)}`;
  if (d.startsWith("44") && d.length >= 11) return `+44 ${d.slice(2)}`;
  if (d.length >= 8 && d.length <= 15) return `+${d}`;
  return String(v);
};

// Canonical comparison / storage key (digits only).
// India → 10-digit local; everything else → full digits with country code.
const phoneKey = (v) => {
  const d = digitsOf(v);
  if (!d) return "";
  return indianLocal(d) || d;
};

// For Number-typed schema fields (SiteBooking / FD / RD mobilenumber).
const toPhoneNumber = (v) => {
  const k = phoneKey(v);
  if (!k) return undefined;
  const n = Number(k);
  return isNaN(n) ? undefined : n;
};

module.exports = { formatPhone, phoneKey, toPhoneNumber, digitsOf };