/**
 * ONE-TIME MIGRATION — pad membership IDs from 3 digits to 4.
 *
 *     GK2023P003   →  GK2023P0003
 *     GK2023P1005  →  unchanged (already 4 digits)
 *
 * WHY A NODE SCRIPT AND NOT A mongosh ONE
 * Every other migration in this project (fixMemberIdentifiers.js,
 * scripts/fixMemberDates.js) is a Node script that reads MONGODB_URI from the
 * same .env the app uses. This follows that convention, which means:
 *   • no mongosh install needed
 *   • no connection string pasted on the command line, so your Atlas
 *     credentials never land in PowerShell history or a shared terminal log
 *
 * USAGE (from the backend project root)
 *   node scripts/migrateMembershipIdTo4Digits.js              ← DRY RUN, writes nothing
 *   node scripts/migrateMembershipIdTo4Digits.js --commit     ← actually applies
 *
 * Safe to re-run: already-4-digit values are skipped, so an interrupted run
 * simply resumes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS TOUCHES EIGHT COLLECTIONS, NOT ONE
 *
 * The membership ID is a STRING FOREIGN KEY copied into every related record.
 * Updating only `membership` would leave every receipt, booking and deposit
 * pointing at an ID that no longer exists — and because every backend lookup is
 * an exact string match, NOTHING WOULD THROW. Receipts would silently stop
 * matching their member, WhatsApp reminders would stop resolving, and the
 * receipt form would start reporting "no site booking exists" for members who
 * have one.
 *
 * Note `Member` maps to a collection called "membership", not "members" —
 * mongoose.model("Member", memberSchema, "membership").
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * BEFORE YOU RUN WITH --commit
 *   1. Take an Atlas snapshot. This rewrites primary identifiers in place and
 *      there is no automatic undo.
 *   2. Read the dry-run output in full, especially SKIPPED and COLLISIONS.
 *   3. Deploy the frontend padStart(4) change at the same time. Old build +
 *      new data means an admin typing "3" builds GK2023P003, which is gone.
 */

const fs = require("fs");
const path = require("path");

// ── Load .env without hard-depending on the dotenv package ───────────────────
// `dotenv` is in package.json, but if node_modules has not been installed in
// this folder the require throws a raw MODULE_NOT_FOUND stack trace, which
// tells you nothing useful. Try dotenv first; fall back to a tiny parser so a
// missing dev dependency cannot stop a migration from reading its own config.
(function loadEnv() {
  try {
    require("dotenv").config({ quiet: true });
    return;
  } catch {
    // dotenv unavailable — parse .env by hand.
  }
  for (const candidate of [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "..", ".env"),
  ]) {
    if (!fs.existsSync(candidate)) continue;
    const text = fs.readFileSync(candidate, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      // Strip one layer of matching quotes, keeping any "=" inside the value
      // (Atlas connection strings contain them in query parameters).
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
    console.log(`  (read ${path.basename(candidate)} directly — dotenv not installed)`);
    return;
  }
})();

// ── mongodb driver is genuinely required — it is how we talk to Atlas ─────────
let MongoClient;
try {
  ({ MongoClient } = require("mongodb"));
} catch {
  console.error(
    "\n✗ The 'mongodb' package is not installed in this folder.\n\n" +
      "  Run this first, from the backend project root:\n\n" +
      "      npm install\n\n" +
      "  Both 'mongodb' and 'dotenv' are already listed in package.json, so\n" +
      "  npm install is all that is needed — nothing extra to add.\n"
  );
  process.exit(1);
}

const COMMIT = process.argv.includes("--commit");
const TARGET_DIGITS = 4;

// Same env names the rest of the project accepts.
const URI =
  process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB;

const TARGETS = [
  { coll: "membership", fields: ["membership_id"], identity: true },
  { coll: "sitebookings", fields: ["membership_id"] },
  { coll: "receipts", fields: ["membershipid", "seniority_no"] },
  { coll: "payments", fields: ["membershipid"] },
  { coll: "fixeddeposits", fields: ["membershipId"] },
  { coll: "recurringdeposits", fields: ["membershipId"] },
  { coll: "messagelogs", fields: ["membership_id"] },
  // No controller imports MemberLogin, so this looks unused — but if it holds
  // rows, `username` IS the membership id and must move with it.
  { coll: "memberlogins", fields: ["membership_id", "username"], identity: true },
];

// CODE(2-5 letters) + YEAR(4 digits) + optional series letter + number.
// Strict and anchored on purpose: anything not matching this shape is REPORTED
// and LEFT ALONE rather than guessed at. AddMember.js permits hyphens in the id
// field, so values like "GK-2023-P003" can exist, and silently rewriting those
// would be worse than skipping them.
const ID_RE = /^([A-Z]{2,5})(\d{4})([A-Z]?)(\d+)$/;

