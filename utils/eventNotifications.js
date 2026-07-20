// ─────────────────────────────────────────────────────────────────────────
// Event notifications
//
// Fires a WhatsApp (MSG91) + Email (Brevo) message automatically when a record
// is created: new member, site booking, fixed deposit, recurring deposit,
// receipt, and FD certificate.
//
// Design notes:
//  • Every function is FIRE-AND-FORGET. Controllers call it inside setImmediate
//    (or just `.catch()`) AFTER they've already sent their HTTP response, so a
//    messaging failure can never break the create request or slow it down.
//  • Channels respect the Automation Setup toggles (settings.whatsapp.enabled /
//    settings.email.enabled) and the master `eventNotificationsEnabled` switch.
//  • Receipt and FD-certificate messages attach the PDF:
//       – WhatsApp: via the template's DOCUMENT header (public Cloudinary URL)
//       – Email:    via base64 attachment (utils/mailer.js already supports it)
//    The other events have no PDF, so they send text only.
//  • Every attempt is written to MessageLog (kind:"event") for the Messages tab.
// ─────────────────────────────────────────────────────────────────────────

const ReminderSettings = require("../models/ReminderSettings");
const MessageLog = require("../models/MessageLog");
const Member = require("../models/Member");
const { sendWhatsAppTemplate } = require("./msg91Whatsapp");
const sendMail = require("./mailer");

const SOCIETY = "The Gruhakalpa Housing Co-Operative Society Ltd.";

const inr = (n) => `Rs.${Number(n || 0).toLocaleString("en-IN")}`;

const fmtDate = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt)) return "";
  return dt.toLocaleDateString("en-IN");
};

// Resolve the recipient's contact details. Anything the caller already knows
// takes priority; missing bits are looked up from the Member record.
const resolveContact = async ({ membership_id, name, mobile, email }) => {
  let member = null;
  if ((!mobile || !email || !name) && membership_id) {
    try {
      member = await Member.findOne({ membership_id }).lean();
    } catch (_) {
      member = null;
    }
  }
  return {
    name: name || member?.name || "Member",
    mobile:
      mobile ||
      member?.mobile ||
      member?.mobilenumber ||
      member?.mobile_number ||
      "",
    email: email || member?.email || "",
  };
};

// Core sender used by every event. Sends WhatsApp + email per the enabled
// channels and logs each attempt. Never throws.
//
// @param opts.kindLabel     short human label used in logs ("Receipt" etc.)
// @param opts.templateName  MSG91 template for this event (may be blank → skip)
// @param opts.bodyValues    ordered WhatsApp body variable values
// @param opts.bodyNames     matching named-variable list (same order)
// @param opts.documentUrl   public PDF url to attach on WhatsApp (optional)
// @param opts.documentFilename filename for the attached PDF (optional)
// @param opts.emailSubject  email subject
// @param opts.emailBody     email plain-text body
// @param opts.pdfBase64     base64 PDF for the email attachment (optional)
// @param opts.pdfFilename   filename for the email attachment (optional)
const dispatch = async ({
  membership_id,
  name,
  mobile,
  email,
  kindLabel,
  templateName,
  bodyValues = [],
  bodyNames = null,
  documentUrl = null,
  documentFilename = null,
  emailSubject,
  emailBody,
  pdfBase64 = null,
  pdfFilename = null,
}) => {
  let settings;
  try {
    settings = await ReminderSettings.getSettings();
  } catch (e) {
    console.error("⚠️ event notify: could not load settings:", e.message);
    return;
  }

  if (settings.eventNotificationsEnabled === false) {
    console.log(`ℹ️ Event notifications disabled — skipping ${kindLabel}.`);
    return;
  }

  const contact = await resolveContact({ membership_id, name, mobile, email });
  const wa = settings.whatsapp || {};

  const logBase = {
    membership_id: membership_id || "",
    name: contact.name,
    kind: "event",
    milestone: kindLabel.toLowerCase().replace(/\s+/g, "_"),
    sentBy: "auto",
  };

  // ── WhatsApp ──
  if (wa.enabled && templateName && contact.mobile) {
    try {
      const result = await sendWhatsAppTemplate({
        to: contact.mobile,
        templateName,
        integratedNumber: wa.integratedNumber,
        languageCode: wa.languageCode || "en",
        bodyValues,
        bodyNames,
        documentUrl,
        documentFilename,
      });
      await MessageLog.create({
        ...logBase,
        channel: "whatsapp",
        to: String(contact.mobile),
        provider: "msg91",
        body: bodyValues.join(" | "),
        status: result.success ? "sent" : "failed",
        error: result.success ? "" : result.error || "",
        providerMessageId: result.messageId || "",
      });
    } catch (e) {
      console.error(`⚠️ ${kindLabel} WhatsApp failed:`, e.message);
      await MessageLog.create({
        ...logBase,
        channel: "whatsapp",
        to: String(contact.mobile || ""),
        provider: "msg91",
        status: "failed",
        error: e.message,
      }).catch(() => {});
    }
  } else if (wa.enabled && templateName && !contact.mobile) {
    console.warn(`⚠️ ${kindLabel}: no mobile number — WhatsApp skipped.`);
  }

  // ── Email ──
  const emailOn = !settings.email || settings.email.enabled !== false;
  if (emailOn && contact.email) {
    try {
      const result = await sendMail(
        contact.email,
        emailSubject,
        emailBody,
        pdfBase64,
        pdfFilename,
      );
      await MessageLog.create({
        ...logBase,
        channel: "email",
        to: contact.email,
        provider: "brevo",
        subject: emailSubject,
        body: emailBody,
        status: result?.success ? "sent" : "sent",
        providerMessageId: result?.messageId || "",
      });
    } catch (e) {
      console.error(`⚠️ ${kindLabel} email failed:`, e.message);
      await MessageLog.create({
        ...logBase,
        channel: "email",
        to: contact.email,
        provider: "brevo",
        subject: emailSubject,
        status: "failed",
        error: e.message,
      }).catch(() => {});
    }
  }
};

