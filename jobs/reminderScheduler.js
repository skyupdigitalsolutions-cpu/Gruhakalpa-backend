/**
 * reminderScheduler.js
 *
 * Schedules the daily payment-reminder run using node-cron.
 * Works on an always-on host (like Elastic Beanstalk). The instance stays
 * running, so the in-process cron fires reliably once a day.
 *
 * Configure with env vars (optional):
 *   REMINDER_CRON      - cron expression (default "0 9 * * *"  = every day 09:00)
 *   REMINDER_TIMEZONE  - IANA timezone   (default "Asia/Kolkata")
 *   REMINDERS_ENABLED  - set to "false" to disable the automatic run
 */

const cron = require("node-cron");
const { runAllReminders } = require("../utils/reminderService");

function startReminderScheduler() {
  if (process.env.REMINDERS_ENABLED === "false") {
    console.log("⏸️  Payment reminder scheduler is DISABLED (REMINDERS_ENABLED=false)");
    return;
  }

  const expression = process.env.REMINDER_CRON || "0 9 * * *";
  const timezone = process.env.REMINDER_TIMEZONE || "Asia/Kolkata";

  if (!cron.validate(expression)) {
    console.error(`❌ Invalid REMINDER_CRON "${expression}" — scheduler not started`);
    return;
  }

  cron.schedule(
    expression,
    async () => {
      console.log(`⏰ Running scheduled payment reminders (${new Date().toISOString()})`);
      try {
        await runAllReminders();
      } catch (err) {
        console.error("❌ Scheduled reminder run failed:", err.message);
      }
    },
    { timezone },
  );

  console.log(
    `✅ Payment reminder scheduler started (cron "${expression}", tz ${timezone})`,
  );
}

module.exports = { startReminderScheduler };