/**
 * DIAGNOSTIC — find member documents whose dates are still strings.
 *
 * WHY THIS EXISTS
 * ---------------
 * fixMemberDates.js reported "Documents needing work: 0", yet the frontend
 * still shows a blank DOB for some members and their raw documents clearly hold
 * a dd-mm-yyyy string. Those two facts can only both be true if the script and
 * the frontend are not looking at the same set of documents. This script finds
 * out which, without changing anything.
 *
 * It checks, in order:
 *   1. WHICH database the connection string actually resolves to. If .env points
 *      at a different database than the one you inspect in Compass (or than the
 *      deployed backend uses), the migration ran against the wrong data.
 *   2. Every collection in that database, for documents holding `dob` as a
 *      string — in case member records live somewhere other than "membership".
 *   3. Every OTHER database on the same cluster, same check. A stray
 *      "test" / "gruhakalpa-dev" database with a real "membership" collection is
 *      a common cause.
 *   4. A breakdown of the `membership` collection: how many dobs are Date, how
 *      many are string, how many are missing.
 *   5. Whether the ID format splits into batches (GK2023P062 vs GK2023P0062),
 *      which would indicate a second import that arrived after the migration —
 *      and which can also produce two records for the same logical member.
 *
 * READ-ONLY. Writes nothing.
 *
 * USAGE (from the backend project root):
 *   node scripts/diagnoseMemberDates.js
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
  console.error("MONGODB_URI is not set. Check your .env.");
  process.exit(1);
}

const DATE_FIELDS = ["dob", "date", "membership_date"];

// Redact credentials before printing a connection string.
function safeUri(uri) {
  return String(uri).replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@");
}

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    const conn = mongoose.connection;

    console.log("═".repeat(70));
    console.log("1. CONNECTION");
    console.log("═".repeat(70));
    console.log(`URI              : ${safeUri(MONGO_URI)}`);
    console.log(`Database in use  : ${conn.db.databaseName}`);
    console.log(`Host             : ${conn.host || "(srv)"}`);
    console.log(
      "\n>> If the database name above is NOT the one you inspect in Compass,\n" +
        "   that alone explains it: the migration fixed a different database.\n",
    );

    // ── 2. This database, every collection ────────────────────────────────────
    console.log("═".repeat(70));
    console.log("2. THIS DATABASE — collections holding a STRING dob");
    console.log("═".repeat(70));

    const cols = await conn.db.listCollections().toArray();
    let foundHere = 0;
    for (const { name } of cols) {
      const c = conn.db.collection(name);
      const strCount = await c.countDocuments({ dob: { $type: "string" } });
      if (strCount > 0) {
        foundHere += strCount;
        console.log(`  ${name.padEnd(28)} ${strCount} document(s) with string dob  <-- NEEDS FIXING`);
      }
    }
    if (!foundHere) console.log("  (none in this database)");
    console.log("");

    // ── 3. Other databases on the same cluster ────────────────────────────────
    console.log("═".repeat(70));
    console.log("3. OTHER DATABASES on this cluster");
    console.log("═".repeat(70));
    try {
      const admin = conn.db.admin();
      const { databases } = await admin.listDatabases();
      for (const { name } of databases) {
        if (["admin", "local", "config"].includes(name)) continue;
        const other = conn.getClient().db(name);
        const otherCols = await other.listCollections().toArray();
        let total = 0;
        const hits = [];
        for (const oc of otherCols) {
          const n = await other
            .collection(oc.name)
            .countDocuments({ dob: { $type: "string" } });
          if (n > 0) {
            total += n;
            hits.push(`${oc.name} (${n})`);
          }
        }
        const marker = name === conn.db.databaseName ? "  <-- currently connected" : "";
        const memberCount = otherCols.some((c) => c.name === "membership")
          ? await other.collection("membership").countDocuments()
          : null;
        console.log(
          `  ${name.padEnd(26)} membership docs: ${
            memberCount === null ? "n/a" : String(memberCount).padEnd(6)
          }  string-dob: ${total}${marker}`,
        );
        if (hits.length) console.log(`      -> ${hits.join(", ")}`);
      }
    } catch (e) {
      console.log(`  (could not list databases: ${e.message})`);
      console.log("  Atlas users on shared tiers often lack listDatabases rights — skip this section.");
    }
    console.log("");

    // ── 4. membership breakdown ───────────────────────────────────────────────
    console.log("═".repeat(70));
    console.log(`4. "membership" BREAKDOWN in ${conn.db.databaseName}`);
    console.log("═".repeat(70));
    const m = conn.db.collection("membership");
    const total = await m.countDocuments();
    console.log(`  Total documents            : ${total}`);
    for (const f of DATE_FIELDS) {
      const asDate = await m.countDocuments({ [f]: { $type: "date" } });
      const asStr = await m.countDocuments({ [f]: { $type: "string" } });
      const missing = await m.countDocuments({ [f]: { $exists: false } });
      console.log(
        `  ${f.padEnd(16)} Date: ${String(asDate).padEnd(6)} ` +
          `String: ${String(asStr).padEnd(6)} Missing: ${missing}`,
      );
    }
    const legacyFather = await m.countDocuments({ "father/ husband": { $exists: true } });
    console.log(`  "father/ husband" keys     : ${legacyFather}`);
    console.log("");

    // Sample the stragglers
    const stragglers = await m
      .find({ dob: { $type: "string" } })
      .project({ membership_id: 1, name: 1, dob: 1, date: 1, createdAt: 1, _id: 1 })
      .limit(15)
      .toArray();

    if (stragglers.length) {
      console.log(`  STILL STRING (showing up to 15):`);
      stragglers.forEach((d) => {
        // _id timestamp tells you WHEN the document was inserted — the fastest
        // way to see whether it arrived after the migration ran.
        const inserted = d._id.getTimestamp
          ? d._id.getTimestamp().toISOString().slice(0, 19).replace("T", " ")
          : "?";
        console.log(
          `    ${String(d.membership_id || d._id).padEnd(14)} ` +
            `dob="${String(d.dob).padEnd(12)}" inserted=${inserted}  ${d.name || ""}`,
        );
      });
      console.log(
        "\n  >> Compare 'inserted' against when you ran the migration. If these are\n" +
          "     NEWER, a fresh import re-introduced the problem and the import path\n" +
          "     itself needs fixing — not just the data.\n",
      );
    } else {
      console.log("  No string dobs in this collection.\n");
    }

    // ── 5. ID format batches / collisions ─────────────────────────────────────
    console.log("═".repeat(70));
    console.log("5. MEMBERSHIP ID FORMATS (batch fingerprint)");
    console.log("═".repeat(70));
    const byLen = await m
      .aggregate([
        { $match: { membership_id: { $type: "string" } } },
        {
          $group: {
            _id: { $strLenCP: "$membership_id" },
            count: { $sum: 1 },
            example: { $first: "$membership_id" },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();
    byLen.forEach((r) =>
      console.log(`  length ${String(r._id).padEnd(3)} : ${String(r.count).padEnd(6)} e.g. ${r.example}`),
    );
    if (byLen.length > 1) {
      console.log(
        "\n  >> More than one ID length means more than one import batch\n" +
          "     (e.g. GK2023P062 vs GK2023P0062). Check whether the same person\n" +
          "     exists twice under both formats:",
      );
      const dupes = await m
        .aggregate([
          { $match: { membership_id: { $type: "string" } } },
          {
            $project: {
              name: 1,
              membership_id: 1,
              // Strip the prefix and leading zeros to get a comparable number
              normalized: {
                $let: {
                  vars: {
                    digits: {
                      $reduce: {
                        input: { $split: ["$membership_id", "P"] },
                        initialValue: "",
                        in: "$$this",
                      },
                    },
                  },
                  in: { $toInt: { $ifNull: [{ $toInt: "$$digits" }, 0] } },
                },
              },
            },
          },
          { $group: { _id: "$normalized", ids: { $addToSet: "$membership_id" }, names: { $addToSet: "$name" }, n: { $sum: 1 } } },
          { $match: { n: { $gt: 1 } } },
          { $limit: 10 },
        ])
        .toArray()
        .catch(() => []);
      if (dupes.length) {
        dupes.forEach((d) =>
          console.log(`     seq ${d._id}: ${d.ids.join(" / ")}  -> ${d.names.join(" | ")}`),
        );
      } else {
        console.log("     (no overlapping sequence numbers found — batches are distinct)");
      }
    }

    console.log("\n" + "═".repeat(70));
    console.log("NEXT STEP");
    console.log("═".repeat(70));
    if (foundHere) {
      console.log(
        "String dobs exist in THIS database. Re-run the migration:\n" +
          "  node scripts/fixMemberDates.js --commit\n" +
          "If it still reports 0, the collection name in section 2 above differs\n" +
          "from 'membership' — tell me which one and I'll point the script at it.",
      );
    } else {
      console.log(
        "This database is clean. The blank DOBs you see in the frontend are\n" +
          "therefore coming from a DIFFERENT database — compare section 1 and 3\n" +
          "against what your deployed backend's MONGODB_URI is set to (Render\n" +
          "environment variables), not just your local .env.",
      );
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("Diagnostic failed:", err.message);
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(1);
  }
})();