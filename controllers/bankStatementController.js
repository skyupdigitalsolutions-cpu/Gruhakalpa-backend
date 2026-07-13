const BankStatement = require("../models/BankStatement");
const BankOpeningBalance = require("../models/BankOpeningBalance");

const VALID_BANKS = ["Apex", "HDFC", "Cash", "BDCC"];
const VALID_MODES = ["Cash", "UPI", "Cheque", "Netbanking", "DD", "NEFT/RTGS"];

// Read the opening balance for a single bank (0 if none set yet).
const getOpeningFor = async (bank) => {
  const ob = await BankOpeningBalance.findOne({ singleton: "OPENING" }).lean();
  return ob ? Number(ob[bank]) || 0 : 0;
};

// Next serial number = highest existing serial + 1.
const getNextSerial = async () => {
  const last = await BankStatement.findOne({})
    .sort({ serialNo: -1 })
    .select("serialNo")
    .lean();
  return (last?.serialNo || 0) + 1;
};

// Recompute the per-bank running closing balance for every row of a bank,
// ordered chronologically (date, then serial). Keeps stored balances correct
// after any create / edit / delete, including back-dated entries.
const recalculateBank = async (bank) => {
  const entries = await BankStatement.find({ bank }).sort({
    date: 1,
    serialNo: 1,
    createdAt: 1,
  });
  // Start each bank's running balance from its opening balance.
  let running = await getOpeningFor(bank);
  const ops = [];
  for (const e of entries) {
    running += (e.credit || 0) - (e.debit || 0);
    if (e.closingBalance !== running) {
      ops.push({
        updateOne: {
          filter: { _id: e._id },
          update: { $set: { closingBalance: running } },
        },
      });
    }
  }
  if (ops.length) await BankStatement.bulkWrite(ops);
};

// Normalise one incoming record into a clean document (without serialNo).
const buildDoc = (r, createdBy) => {
  const bank = VALID_BANKS.includes(r.bank) ? r.bank : null;
  if (!bank) throw new Error(`Invalid or missing bank: "${r.bank}"`);

  const credit = Math.max(0, Number(r.credit) || 0);
  const debit = Math.max(0, Number(r.debit) || 0);

  return {
    date: r.date ? new Date(r.date) : new Date(),
    description: (r.description || "").trim(),
    modeOfPayment: VALID_MODES.includes(r.modeOfPayment)
      ? r.modeOfPayment
      : "Cash",
    headOfAccount: (r.headOfAccount || "").trim(),
    bank,
    credit,
    debit,
    transactionId: (r.transactionId || "").trim(),
    created_by: createdBy,
  };
};

// POST /bankstatement
// Body can be a single record, an array of records, or { records: [...] }.
// This supports the "multiple transactions on one date" batch entry form.
exports.createEntry = async (req, res) => {
  try {
    const createdBy = req.body.created_by || req.admin?.username || "Admin";

    let records;
    if (Array.isArray(req.body.records)) records = req.body.records;
    else if (Array.isArray(req.body)) records = req.body;
    else records = [req.body];

    records = (records || []).filter(
      (r) => r && (r.bank || r.description || r.credit || r.debit),
    );

    if (records.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No records to save" });
    }

    let nextSerial = await getNextSerial();
    let docs;
    try {
      docs = records.map((r) => ({
        ...buildDoc(r, createdBy),
        serialNo: nextSerial++,
      }));
    } catch (validationErr) {
      return res
        .status(400)
        .json({ success: false, message: validationErr.message });
    }

    const created = await BankStatement.insertMany(docs);

    const banks = [...new Set(created.map((d) => d.bank))];
    for (const b of banks) await recalculateBank(b);

    const ids = created.map((d) => d._id);
    const refreshed = await BankStatement.find({ _id: { $in: ids } }).sort({
      date: 1,
      serialNo: 1,
    });

    console.log(`🏦 ${refreshed.length} bank statement record(s) created`);
    res.status(201).json({ success: true, data: refreshed });
  } catch (err) {
    console.error("Error creating bank statement entry:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create bank statement entry" });
  }
};

