/**
 * ONE-TIME MIGRATION — repair member date fields (and a few legacy keys).
 *
 * WHY DOB IS BLANK ON THE MEMBER DETAILS SCREEN
 * ---------------------------------------------
 * models/Member.js declares:
 *
 *     dob: { type: Date, required: true }
 *
 * but a number of member documents hold dob as a dd-mm-yyyy STRING, e.g.
 * "26-05-1985". Those rows were inserted straight into MongoDB (bulk import /
 * mongoimport / Compass), bypassing Mongoose — the app's own controller writes
 * `new Date(req.body.dob)`, so anything created through the UI is fine.
 *
 * On read, Mongoose casts each value to its schema type. JavaScript parses
 * "26-05-1985" as month=26, which does not exist:
 *
 *     new Date("26-05-1985")  ->  Invalid Date
 *
 * Mongoose then DROPS the field during hydration, so the API response contains
 * no `dob` key at all, and the frontend's formatDate(undefined) correctly
 * renders "-". Nothing is wrong with the frontend: formatDate("26-05-1985")
 * already returns "26/05/1985". The value simply never reaches it.
 *
 * WHAT THIS SCRIPT FIXES
 *   1. dob / date / membership_date stored as strings  -> real Date objects
 *   2. The legacy key "father/ husband"                -> the schema path `father`
 *      (the slash/space key is not a schema path, so it is dropped on read too)
 *
 * DATE ORDER
 *   Defaults to dd-mm-yyyy (Indian convention, and consistent with the sample
 *   data where the first component is 26). Values whose first component is > 12
 *   are unambiguous. Genuinely ambiguous values (both parts <= 12, e.g.
 *   "05-06-1985") are reported so you can eyeball them; use --mdy if your
 *   import was actually mm-dd-yyyy.
 *
 * USAGE (from the backend project root):
 *   node scripts/fixMemberDates.js                 # dry run — reports only
 *   node scripts/fixMemberDates.js --commit        # apply, dd-mm-yyyy
 *   node scripts/fixMemberDates.js --commit --mdy  # apply, mm-dd-yyyy
 *
 * Safe to re-run: rows already holding a real Date are skipped.
 * Requires the same MONGODB_URI the app uses.
 */

require("dotenv").config();

// ── DNS resolver override (fixes "querySrv ECONNREFUSED" on Windows) ─────────
// A mongodb+srv:// URI requires an SRV record lookup. Node does NOT use the
// Windows resolver for this — it uses c-ares, which reads the DNS servers
// configured on your network adapters directly. If any of those is a loopback
// address with nothing listening, or belongs to a stale virtual adapter left by
// Docker / VMware / VirtualBox / a VPN, the lookup is REFUSED:
//
//     querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net
//
// This happens even when `nslookup` succeeds, because nslookup takes a
// different code path and falls back between servers. Pointing Node's resolver
// at a known-good public DNS sidesteps the adapter config entirely.
//
//   DNS_SERVERS=1.1.1.1,8.8.8.8   (default)
//   DNS_SERVERS=off               to disable and use the system config
const dns = require("dns");
const dnsSetting = (process.env.DNS_SERVERS || "1.1.1.1,8.8.8.8").trim();
if (dnsSetting.toLowerCase() !== "off") {
  const servers = dnsSetting.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    dns.setServers(servers);
    console.log(`[dns] Node resolver set to: ${servers.join(", ")}  (DNS_SERVERS=off to disable)`);
  } catch (e) {
    console.warn(`[dns] Could not set resolver: ${e.message} — using system DNS.`);
  }
}


const mongoose = require("mongoose");

const MONGO_URI =
  process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI;

if (!MONGO_URI) {
  console.error(
    "MONGODB_URI is not set. Ensure a .env file exists in the backend root " +
      "with the same connection string the app uses, or run:\n" +
      "  MONGODB_URI='your-uri' node scripts/fixMemberDates.js --commit",
  );
  process.exit(1);
}

const COMMIT = process.argv.includes("--commit");
const MDY = process.argv.includes("--mdy"); // treat strings as mm-dd-yyyy

// The Member model maps to the "membership" collection. We go through the
// native driver deliberately: querying via Mongoose would try to cast these
// values to Date and drop the very rows we need to find.
const COLLECTION = "membership";
const DATE_FIELDS = ["dob", "date", "membership_date"];

/**
 * Parse a stored date string into a UTC-midnight Date.
 * Returns { date, ambiguous } or null if unparseable.
 *
 * Uses Date.UTC rather than `new Date(y, m, d)` so the stored instant does not
 * shift by a day depending on the server's timezone — a real risk on Render
 * (UTC) versus a local machine in IST.
 */
