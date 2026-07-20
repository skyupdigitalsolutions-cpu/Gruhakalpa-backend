const mongoose = require("mongoose");

// Every reminder / message sent to a client (WhatsApp via MSG91, Email via Brevo)
// is recorded here so the dashboard can show a full communication history.
const messageLogSchema = new mongoose.Schema(
  {
    membership_id: { type: String, required: true, index: true },
    name: { type: String, default: "" },

    // "whatsapp" (MSG91) or "email" (Brevo)
    channel: {
      type: String,
      enum: ["whatsapp", "email"],
      required: true,
      index: true,
    },

    // Recipient address — phone number for whatsapp, email address for email
    to: { type: String, default: "" },

    // Why the message was sent
    kind: {
      type: String,
      enum: ["upcoming", "overdue", "confirmation", "manual", "event"],
      default: "manual",
      index: true,
    },

    // Which cadence milestone this reminder was for, so the scheduler sends
    // each one exactly once per bucket. e.g. "30d","15d","7d","1d","0d",
    // "overdue","confirmation" (blank for manual sends).
    milestone: { type: String, default: "", index: true },

    // Which installment / bucket this reminder was about (optional)
    dueLabel: { type: String, default: "" },
    amount: { type: Number, default: 0 },
    dueDate: { type: Date },

    subject: { type: String, default: "" }, // email subject (blank for whatsapp)
    body: { type: String, default: "" }, // rendered text that was sent

    status: {
      type: String,
      enum: ["sent", "failed"],
      default: "sent",
      index: true,
    },
    error: { type: String, default: "" },

    provider: { type: String, default: "" }, // "msg91" | "brevo"
    providerMessageId: { type: String, default: "" },

    // "auto" for the scheduler, otherwise the admin username who clicked send
    sentBy: { type: String, default: "auto" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("MessageLog", messageLogSchema);