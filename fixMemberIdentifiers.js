/**
 * ONE-TIME MIGRATION — repair member identifier fields.
 *
 * Why: aadharnumber / mobile / alternatemobile / nomineenumber were previously
 * stored as Number. That mangled 12-digit aadhaar values into scientific
 * notation (e.g. 9.68581E+11), dropped leading zeros, and turned
 * space-separated values into NaN — so they showed up blank on the Member
 * Details screen. The schema is now String; this script rewrites the values
 * already in the database as clean strings.
 *
 * It can ALSO optionally restore correct aadhaar / mobile from a clean CSV
 * export (matched on membership_id), which is the only way to recover rows
 * whose digits were already lost to scientific notation in the DB.
 *
 * USAGE (from the backend project root):
 *   node fixMemberIdentifiers.js
 *   node fixMemberIdentifiers.js /absolute/path/to/clean_membership.csv
 *
 * Requires the same MONGODB connection env the app uses. Safe to re-run.
 */

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const Member = require("./models/Member");

// Adjust this if your app reads the URI from a different env var.
const MONGO_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.DB_URI ||
  "mongodb://127.0.0.1:27017/gruhakalpa";

// Turn any stored value into clean digit text. Handles Number, scientific
// notation strings, and space-separated strings. Returns "" if unrecoverable.
const toDigits = (val) => {
  if (val === null || val === undefined) return "";
  let s = String(val).trim();
  if (s === "") return "";
  // Scientific notation like 9.68581E+11 — expand then strip non-digits.
  if (/e\+?\d+/i.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return "";
    s = n.toLocaleString("fullwide", { useGrouping: false });
  }
  return s.replace(/\D/g, "");
};

// Very small CSV parser (handles quoted fields with commas). Good enough for a
// standard membership export. Returns array of row objects keyed by header.
function parseCSV(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (field !== "" || row.length > 0) {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      }
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => (obj[h] = r[idx] ?? ""));
    return obj;
  });
}

async function main() {
  const csvPath = process.argv[2];
  let csvByMembershipId = null;

  if (csvPath) {
    const abs = path.resolve(csvPath);
    if (!fs.existsSync(abs)) {
      console.error(`CSV not found: ${abs}`);
      process.exit(1);
    }
    const text = fs.readFileSync(abs, "utf8");
    const rows = parseCSV(text);
    csvByMembershipId = new Map();
    for (const r of rows) {
      const id = (r.membership_id || "").trim();
      if (id) csvByMembershipId.set(id, r);
    }
    console.log(`Loaded ${csvByMembershipId.size} rows from CSV for restore.`);
  }

  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB.");

  const members = await Member.find({}).lean();
  console.log(`Scanning ${members.length} members...`);

  let updated = 0;
  let restored = 0;

  for (const m of members) {
    const set = {};

    // Restore aadhaar/mobile from clean CSV when available (recovers values
    // already lost to scientific notation in the DB).
    const csvRow =
      csvByMembershipId && csvByMembershipId.get((m.membership_id || "").trim());

    const targets = [
      { field: "aadharnumber", csvKey: "aadharnumber" },
      { field: "mobile", csvKey: "mobile" },
      { field: "alternatemobile", csvKey: "alternatemobile" },
      { field: "nomineenumber", csvKey: "nomineenumber" },
    ];

    for (const t of targets) {
      const current = m[t.field];

      // Prefer a clean CSV value if the current DB value looks corrupted/lost.
      let candidate = toDigits(current);
      const currentLooksBad =
        current === null ||
        current === undefined ||
        typeof current === "number" ||
        /e\+?\d+/i.test(String(current));

      if (csvRow && currentLooksBad) {
        const fromCsv = toDigits(csvRow[t.csvKey]);
        if (fromCsv) {
          candidate = fromCsv;
          if (t.field === "aadharnumber" || t.field === "mobile") restored++;
        }
      }

      // Only write when the stored form actually differs (e.g. it was a Number,
      // or scientific notation, or had spaces) — avoids no-op writes.
      const currentStr = current === null || current === undefined ? "" : String(current);
      if (candidate !== "" && candidate !== currentStr) {
        set[t.field] = candidate;
      }
    }

    if (Object.keys(set).length > 0) {
      await Member.updateOne({ _id: m._id }, { $set: set });
      updated++;
    }
  }

  console.log(`Done. Members updated: ${updated}. Identifier values restored from CSV: ${restored}.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});