function parseDateString(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;

  // Already ISO-ish (yyyy-mm-dd or a full ISO timestamp) — safe to hand to Date.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : { date: d, ambiguous: false };
  }

  // dd-mm-yyyy / dd/mm/yyyy / dd.mm.yyyy (and the mm-dd variant under --mdy)
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const p1 = Number(m[1]);
    const p2 = Number(m[2]);
    const year = Number(m[3]);

    let day;
    let month;
    let ambiguous = false;

    if (p1 > 12) {
      // First component cannot be a month — unambiguously dd-mm.
      day = p1;
      month = p2;
    } else if (p2 > 12) {
      // Second component cannot be a month — unambiguously mm-dd.
      month = p1;
      day = p2;
    } else {
      // Both <= 12: order is genuinely undecidable from the value alone.
      ambiguous = true;
      day = MDY ? p2 : p1;
      month = MDY ? p1 : p2;
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const d = new Date(Date.UTC(year, month - 1, day));
    // Reject impossible dates that JS would silently roll over
    // (e.g. 31-02-1985 becoming 03 March).
    if (
      d.getUTCFullYear() !== year ||
      d.getUTCMonth() !== month - 1 ||
      d.getUTCDate() !== day
    ) {
      return null;
    }
    return { date: d, ambiguous };
  }

  // Last resort: let the engine try, but only accept a sane year.
  const d = new Date(s);
  if (!isNaN(d.getTime()) && d.getUTCFullYear() > 1900 && d.getUTCFullYear() < 2100) {
    return { date: d, ambiguous: true };
  }
  return null;
}

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected.\n");
    console.log(
      `Interpreting ambiguous strings as ${MDY ? "mm-dd-yyyy" : "dd-mm-yyyy"}` +
        `${MDY ? "" : "  (pass --mdy to switch)"}\n`,
    );

    const col = mongoose.connection.db.collection(COLLECTION);

    const stats = {
      scanned: 0,
      updated: 0,
      fieldsFixed: 0,
      fatherMoved: 0,
      unparseable: [],
      ambiguous: [],
    };

    // Only pull rows that actually need work: any target field held as a string,
    // or the legacy "father/ husband" key present.
    const query = {
      $or: [
        ...DATE_FIELDS.map((f) => ({ [f]: { $type: "string" } })),
        { "father/ husband": { $exists: true } },
      ],
    };

    const cursor = col.find(query);

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      stats.scanned++;

      const $set = {};
      const $unset = {};

      for (const field of DATE_FIELDS) {
        const val = doc[field];
        if (typeof val !== "string") continue; // already a Date, or absent

        const parsed = parseDateString(val);
        if (!parsed) {
          stats.unparseable.push({
            membership_id: doc.membership_id || String(doc._id),
            name: doc.name || "",
            field,
            value: val,
          });
          continue;
        }
        if (parsed.ambiguous) {
          stats.ambiguous.push({
            membership_id: doc.membership_id || String(doc._id),
            name: doc.name || "",
            field,
            value: val,
            interpreted: parsed.date.toISOString().slice(0, 10),
          });
        }
        $set[field] = parsed.date;
        stats.fieldsFixed++;
      }

      // Legacy key -> schema path. Only fill `father` if it isn't already set,
      // so we never overwrite a value the app wrote.
      const legacyFather = doc["father/ husband"];
      if (legacyFather !== undefined) {
        if (!doc.father && typeof legacyFather === "string" && legacyFather.trim()) {
          $set.father = legacyFather.trim();
        }
        $unset["father/ husband"] = "";
        stats.fatherMoved++;
      }

      if (!Object.keys($set).length && !Object.keys($unset).length) continue;

      if (COMMIT) {
        const update = {};
        if (Object.keys($set).length) update.$set = $set;
        if (Object.keys($unset).length) update.$unset = $unset;
        await col.updateOne({ _id: doc._id }, update);
      }
      stats.updated++;
    }

    // ── Report ────────────────────────────────────────────────────────────────
    console.log("──────────────────────────────────────────────");
    console.log(`Documents needing work : ${stats.scanned}`);
    console.log(`Documents ${COMMIT ? "updated" : "that would update"} : ${stats.updated}`);
    console.log(`Date fields converted  : ${stats.fieldsFixed}`);
    console.log(`"father/ husband" keys : ${stats.fatherMoved}`);
    console.log("──────────────────────────────────────────────\n");

    if (stats.ambiguous.length) {
      console.log(
        `AMBIGUOUS (${stats.ambiguous.length}) — both day and month <= 12, so ` +
          `the order cannot be determined from the value.\n` +
          `Interpreted as ${MDY ? "mm-dd-yyyy" : "dd-mm-yyyy"}. Spot-check these:`,
      );
      stats.ambiguous.slice(0, 25).forEach((r) =>
        console.log(
          `  ${r.membership_id.padEnd(12)} ${r.field.padEnd(15)} ` +
            `"${r.value}"  ->  ${r.interpreted}   ${r.name}`,
        ),
      );
      if (stats.ambiguous.length > 25) {
        console.log(`  ... and ${stats.ambiguous.length - 25} more`);
      }
      console.log("");
    }

    if (stats.unparseable.length) {
      console.log(
        `UNPARSEABLE (${stats.unparseable.length}) — left untouched, fix by hand:`,
      );
      stats.unparseable.slice(0, 40).forEach((r) =>
        console.log(
          `  ${r.membership_id.padEnd(12)} ${r.field.padEnd(15)} ` +
            `"${r.value}"   ${r.name}`,
        ),
      );
      if (stats.unparseable.length > 40) {
        console.log(`  ... and ${stats.unparseable.length - 40} more`);
      }
      console.log("");
    }

    if (!COMMIT) {
      console.log(
        stats.updated === 0
          ? "Nothing to change."
          : "DRY RUN — nothing was written.\n" +
              "Re-run with --commit to apply:\n" +
              "  node scripts/fixMemberDates.js --commit",
      );
    } else {
      console.log("Migration complete. Reload the Member List to confirm DOB now shows.");
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err.message);
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(1);
  }
})();