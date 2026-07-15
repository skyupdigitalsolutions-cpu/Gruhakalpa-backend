const mongoose = require("mongoose");

// A Fixed Deposit held by a member. The principal (`amount`) may be paid across
// several transactions (`payments`); the admin sets/updates `amountPaidDate` to
// the date the deposit is considered funded, and `maturityDate` is always
// 367 days after it. Interest is simple interest on the principal for the term.
//
// A member may hold multiple FDs. They all share one `baseFdrNo` (assigned on
// the member's first FD) and each FD is a "round": `renewalNo` 1, 2, 3 … The
// full `fdrNo` is `${baseFdrNo}-R${round}` e.g. FDR2026001-R01, FDR2026001-R02.
const fixedDepositSchema = new mongoose.Schema(
  {
    fdrNo: { type: String, required: true, unique: true }, // e.g. FDR2026001-R01
    baseFdrNo: { type: String, index: true }, // shared per member e.g. FDR2026001
    renewalNo: { type: Number, default: 1 }, // 1,2,3 … → R01,R02,R03
    membershipId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    mobilenumber: { type: Number },

    date: { type: Date, required: true }, // issue/booking date

    amount: { type: Number, required: true }, // principal (the fixed sum)
    sumInWords: { type: String, default: "" }, // "Rupees ... Only" (auto)

    amountPaid: { type: Number, default: 0 }, // accumulated across transactions
    amountPaidDate: { type: Date, required: true }, // maturity anchors here
    payments: [
      {
        date: { type: Date },
        amount: { type: Number, default: 0 },
      },
    ],

    // Fixed Deposit receipts the admin selected while creating this FD (round).
    // Stored here so admins/superadmins can view + download the underlying
    // receipt PDF straight from the Fixed Deposit list. A receipt attached to an
    // earlier round is not offered again for later rounds of the same member.
    receipts: [
      {
        receipt_id: { type: mongoose.Schema.Types.ObjectId, ref: "Receipt" },
        receipt_no: { type: String, default: "" },
        date: { type: Date },
        amount: { type: Number, default: 0 },
        pdfUrl: { type: String, default: null },
      },
    ],

    tenureMonths: { type: Number, default: 12 }, // informational
    maturityDate: { type: Date }, // auto = amountPaidDate + 367 days

    interestRate: { type: Number, default: 0 }, // custom % set by admin
    interestAmount: { type: Number, default: 0 }, // computed
    maturityAmount: { type: Number, default: 0 }, // principal + interest

    projectname: { type: String, default: "NA" }, // deposits aren't site-project bound
    created_by: { type: String },
    cancelled: { type: Boolean, default: false },
    cancelledAt: { type: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model("FixedDeposit", fixedDepositSchema, "fixeddeposits");