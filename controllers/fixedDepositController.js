const FixedDeposit = require("../models/FixedDeposit");
const Member = require("../models/Member");
const {
  numberToWordsIndian,
  addDays,
  daysBetween,
  computeFDInterest,
  nextDepositNumber,
  round2,
  FD_TENURE_DAYS,
} = require("../utils/depositUtils");

// Recompute maturityDate, interestAmount, maturityAmount, sumInWords from the
// current amount / paid date / rate. Mutates and returns the plain object.
function recomputeFD(doc) {
  const paidDate = doc.amountPaidDate ? new Date(doc.amountPaidDate) : new Date(doc.date);
  const maturityDate = addDays(paidDate, FD_TENURE_DAYS);
  const days = daysBetween(paidDate, maturityDate) || FD_TENURE_DAYS;
  const { interestAmount, maturityAmount } = computeFDInterest(
    doc.amount,
    doc.interestRate,
    days,
  );
  doc.maturityDate = maturityDate;
  doc.interestAmount = interestAmount;
  doc.maturityAmount = maturityAmount;
  doc.sumInWords = numberToWordsIndian(doc.amount);
  return doc;
}

exports.createFixedDeposit = async (req, res) => {
  try {
    const {
      membershipId,
      name,
      date,
      amount,
      amountPaid,
      amountPaidDate,
      tenureMonths,
      interestRate,
      payments,
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
    const fdrNo = await nextDepositNumber(FixedDeposit, "fdrNo", "FDR", yr);

    const paidList = Array.isArray(payments) ? payments : [];
    const paidFromList = paidList.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    const doc = {
      fdrNo,
      membershipId,
      name: name || member.name,
      mobilenumber,
      date: date ? new Date(date) : new Date(),
      amount: Number(amount) || 0,
      amountPaid: Number(amountPaid) || paidFromList || 0,
      amountPaidDate: amountPaidDate ? new Date(amountPaidDate) : new Date(date || Date.now()),
      payments: paidList.map((p) => ({
        date: p.date ? new Date(p.date) : new Date(),
        amount: Number(p.amount) || 0,
      })),
      tenureMonths: Number(tenureMonths) || 12,
      interestRate: Number(interestRate) || 0,
      projectname: "NA",
      created_by: created_by || "",
    };

    recomputeFD(doc);

    const created = await FixedDeposit.create(doc);
    res.status(201).json({ success: true, message: "Fixed Deposit created", data: created });
  } catch (error) {
    console.error("createFixedDeposit error:", error);
    res.status(500).json({ success: false, message: "Error creating fixed deposit" });
  }
};

exports.getAllFixedDeposits = async (req, res) => {
  try {
    const list = await FixedDeposit.find({}).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: list });
  } catch (error) {
    console.error("getAllFixedDeposits error:", error);
    res.status(500).json({ success: false, message: "Error fetching fixed deposits" });
  }
};

exports.getFixedDepositById = async (req, res) => {
  try {
    const fd = await FixedDeposit.findById(req.params.id);
    if (!fd) return res.status(404).json({ success: false, message: "Not found" });
    res.status(200).json({ success: true, data: fd });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching fixed deposit" });
  }
};

// Update: any of amount / amountPaidDate / interestRate / tenure / name — then
// derived fields (maturity, interest, words) are recomputed. Also supports
// appending a payment transaction via { addPayment: { date, amount } }.
exports.updateFixedDeposit = async (req, res) => {
  try {
    const fd = await FixedDeposit.findById(req.params.id);
    if (!fd) return res.status(404).json({ success: false, message: "Not found" });
    if (fd.cancelled) {
      return res.status(400).json({ success: false, message: "Deposit is cancelled" });
    }

    const b = req.body;
    if (b.name !== undefined) fd.name = b.name;
    if (b.amount !== undefined) fd.amount = Number(b.amount) || 0;
    if (b.interestRate !== undefined) fd.interestRate = Number(b.interestRate) || 0;
    if (b.tenureMonths !== undefined) fd.tenureMonths = Number(b.tenureMonths) || 12;
    if (b.date !== undefined) fd.date = new Date(b.date);
    if (b.amountPaidDate !== undefined) fd.amountPaidDate = new Date(b.amountPaidDate);
    if (b.amountPaid !== undefined) fd.amountPaid = Number(b.amountPaid) || 0;

    // Append a payment transaction and roll it into amountPaid.
    if (b.addPayment && b.addPayment.amount) {
      const p = {
        date: b.addPayment.date ? new Date(b.addPayment.date) : new Date(),
        amount: Number(b.addPayment.amount) || 0,
      };
      fd.payments.push(p);
      fd.amountPaid = round2((fd.amountPaid || 0) + p.amount);
      // If the admin didn't override the paid date, anchor maturity to the
      // latest payment date (the deposit is now more fully funded).
      if (b.amountPaidDate === undefined) fd.amountPaidDate = p.date;
    }

    recomputeFD(fd);
    await fd.save();
    res.status(200).json({ success: true, message: "Fixed Deposit updated", data: fd });
  } catch (error) {
    console.error("updateFixedDeposit error:", error);
    res.status(500).json({ success: false, message: "Error updating fixed deposit" });
  }
};

exports.cancelFixedDeposit = async (req, res) => {
  try {
    const fd = await FixedDeposit.findByIdAndUpdate(
      req.params.id,
      { $set: { cancelled: true, cancelledAt: new Date() } },
      { new: true },
    );
    if (!fd) return res.status(404).json({ success: false, message: "Not found" });
    res.status(200).json({ success: true, message: "Fixed Deposit cancelled", data: fd });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error cancelling fixed deposit" });
  }
};