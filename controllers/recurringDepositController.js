const RecurringDeposit = require("../models/RecurringDeposit");
const Member = require("../models/Member");
const {
  numberToWordsIndian,
  addMonths,
  computeRDCompound,
  computeRDCompoundSeries,
  nextDepositNumber,
  round2,
} = require("../utils/depositUtils");

// Recompute totals, maturityDate, compound interest, schedule and words from the
// current installments / monthly amount / rate / tenure.
//
// Interest is MONTHLY COMPOUNDING (see utils/depositUtils.computeRDCompound):
//   - The "projection" fields assume every installment of the full tenure is
//     paid: totalDeposit, interestAmount, maturityAmount, schedule.
//   - The "accrued" fields value only the installments actually recorded so far:
//     totalPaid, accruedInterest, accruedValue.
function recomputeRD(doc) {
  const installments = Array.isArray(doc.installments) ? doc.installments : [];
  const monthsPaid = installments.length;
  const start = doc.amountPaidDate ? new Date(doc.amountPaidDate) : new Date(doc.date);
  const tenure = Number(doc.tenureMonths) || 12;
  const maturityDate = addMonths(start, tenure);

  // Full-tenure projection (fixed monthly amount for every month of the term).
  const projected = computeRDCompound(doc.monthlyAmount, doc.interestRate, tenure);

  // Accrued value of what has actually been paid so far (amounts may vary).
  const accrued = computeRDCompoundSeries(installments, doc.interestRate);

  doc.monthsPaid = monthsPaid;
  doc.totalPaid = accrued.totalPaid;
  doc.maturityDate = maturityDate;
  doc.compounding = "monthly";

  doc.totalDeposit = projected.totalDeposit;
  doc.interestAmount = projected.interestAmount;
  doc.maturityAmount = projected.maturityAmount;
  doc.schedule = projected.schedule;

  doc.accruedInterest = accrued.accruedInterest;
  doc.accruedValue = accrued.accruedValue;

  doc.sumInWords = numberToWordsIndian(doc.monthlyAmount);
  return doc;
}

exports.createRecurringDeposit = async (req, res) => {
  try {
    const {
      membershipId,
      name,
      date,
      monthlyAmount,
      amountPaidDate,
      tenureMonths,
      interestRate,
      installments,
      created_by,
    } = req.body;

    if (!membershipId) {
      return res
        .status(400)
        .json({ success: false, message: "membershipId is required" });
    }

    const member = await Member.findOne({ membership_id: membershipId });
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found. Please add the member first.",
      });
    }

    const mobilenumber =
      member.mobilenumber || member.mobile || member.mobile_number || undefined;

    const yr = date ? new Date(date).getFullYear() : new Date().getFullYear();
    const rdNo = await nextDepositNumber(RecurringDeposit, "rdNo", "RD", yr);

    const start = amountPaidDate ? new Date(amountPaidDate) : new Date(date || Date.now());

    // First month's payment: use provided installments, else seed one from the
    // monthly amount on the start date.
    let insts = Array.isArray(installments) && installments.length
      ? installments.map((i) => ({
          date: i.date ? new Date(i.date) : start,
          amount: Number(i.amount) || Number(monthlyAmount) || 0,
        }))
      : [{ date: start, amount: Number(monthlyAmount) || 0 }];

    const doc = {
      rdNo,
      membershipId,
      name: name || member.name,
      mobilenumber,
      date: date ? new Date(date) : new Date(),
      monthlyAmount: Number(monthlyAmount) || 0,
      amountPaidDate: start,
      tenureMonths: Number(tenureMonths) || 12,
      interestRate: Number(interestRate) || 0,
      installments: insts,
      projectname: "NA",
      created_by: created_by || "",
    };

    recomputeRD(doc);

    const created = await RecurringDeposit.create(doc);
    res.status(201).json({ success: true, message: "Recurring Deposit created", data: created });
  } catch (error) {
    console.error("createRecurringDeposit error:", error);
    res.status(500).json({ success: false, message: "Error creating recurring deposit" });
  }
};

exports.getAllRecurringDeposits = async (req, res) => {
  try {
    const list = await RecurringDeposit.find({}).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: list });
  } catch (error) {
    console.error("getAllRecurringDeposits error:", error);
    res.status(500).json({ success: false, message: "Error fetching recurring deposits" });
  }
};

exports.getRecurringDepositById = async (req, res) => {
  try {
    const rd = await RecurringDeposit.findById(req.params.id);
    if (!rd) return res.status(404).json({ success: false, message: "Not found" });
    res.status(200).json({ success: true, data: rd });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching recurring deposit" });
  }
};

// Update: edit fields and/or record a new monthly payment.
//   { addInstallment: { date, amount } }  → appends one month's deposit
// After any change, totals / interest / maturity are recomputed.
exports.updateRecurringDeposit = async (req, res) => {
  try {
    const rd = await RecurringDeposit.findById(req.params.id);
    if (!rd) return res.status(404).json({ success: false, message: "Not found" });
    if (rd.cancelled) {
      return res.status(400).json({ success: false, message: "Deposit is cancelled" });
    }

    const b = req.body;
    if (b.name !== undefined) rd.name = b.name;
    if (b.monthlyAmount !== undefined) rd.monthlyAmount = Number(b.monthlyAmount) || 0;
    if (b.interestRate !== undefined) rd.interestRate = Number(b.interestRate) || 0;
    if (b.tenureMonths !== undefined) rd.tenureMonths = Number(b.tenureMonths) || 12;
    if (b.date !== undefined) rd.date = new Date(b.date);
    if (b.amountPaidDate !== undefined) rd.amountPaidDate = new Date(b.amountPaidDate);
    if (b.status !== undefined) rd.status = b.status;

    // Record a monthly payment.
    if (b.addInstallment && b.addInstallment.amount) {
      rd.installments.push({
        date: b.addInstallment.date ? new Date(b.addInstallment.date) : new Date(),
        amount: Number(b.addInstallment.amount) || Number(rd.monthlyAmount) || 0,
      });
    }

    // Allow full replacement of installments if provided explicitly.
    if (Array.isArray(b.installments)) {
      rd.installments = b.installments.map((i) => ({
        date: i.date ? new Date(i.date) : new Date(),
        amount: Number(i.amount) || 0,
      }));
    }

    recomputeRD(rd);
    await rd.save();
    res.status(200).json({ success: true, message: "Recurring Deposit updated", data: rd });
  } catch (error) {
    console.error("updateRecurringDeposit error:", error);
    res.status(500).json({ success: false, message: "Error updating recurring deposit" });
  }
};

exports.cancelRecurringDeposit = async (req, res) => {
  try {
    const rd = await RecurringDeposit.findByIdAndUpdate(
      req.params.id,
      { $set: { cancelled: true, cancelledAt: new Date() } },
      { new: true },
    );
    if (!rd) return res.status(404).json({ success: false, message: "Not found" });
    res.status(200).json({ success: true, message: "Recurring Deposit cancelled", data: rd });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error cancelling recurring deposit" });
  }
};