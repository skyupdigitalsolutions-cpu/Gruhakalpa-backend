require("dotenv").config();
const mongoose = require("mongoose");

// ─────────────────────────────────────────────────────────────────────────
// Local automation diagnostic
//
// Run from the backend folder:   node checkAutomation.js
// Optionally send a real test WhatsApp to your own number:
//                                node checkAutomation.js 9538281101
//
// It verifies every piece the WhatsApp automation needs, so you can see at a
// glance WHY nothing is sending locally.
// ─────────────────────────────────────────────────────────────────────────

const ok = (m) => console.log("  ✅ " + m);
const bad = (m) => console.log("  ❌ " + m);
const warn = (m) => console.log("  ⚠️  " + m);

(async () => {
  console.log("\n──────── Gruhakalpa automation check (local) ────────\n");

  // 1. ENV — MSG91
  console.log("1) MSG91 credentials (.env)");
  const key = process.env.MSG91_AUTHKEY || "";
  const num = process.env.MSG91_WHATSAPP_NUMBER || "";
  if (!key || key.includes("your_")) bad("MSG91_AUTHKEY is missing or a placeholder — WhatsApp will NOT send.");
  else ok(`MSG91_AUTHKEY set (${key.slice(0, 4)}…${key.slice(-3)})`);
  if (!num) warn("MSG91_WHATSAPP_NUMBER not in .env (can still come from settings).");
  else ok(`MSG91_WHATSAPP_NUMBER = ${num}`);

  // 2. DB connect
  console.log("\n2) Database");
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI;
  if (!uri) { bad("No MONGODB_URI in .env — cannot check settings/members."); process.exit(1); }
  try {
    await mongoose.connect(uri);
    ok("Connected to MongoDB.");
  } catch (e) {
    bad("Could not connect to MongoDB: " + e.message);
    process.exit(1);
  }

  // 3. Settings — is WhatsApp channel ON?
  console.log("\n3) Automation settings (ReminderSettings)");
  let settings;
  try {
    const ReminderSettings = require("./models/ReminderSettings");
    settings = await ReminderSettings.getSettings();
    const wa = settings.whatsapp || {};
    if (wa.enabled) ok("WhatsApp channel is ENABLED.");
    else bad("WhatsApp channel is DISABLED — turn it on in Automation Setup, or nothing sends.");
    if (settings.eventNotificationsEnabled !== false) ok("Event notifications are ON.");
    else bad("Event notifications are OFF (member/receipt/FD/RD greetings won't fire).");
    ok(`Integrated number in settings: ${wa.integratedNumber || "(none — will use .env)"}`);
    console.log("     Templates:",
      JSON.stringify({
        receipt: wa.templateReceipt, fd_cert: wa.templateFdCertificate,
        member: wa.templateMemberAdded, site: wa.templateSiteBooking,
        upcoming: wa.templateUpcoming, overdue: wa.templateOverdue,
      }, null, 0));
  } catch (e) {
    bad("Could not load settings: " + e.message);
  }

  // 4. Members — is there anyone to send to (with a mobile)?
  console.log("\n4) Members");
  try {
    const Member = require("./models/Member");
    const total = await Member.countDocuments({});
    const withMobile = await Member.countDocuments({ mobile: { $nin: [null, ""] } });
    ok(`Members: ${total} total, ${withMobile} have a mobile number.`);
    if (withMobile === 0) bad("No member has a mobile number — sends will be skipped.");
  } catch (e) {
    bad("Could not read members: " + e.message);
  }

  // 5. Festival controller present?
  console.log("\n5) Festival automation");
  try {
    const fc = require("./controllers/festivalController");
    const needed = ["listFestivals", "runDueFestivals", "sendFestivalToAllMembers", "uploadFestivalImage", "testFestival"];
    const missing = needed.filter((n) => typeof fc[n] !== "function");
    if (missing.length) bad("festivalController is missing: " + missing.join(", "));
    else ok("festivalController loaded with all functions.");
  } catch (e) {
    bad("festivalController.js not found or broken: " + e.message);
  }

  // 6. Optional live send
  const testNum = process.argv[2];
  if (testNum) {
    console.log(`\n6) Live test — sending a WhatsApp to ${testNum}`);
    try {
      const { sendWhatsAppTemplate, isConfigured } = require("./utils/msg91Whatsapp");
      if (!isConfigured()) { bad("MSG91 not configured — skipping live test."); }
      else {
        const wa = (settings && settings.whatsapp) || {};
        const tpl = wa.templateReceipt || wa.templateUpcoming;
        if (!tpl) { warn("No template name set in settings to test with."); }
        else {
          const r = await sendWhatsAppTemplate({
            to: String(testNum),
            templateName: tpl,
            integratedNumber: wa.integratedNumber,
            languageCode: wa.languageCode || "en",
            bodyValues: ["Test", "TEST-001", "Rs.1,000", "Test"],
            bodyNames: ["customer_name", "receipt_no", "amount", "payment_type"],
          });
          if (r.success) ok(`MSG91 accepted the message (id: ${r.messageId || "-"}). Check the phone / MSG91 dashboard.`);
          else bad(`MSG91 rejected it: ${r.error}`);
        }
      }
    } catch (e) {
      bad("Live test error: " + e.message);
    }
  } else {
    console.log("\n6) Live test — skipped. To send a real test WhatsApp, run:");
    console.log("     node checkAutomation.js 9538281101   (your own number)");
  }

  console.log("\n─────────────────────────────────────────────────────\n");
  await mongoose.disconnect();
  process.exit(0);
})();