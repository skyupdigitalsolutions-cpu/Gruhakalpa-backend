const Member = require("../models/Member");
const SiteBooking = require("../models/SiteBooking");
const Receipt = require("../models/Receipt");
const MessageLog = require("../models/MessageLog");
const ReminderSettings = require("../models/ReminderSettings");
const sendMail = require("../utils/mailer");
const { sendWhatsAppTemplate } = require("../utils/msg91Whatsapp");
const {
  buildScheduleForBooking,
  computeClientRows,
} = require("../utils/paymentSchedule");

// If your approved WhatsApp template uses NAMED variables ({{name}} etc.),
// set MSG91_BODY_NAMES in .env to the comma-separated names in the SAME order
// as they appear in the template (customer_name, membership_id, installment,
// amount, due_date).
// Example: MSG91_BODY_NAMES=customer_name,membership_id,installment,amount,due_date
// Leave it unset to send positional variables (body_1..body_N) for {{1}} templates.
const WA_BODY_NAMES = process.env.MSG91_BODY_NAMES
  ? process.env.MSG91_BODY_NAMES.split(",").map((s) => s.trim()).filter(Boolean)
  : null;

// If your CONFIRMATION template is also NAMED (check its dashboard "Copy Code"),
// set MSG91_CONFIRMATION_BODY_NAMES in .env to its variable names in the SAME
// order as the confirmation values below (name, amount paid, remaining, date).
// Leave unset to send positional (body_1..body_N) for a {{1}} confirmation.
const WA_CONFIRMATION_BODY_NAMES = process.env.MSG91_CONFIRMATION_BODY_NAMES
  ? process.env.MSG91_CONFIRMATION_BODY_NAMES.split(",").map((s) => s.trim()).filter(Boolean)
  : null;

const inr = (n) => `Rs.${Number(n || 0).toLocaleString("en-IN")}`;
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN") : "";

// ── Shared data loader ─────────────────────────────────────────────────────
// Loads bookings + members + receipts and indexes them for the engine.
const loadData = async () => {
  const [bookings, members, receipts] = await Promise.all([
    SiteBooking.find({}).lean(),
    Member.find({}).lean(),
    Receipt.find({}).lean(),
  ]);

  const membersById = new Map();
  for (const m of members) membersById.set(m.membership_id, m);

  const receiptsByMember = new Map();
  for (const r of receipts) {
    const key = r.membershipid || r.seniority_no;
    if (!key) continue;
    if (!receiptsByMember.has(key)) receiptsByMember.set(key, []);
    receiptsByMember.get(key).push(r);
  }

  return { bookings, membersById, receiptsByMember };
};

// GET /payment-schedule?filter=upcoming|overdue|due_soon|all&search=
exports.getSchedule = async (req, res) => {
  try {
    const settings = await ReminderSettings.getSettings();
    const { bookings, membersById, receiptsByMember } = await loadData();

    let rows = computeClientRows(
      bookings,
      receiptsByMember,
      membersById,
      settings,
    );

    // Only clients that still owe something
    rows = rows.filter((r) => r.totalOutstanding > 0);

    const filter = (req.query.filter || "all").toLowerCase();
    if (filter === "overdue") {
      rows = rows.filter((r) => r.overallStatus === "overdue");
    } else if (filter === "upcoming") {
      rows = rows.filter(
        (r) =>
          r.overallStatus === "upcoming" || r.overallStatus === "due_soon",
      );
    } else if (filter === "due_soon") {
      rows = rows.filter((r) => r.overallStatus === "due_soon");
    }

    const q = (req.query.search || "").toLowerCase().trim();
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.name || "").toLowerCase().includes(q) ||
          (r.membership_id || "").toLowerCase().includes(q) ||
          String(r.mobile || "").includes(q) ||
          (r.projectname || "").toLowerCase().includes(q),
      );
    }

    // Nearest due first
    rows.sort((a, b) => {
      const ad = a.nextDue ? new Date(a.nextDue.dueDate) : Infinity;
      const bd = b.nextDue ? new Date(b.nextDue.dueDate) : Infinity;
      return ad - bd;
    });

    const summary = {
      clientsDue: rows.length,
      clientsOverdue: rows.filter((r) => r.overallStatus === "overdue").length,
      clientsDueSoon: rows.filter((r) => r.overallStatus === "due_soon").length,
      totalOutstanding: rows.reduce((s, r) => s + r.totalOutstanding, 0),
      totalOverdue: rows.reduce((s, r) => s + r.overdueAmount, 0),
    };

    res.json({ success: true, summary, data: rows });
  } catch (err) {
    console.error("❌ getSchedule error:", err);
    res.status(500).json({ success: false, message: "Failed to build schedule" });
  }
};

