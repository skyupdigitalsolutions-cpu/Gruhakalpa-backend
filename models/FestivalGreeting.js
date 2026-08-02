const mongoose = require("mongoose");

// One document per festival template. Holds the template name, its recurring
// date (month+day, auto-mapped from the template name), this year's uploaded
// image, and a per-year sent log so a festival fires at most once per year.
const festivalGreetingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    templateName: { type: String, default: "" },

    month: { type: Number, min: 1, max: 12, required: true },
    day: { type: Number, min: 1, max: 31, required: true },

    imageUrl: { type: String, default: "" },
    imagePublicId: { type: String, default: "" },
    imageUploadedAt: { type: Date, default: null },

    // Default OFF — with a large membership, a festival must be manually
    // switched ON in the panel before it auto-sends to all members. This
    // prevents accidental mass sends. (Staff reminders are separate and stay on.)
    enabled: { type: Boolean, default: false },

    lastSentYear: { type: Number, default: null },
    lastSentAt: { type: Date, default: null },
    lastSentCount: { type: Number, default: 0 },

    // Tracks which staff "upload image" reminder slots have fired this year, so
    // each slot sends exactly once. Keys: "YYYY_d3_10", "YYYY_d2_10",
    // "YYYY_d1_10", "YYYY_d1_14". Value: true once sent.
    staffReminderSlots: { type: Map, of: Boolean, default: {} },
    // Tracks the member greeting slot ("YYYY_day_0930") so it fires once.
    memberGreetingSlot: { type: Map, of: Boolean, default: {} },
  },
  { timestamps: true },
);

module.exports = mongoose.model("FestivalGreeting", festivalGreetingSchema);