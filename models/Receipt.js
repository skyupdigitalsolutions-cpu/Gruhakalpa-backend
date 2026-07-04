const mongoose = require("mongoose");

const receiptSchema = new mongoose.Schema(
  {
    membershipid: {
      type: String,
      required: true,
    },
    receipt_no: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: false, // Optional field for user email
    },
    projectname: String,
    date: {
      type: Date,
      required: true,
    },
    amountpaid: {
      type: Number,
      required: true,
    },
    bookingamount: {
      type: Number,
      default: 0,
    },
    mobilenumber: Number,
    totalreceived: {
      type: Number,
      default: 0,
    },
    paymentmode: String,
    paymenttype: String,
    transactionid: String,
    sitedimension: String, // ✅ Field for site dimensions
    created_by: String,
    bank: String,
    seniority_no: String,
    is_new_user: { type: Boolean, default: false }, // true if this was their very first receipt
    cancelled: { type: Boolean, default: false },
    cancelledAt: { type: Date },
    pdfUrl: { type: String, default: null }, // Cloudinary URL of the generated receipt PDF

    // Exact split of this receipt's amount across payment buckets.
    // bucket: internal key ("Down Payment" | "Installment N" | fee name)
    // label:  what was printed on the receipt (e.g. "Booking Advance" while DP incomplete)
    // amount: rupees allocated to that bucket in THIS receipt
    allocations: [
      {
        bucket: { type: String },
        label: { type: String },
        amount: { type: Number, default: 0 },
      },
    ],
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Receipt", receiptSchema);