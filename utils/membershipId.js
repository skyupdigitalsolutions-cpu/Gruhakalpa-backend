// Shared membership-ID ordering.
//
// A membership ID packs four things together: a series prefix, the year it was
// issued, the membership type letter, and the member's sequence number —
// "GK2024P1176". The sequence number is what everyone means by "membership
// order", and it runs UNBROKEN across years and types: GK2024P1338 is followed
// immediately by GK2025A1339.
//
// So the sequence number must be the PRIMARY sort key. Neither Mongo's
// `.sort({ membership_id: 1 })` nor a plain string compare does that — both
// order byte by byte, which makes the YEAR the first tiebreaker and the TYPE
// LETTER the second. That splits one continuous run into separate blocks
// (GK2024A, GK2024P, GK2025A, GK2025P) with the numbering restarting inside
// each one.
//
// The prefix still groups first, so GK / NCS / NCG stay in their own runs;
// those are independent numbering series and interleaving them would be wrong.
//
// This file is the CommonJS twin of the comparator in the frontend's
// src/components/MemberList.js — keep the two in step.

// Leading letters of the ID. "GK2024P1176" -> "GK"
const idPrefix = (val) =>
  (String(val ?? "")
    .trim()
    .toUpperCase()
    .match(/^[A-Z]+/) || [""])[0];

// LAST run of digits in the ID = the sequence number. Taking the last group
// rather than the first is what skips over the year.
//   "GK2024P1176" -> 1176      "GK2025A1339" -> 1339
const idSequence = (val) => {
  const groups = String(val ?? "").match(/\d+/g);
  return groups ? Number(groups[groups.length - 1]) : null;
};

// Split an ID into alternating text / number chunks, used only as a tiebreaker.
// Numeric segments still compare as NUMBERS, not as text, so an unpadded legacy
// "GK2023P9" never sorts after "GK2023P1000".
const idChunks = (val) =>
  String(val ?? "")
    .trim()
    .toUpperCase()
    .split(/(\d+)/)
    .filter((part) => part !== "");

const compareChunks = (A, B) => {
  const len = Math.max(A.length, B.length);
  for (let i = 0; i < len; i++) {
    const x = A[i];
    const y = B[i];
    // Shorter ID that matched so far is the smaller one ("GK2023P1" < "GK2023P1A")
    if (x === undefined) return -1;
    if (y === undefined) return 1;

    const xIsNum = /^\d+$/.test(x);
    const yIsNum = /^\d+$/.test(y);

    if (xIsNum && yIsNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
    } else if (x !== y) {
      // Numeric chunks sort before text chunks at the same position.
      if (xIsNum !== yIsNum) return xIsNum ? -1 : 1;
      return x < y ? -1 : 1;
    }
  }
  return 0;
};

const compareMembershipId = (a, b) => {
  const aId = String(a ?? "").trim();
  const bId = String(b ?? "").trim();

  // Members with no ID sort to the bottom rather than crowding the top.
  if (!aId || !bId) return aId ? -1 : bId ? 1 : 0;

  // 1. Series prefix (GK / NCS / NCG) — separate numbering series stay grouped.
  const prefixDiff = idPrefix(aId).localeCompare(idPrefix(bId));
  if (prefixDiff !== 0) return prefixDiff;

  // 2. Sequence number — the actual membership order.
  const aSeq = idSequence(aId);
  const bSeq = idSequence(bId);
  if (aSeq === null && bSeq !== null) return 1;
  if (bSeq === null && aSeq !== null) return -1;
  if (aSeq !== null && bSeq !== null && aSeq !== bSeq) return aSeq - bSeq;

  // 3. Same sequence number (a re-issue, or a "-A" style suffix): fall back to
  //    the full chunk-wise compare so the ordering is still deterministic.
  return compareChunks(idChunks(aId), idChunks(bId));
};

// Sort an array of member-ish objects in place by their membership_id.
const sortByMembershipId = (list, key = "membership_id") =>
  list.sort((a, b) => compareMembershipId(a?.[key], b?.[key]));

module.exports = {
  idPrefix,
  idSequence,
  compareMembershipId,
  sortByMembershipId,
};