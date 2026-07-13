const mongoose = require("mongoose");

// Single global settings document that controls payment-reminder automation.
// There is only ever ONE of these (key: "global"). Superadmin edits it from
// the "Automation Setup" tab in the Payments Due page.
const reminderSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },

    // Master switch for the auto scheduler
    autoEnabled: { type: Boolean, default: false },

    // How many days BEFORE a due date a payment counts as "due soon"
    // (and triggers an upcoming reminder).
    reminderWindowDays: { type: Number, default: 7 },

    // Spacing between installments, counted in months from the booking date.
    // Installment N is due = bookingDate + (N * intervalMonths) months.
    intervalMonths: { type: Number, default: 1 },

    // Don't re-send the same reminder (member + bucket + channel) more often
    // than this many days — prevents the scheduler from spamming clients.
    resendGapDays: { type: Number, default: 20 },

    // Days-before-due at which to send a reminder. The scheduler sends each of
    // these once per installment: 1 month, 15d, 7d, 1d, and on the due date (0).
    preDueOffsets: { type: [Number], default: [30, 15, 7, 1, 0] },

    // Once a payment is overdue, re-send the due notice every N days until paid.
    overdueEveryDays: { type: Number, default: 7 },

    // ── WhatsApp (MSG91) ──
    whatsapp: {
      enabled: { type: Boolean, default: false },
      // MSG91 "integrated number" (your approved WhatsApp Business number)
      integratedNumber: { type: String, default: "" },
      // Approved MSG91 template names. Body variables are sent in order:
      //   1 = member name, 2 = amount (₹), 3 = due label, 4 = due date
      templateUpcoming: { type: String, default: "gruhakalpa_payment_reminder" },
      templateOverdue: { type: String, default: "gruhakalpa_payment_overdue" },
      // Sent when a payment is received. Body vars: name, amount paid,
      // remaining balance, date.
      templateConfirmation: { type: String, default: "" },
      languageCode: { type: String, default: "en" },
    },

    // ── Email (Brevo — reuses utils/mailer.js) ──
    email: {
      enabled: { type: Boolean, default: true },
    },

    lastRunAt: { type: Date },
  },
  { timestamps: true },
);

// Convenience loader — always returns the single settings doc, creating
// it with defaults on first access.
reminderSettingsSchema.statics.getSettings = async function () {
  let doc = await this.findOne({ key: "global" });
  if (!doc) doc = await this.create({ key: "global" });
  return doc;
};

module.exports = mongoose.model("ReminderSettings", reminderSettingsSchema);