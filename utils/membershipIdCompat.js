// utils/membershipIdCompat.js
// ─────────────────────────────────────────────────────────────────────────────
// BACKWARD-COMPATIBLE MEMBERSHIP ID LOOKUP
//
// THE PROBLEM
// controllers/memberLoginController.js authenticates with:
//
//     Member.findOne({ membership_id: username.trim() })
//
// and the comment above it says "username = membership_id". So the membership
// id IS the login username. Repadding GK2023P003 → GK2023P0003 therefore
// changes every member's username at once. On the morning after the migration,
// every member who types the id printed on their paperwork gets
// "Invalid credentials" — and the error gives them no hint why.
//
// THE FIX
// Try the id exactly as typed, then try the same id with the numeric tail
// re-padded to 4 digits, then with it stripped of leading zeros. Any historical
// or current spelling of the same id resolves to the same member.
//
// This is a read-only compatibility shim: it never writes, so it is safe to
// deploy BEFORE the migration and leave in place afterwards. Keeping it means
// old membership cards, old receipts and old WhatsApp messages carry on working
// indefinitely, which matters because you cannot recall paper.
// ─────────────────────────────────────────────────────────────────────────────

const ID_RE = /^([A-Z]{2,5})(\d{4})([A-Z]?)(\d+)$/;
const TARGET_DIGITS = 4;

/**
 * Every spelling of a membership id that should resolve to the same member,
 * most likely first. Returns a de-duplicated array.
 */
function membershipIdVariants(raw) {
  const input = String(raw || "").trim();
  if (!input) return [];

  const out = [input];
  const upper = input.toUpperCase();
  if (upper !== input) out.push(upper);

  const m = upper.match(ID_RE);
  if (m) {
    const [, code, year, letter, digits] = m;
    const bare = digits.replace(/^0+/, "") || "0";

    // 4-digit form (post-migration)
    out.push(`${code}${year}${letter}${bare.padStart(TARGET_DIGITS, "0")}`);
    // 3-digit form (pre-migration) — only if it still fits
    if (bare.length <= 3) out.push(`${code}${year}${letter}${bare.padStart(3, "0")}`);
    // unpadded, for anything hand-entered
    out.push(`${code}${year}${letter}${bare}`);
  }

  return [...new Set(out)];
}

/**
 * Find a member by any historical spelling of their membership id.
 *
 * @param {import("mongoose").Model} Member
 * @param {string} raw   id as typed by the user
 * @returns {Promise<object|null>}
 */
async function findMemberByAnyMembershipId(Member, raw) {
  const variants = membershipIdVariants(raw);
  if (!variants.length) return null;

  // One query rather than a loop: $in preserves index use and avoids N round
  // trips. Order of preference is re-applied below because $in does not
  // guarantee which document comes back first.
  const matches = await Member.find({ membership_id: { $in: variants } });
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  // More than one variant exists as a real record — ambiguous data. Prefer the
  // exact string the user typed, then the canonical 4-digit form.
  for (const v of variants) {
    const hit = matches.find((d) => d.membership_id === v);
    if (hit) return hit;
  }
  return matches[0];
}

module.exports = { membershipIdVariants, findMemberByAnyMembershipId, ID_RE, TARGET_DIGITS };