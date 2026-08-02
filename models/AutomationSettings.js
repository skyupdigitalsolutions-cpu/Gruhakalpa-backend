const mongoose = require("mongoose");

// ─────────────────────────────────────────────────────────────────────────
// AutomationSettings — settings that belong ONLY to the festival-automation
// panel, kept completely separate from the admin's ReminderSettings.
//
// This is what makes the automation panel self-contained: its own WhatsApp
// on/off and its own master switch. Turning WhatsApp on/off here does NOT
// affect the admin's receipts / payment-reminder WhatsApp, and vice versa.
//
// There is a single document (a singleton), fetched via getSettings().
// ─────────────────────────────────────────────────────────────────────────

const automationSettingsSchema = new mongoose.Schema(
  {
    singleton: { type: String, default: "automation", unique: true },

    // The automation panel's OWN WhatsApp channel on/off (independent of admin).
    whatsappEnabled: { type: Boolean, default: false },

    // Master festival switch — festivals only auto-send when this is ON.
    festivalAutomationEnabled: { type: Boolean, default: false },

    // The integrated WhatsApp sender number (defaults to env if blank).
    integratedNumber: { type: String, default: "" },
    languageCode: { type: String, default: "en" },
  },
  { timestamps: true },
);

// Fetch (or create) the single settings document.
automationSettingsSchema.statics.getSettings = async function () {
  let doc = await this.findOne({ singleton: "automation" });
  if (!doc) doc = await this.create({ singleton: "automation" });
  return doc;
};

module.exports = mongoose.model("AutomationSettings", automationSettingsSchema);