// GET /payment-schedule/:membership_id  — full detail for one client
exports.getClientDetail = async (req, res) => {
  try {
    const mid = req.params.membership_id;
    const settings = await ReminderSettings.getSettings();

    const member = await Member.findOne({ membership_id: mid }).lean();
    const booking = await SiteBooking.findOne({ membership_id: mid }).lean();

    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "No site booking for this member" });
    }

    const receipts = await Receipt.find({
      $or: [{ membershipid: mid }, { seniority_no: mid }],
    })
      .sort({ date: -1 })
      .lean();

    const schedule = buildScheduleForBooking(booking, receipts, settings);
    const messages = await MessageLog.find({ membership_id: mid })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({
      success: true,
      data: {
        member: member || null,
        booking,
        schedule,
        receipts,
        messages,
      },
    });
  } catch (err) {
    console.error("❌ getClientDetail error:", err);
    res.status(500).json({ success: false, message: "Failed to load client" });
  }
};

// GET /messages?membership_id=&channel=&status=
exports.getMessages = async (req, res) => {
  try {
    const filter = {};
    if (req.query.membership_id) filter.membership_id = req.query.membership_id;
    if (["whatsapp", "email"].includes(req.query.channel))
      filter.channel = req.query.channel;
    if (["sent", "failed"].includes(req.query.status))
      filter.status = req.query.status;

    const messages = await MessageLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    res.json({ success: true, data: messages });
  } catch (err) {
    console.error("❌ getMessages error:", err);
    res.status(500).json({ success: false, message: "Failed to load messages" });
  }
};

// ── Core send helpers (also used by the scheduler) ─────────────────────────

// Friendly phrase for how far off a due date is, given the milestone tag.
const timingPhrase = (milestone) => {
  switch (milestone) {
    case "30d":
      return "due in about a month";
    case "15d":
      return "due in 15 days";
    case "7d":
      return "due in 7 days";
    case "1d":
      return "due tomorrow";
    case "0d":
      return "due today";
    default:
      return "coming up";
  }
};

// Build the human-readable reminder text (used for email + logged for whatsapp).
const buildReminderText = (row, bucket, kind, milestone) => {
  const overdue = kind === "overdue";
  const when = overdue
    ? "is now past its due date"
    : `is ${timingPhrase(milestone)}`;
  return `Dear ${row.name},

This is a ${overdue ? "payment overdue notice" : "friendly payment reminder"} from The Gruhakalpa Housing Co-Operative Society Ltd.

Membership ID : ${row.membership_id}
${bucket.label}   : ${inr(bucket.outstanding)}
Due Date      : ${fmtDate(bucket.dueDate)}

Your ${bucket.label} payment ${when}.${
    overdue
      ? " Kindly clear it at the earliest to avoid further notices."
      : " Kindly ensure the payment is made on or before the due date."
  }

For any queries please contact the society office.

Best Regards,
The Gruhakalpa Housing Co-Operative Society Ltd.`;
};

