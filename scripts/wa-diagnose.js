#!/usr/bin/env node
/**
 * wa-diagnose.js — Gruhakalpa WhatsApp (MSG91) template tester / solver
 * ---------------------------------------------------------------------
 * Fires the EXACT same bulk-template request your backend's msg91Whatsapp.js
 * sends, prints MSG91's raw response, and interprets it. Use it to find the
 * variable SHAPE your approved template actually expects — the last thing
 * standing between you and a delivered message.
 *
 * HOW TO RUN (from the backend root folder, so it can read your .env):
 *     node wa-diagnose.js
 * or, if you drop it in a scripts/ folder:
 *     node scripts/wa-diagnose.js
 *
 * Node 18+ required (uses built-in fetch). You're on Node 24, so fine.
 *
 * HOW TO SOLVE THE ISSUE:
 *   1. Run it once as-is (paramStyle "positional", 5 values).
 *   2. Read the RAW RESPONSE + the interpretation it prints.
 *   3. If MSG91 complains about parameters, adjust CONFIG.values / paramStyle
 *      and run again. Iterate until you get a clean "queued/success" AND the
 *      MSG91 dashboard shows Delivered (not Failed) for the printed request_id.
 *   4. Once you know the winning shape, tell your dev (or me) and we set
 *      msg91Whatsapp.js to match it permanently.
 */