// GET /bankstatement  (optional ?bank=Apex)
exports.getEntries = async (req, res) => {
  try {
    const filter = {};
    if (req.query.bank && VALID_BANKS.includes(req.query.bank)) {
      filter.bank = req.query.bank;
    }
    const entries = await BankStatement.find(filter).sort({
      date: 1,
      serialNo: 1,
      createdAt: 1,
    });
    res.json({ success: true, data: entries });
  } catch (err) {
    console.error("Error fetching bank statement:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch bank statement" });
  }
};

// PUT /bankstatement/:id
exports.updateEntry = async (req, res) => {
  try {
    const existing = await BankStatement.findById(req.params.id);
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Entry not found" });
    }

    const updates = {};
    if (req.body.date !== undefined) updates.date = new Date(req.body.date);
    if (req.body.description !== undefined)
      updates.description = (req.body.description || "").trim();
    if (req.body.modeOfPayment !== undefined)
      updates.modeOfPayment = VALID_MODES.includes(req.body.modeOfPayment)
        ? req.body.modeOfPayment
        : existing.modeOfPayment;
    if (req.body.headOfAccount !== undefined)
      updates.headOfAccount = (req.body.headOfAccount || "").trim();
    if (req.body.bank !== undefined) {
      if (!VALID_BANKS.includes(req.body.bank)) {
        return res
          .status(400)
          .json({ success: false, message: `Invalid bank: "${req.body.bank}"` });
      }
      updates.bank = req.body.bank;
    }
    if (req.body.credit !== undefined)
      updates.credit = Math.max(0, Number(req.body.credit) || 0);
    if (req.body.debit !== undefined)
      updates.debit = Math.max(0, Number(req.body.debit) || 0);
    if (req.body.transactionId !== undefined)
      updates.transactionId = (req.body.transactionId || "").trim();

    const prevBank = existing.bank;

    const entry = await BankStatement.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true },
    );

    // Recompute both the old and (possibly changed) new bank.
    const banksToFix = new Set([prevBank, entry.bank]);
    for (const b of banksToFix) await recalculateBank(b);

    const refreshed = await BankStatement.findById(entry._id);
    res.json({ success: true, data: refreshed });
  } catch (err) {
    console.error("Error updating bank statement entry:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update entry" });
  }
};

// DELETE /bankstatement/:id
exports.deleteEntry = async (req, res) => {
  try {
    const entry = await BankStatement.findByIdAndDelete(req.params.id);
    if (!entry) {
      return res
        .status(404)
        .json({ success: false, message: "Entry not found" });
    }
    await recalculateBank(entry.bank);
    console.log(`🗑️ Bank statement entry deleted: #${entry.serialNo}`);
    res.json({ success: true, message: "Entry deleted" });
  } catch (err) {
    console.error("Error deleting bank statement entry:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete entry" });
  }
};

// GET /bankstatement/opening — returns the opening balance singleton
// (or zeros if it has never been set).
exports.getOpeningBalance = async (req, res) => {
  try {
    const ob = await BankOpeningBalance.findOne({ singleton: "OPENING" }).lean();
    const data = ob || {
      date: null,
      Apex: 0,
      HDFC: 0,
      Cash: 0,
      BDCC: 0,
    };
    res.json({ success: true, data });
  } catch (err) {
    console.error("Error fetching opening balance:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch opening balance" });
  }
};

// PUT /bankstatement/opening — upsert the opening balance singleton, then
// recompute every bank's running balance so it starts from the new opening.
exports.saveOpeningBalance = async (req, res) => {
  try {
    const updatedBy = req.body.updated_by || req.admin?.username || "Admin";
    const update = {
      singleton: "OPENING",
      date: req.body.date ? new Date(req.body.date) : new Date(),
      updated_by: updatedBy,
    };
    VALID_BANKS.forEach((b) => {
      update[b] = Math.max(0, Number(req.body[b]) || 0);
    });

    const ob = await BankOpeningBalance.findOneAndUpdate(
      { singleton: "OPENING" },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    // Opening balance feeds every bank's running balance — recompute all.
    for (const b of VALID_BANKS) await recalculateBank(b);

    console.log("🏦 Opening balance updated");
    res.json({ success: true, data: ob });
  } catch (err) {
    console.error("Error saving opening balance:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to save opening balance" });
  }
};