function padId(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const m = v.match(ID_RE);
  if (!m) return { status: "nonconforming", value: v };
  const [, code, year, letter, digits] = m;
  if (digits.length >= TARGET_DIGITS) return { status: "already", value: v };
  return {
    status: "change",
    value: v,
    next: `${code}${year}${letter}${digits.padStart(TARGET_DIGITS, "0")}`,
  };
}

// ── Atlas SRV lookups and local DNS ──────────────────────────────────────────
// A "mongodb+srv://" URI is not a hostname — the driver must first ask DNS for
// an SRV record (_mongodb._tcp.<cluster>) to discover the real replica-set
// hosts. Plenty of home routers, ISPs, office networks and VPNs refuse or drop
// SRV queries, which surfaces as:
//
//     querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net
//
// It is a DNS failure, not a MongoDB or credentials failure — the driver never
// got far enough to try connecting. Node uses the system resolver by default,
// so the fix is to point it at a public resolver that does answer SRV queries.
const dns = require("dns");

const DNS_OVERRIDE = (() => {
  const arg = process.argv.find((a) => a.startsWith("--dns="));
  if (arg) return arg.slice(6).split(",").map((s) => s.trim()).filter(Boolean);
  return ["1.1.1.1", "8.8.8.8"]; // Cloudflare, then Google
})();

function isSrvDnsFailure(err) {
  const msg = String((err && err.message) || err || "");
  const code = String((err && err.code) || "");
  const syscall = String((err && err.syscall) || "");
  return (
    /querySrv|queryTxt/i.test(msg) ||
    /querySrv|queryTxt/i.test(syscall) ||
    (/_mongodb\._tcp/i.test(msg) &&
      /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ESERVFAIL|ETIMEOUT|ENODATA/i.test(code + msg))
  );
}

