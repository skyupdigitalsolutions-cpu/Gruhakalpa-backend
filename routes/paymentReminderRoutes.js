const express = require("express");
const router = express.Router();
const controller = require("../controllers/paymentReminderController");
const authMiddleware = require("../middleware/authMiddleware");

// Allow the run-due endpoint to be hit either by a logged-in admin OR by an
// external cron using ?secret=CRON_SECRET. We try auth but don't hard-fail;
// the controller enforces one of the two.
const optionalAuth = (req, res, next) => {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    return authMiddleware(req, res, next);
  }
  next();
};

// Read endpoints (admin / superadmin token required)
router.get("/payment-schedule", authMiddleware, controller.getSchedule);
router.get(
  "/payment-schedule/:membership_id",
  authMiddleware,
  controller.getClientDetail,
);
router.get("/messages", authMiddleware, controller.getMessages);

// Reminder settings
router.get("/reminder-settings", authMiddleware, controller.getSettings);
router.put("/reminder-settings", authMiddleware, controller.updateSettings);

// Sending
router.post("/reminders/send", authMiddleware, controller.sendReminder);
router.post("/reminders/run-due", optionalAuth, controller.runDueEndpoint);

module.exports = router;