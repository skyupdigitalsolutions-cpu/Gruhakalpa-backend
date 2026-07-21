const mongoose = require("mongoose");

// Single global settings document that controls payment-reminder automation.
// There is only ever ONE of these (key: "global"). Superadmin edits it from
// the "Automation Setup" tab in the Payments Due page.
const reminderSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },

    // Master switch for the auto scheduler
    autoEnabled: { type: Boolean, default: false },

    // Master switch for event notifications (member/booking/FD/RD/receipt/
    // certificate messages fired automatically when the record is created).
    eventNotificationsEnabled: { type: Boolean, default: true },

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
      templateUpcoming: { type: String, default: "wa_reminder_payment" },
      templateOverdue: { type: String, default: "wa_overdue_payment" },
      // Sent when a payment is received. Body vars: name, amount paid,
      // remaining balance, date.
      templateConfirmation: { type: String, default: "" },

      // ── Event notifications (fired automatically when a record is created) ──
      // Each is an approved MSG91 template name. The two PDF ones must be
      // approved with a DOCUMENT header so the receipt / FD certificate PDF
      // attaches. Leave blank to skip WhatsApp for that event.
      templateReceipt: { type: String, default: "wa_gruhakalpa_receipt" },
      templateFdCertificate: {
        type: String,
        default: "wa_gruhakalpa_fd_certificate",
      },
      templateFdCreated: { type: String, default: "wa_gruhakalpa_fd_created" },
      templateRdCreated: { type: String, default: "wa_gruhakalpa_rd_created" },
      templateMemberAdded: {
        type: String,
        default: "wa_gruhakalpa_add_member",
      },
      templateSiteBooking: {
        type: String,
        default: "wa_gruhakalpa_site_booking",
      },

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

// Approved MSG91 template names for this WABA. Used to auto-fill the settings
// doc so an existing (pre-event-notifications) settings record gets the right
// names without the admin having to type all 8 into the Automation Setup tab.
// A field is only overwritten when it's blank or still holds a known OLD
// default — a name the admin deliberately typed is never changed.
const APPROVED_TEMPLATES = {
  templateUpcoming: "wa_reminder_payment",
  templateOverdue: "wa_overdue_payment",
  templateReceipt: "wa_gruhakalpa_receipt",
  templateFdCertificate: "wa_gruhakalpa_fd_certificate",
  templateFdCreated: "wa_gruhakalpa_fd_created",
  templateRdCreated: "wa_gruhakalpa_rd_created",
  templateMemberAdded: "wa_gruhakalpa_add_member",
  templateSiteBooking: "wa_gruhakalpa_site_booking",
};
// Old placeholder defaults that predate approval — safe to overwrite.
const OLD_DEFAULTS = new Set([
  "",
  "gruhakalpa_payment_reminder",
  "gruhakalpa_payment_overdue",
  "gruhakalpa_receipt",
  "gruhakalpa_fd_certificate",
  "gruhakalpa_fd_created",
  "gruhakalpa_rd_created",
  "gruhakalpa_member_added",
  "gruhakalpa_site_booking",
]);

// Convenience loader — always returns the single settings doc, creating
// it with defaults on first access, and back-filling the approved MSG91
// template names on an existing doc.
reminderSettingsSchema.statics.getSettings = async function () {
  let doc = await this.findOne({ key: "global" });
  if (!doc) doc = await this.create({ key: "global" });

  // Back-fill approved template names where the stored value is blank or an
  // old default. Never touches a custom name the admin set intentionally.
  let changed = false;
  if (!doc.whatsapp) doc.whatsapp = {};
  for (const [field, approved] of Object.entries(APPROVED_TEMPLATES)) {
    const current = (doc.whatsapp[field] || "").trim();
    if (OLD_DEFAULTS.has(current) && current !== approved) {
      doc.whatsapp[field] = approved;
      changed = true;
    }
  }
  if (changed) {
    doc.markModified("whatsapp");
    await doc.save();
  }

  return doc;
};

module.exports = mongoose.model("ReminderSettings", reminderSettingsSchema);