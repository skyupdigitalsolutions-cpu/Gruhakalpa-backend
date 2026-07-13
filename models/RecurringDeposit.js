const mongoose = require("mongoose");

// A Recurring Deposit held by a member. The member pays `monthlyAmount` each
// month; every payment is recorded in `installments`. Interest is calculated on
// the total paid so far, pro-rated for the number of completed months — so if a
// member pays 5 months and withdraws, they earn 5 months' interest on the sum.
const recurringDepositSchema = new mongoose.Schema(
  {
    rdNo: { type: String, required: true, unique: true }, // e.g. RD2026001
    membershipId: { type: String, required: true },
    name: { type: String, required: true },
    mobilenumber: { type: Number },

    date: { type: Date, required: true }, // issue/booking date

    monthlyAmount: { type: Number, required: true }, // the monthly deposit ("amount")
    sumInWords: { type: String, default: "" }, // words for the monthly amount (auto)

    amountPaidDate: { type: Date, required: true }, // first deposit / start date
    tenureMonths: { type: Number, required: true, default: 12 }, // custom term
    maturityDate: { type: Date }, // auto = amountPaidDate + tenureMonths

    interestRate: { type: Number, default: 0 }, // custom % set by admin

    // Each recorded monthly payment.
    installments: [
      {
        date: { type: Date },
        amount: { type: Number, default: 0 },
      },
    ],
    monthsPaid: { type: Number, default: 0 }, // installments.length
    totalPaid: { type: Number, default: 0 }, // sum of installments

    interestAmount: { type: Number, default: 0 }, // computed on totalPaid for monthsPaid
    maturityAmount: { type: Number, default: 0 }, // totalPaid + interest

    status: { type: String, enum: ["active", "closed"], default: "active" },
    projectname: { type: String, default: "NA" },
    created_by: { type: String },
    cancelled: { type: Boolean, default: false },
    cancelledAt: { type: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  "RecurringDeposit",
  recurringDepositSchema,
  "recurringdeposits",
);