// ── 1. New member added ──────────────────────────────────────────────────
const notifyMemberAdded = async (member) => {
  const membership_id = member.membership_id;
  const name = member.name;
  await dispatch({
    membership_id,
    name,
    mobile: member.mobile || member.mobilenumber,
    email: member.email,
    kindLabel: "Member Added",
    templateName: (await ReminderSettings.getSettings()).whatsapp
      ?.templateMemberAdded,
    // Template vars: customer_name, membership_id, membership_type
    bodyValues: [name, membership_id, member.membershiptype || "Member"],
    bodyNames: ["customer_name", "membership_id", "membership_type"],
    emailSubject: `Welcome to ${SOCIETY}`,
    emailBody:
      `Dear ${name},\n\n` +
      `Welcome to ${SOCIETY}. Your membership has been created successfully.\n\n` +
      `Membership ID: ${membership_id}\n` +
      `Membership Type: ${member.membershiptype || "Member"}\n\n` +
      `Please keep your Membership ID safe for all future correspondence.\n\n` +
      `Team Gruhakalpa`,
  });
};

// ── 2. Site booking created ──────────────────────────────────────────────
const notifySiteBooking = async (booking) => {
  const membership_id = booking.membership_id;
  const name = booking.name;
  await dispatch({
    membership_id,
    name,
    mobile: booking.mobilenumber,
    kindLabel: "Site Booking",
    templateName: (await ReminderSettings.getSettings()).whatsapp
      ?.templateSiteBooking,
    // Template vars: customer_name, membership_id, project_name, dimension, amount
    bodyValues: [
      name,
      membership_id,
      booking.projectname || "",
      booking.sitedimension || "",
      inr(booking.totalamount),
    ],
    bodyNames: [
      "customer_name",
      "membership_id",
      "project_name",
      "dimension",
      "amount",
    ],
    emailSubject: `Site Booking Confirmed — ${SOCIETY}`,
    emailBody:
      `Dear ${name},\n\n` +
      `Your site booking has been created successfully.\n\n` +
      `Membership ID: ${membership_id}\n` +
      `Project: ${booking.projectname || "-"}\n` +
      `Site Dimension: ${booking.sitedimension || "-"}\n` +
      `Total Amount: ${inr(booking.totalamount)}\n\n` +
      `Thank you for choosing ${SOCIETY}.\n\n` +
      `Team Gruhakalpa`,
  });
};

// ── 3. Fixed Deposit created ─────────────────────────────────────────────
const notifyFdCreated = async (fd) => {
  const membership_id = fd.membershipId;
  const name = fd.name;
  await dispatch({
    membership_id,
    name,
    mobile: fd.mobilenumber,
    kindLabel: "FD Created",
    templateName: (await ReminderSettings.getSettings()).whatsapp
      ?.templateFdCreated,
    // Template vars: customer_name, fdr_no, amount, tenure, maturity_date
    bodyValues: [
      name,
      fd.fdrNo || "",
      inr(fd.amount),
      `${fd.tenureMonths || 12} months`,
      fmtDate(fd.maturityDate),
    ],
    bodyNames: [
      "customer_name",
      "fdr_no",
      "amount",
      "tenure",
      "maturity_date",
    ],
    emailSubject: `Fixed Deposit Created — ${SOCIETY}`,
    emailBody:
      `Dear ${name},\n\n` +
      `Your Fixed Deposit has been created successfully.\n\n` +
      `FDR No: ${fd.fdrNo || "-"}\n` +
      `Amount: ${inr(fd.amount)}\n` +
      `Tenure: ${fd.tenureMonths || 12} months\n` +
      `Interest Rate: ${fd.interestRate || 0}% p.a.\n` +
      `Maturity Date: ${fmtDate(fd.maturityDate) || "-"}\n\n` +
      `Team Gruhakalpa`,
  });
};

