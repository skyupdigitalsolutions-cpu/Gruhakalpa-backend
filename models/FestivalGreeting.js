const mongoose = require("mongoose");

// ─────────────────────────────────────────────────────────────────────────
// Festival greeting automation
//
// One document per festival. It holds the approved MSG91 template name, the
// festival's date (month + day, since the greeting recurs every year), the
// image the admin uploads for THIS year, and a small per-year log so the
// scheduler sends each festival at most once per calendar year.
//
// The image is uploaded fresh each year (imageUrl is cleared/replaced), so the
// admin drops in the current year's creative before the date arrives. If no
// image is uploaded, the greeting still goes out as a text-only message.
// ─────────────────────────────────────────────────────────────────────────

const festivalGreetingSchema = new mongoose.Schema(
  {
    // Stable key, e.g. "new_year", "ugadi" — matches the template slug.
    key: { type: String, required: true, unique: true, index: true },

    // Display name shown in the UI, e.g. "Ugadi".
    name: { type: String, required: true },

    // Approved MSG91 template name, e.g. "wa_gk_ugadi".
    templateName: { type: String, default: "" },

    // Recurring date. Year is ignored — the scheduler matches month+day.
    // Some festivals move each year (Eid, Ugadi…); admin can update these.
    month: { type: Number, min: 1, max: 12, required: true }, // 1–12
    day: { type: Number, min: 1, max: 31, required: true },

    // This year's uploaded creative (Cloudinary secure_url). Empty = text only.
    imageUrl: { type: String, default: "" },
    imagePublicId: { type: String, default: "" },
    imageUploadedAt: { type: Date, default: null },

    // Whether this festival's greeting is turned on.
    enabled: { type: Boolean, default: true },

    // Per-year send log so we never send the same festival twice in a year.
    // Stores the last year we sent, e.g. 2026.
    lastSentYear: { type: Number, default: null },
    lastSentAt: { type: Date, default: null },
    lastSentCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("FestivalGreeting", festivalGreetingSchema);