// Send one reminder over one channel and write a MessageLog row.
const sendOne = async ({
  row,
  bucket,
  channel,
  kind,
  milestone = "",
  settings,
  sentBy,
}) => {
  const isOverdue = kind === "overdue";
  const text = buildReminderText(row, bucket, kind, milestone);

  const logBase = {
    membership_id: row.membership_id,
    name: row.name,
    channel,
    kind,
    milestone,
    dueLabel: bucket.label,
    amount: bucket.outstanding,
    dueDate: bucket.dueDate,
    body: text,
    sentBy: sentBy || "auto",
  };

  if (channel === "whatsapp") {
    const wa = settings.whatsapp || {};
    const templateName = isOverdue
      ? wa.templateOverdue || wa.templateUpcoming
      : wa.templateUpcoming;

    const result = await sendWhatsAppTemplate({
      to: row.mobile,
      templateName,
      integratedNumber: wa.integratedNumber,
      languageCode: wa.languageCode || "en",
      // NAMED variables, matched by name (order here just pairs value↔name).
      // IMPORTANT: the order MUST match the variable order in the approved
      // MSG91 template, because MSG91 falls back to POSITIONAL matching even
      // for named templates. Template order is:
      //   customer_name, membership_id, installment, amount, due_date
      bodyValues: [
        row.name, // customer_name
        row.membership_id, // membership_id
        bucket.label, // installment
        inr(bucket.outstanding), // amount
        fmtDate(bucket.dueDate), // due_date
      ],
      // The approved template uses NAMED variables. MSG91 needs each sent as
      // "body_<name>" with a parameter_name (handled in msg91Whatsapp.js).
      // Override the names via MSG91_BODY_NAMES in .env only if you change the
      // template. Names MUST exactly match the {{...}} in the template body,
      // AND the order MUST match the template's variable order.
      bodyNames: WA_BODY_NAMES || [
        "customer_name",
        "membership_id",
        "installment",
        "amount",
        "due_date",
      ],
    });

    return MessageLog.create({
      ...logBase,
      to: String(row.mobile || ""),
      provider: "msg91",
      status: result.success ? "sent" : "failed",
      error: result.success ? "" : result.error || "",
      providerMessageId: result.messageId || "",
    });
  }

  // channel === "email" (Brevo)
  const subject = isOverdue
    ? `Payment Overdue - ${bucket.label}`
    : `Payment Reminder - ${bucket.label}`;

  let status = "sent";
  let error = "";
  let providerMessageId = "";
  try {
    if (!row.email) throw new Error("No email address on file for this member");
    const r = await sendMail(row.email, subject, text);
    providerMessageId = r?.messageId || "";
  } catch (e) {
    status = "failed";
    error = e.message;
  }

  return MessageLog.create({
    ...logBase,
    to: row.email || "",
    subject,
    provider: "brevo",
    status,
    error,
    providerMessageId,
  });
};

// ── Payment confirmation (fired when a receipt is created) ─────────────────

const buildConfirmationText = (row, amountPaid, remaining, date) =>
  `Dear ${row.name},

We have received your payment. Thank you!

Membership ID   : ${row.membership_id}
Amount Received : ${inr(amountPaid)}
Date            : ${fmtDate(date)}
Balance Remaining : ${inr(remaining)}

${
  remaining > 0
    ? "We will remind you before your next installment is due."
    : "Your payments are fully cleared. Thank you!"
}

Best Regards,
The Gruhakalpa Housing Co-Operative Society Ltd.`;

