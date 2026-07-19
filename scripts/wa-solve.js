#!/usr/bin/env node
/**
 * wa-solve.js — Gruhakalpa WhatsApp (MSG91) final verifier
 * ---------------------------------------------------------------------------
 * We now know the exact shape the approved template "gruhakalpa_payment_reminder"
 * expects, straight from its dashboard "Copy Code":
 *   • NAMED variables, each sent as   "body_<name>": { type, value, parameter_name }
 *   • a template-level "namespace"
 *   • order: customer_name, amount, installment, membership_id, due_date
 *
 * This script fires ONE message in exactly that shape so you can confirm a real
 * Delivered. Your backend (msg91Whatsapp.js + paymentReminderController.js) now
 * produces the identical payload, so once this delivers, the app does too.
 *
 * RUN (from the backend root, so it can read .env):
 *     node scripts/wa-solve.js
 */

const path = require("path");
try { require("dotenv").config(); } catch (_) {}
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch (_) {}

// ════════════════════════════ EDIT ME (rarely) ═══════════════════════════
const CONFIG = {
  authKey:          process.env.MSG91_AUTHKEY || "",
  integratedNumber: (process.env.MSG91_WHATSAPP_NUMBER || "").trim(),

  templateName: "gruhakalpa_payment_reminder",
  languageCode: "en",
  // From the template's Copy Code. Falls back to .env MSG91_WHATSAPP_NAMESPACE.
  namespace: process.env.MSG91_WHATSAPP_NAMESPACE ||
             "81e92313_0320_46ab_9351_bbd501b5c3ce",

  to: "919538281101", // a number YOU can check for arrival

  // name -> value, in the template's variable order. Matched by NAME, so the
  // order only needs to keep each value beside its correct name.
  vars: [
    ["customer_name", "srinivas"],
    ["amount",        "Rs.12,500"],
    ["installment",   "Installment 3"],
    ["membership_id", "GK2026001"],
    ["due_date",      "8/10/2026"],
  ],
};
// ══════════════════════════════════════════════════════════════════════════

const SEND_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";
const line = (c = "─") => console.log(c.repeat(70));

const normalizePhone = (raw) => {
  let s = String(raw || "").replace(/[^\d]/g, "");
  if (!s) return "";
  if (s.length === 10) s = "91" + s;
  if (s.length === 11 && s.startsWith("0")) s = "91" + s.slice(1);
  return s;
};

function preflight() {
  const p = [];
  if (!CONFIG.authKey || CONFIG.authKey.includes("your_"))
    p.push("MSG91_AUTHKEY missing/placeholder in .env.");
  if (!CONFIG.integratedNumber)
    p.push("MSG91_WHATSAPP_NUMBER (sender) missing in .env.");
  if (/\s/.test(process.env.MSG91_WHATSAPP_NUMBER || ""))
    p.push("Sender number in .env has stray whitespace — trim it.");
  if (!normalizePhone(CONFIG.to)) p.push(`Recipient "${CONFIG.to}" invalid.`);
  return p;
}

// Build the MSG91 named-parameter components map (matches dashboard Copy Code).
function buildComponents() {
  const c = {};
  for (const [name, value] of CONFIG.vars) {
    c[`body_${name}`] = { type: "text", value: String(value ?? ""), parameter_name: name };
  }
  return c;
}

async function main() {
  line("═");
  console.log(" Gruhakalpa WhatsApp — named-template verifier");
  line("═");

  const problems = preflight();
  if (problems.length) {
    console.log(" Cannot send — fix these first:");
    problems.forEach((p) => console.log("   • " + p));
    process.exit(1);
  }

  const to = normalizePhone(CONFIG.to);
  const components = buildComponents();
  const template = {
    name: CONFIG.templateName,
    language: { code: CONFIG.languageCode || "en", policy: "deterministic" },
    to_and_components: [{ to: [to], components }],
  };
  if (CONFIG.namespace) template.namespace = String(CONFIG.namespace);

  const payload = {
    integrated_number: String(CONFIG.integratedNumber),
    content_type: "template",
    payload: { messaging_product: "whatsapp", type: "template", template },
  };

  console.log(`From ${CONFIG.integratedNumber}  →  To ${to}`);
  console.log("Namespace:", CONFIG.namespace || "(none)");
  console.log("Components:", JSON.stringify(components));
  line();

  let status, data, raw;
  try {
    const res = await fetch(SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: CONFIG.authKey },
      body: JSON.stringify(payload),
    });
    status = res.status; raw = await res.text();
    try { data = JSON.parse(raw); } catch { data = raw; }
  } catch (e) { console.log("✗ Network error:", e.message); process.exit(1); }

  console.log(`HTTP ${status}  RAW:`, typeof data === "object" ? JSON.stringify(data, null, 2) : String(data).slice(0, 800));

  const s = JSON.stringify(data || {}).toLowerCase();
  console.log("\n→ Interpretation:");
  if (s.includes("param") || s.includes("variable") || s.includes("localizable") || s.includes("missing")) {
    console.log("  ✗ MSG91 flagged a parameter problem — the names/namespace don't");
    console.log("    match the template. Recheck CONFIG.vars names against the");
    console.log("    template Copy Code (customer_name, amount, installment,");
    console.log("    membership_id, due_date) and that the namespace is exact.");
  } else if (s.includes("not integrated")) {
    console.log("  ✗ Sender number isn't integrated on this account (or has spaces).");
  } else {
    const reqId = (data && (data.request_id || (typeof data.data === "string" && data.data.length === 32 ? data.data : ""))) || "";
    console.log("  ✅ Accepted / queued in the correct named shape.");
    if (reqId) console.log(`     request_id: ${reqId}`);
    console.log("     Final check: look at the phone, or open the MSG91 dashboard");
    console.log("     log for this request_id → Delivery Report should say Delivered.");
    console.log("     Delivered here = your app's reminders & confirmations work too.");
  }
  line("═");
}

main();