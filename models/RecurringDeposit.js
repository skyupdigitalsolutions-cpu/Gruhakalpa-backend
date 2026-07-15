const mongoose = require("mongoose");

// A Recurring Deposit held by a member. The member pays a fixed `monthlyAmount`
// at the start of each month. Interest is MONTHLY COMPOUNDING: at the end of each
// completed month the running balance earns one month's interest (annual% / 12),
// which is added back to the balance — so the first payment starts earning only
// after the first month, and each later payment compounds for the months that
// remain until maturity. See utils/depositUtils.computeRDCompound.
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

    interestRate: { type: Number, default: 0 }, // custom % p.a. set by admin
    compounding: { type: String, default: "monthly" }, // interest model

    // Each recorded monthly payment.
    installments: [
      {
        date: { type: Date },
        amount: { type: Number, default: 0 },
      },
    ],
    monthsPaid: { type: Number, default: 0 }, // installments.length
    totalPaid: { type: Number, default: 0 }, // sum of installments so far

    // ── Projection for the FULL tenure (if every installment is paid) ──
    totalDeposit: { type: Number, default: 0 }, // monthlyAmount × tenureMonths
    interestAmount: { type: Number, default: 0 }, // total compound interest at maturity
    maturityAmount: { type: Number, default: 0 }, // totalDeposit + interestAmount

    // ── Accrued so far (based on the installments actually recorded) ──
    accruedInterest: { type: Number, default: 0 }, // compound interest earned to date
    accruedValue: { type: Number, default: 0 }, // totalPaid + accruedInterest

    // Per-month compound schedule for the full tenure (deposit / interest / balance).
    schedule: [
      {
        month: { type: Number },
        deposit: { type: Number, default: 0 },
        interest: { type: Number, default: 0 }, // interest earned that month
        balance: { type: Number, default: 0 }, // running balance after that month
      },
    ],

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