// Load .env from the current folder AND the parent (covers running from
// either the backend root or a scripts/ subfolder).
try { require("dotenv").config(); } catch (_) {}
try { require("dotenv").config({ path: require("path").join(__dirname, ".env") }); } catch (_) {}
try { require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") }); } catch (_) {}

// ════════════════════════════ EDIT ME ════════════════════════════════
const CONFIG = {
  // Credentials — left blank, they load from your .env automatically.
  // Only hard-code here if you want to test a value WITHOUT touching .env.
  authKey:          process.env.MSG91_AUTHKEY || "",
  integratedNumber: (process.env.MSG91_WHATSAPP_NUMBER || "").trim(),

  templateName: "gruhakalpa_payment_reminder", // exact name from the dashboard
  languageCode: "en",                          // MUST match dashboard: "en" vs "en_US"

  to: "919538281101",                          // recipient: digits only, with 91

  // The values in order. Reminder template = name, membership id, amount,
  // installment, due date. (For the CONFIRMATION template instead, use 4:
  //   ["srinivas", "Rs.12,500", "Rs.27,52,500", "19/07/2026"]  and set
  //   templateName to your confirmation template + paramStyle "positional".)
  values: ["srinivas", "GK2026001", "Rs.12,500", "Installment 3", "8/10/2026"],

  // "positional" -> keys body_1..body_N  (for {{1}} {{2}} .. templates)  ← try this FIRST
  // "named"      -> keys from `names` below (for {{customer_name}} .. templates)
  paramStyle: "positional",

  // Only used when paramStyle === "named". Same length/order as `values`.
  names: ["customer_name", "membership_id", "amount", "installment", "due_date"],
};
// ══════════════════════════════════════════════════════════════════════

const MSG91_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";

const line = (c = "─") => console.log(c.repeat(66));

// Same phone normalisation the backend uses for the RECIPIENT.
const normalizePhone = (raw) => {
  let s = String(raw || "").replace(/[^\d]/g, "");
  if (!s) return "";
  if (s.length === 10) s = "91" + s;
  if (s.length === 11 && s.startsWith("0")) s = "91" + s.slice(1);
  return s;
};

function preflight() {
  const problems = [];
  if (!CONFIG.authKey || CONFIG.authKey.includes("your_"))
    problems.push("MSG91_AUTHKEY is missing (or still a placeholder). Set it in .env.");
  if (!CONFIG.integratedNumber)
    problems.push("MSG91_WHATSAPP_NUMBER (integrated/sender number) is missing.");
  if (/\s/.test(process.env.MSG91_WHATSAPP_NUMBER || ""))
    problems.push('Integrated number in .env has stray whitespace — trim it (this caused the earlier "\\t 919071553938" / not-integrated error).');
  if (!CONFIG.templateName) problems.push("templateName is empty.");
  if (!normalizePhone(CONFIG.to)) problems.push(`Recipient "${CONFIG.to}" is not a valid phone.`);
  return problems;
}

function buildComponents() {
  const components = {};
  CONFIG.values.forEach((val, i) => {
    const key =
      CONFIG.paramStyle === "named"
        ? String(CONFIG.names[i] || `body_${i + 1}`)
        : `body_${i + 1}`;
    components[key] = { type: "text", value: String(val ?? "") };
  });
  return components;
}

function interpret(status, data) {
  const s = JSON.stringify(data || {}).toLowerCase();
  console.log("\n→ Interpretation:");

  if (s.includes("not integrated")) {
    console.log("  The SENDER (integrated) number isn't a registered WhatsApp");
    console.log("  number on THIS MSG91 account, OR it has stray whitespace.");
    console.log("  Fix: copy the exact number from MSG91 → WhatsApp settings.");
    return;
  }
  if (s.includes("parameter") || s.includes("param") || s.includes("localizable") || s.includes("variable")) {
    console.log("  VARIABLE MISMATCH — the template expects a different set/number");
    console.log("  of parameters than we sent. This is the usual cause of a");
    console.log("  'Failed / UUID undefined' delivery. Try:");
    console.log("    • flip CONFIG.paramStyle ('positional' ⇄ 'named')");
    console.log("    • change how many items are in CONFIG.values (try 3, 4, 5)");
    console.log("  then re-run until the error clears.");
    return;
  }
  if (s.includes("template") && (s.includes("not") || s.includes("found") || s.includes("exist"))) {
    console.log("  Template name/language not found on this account. Check the");
    console.log("  exact name and that languageCode matches ('en' vs 'en_US').");
    return;
  }
  if (status === 401 || s.includes("authkey") || s.includes("unauthor")) {
    console.log("  Auth key rejected. Use the key from THIS MSG91 account, no spaces.");
    return;
  }
  const accepted =
    data && typeof data === "object" &&
    !data.hasError && data.status !== "fail" && data.status !== "error" &&
    (data.request_id || data.data || data.message);
  if (accepted) {
    const reqId = data.request_id || (typeof data.data === "string" ? data.data : "") || "(see body)";
    console.log("  ✅ MSG91 ACCEPTED the request (queued). This is NOT final delivery.");
    console.log(`  Now open the MSG91 dashboard log, find request_id: ${reqId}`);
    console.log("  and confirm Delivery Report = Delivered (not Failed). If it");
    console.log("  still says Failed, the variable shape is wrong — see above.");
    return;
  }
  console.log("  Unrecognised response — read the raw body above for the reason.");
}

async function main() {
  line("═");
  console.log(" Gruhakalpa WhatsApp template diagnostic");
  line("═");

  const problems = preflight();
  if (problems.length) {
    console.log("✗ Cannot send yet — fix these first:\n");
    problems.forEach((p) => console.log("   • " + p));
    process.exit(1);
  }

  const to = normalizePhone(CONFIG.to);
  const components = buildComponents();

  console.log("Sending :", CONFIG.templateName, `(lang ${CONFIG.languageCode})`);
  console.log("From    :", CONFIG.integratedNumber);
  console.log("To      :", to);
  console.log("Style   :", CONFIG.paramStyle, `(${CONFIG.values.length} params)`);
  console.log("Params  :", JSON.stringify(components));
  line();

  const payload = {
    integrated_number: String(CONFIG.integratedNumber),
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: CONFIG.templateName,
        language: { code: CONFIG.languageCode || "en", policy: "deterministic" },
        to_and_components: [{ to: [to], components }],
      },
    },
  };

  let status, raw, data;
  try {
    const res = await fetch(MSG91_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: CONFIG.authKey },
      body: JSON.stringify(payload),
    });
    status = res.status;
    raw = await res.text();
    try { data = JSON.parse(raw); } catch { data = raw; }
  } catch (err) {
    console.log("✗ Network/request error:", err.message);
    process.exit(1);
  }

  console.log(`HTTP status : ${status}`);
  console.log("RAW RESPONSE:");
  console.log(typeof data === "object" ? JSON.stringify(data, null, 2) : String(data).slice(0, 2000));

  interpret(status, data);
  line("═");
  console.log("Tip: change CONFIG.paramStyle / CONFIG.values and re-run to test");
  console.log("shapes. The winning shape is the one that reaches Delivered.");
  line("═");
}

main();