const FixedDeposit = require("../models/FixedDeposit");
const Member = require("../models/Member");
const Receipt = require("../models/Receipt");
const {
  numberToWordsIndian,
  addDays,
  daysBetween,
  computeFDInterest,
  round2,
  FD_TENURE_DAYS,
} = require("../utils/depositUtils");

const pad2 = (n) => String(Number(n) || 0).padStart(2, "0");

// Strip the "-R01" round suffix off an fdrNo to recover the shared base number.
const stripRound = (fdrNo) => String(fdrNo || "").replace(/-R\d+$/i, "");
// Read the round number out of an fdrNo (e.g. FDR2026001-R03 → 3), else 0.
const roundFromFdr = (fdrNo) => {
  const m = String(fdrNo || "").match(/-R(\d+)$/i);
  return m ? parseInt(m[1], 10) : 0;
};

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

// Next fresh base FDR number for a year e.g. FDR2026001. Considers both the
// stored `baseFdrNo` and any legacy records that only carry `fdrNo`, so a new
// base never collides with an existing one.
async function nextBaseFdrNo(year) {
  const yr = year || new Date().getFullYear();
  const stem = `FDR${yr}`;
  const seqRx = new RegExp(`^FDR${yr}(\\d{3,})`);
  const docs = await FixedDeposit.find({
    $or: [
      { baseFdrNo: { $regex: `^FDR${yr}\\d{3,}` } },
      { fdrNo: { $regex: `^FDR${yr}\\d{3,}` } },
    ],
  })
    .select("baseFdrNo fdrNo")
    .lean();

  let maxSeq = 0;
  for (const d of docs) {
    const src = d.baseFdrNo || stripRound(d.fdrNo);
    const m = String(src).match(seqRx);
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  }
  return `${stem}${String(maxSeq + 1).padStart(3, "0")}`;
}

// Resolve the FDR identity for a member's new FD. If the member already holds
// FDs, reuse their base number and take the next round; otherwise mint a fresh
// base at round 1. Returns { baseFdrNo, renewalNo, fdrNo }.
async function resolveFdrIdentity(membershipId, year) {
  const existing = await FixedDeposit.find({ membershipId })
    .select("fdrNo baseFdrNo renewalNo")
    .lean();

  if (existing && existing.length) {
    let base =
      existing.find((d) => d.baseFdrNo)?.baseFdrNo ||
      stripRound(existing[0].fdrNo);
    if (!base) base = await nextBaseFdrNo(year);

    const maxRound = existing.reduce((mx, d) => {
      const rn = Number(d.renewalNo) || roundFromFdr(d.fdrNo);
      return Math.max(mx, rn);
    }, 0);
    const renewalNo = maxRound + 1;
    return { baseFdrNo: base, renewalNo, fdrNo: `${base}-R${pad2(renewalNo)}` };
  }

  const base = await nextBaseFdrNo(year);
  return { baseFdrNo: base, renewalNo: 1, fdrNo: `${base}-R01` };
}

// Normalize the receipts picked in the FD form into entries stored on the FD.
// The pdfUrl is re-read from the Receipt collection (server is authoritative)
// so admins/superadmins can view + download the receipt PDF from the FD list,
// even if the client didn't send the URL.
async function buildReceiptEntries(receipts) {
  if (!Array.isArray(receipts) || receipts.length === 0) return [];

  const ids = receipts.map((r) => r && r.receipt_id).filter(Boolean);
  let byId = {};
  if (ids.length) {
    try {
      const docs = await Receipt.find({ _id: { $in: ids } }).select(
        "receipt_no date amountpaid pdfUrl",
      );
      byId = docs.reduce((m, d) => {
        m[String(d._id)] = d;
        return m;
      }, {});
    } catch (e) {
      console.error("buildReceiptEntries lookup error:", e.message);
    }
  }

  return receipts.map((r) => {
    const src = r && r.receipt_id ? byId[String(r.receipt_id)] : null;
    return {
      receipt_id: (r && r.receipt_id) || undefined,
      receipt_no: (r && r.receipt_no) || (src && src.receipt_no) || "",
      date: r && r.date ? new Date(r.date) : (src && src.date) || undefined,
      amount:
        Number(r && r.amount) ||
        (src ? Number(src.amountpaid) : 0) ||
        0,
      pdfUrl: (r && r.pdfUrl) || (src && src.pdfUrl) || null,
    };
  });
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
      receipts,
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

    const paidList = Array.isArray(payments) ? payments : [];
    const paidFromList = paidList.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    // Selected FD receipts to attach (viewable/downloadable from the FD list).
    const receiptEntries = await buildReceiptEntries(receipts);

    const baseDoc = {
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
      receipts: receiptEntries,
      tenureMonths: Number(tenureMonths) || 12,
      interestRate: Number(interestRate) || 0,
      projectname: "NA",
      created_by: created_by || "",
    };

    // Assign base FDR + next round, retrying on the rare fdrNo race.
    let created = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { baseFdrNo, renewalNo, fdrNo } = await resolveFdrIdentity(
        membershipId,
        yr,
      );
      const doc = { ...baseDoc, baseFdrNo, renewalNo, fdrNo };
      recomputeFD(doc);
      try {
        created = await FixedDeposit.create(doc);
        break;
      } catch (e) {
        lastErr = e;
        if (e && e.code === 11000) continue; // duplicate fdrNo — recompute round
        throw e;
      }
    }
    if (!created) throw lastErr || new Error("Could not allocate FDR number");

    res.status(201).json({ success: true, message: "Fixed Deposit created", data: created });
  } catch (error) {
    console.error("createFixedDeposit error:", error);
    res.status(500).json({ success: false, message: "Error creating fixed deposit" });
  }
};

exports.getAllFixedDeposits = async (req, res) => {
  try {
    const filter = {};
    if (req.query.membershipId) filter.membershipId = req.query.membershipId;
    if (req.query.baseFdrNo) filter.baseFdrNo = req.query.baseFdrNo;
    const list = await FixedDeposit.find(filter).sort({ createdAt: -1 });
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

    // Replace the linked receipts if a new selection was sent.
    if (b.receipts !== undefined) {
      fd.receipts = await buildReceiptEntries(b.receipts);
    }

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