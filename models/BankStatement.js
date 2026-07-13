const mongoose = require("mongoose");

// Bank Statement register — day book of the society's bank / cash transactions.
// Multiple transactions can share the same date. Credits add to the balance,
// debits subtract. The closing (running) balance is tracked PER BANK because
// each bank / cash book carries its own balance.
const bankStatementSchema = new mongoose.Schema(
  {
    // Auto-generated sequential serial number (max existing + 1).
    // Also helps order multiple transactions that fall on the same date.
    serialNo: {
      type: Number,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    // Cash | UPI | Cheque | Netbanking | DD | NEFT/RTGS
    modeOfPayment: {
      type: String,
      enum: ["Cash", "UPI", "Cheque", "Netbanking", "DD", "NEFT/RTGS"],
      default: "Cash",
    },
    // Kept as a free (trimmed) string rather than an enum so the head-of-account
    // list can be edited on the frontend later without breaking old records.
    headOfAccount: {
      type: String,
      trim: true,
      default: "",
    },
    // Apex | HDFC | Cash | BDCC
    bank: {
      type: String,
      enum: ["Apex", "HDFC", "Cash", "BDCC"],
      required: true,
      default: "Apex",
    },
    credit: {
      type: Number,
      default: 0,
      min: 0,
    },
    debit: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Snapshot of the per-bank running balance at the time of saving.
    // The frontend also recomputes this live so filtering never corrupts it.
    closingBalance: {
      type: Number,
      default: 0,
    },
    transactionId: {
      type: String,
      trim: true,
      default: "",
    },
    created_by: {
      type: String,
      default: "Admin",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("BankStatement", bankStatementSchema);