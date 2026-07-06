/**
 * reminderService.js
 *
 * For a single site booking, works out whether a payment reminder is due today
 * and, if so, sends it over BOTH channels:
 *   - WhatsApp via MSG91 (template message)
 *   - Email via Brevo (plain text, generated in code)
 *
 * It then records the reminder key on the booking (remindersSent[]) so the same
 * reminder is never sent twice.
 */

const Member = require("../models/Member");
const Payment = require("../models/Payment");
const SiteBooking = require("../models/SiteBooking");
const { evaluateBooking } = require("./paymentSchedule");
const { sendWhatsApp } = require("./whatsapp");
const sendMail = require("./mailer");

const SOCIETY_NAME = "The Gruhakalpa Housing Co-operative Society Ltd.";

/** Sum all payments made against a membership id. */
async function getTotalPaid(membershipId) {
  const payments = await Payment.find({ membershipid: membershipId }).lean();
  return payments.reduce((sum, p) => sum + (Number(p.amountpaid) || 0), 0);
}

/** Look up the member's email + mobile from the membership collection. */
async function getContact(booking) {
  const member = await Member.findOne({
    membership_id: booking.membership_id,
  }).lean();

  return {
    email: member?.email || null,
    // Prefer the member record's mobile; fall back to the booking's mobile.
    mobile: member?.mobile || booking.mobilenumber || null,
  };
}

/** Build the email subject + body for a reminder. */
function buildEmail(info) {
  const overdue = info.type === "overdue";
  const subject = overdue
    ? `Overdue Payment Reminder - ${info.installmentLabel} (${info.membershipId})`
    : `Payment Reminder - ${info.installmentLabel} (${info.membershipId})`;

  const body = overdue
    ? `Dear ${info.name},

This is a reminder from ${SOCIETY_NAME}.

Your payment for "${info.installmentLabel}" of your booking (${info.projectName}) was due on ${info.dueDateFormatted} and is now OVERDUE.

  Membership ID    : ${info.membershipId}
  Pending amount   : Rs. ${info.pendingAmount.toLocaleString("en-IN")}
  Total outstanding: Rs. ${info.totalOutstanding.toLocaleString("en-IN")}
  Original due date: ${info.dueDateFormatted}

Please clear the pending amount immediately to avoid penalty. For any assistance, kindly contact the society office.

Regards,
${SOCIETY_NAME}`
    : `Dear ${info.name},

This is a reminder from ${SOCIETY_NAME}.

Your payment for "${info.installmentLabel}" of your booking (${info.projectName}) is due by ${info.dueDateFormatted}.

  Membership ID    : ${info.membershipId}
  Pending amount   : Rs. ${info.pendingAmount.toLocaleString("en-IN")}
  Total outstanding: Rs. ${info.totalOutstanding.toLocaleString("en-IN")}
  Due date         : ${info.dueDateFormatted}

Kindly complete the payment at the earliest. For any queries, contact the society office.

Regards,
${SOCIETY_NAME}`;

  return { subject, body };
}

/**
 * Process one booking. Returns a small result object for logging.
 * Set dryRun=true to compute what WOULD be sent without sending or recording.
 */
async function processBooking(booking, { today = new Date(), dryRun = false } = {}) {
  // Skip cancelled / inactive bookings
  if (booking.cancelled || booking.status !== "active") {
    return { membershipId: booking.membership_id, skipped: "inactive" };
  }

  const totalPaid = await getTotalPaid(booking.membership_id);
  const sentKeys = (booking.remindersSent || []).map((r) => r.key);

  const info = evaluateBooking(booking, totalPaid, sentKeys, today);
  if (!info) {
    return { membershipId: booking.membership_id, action: "none" };
  }

  if (dryRun) {
    return {
      membershipId: booking.membership_id,
      action: "would-send",
      reminderKey: info.reminderKey,
      type: info.type,
      pendingAmount: info.pendingAmount,
      dueDate: info.dueDateFormatted,
    };
  }

  const contact = await getContact(booking);
  const channels = [];

  // ---- WhatsApp (MSG91) ----
  if (contact.mobile) {
    const wa = await sendWhatsApp({
      to: contact.mobile,
      templateType: info.type === "overdue" ? "overdue" : "reminder",
      variables: {
        customer_name: info.name,
        amount: info.pendingAmount,
        installment: info.installmentLabel,
        membership_id: info.membershipId,
        due_date: info.dueDateFormatted,
      },
    });
    channels.push({ channel: "whatsapp", ...wa });
  } else {
    channels.push({ channel: "whatsapp", success: false, error: "no mobile" });
  }

  // ---- Email (Brevo) ----
  if (contact.email) {
    const { subject, body } = buildEmail(info);
    try {
      await sendMail(contact.email, subject, body);
      channels.push({ channel: "email", success: true });
    } catch (err) {
      channels.push({ channel: "email", success: false, error: err.message });
    }
  } else {
    channels.push({ channel: "email", success: false, error: "no email" });
  }

  // Record the reminder so it is never resent, as long as at least one channel
  // succeeded. If both failed, we leave it unrecorded so it retries next run.
  const anySuccess = channels.some((c) => c.success);
  if (anySuccess) {
    await SiteBooking.updateOne(
      { _id: booking._id },
      {
        $push: {
          remindersSent: {
            key: info.reminderKey,
            sentAt: new Date(),
            type: info.type,
            pendingAmount: info.pendingAmount,
            channels: channels.map((c) => `${c.channel}:${c.success ? "ok" : "fail"}`),
          },
        },
      },
    );
  }

  return {
    membershipId: booking.membership_id,
    action: anySuccess ? "sent" : "failed",
    reminderKey: info.reminderKey,
    type: info.type,
    pendingAmount: info.pendingAmount,
    channels,
  };
}

/**
 * Run reminders across ALL active bookings. Returns a summary array.
 */
async function runAllReminders({ today = new Date(), dryRun = false } = {}) {
  const bookings = await SiteBooking.find({
    cancelled: { $ne: true },
    status: "active",
  });

  const results = [];
  for (const booking of bookings) {
    try {
      results.push(await processBooking(booking, { today, dryRun }));
    } catch (err) {
      console.error(
        `❌ Reminder error for ${booking.membership_id}:`,
        err.message,
      );
      results.push({
        membershipId: booking.membership_id,
        action: "error",
        error: err.message,
      });
    }
  }

  const sent = results.filter((r) => r.action === "sent").length;
  console.log(
    `📨 Reminder run complete: ${sent} sent / ${results.length} bookings checked`,
  );
  return results;
}

module.exports = { processBooking, runAllReminders, getTotalPaid };