const sendConfirmationOne = async ({
  row,
  channel,
  amountPaid,
  remaining,
  date,
  settings,
  sentBy,
}) => {
  const text = buildConfirmationText(row, amountPaid, remaining, date);
  const logBase = {
    membership_id: row.membership_id,
    name: row.name,
    channel,
    kind: "confirmation",
    milestone: "confirmation",
    dueLabel: "Payment received",
    amount: amountPaid,
    body: text,
    sentBy: sentBy || "auto",
  };

  if (channel === "whatsapp") {
    const wa = settings.whatsapp || {};
    const result = await sendWhatsAppTemplate({
      to: row.mobile,
      templateName: wa.templateConfirmation,
      integratedNumber: wa.integratedNumber,
      languageCode: wa.languageCode || "en",
      // body_1..body_4 => name, amount paid, remaining balance, date
      bodyValues: [
        row.name,
        inr(amountPaid),
        inr(remaining),
        fmtDate(date),
      ],
      // Positional by default. If the confirmation template is NAMED, set
      // MSG91_CONFIRMATION_BODY_NAMES in .env (see note at top of file).
      bodyNames: WA_CONFIRMATION_BODY_NAMES || null,
    });
    return MessageLog.create({
      ...logBase,
      to: String(row.mobile || ""),
      provider: "msg91",
      status: result.success ? "sent" : "failed",
      error: result.success ? "" : result.error || "",
      providerMessageId: result.messageId || "",
    });
  }

  // email
  const subject = "Payment Received - Thank You";
  let status = "sent";
  let error = "";
  let providerMessageId = "";
  try {
    if (!row.email) throw new Error("No email address on file for this member");
    const r = await sendMail(row.email, subject, text);
    providerMessageId = r?.messageId || "";
  } catch (e) {
    status = "failed";
    error = e.message;
  }
  return MessageLog.create({
    ...logBase,
    to: row.email || "",
    subject,
    provider: "brevo",
    status,
    error,
    providerMessageId,
  });
};

// Called from the receipt controller right after a receipt is saved.
// Sends a "payment received" confirmation over each enabled channel.
const sendPaymentConfirmation = async ({ membership_id, amountPaid }) => {
  try {
    const settings = await ReminderSettings.getSettings();
    const booking = await SiteBooking.findOne({ membership_id }).lean();
    if (!booking) return;
    const member = await Member.findOne({ membership_id }).lean();
    const receipts = await Receipt.find({
      $or: [{ membershipid: membership_id }, { seniority_no: membership_id }],
    }).lean();

    const schedule = buildScheduleForBooking(booking, receipts, settings);
    const remaining = schedule.totalOutstanding;

    const row = {
      membership_id,
      name: booking.name || member?.name || "",
      mobile: member?.mobile || booking.mobilenumber || null,
      email: member?.email || "",
    };

    const channels = [];
    if (settings.whatsapp?.enabled) channels.push("whatsapp");
    if (settings.email?.enabled) channels.push("email");

    for (const ch of channels) {
      await sendConfirmationOne({
        row,
        channel: ch,
        amountPaid: Number(amountPaid || 0),
        remaining,
        date: new Date(),
        settings,
        sentBy: "auto",
      });
    }
  } catch (err) {
    console.error("⚠️ sendPaymentConfirmation failed:", err.message);
  }
};

exports.sendPaymentConfirmation = sendPaymentConfirmation;

// POST /reminders/send  { membership_id, channel: whatsapp|email|both, dueLabel? }
exports.sendReminder = async (req, res) => {
  try {
    const { membership_id, channel = "whatsapp", dueLabel } = req.body;
    if (!membership_id)
      return res
        .status(400)
        .json({ success: false, message: "membership_id is required" });

    const settings = await ReminderSettings.getSettings();
    const booking = await SiteBooking.findOne({ membership_id }).lean();
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "No site booking for this member" });

    const member = await Member.findOne({ membership_id }).lean();
    const receipts = await Receipt.find({
      $or: [{ membershipid: membership_id }, { seniority_no: membership_id }],
    }).lean();

    const schedule = buildScheduleForBooking(booking, receipts, settings);

    // Pick the bucket: named one if provided, else the next due.
    let bucket = null;
    if (dueLabel) {
      bucket = schedule.buckets.find((b) => b.label === dueLabel);
    }
    if (!bucket) bucket = schedule.nextDue;
    if (!bucket || bucket.outstanding <= 0)
      return res.json({
        success: true,
        message: "Nothing outstanding for this client — no reminder sent.",
      });

    const row = {
      membership_id,
      name: booking.name || member?.name || "",
      mobile: member?.mobile || booking.mobilenumber || null,
      email: member?.email || "",
    };
    const kind = bucket.status === "overdue" ? "overdue" : "upcoming";
    const sentBy = req.admin?.username || req.admin?.email || "admin";

    const channels =
      channel === "both" ? ["whatsapp", "email"] : [channel];
    const logs = [];
    for (const ch of channels) {
      logs.push(
        await sendOne({ row, bucket, channel: ch, kind, settings, sentBy }),
      );
    }

    const anyFailed = logs.some((l) => l.status === "failed");
    res.json({
      success: !anyFailed,
      message: anyFailed
        ? "Some messages failed — see the details."
        : "Reminder sent.",
      data: logs,
    });
  } catch (err) {
    console.error("❌ sendReminder error:", err);
    res.status(500).json({ success: false, message: "Failed to send reminder" });
  }
};

