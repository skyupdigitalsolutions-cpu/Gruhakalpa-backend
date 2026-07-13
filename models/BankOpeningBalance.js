const mongoose = require("mongoose");

// Singleton document holding the society's opening balance per bank as of a
// given start date. Exactly one row (singleton = "OPENING"). Each bank's
// running balance in the statement starts from its opening balance here.
const bankOpeningBalanceSchema = new mongoose.Schema(
  {
    singleton: {
      type: String,
      default: "OPENING",
      unique: true,
      index: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    Apex: { type: Number, default: 0 },
    HDFC: { type: Number, default: 0 },
    Cash: { type: Number, default: 0 },
    BDCC: { type: Number, default: 0 },
    updated_by: { type: String, default: "Admin" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("BankOpeningBalance", bankOpeningBalanceSchema);