async function connectWithDnsFallback(uri) {
  const opts = { serverSelectionTimeoutMS: 20000 };

  try {
    const client = new MongoClient(uri, opts);
    await client.connect();
    return client;
  } catch (err) {
    if (!isSrvDnsFailure(err) || !/^mongodb\+srv:\/\//i.test(uri)) throw err;

    console.log(
      `  SRV DNS lookup failed via the system resolver.\n` +
        `  Retrying with public DNS (${DNS_OVERRIDE.join(", ")})…`
    );
    dns.setServers(DNS_OVERRIDE);

    const client = new MongoClient(uri, opts);
    await client.connect();
    console.log("  connected using the public resolver.");
    return client;
  }
}

function explainSrvFailure(uri) {
  console.error(
    "\n  This is a DNS problem, not a MongoDB or password problem — the driver\n" +
      "  never reached your cluster. A 'mongodb+srv://' URI needs an SRV record\n" +
      "  lookup, and the resolvers on this network refused it.\n\n" +
      "  Three ways forward, easiest first:\n\n" +
      "  1. Force a different resolver:\n" +
      "        node scripts/migrateMembershipIdTo4Digits.js --dns=8.8.8.8\n\n" +
      "  2. Use the NON-SRV connection string, which needs no SRV lookup.\n" +
      "     In Atlas: Connect → Drivers → set Driver to 'Node.js' and Version to\n" +
      "     '2.2.12 or later'. You get a 'mongodb://' string listing all three\n" +
      "     hosts. Put it in .env as MONGO_URI (this script prefers MONGODB_URI,\n" +
      "     so keep the srv one there for the app and pass the standard one via\n" +
      "     the environment for this run):\n" +
      "        $env:MONGO_URI=\"mongodb://host1,host2,host3/db?replicaSet=...\"\n" +
      "        node scripts/migrateMembershipIdTo4Digits.js\n\n" +
      "  3. If you are on a VPN or office network, disconnect it and retry —\n" +
      "     blocked SRV records are a common corporate DNS policy.\n"
  );
}

(async () => {
  if (!URI) {
    console.error(
      "\n✗ No connection string found.\n\n" +
        "  This script reads MONGODB_URI (or MONGO_URI) from the .env file in the\n" +
        "  backend project root — the same one server.js uses.\n\n" +
        "  Check that:\n" +
        "    • you are running from the project root, not from inside scripts/\n" +
        "        cd D:\\Gruhakalpa\\Gruhakalpa-backend\n" +
        "        node scripts/migrateMembershipIdTo4Digits.js\n" +
        "    • .env exists there and contains a line like\n" +
        "        MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/dbname\n"
    );
    process.exit(1);
  }

  const line = "=".repeat(72);
  let client;

  console.log(line);
  console.log(
    COMMIT
      ? "  MODE: COMMIT — changes WILL be written"
      : "  MODE: DRY RUN — nothing will be written  (add --commit to apply)"
  );
  console.log(`  Padding the numeric tail to ${TARGET_DIGITS} digits`);
  console.log(line);

  try {
    client = await connectWithDnsFallback(URI);
    const db = client.db();
    console.log(`connected to database: ${db.databaseName}`);

    const mapping = [];
    const nonconforming = [];
    const collisions = [];
    let gChange = 0,
      gAlready = 0,
      gScanned = 0,
      gWritten = 0;

    for (const t of TARGETS) {
      const col = db.collection(t.coll);

      let total = 0;
      try {
        total = await col.countDocuments({});
      } catch {
        total = 0;
      }
      if (!total) {
        console.log(`\n${t.coll.padEnd(20)} empty or absent — skipped`);
        continue;
      }

      console.log(`\n${t.coll}  (${total} docs)  fields: ${t.fields.join(", ")}`);

      let changed = 0,
        already = 0,
        bad = 0,
        scanned = 0;
      const ops = [];

      for (const f of t.fields) {
        const cursor = col.find(
          { [f]: { $type: "string", $ne: "" } },
          { projection: { [f]: 1 } }
        );

        while (await cursor.hasNext()) {
          const doc = await cursor.next();
          scanned++;
          const r = padId(doc[f]);
          if (!r) continue;

          if (r.status === "nonconforming") {
            bad++;
            nonconforming.push({ coll: t.coll, field: f, _id: doc._id, value: r.value });
            continue;
          }
          if (r.status === "already") {
            already++;
            continue;
          }

          // Only the identity fields carry a unique index, so a clash there is
          // the one that would actually abort a write.
          if (t.identity) {
            const clash = await col.countDocuments({
              [f]: r.next,
              _id: { $ne: doc._id },
            });
            if (clash > 0) {
              collisions.push({ coll: t.coll, field: f, from: r.value, to: r.next });
              continue;
            }
          }

          ops.push({
            updateOne: { filter: { _id: doc._id }, update: { $set: { [f]: r.next } } },
          });
          if (t.coll === "membership" && f === "membership_id") {
            mapping.push({ old: r.value, new: r.next });
          }
          changed++;
        }
      }

      if (COMMIT && ops.length) {
        const res = await col.bulkWrite(ops, { ordered: false });
        gWritten += res.modifiedCount;
        console.log(`  written: ${res.modifiedCount} modified`);
      }

      console.log(
        `  scanned ${scanned}  ·  to change ${changed}  ·  already ${TARGET_DIGITS}-digit ${already}  ·  non-conforming ${bad}`
      );
      gChange += changed;
      gAlready += already;
      gScanned += scanned;
    }

    console.log("\n" + line);
    console.log("SUMMARY");
    console.log(`  values scanned            ${gScanned}`);
    console.log(`  values to change          ${gChange}`);
    console.log(`  already ${TARGET_DIGITS}-digit           ${gAlready}`);
    console.log(`  non-conforming (skipped)  ${nonconforming.length}`);
    console.log(`  collisions (skipped)      ${collisions.length}`);
    if (COMMIT) console.log(`  documents modified        ${gWritten}`);

    if (collisions.length) {
      console.log("\n⚠ COLLISIONS — NOT changed. Resolve these by hand first:");
      collisions.forEach((c) =>
        console.log(`   ${c.coll}.${c.field}: ${c.from} → ${c.to} (target already exists)`)
      );
    }

    if (nonconforming.length) {
      console.log("\n⚠ NON-CONFORMING IDs — left untouched, review manually:");
      nonconforming
        .slice(0, 40)
        .forEach((n) => console.log(`   ${n.coll}.${n.field}  _id=${n._id}  "${n.value}"`));
      if (nonconforming.length > 40)
        console.log(`   … and ${nonconforming.length - 40} more`);
    }

    // Write the old → new mapping to a file. Members log in with this value, so
    // this is both the audit trail and the list you would use to notify them.
    if (mapping.length) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const out = path.join(
        __dirname,
        `membership-id-mapping-${COMMIT ? "applied" : "dryrun"}-${stamp}.csv`
      );
      fs.writeFileSync(
        out,
        "old_membership_id,new_membership_id\n" +
          mapping.map((m) => `${m.old},${m.new}`).join("\n") +
          "\n"
      );
      console.log(`\n  mapping written to: ${out}`);
      console.log("  first few:");
      mapping.slice(0, 10).forEach((m) => console.log(`     ${m.old}  →  ${m.new}`));
      if (mapping.length > 10) console.log(`     … and ${mapping.length - 10} more`);
    }

    if (!COMMIT) {
      console.log("\n  DRY RUN — nothing was written.");
      console.log("  Re-run with --commit to apply:");
      console.log("     node scripts/migrateMembershipIdTo4Digits.js --commit");
    }
    console.log(line);
  } catch (err) {
    console.error("\n✗ FAILED:", err.message);
    if (isSrvDnsFailure(err)) explainSrvFailure(URI);
    process.exitCode = 1;
  } finally {
    if (client) await client.close().catch(() => {});
  }
})();