// The auto-run routine — shared by the scheduler and the run-now endpoint.
// For each client's NEXT unpaid installment it decides what (if anything) to
// send today:
//   • before due  -> the tightest un-sent milestone (1mo, 15d, 7d, 1d, due day)
//   • after due   -> an overdue notice, repeated every `overdueEveryDays`
// Each milestone is sent at most once per installment per channel, so it's
// safe to run daily (and robust to an occasional missed day).
const runDueReminders = async ({ sentBy = "auto" } = {}) => {
  const settings = await ReminderSettings.getSettings();
  const { bookings, membersById, receiptsByMember } = await loadData();
  const rows = computeClientRows(
    bookings,
    receiptsByMember,
    membersById,
    settings,
  );

  const channels = [];
  if (settings.whatsapp?.enabled) channels.push("whatsapp");
  if (settings.email?.enabled) channels.push("email");

  // Pre-due offsets, largest first (e.g. 30,15,7,1,0)
  const offsets = (
    settings.preDueOffsets && settings.preDueOffsets.length
      ? settings.preDueOffsets
      : [30, 15, 7, 1, 0]
  )
    .map(Number)
    .filter((n) => !isNaN(n))
    .sort((a, b) => b - a);

  const overdueEvery = (settings.overdueEveryDays || 7) * 24 * 60 * 60 * 1000;
  const now = Date.now();

  let attempted = 0;
  let sent = 0;
  let skipped = 0;

  const alreadySent = async (mid, ch, label, milestone) =>
    !!(await MessageLog.findOne({
      membership_id: mid,
      channel: ch,
      dueLabel: label,
      milestone,
      status: "sent",
    }).lean());

  for (const row of rows) {
    // Act only on the next unpaid installment ("next installment/payment").
    const bucket = row.nextDue;
    if (!bucket || bucket.outstanding <= 0) continue;

    const days = bucket.daysUntilDue; // >=0 upcoming, <0 overdue
    const rowInfo = {
      membership_id: row.membership_id,
      name: row.name,
      mobile: row.mobile,
      email: row.email,
    };

    for (const ch of channels) {
      if (days >= 0) {
        // Pick the tightest milestone we've reached (days <= offset) that we
        // haven't sent yet for this installment/channel. Send just that one.
        const reachedAsc = offsets
          .filter((o) => days <= o)
          .sort((a, b) => a - b); // smallest (tightest) first
        let toSend = null;
        for (const o of reachedAsc) {
          const tag = `${o}d`;
          // eslint-disable-next-line no-await-in-loop
          if (!(await alreadySent(row.membership_id, ch, bucket.label, tag))) {
            toSend = { offset: o, tag };
            break;
          }
        }
        if (!toSend) {
          skipped++;
          continue;
        }
        attempted++;
        const log = await sendOne({
          row: rowInfo,
          bucket,
          channel: ch,
          kind: "upcoming",
          milestone: toSend.tag,
          settings,
          sentBy,
        });
        if (log.status === "sent") sent++;
      } else {
        // Overdue: repeat every `overdueEveryDays`. Send if no overdue notice
        // for this installment/channel within that window.
        const recentOverdue = await MessageLog.findOne({
          membership_id: row.membership_id,
          channel: ch,
          dueLabel: bucket.label,
          milestone: "overdue",
          status: "sent",
          createdAt: { $gte: new Date(now - overdueEvery) },
        }).lean();
        if (recentOverdue) {
          skipped++;
          continue;
        }
        attempted++;
        const log = await sendOne({
          row: rowInfo,
          bucket,
          channel: ch,
          kind: "overdue",
          milestone: "overdue",
          settings,
          sentBy,
        });
        if (log.status === "sent") sent++;
      }
    }
  }

  settings.lastRunAt = new Date();
  await settings.save();

  return { attempted, sent, skipped, channels, clients: rows.length };
};

