const mongoose = require("mongoose");

const siteBookingSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    mobilenumber: {
      type: Number,
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    projectname: String,
    sitedimension: String,
    totalamount: {
      type: Number,
      required: true,
    },
    downpayment: {
      type: Number,
      default: 0,
    },
    // NEW: full installment schedule (supports 14 installments).
    // Each entry: { label: "Installment 1", amount: 150000 }
    installments: [
      {
        label: { type: String },
        amount: { type: Number, default: 0 },
      },
    ],
    // Legacy fields kept for backward-compatibility with older records.
    // No longer written by the new form, but preserved so old data still reads.
    installment1: { type: Number, default: 0 },
    installment2: { type: Number, default: 0 },
    installment3: { type: Number, default: 0 },
    designation: String,
    nominees: [
      {
        name: { type: String },
        age: { type: String },
        relationship: { type: String },
      },
    ],
    membership_id: {
      type: String,
      required: true,
    },
    paymentplan: {
      type: String,
      enum: ["installments", "full"],
      default: "installments",
    },
    status: { type: String, default: "active" },
    cancelled: { type: Boolean, default: false },
    cancellationPdfUrl: { type: String },
    cancelledAt: { type: Date },
    // Payment-reminder automation: records each reminder already sent so the
    // same one is never sent twice. Keyed by installment + milestone.
    remindersSent: [
      {
        key: { type: String },
        sentAt: { type: Date, default: Date.now },
        type: { type: String }, // "reminder" | "overdue"
        pendingAmount: { type: Number },
        channels: [{ type: String }], // e.g. ["whatsapp:ok", "email:ok"]
      },
    ],
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model(
  "SiteBooking",
  siteBookingSchema,
  "sitebookings",
);