/**
 * reminderRoutes.js
 *
 * Admin/testing endpoints for the payment-reminder automation.
 *
 *   GET  /reminders/preview   -> dry run: shows what WOULD be sent today, sends nothing
 *   POST /reminders/run       -> actually runs the reminder job now
 *
 * Both are protected by a simple shared secret passed as the `x-reminder-key`
 * header, matching the REMINDER_TRIGGER_KEY env var. This stops the public
 * internet from triggering blasts. Set REMINDER_TRIGGER_KEY in your env.
 */

const express = require("express");
const router = express.Router();
const { runAllReminders } = require("../utils/reminderService");

function checkKey(req, res, next) {
  const provided = req.headers["x-reminder-key"];
  const expected = process.env.REMINDER_TRIGGER_KEY;
  if (!expected) {
    return res
      .status(503)
      .json({ success: false, message: "REMINDER_TRIGGER_KEY not configured" });
  }
  if (provided !== expected) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
}

// Dry run — preview only, sends nothing
router.get("/reminders/preview", checkKey, async (req, res) => {
  try {
    const results = await runAllReminders({ dryRun: true });
    const toSend = results.filter((r) => r.action === "would-send");
    res.json({ success: true, wouldSend: toSend.length, results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Real run — sends messages now
router.post("/reminders/run", checkKey, async (req, res) => {
  try {
    const results = await runAllReminders();
    const sent = results.filter((r) => r.action === "sent").length;
    res.json({ success: true, sent, results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;