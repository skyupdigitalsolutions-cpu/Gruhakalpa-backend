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
    // NEW: scheduled due date for the down payment. Set from the booking form.
    // When absent (legacy bookings), the schedule engine falls back to the
    // booking date.
    downPaymentDate: { type: Date },
    // NEW: full installment schedule (supports 14 installments).
    // Each entry: { label: "Installment 1", amount: 150000, dueDate: <Date> }
    // dueDate is the scheduled/expected payment date for that installment.
    // When absent (legacy bookings), the schedule engine derives it monthly
    // from the booking date.
    installments: [
      {
        label: { type: String },
        amount: { type: Number, default: 0 },
        dueDate: { type: Date },
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
    cancellationPenalty: { type: Number, default: 0 },
    cancelledAt: { type: Date },
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