// ── 4. Recurring Deposit created ─────────────────────────────────────────
const notifyRdCreated = async (rd) => {
  const membership_id = rd.membershipId;
  const name = rd.name;
  await dispatch({
    membership_id,
    name,
    mobile: rd.mobilenumber,
    kindLabel: "RD Created",
    templateName: (await ReminderSettings.getSettings()).whatsapp
      ?.templateRdCreated,
    // Template vars: customer_name, rd_no, monthly_amount, tenure, maturity_date
    bodyValues: [
      name,
      rd.rdNo || "",
      inr(rd.monthlyAmount),
      `${rd.tenureMonths || 12} months`,
      fmtDate(rd.maturityDate),
    ],
    bodyNames: [
      "customer_name",
      "rd_no",
      "monthly_amount",
      "tenure",
      "maturity_date",
    ],
    emailSubject: `Recurring Deposit Created — ${SOCIETY}`,
    emailBody:
      `Dear ${name},\n\n` +
      `Your Recurring Deposit has been created successfully.\n\n` +
      `RD No: ${rd.rdNo || "-"}\n` +
      `Monthly Amount: ${inr(rd.monthlyAmount)}\n` +
      `Tenure: ${rd.tenureMonths || 12} months\n` +
      `Interest Rate: ${rd.interestRate || 0}% p.a.\n` +
      `Maturity Date: ${fmtDate(rd.maturityDate) || "-"}\n\n` +
      `Team Gruhakalpa`,
  });
};

// ── 5. Receipt created (PDF attached) ────────────────────────────────────
// pdfUrl   = public Cloudinary link (WhatsApp document header)
// pdfBase64/pdfFilename = for the email attachment (already available at create)
const notifyReceipt = async ({
  membership_id,
  name,
  mobile,
  email,
  receiptNo,
  amount,
  paymentType,
  pdfUrl,
  pdfBase64,
  pdfFilename,
}) => {
  const filename = pdfFilename || `Receipt_${receiptNo || ""}.pdf`;
  await dispatch({
    membership_id,
    name,
    mobile,
    email,
    kindLabel: "Receipt",
    templateName: (await ReminderSettings.getSettings()).whatsapp
      ?.templateReceipt,
    // Template vars: customer_name, receipt_no, amount, payment_type
    bodyValues: [name, String(receiptNo || ""), inr(amount), paymentType || "Payment"],
    bodyNames: ["customer_name", "receipt_no", "amount", "payment_type"],
    documentUrl: pdfUrl || null,
    documentFilename: filename,
    emailSubject: `Payment Receipt ${receiptNo || ""} — ${SOCIETY}`,
    emailBody:
      `Dear ${name},\n\n` +
      `Please find attached your payment receipt.\n\n` +
      `Receipt No: ${receiptNo || "-"}\n` +
      `Amount: ${inr(amount)}\n` +
      `Towards: ${paymentType || "Payment"}\n\n` +
      `Thank you for your payment.\n\n` +
      `Team Gruhakalpa`,
    pdfBase64: pdfBase64 || null,
    pdfFilename: filename,
  });
};

// ── 6. FD Certificate generated (PDF attached) ───────────────────────────
const notifyFdCertificate = async ({
  membership_id,
  name,
  mobile,
  email,
  fdrNo,
  amount,
  maturityDate,
  pdfUrl,
  pdfBase64,
  pdfFilename,
}) => {
  const filename = pdfFilename || `FDCertificate_${fdrNo || ""}.pdf`;
  await dispatch({
    membership_id,
    name,
    mobile,
    email,
    kindLabel: "FD Certificate",
    templateName: (await ReminderSettings.getSettings()).whatsapp
      ?.templateFdCertificate,
    // Template vars: customer_name, fdr_no, amount, maturity_date
    bodyValues: [name, fdrNo || "", inr(amount), fmtDate(maturityDate)],
    bodyNames: ["customer_name", "fdr_no", "amount", "maturity_date"],
    documentUrl: pdfUrl || null,
    documentFilename: filename,
    emailSubject: `Fixed Deposit Certificate ${fdrNo || ""} — ${SOCIETY}`,
    emailBody:
      `Dear ${name},\n\n` +
      `Please find attached your Fixed Deposit certificate.\n\n` +
      `FDR No: ${fdrNo || "-"}\n` +
      `Amount: ${inr(amount)}\n` +
      `Maturity Date: ${fmtDate(maturityDate) || "-"}\n\n` +
      `Team Gruhakalpa`,
    pdfBase64: pdfBase64 || null,
    pdfFilename: filename,
  });
};

// Wrap each export so a thrown error can never bubble into a controller.
const safe = (fn) => (...args) =>
  Promise.resolve()
    .then(() => fn(...args))
    .catch((e) => console.error("⚠️ event notification error:", e.message));

module.exports = {
  notifyMemberAdded: safe(notifyMemberAdded),
  notifySiteBooking: safe(notifySiteBooking),
  notifyFdCreated: safe(notifyFdCreated),
  notifyRdCreated: safe(notifyRdCreated),
  notifyReceipt: safe(notifyReceipt),
  notifyFdCertificate: safe(notifyFdCertificate),
};