exports.runDueReminders = runDueReminders;

// POST /reminders/run-due  — manual trigger of the auto routine.
// Auth: normal admin token OR ?secret=CRON_SECRET (for an external cron pinger).
exports.runDueEndpoint = async (req, res) => {
  try {
    const secret = req.query.secret || req.body?.secret;
    const hasSecret =
      process.env.CRON_SECRET && secret === process.env.CRON_SECRET;

    if (!hasSecret && !req.admin) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized" });
    }

    const settings = await ReminderSettings.getSettings();
    if (!settings.autoEnabled && hasSecret && !req.admin) {
      return res.json({
        success: true,
        message: "Automation is disabled — nothing sent.",
      });
    }

    const result = await runDueReminders({
      sentBy: req.admin?.username || (hasSecret ? "cron" : "admin"),
    });
    res.json({ success: true, message: "Reminder run complete.", result });
  } catch (err) {
    console.error("❌ runDue error:", err);
    res.status(500).json({ success: false, message: "Failed to run reminders" });
  }
};

// GET /reminder-settings
exports.getSettings = async (req, res) => {
  try {
    const settings = await ReminderSettings.getSettings();
    res.json({ success: true, data: settings });
  } catch (err) {
    console.error("❌ getSettings error:", err);
    res.status(500).json({ success: false, message: "Failed to load settings" });
  }
};

// PUT /reminder-settings
exports.updateSettings = async (req, res) => {
  try {
    const settings = await ReminderSettings.getSettings();
    const b = req.body || {};

    if (b.autoEnabled !== undefined) settings.autoEnabled = !!b.autoEnabled;
    if (b.reminderWindowDays !== undefined)
      settings.reminderWindowDays = Number(b.reminderWindowDays) || 0;
    if (b.intervalMonths !== undefined)
      settings.intervalMonths = Number(b.intervalMonths) || 1;
    if (b.resendGapDays !== undefined)
      settings.resendGapDays = Number(b.resendGapDays) || 0;
    if (b.overdueEveryDays !== undefined)
      settings.overdueEveryDays = Number(b.overdueEveryDays) || 7;
    if (b.preDueOffsets !== undefined) {
      const arr = (
        Array.isArray(b.preDueOffsets)
          ? b.preDueOffsets
          : String(b.preDueOffsets).split(",")
      )
        .map((n) => parseInt(n, 10))
        .filter((n) => !isNaN(n) && n >= 0)
        .sort((x, y) => y - x);
      if (arr.length) settings.preDueOffsets = arr;
    }

    if (b.whatsapp) {
      settings.whatsapp = {
        enabled: !!b.whatsapp.enabled,
        // Strip whitespace so a pasted "\t 9190..." can't break sending.
        integratedNumber: String(b.whatsapp.integratedNumber || "").replace(/\s+/g, ""),
        templateUpcoming: b.whatsapp.templateUpcoming || "",
        templateOverdue: b.whatsapp.templateOverdue || "",
        templateConfirmation: b.whatsapp.templateConfirmation || "",
        languageCode: b.whatsapp.languageCode || "en",
      };
    }
    if (b.email) {
      settings.email = { enabled: !!b.email.enabled };
    }

    await settings.save();
    res.json({ success: true, message: "Settings saved.", data: settings });
  } catch (err) {
    console.error("❌ updateSettings error:", err);
    res.status(500).json({ success: false, message: "Failed to save settings" });
  }
};