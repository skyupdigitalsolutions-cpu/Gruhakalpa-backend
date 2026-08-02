// ─────────────────────────────────────────────────────────────────────────
// Reminder scheduler
//
// A lightweight in-process scheduler that periodically fires the auto payment
// reminders when automation is enabled in ReminderSettings.
//
// NOTE: on hosts that sleep idle instances (e.g. Render free tier) an
// in-process timer can pause. For guaranteed delivery, ALSO set up an external
// cron (e.g. cron-job.org) to hit:
//     POST /reminders/run-due?secret=<CRON_SECRET>   once a day.
// Both paths call the same runDueReminders routine and share dedupe logic, so
// running both is safe.
// ─────────────────────────────────────────────────────────────────────────

const ReminderSettings = require("../models/ReminderSettings");
const { runDueReminders } = require("../controllers/paymentReminderController");
const { runDueFestivals } = require("../controllers/festivalController");

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // check every 30 minutes (to catch 9:30/10:00/14:00 windows)
const MIN_GAP_MS = 20 * 60 * 60 * 1000; // payment reminders run at most ~once/day

const tick = async () => {
  try {
    // Festival greetings — fire on their date, at most once per year. Safe to
    // call every tick regardless of the payment-reminder toggle.
    try {
      const fired = await runDueFestivals();
      if (fired > 0) console.log(`🎉 Festival greetings fired for ${fired} festival(s) today.`);
    } catch (e) {
      console.error("⚠️ Festival check failed:", e.message);
    }

    const settings = await ReminderSettings.getSettings();
    if (!settings.autoEnabled) return;

    const last = settings.lastRunAt ? new Date(settings.lastRunAt).getTime() : 0;
    if (Date.now() - last < MIN_GAP_MS) return; // already ran recently

    console.log("⏰ Auto payment-reminder run starting...");
    const result = await runDueReminders({ sentBy: "auto" });
    console.log(
      `⏰ Auto reminder run done — attempted ${result.attempted}, sent ${result.sent}, skipped ${result.skipped}`,
    );
  } catch (err) {
    console.error("⚠️ Reminder scheduler tick failed:", err.message);
  }
};

const startReminderScheduler = () => {
  // First check shortly after boot, then every 30 minutes so festival greeting
  // (09:30) and staff reminders (10:00 / 14:00) fire in their time windows.
  setTimeout(tick, 60 * 1000);
  setInterval(tick, CHECK_INTERVAL_MS);
  console.log("🔔 Scheduler started (checks every 30 min; festival 09:30, staff reminders 10:00 & 14:00).");
};

module.exports = { startReminderScheduler };