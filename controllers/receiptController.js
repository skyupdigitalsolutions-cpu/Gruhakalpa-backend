const Receipt = require("../models/Receipt");
const SiteBooking = require("../models/SiteBooking");
const Member = require("../models/Member");
const sendMail = require("../utils/mailer");
const cloudinary = require("../cloudinaryConfig");
const {
  sendPaymentConfirmation,
} = require("./paymentReminderController");

// Project code mapping — each project has its own independent receipt sequence
const PROJECT_CODES = {
  "New City": "NCG",
  "New City 1": "NCS",
};

// Deposit code mapping — Fixed/Recurring Deposit receipts get their own
// independent sequence too, scoped separately from site-project receipts.
const DEPOSIT_CODES = {
  "Fixed Deposit": "FD",
  "Recurring Deposit": "RD",
};

// Generate a unique receipt number scoped to a specific project/deposit prefix
// e.g. NCG-RCP-000001, NCS-RCP-000001, FD-RCP-000001, RD-RCP-000001
// (independent counters per project / deposit type)
const generateReceiptNumber = async (label) => {
  // Determine prefix from project name or deposit label, fallback to "RCP"
  const code = PROJECT_CODES[label] || DEPOSIT_CODES[label] || "RCP";
  const prefix = `${code}-RCP-`;

  // Count only receipts belonging to this prefix
  const count = await Receipt.countDocuments({
    receipt_no: { $regex: `^${prefix}` },
  });

  let receiptNo;
  let attempts = 0;

  // Loop until we find a truly unused receipt number (handles race conditions)
  do {
    receiptNo = `${prefix}${String(count + 1 + attempts).padStart(6, "0")}`;
    const exists = await Receipt.findOne({ receipt_no: receiptNo });
    if (!exists) break;
    attempts++;
  } while (attempts < 100);

  return receiptNo;
};

exports.updateReceipt = async (req, res) => {
  try {
    const updated = await Receipt.updateOne(
      { _id: req.params.id },
      { $set: req.body },
    );
    if (updated.matchedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Receipt not found" });
    }
    res
      .status(200)
      .json({ success: true, message: "Receipt updated successfully!" });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating receipt",
      error: error.message,
    });
  }
};

// Create receipt
exports.createReceipt = async (req, res) => {
  try {
    const membershipId = req.body.membershipid;
    const userEmail = req.body.email;

    // "site" (default) | "fixed_deposit" | "recurring_deposit"
    const paymentcategory = req.body.paymentcategory || "site";
    const isDeposit = paymentcategory !== "site";

    // Human-readable deposit label ("Fixed Deposit" / "Recurring Deposit"),
    // used only to choose the receipt-number prefix (FD / RD) and to print
    // on the letterhead receipt. Not used for site-project receipts.
    const depositLabel = req.body.deposittype || "";

    // VALIDATION 1: Check if membership/deposit account number is provided
    if (!membershipId) {
      return res.status(400).json({
        success: false,
        message: isDeposit
          ? "Deposit account number is required"
          : "Membership ID is required",
      });
    }

    let memberDoc = null;
    let bookingDoc = null;

    if (!isDeposit) {
      console.log(`🔍 Validating membership ID: ${membershipId}`);

      // VALIDATION 2: Check if member exists with this seniority number
      memberDoc = await Member.findOne({ membership_id: membershipId });

      if (!memberDoc) {
        console.log(
          `❌ Member not found for membership ID: ${membershipId}`,
        );
        return res.status(404).json({
          success: false,
          message: `Member not found with membership ID: ${membershipId}. Please ensure the member is registered first.`,
        });
      }

      console.log(`✅ Member found: ${memberDoc.name}`);

      // VALIDATION 3: Check if site booking exists for this seniority number
      bookingDoc = await SiteBooking.findOne({
        membership_id: membershipId,
      });

      if (!bookingDoc) {
        console.log(
          `❌ Site booking not found for membership ID: ${membershipId}`,
        );
        return res.status(404).json({
          success: false,
          message: `Site booking not found for membership ID: ${membershipId}. Please create a site booking first.`,
        });
      }

      console.log(`✅ Site booking found for: ${bookingDoc.name}`);
    } else {
      console.log(
        `🔍 Deposit receipt (${depositLabel || "Deposit"}) — skipping Member/SiteBooking lookup for account: ${membershipId}`,
      );
    }

    // All validations passed - proceed with receipt creation
    const bookingamount = isDeposit ? 0 : parseInt(bookingDoc.bookingamount || 0);
    const bank = req.body.bank || (bookingDoc && bookingDoc.bank) || "";
    const amountpaid = parseInt(req.body.amountpaid || 0);

    // Deposits are never tied to a project — always stored as "NA".
    // Site receipts keep the existing project-name resolution.
    const projectName = isDeposit
      ? "NA"
      : req.body.projectname || bookingDoc.projectname || "";

    // Whatever label the receipt-number generator should key off of:
    // deposit label (FD/RD) for deposits, project name for site receipts.
    const codeSource = isDeposit ? depositLabel : projectName;

    let receipt_no = req.body.receiptNo
      ? String(req.body.receiptNo).trim()
      : "";

    if (!receipt_no) {
      // No receipt number provided — auto-generate one for this project/deposit
      receipt_no = await generateReceiptNumber(codeSource);
    } else {
      // Receipt number provided — check it doesn't already exist
      const existingReceipt = await Receipt.findOne({ receipt_no });
      if (existingReceipt) {
        console.log(
          `⚠️ Receipt number '${receipt_no}' already exists — auto-generating new one for: ${codeSource}`,
        );
        receipt_no = await generateReceiptNumber(codeSource);
      }
    }
    console.log(
      `🧾 Using receipt number: ${receipt_no} (${isDeposit ? depositLabel : "Project: " + projectName})`,
    );

    // ✅ CHECK IF PDF WAS SENT FROM FRONTEND
    const pdfBase64 = req.body.pdfBase64;
    const pdfFilename = req.body.pdfFilename || `Receipt_${receipt_no}.pdf`;

    console.log('🔍 PDF Data Check:');
    console.log('   pdfBase64:', pdfBase64 ? `✅ Received (${pdfBase64.length} chars)` : '❌ MISSING');
    console.log('   pdfFilename:', pdfFilename);

    // Upload PDF to Cloudinary (same pattern as member images)
    let pdfUrl = null;
    if (pdfBase64) {
      try {
        const pdfBuffer = Buffer.from(pdfBase64, "base64");
        const publicIdSource = isDeposit ? depositLabel : projectName;
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "receipts",
              resource_type: "raw",
              format: "pdf",
              public_id: `${publicIdSource.replace(/[^a-zA-Z0-9]/g, "_")}_${membershipId}`,
              type: "upload", // ✅ ensures public delivery type
              access_mode: "public", // ✅ makes the PDF publicly accessible (no 401)
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            },
          );
          stream.end(pdfBuffer);
        });
        pdfUrl = uploadResult.secure_url;
        console.log(`✅ Receipt PDF uploaded to Cloudinary: ${pdfUrl}`);
      } catch (uploadErr) {
        console.error("⚠️ Cloudinary PDF upload failed:", uploadErr.message);
      }
    } else {
      console.warn('⚠️ No PDF provided - skipping Cloudinary upload');
    }

    // Detect if this is the user's very first receipt (new user)
    const existingReceiptCount = await Receipt.countDocuments({
      $or: [{ membershipid: membershipId }, { seniority_no: membershipId }],
      cancelled: { $ne: true },
    });
    const isNewUser = existingReceiptCount === 0;

    const receiptData = {
      membershipid: membershipId,
      receipt_no,
      name: req.body.name || (memberDoc ? memberDoc.name : ""),
      email: userEmail,
      projectname: projectName,
      paymentcategory,
      date: new Date(req.body.date),
      amountpaid,
      bookingamount,
      mobilenumber:
        parseInt(req.body.mobilenumber) || (memberDoc ? memberDoc.mobile : undefined),
      totalreceived: bookingamount + amountpaid,
      paymentmode: req.body.paymentmode,
      paymenttype: req.body.paymenttype,
      transactionid: req.body.transactionid,
      // Deposits have no site dimension — always blank.
      sitedimension: isDeposit
        ? ""
        : req.body.dimension || bookingDoc.sitedimension,
      created_by: req.body.created_by || "Admin",
      bank,
      seniority_no: membershipId,
      is_new_user: isNewUser,
      pdfUrl, // ✅ Cloudinary URL of the generated receipt PDF
      // Exact per-bucket split so the next receipt's waterfall is accurate.
      allocations: Array.isArray(req.body.allocations)
        ? req.body.allocations.map((a) => ({
            bucket: String(a.bucket || ""),
            label: String(a.label || ""),
            amount: parseInt(a.amount) || 0,
          }))
        : [],
    };

    // Save with a retry guard: the DB unique index on receipt_no is the source
    // of truth. If a concurrent insert grabbed the same number first, the save
    // throws E11000 — we regenerate the next number for this project/deposit
    // and retry so two receipts can never share a number.
    let receipt;
    let saveAttempts = 0;
    while (true) {
      try {
        receipt = new Receipt({ ...receiptData, receipt_no });
        await receipt.save();
        break;
      } catch (err) {
        const isReceiptDup =
          err.code === 11000 &&
          err.keyValue &&
          err.keyValue.receipt_no !== undefined;
        if (isReceiptDup && saveAttempts < 5) {
          saveAttempts++;
          receipt_no = await generateReceiptNumber(codeSource);
          continue;
        }
        throw err;
      }
    }

    console.log("📄 Receipt created successfully:", receipt_no);

    // Send response immediately - don't wait for emails
    res.status(201).json({
      success: true,
      message: "Receipt created successfully! Emails are being sent...",
      data: receipt,
    });

    // Fire a WhatsApp/email "payment received" confirmation (respects the
    // channels enabled in Automation Setup). Fully background, never blocks.
    // Only applies to site-project payments — deposits skip this notification.
    if (!isDeposit) {
      setImmediate(() => {
        sendPaymentConfirmation({
          membership_id: membershipId,
          amountPaid: amountpaid,
        }).catch((e) =>
          console.error("⚠️ Payment confirmation failed:", e.message),
        );
      });
    }

    // Send emails in background (after response is sent)
    setImmediate(async () => {
      try {
        console.log('\n📧 Starting email sending process...');
        console.log('   PDF Base64:', pdfBase64 ? `Present (${pdfBase64.length} chars)` : 'MISSING');
        console.log('   PDF Filename:', pdfFilename);

        const categoryLine = isDeposit
          ? `${depositLabel || "Deposit"} Account`
          : "Membership ID";

        // Customer email message
        const customerMessage = isDeposit
          ? `Dear ${receiptData.name},

Thank you for your payment.

${categoryLine}  : ${membershipId}
Amount Paid      : Rs.${amountpaid.toLocaleString("en-IN")}
Payment Mode     : ${receiptData.paymentmode}
Transaction ID   : ${receiptData.transactionid}
Date             : ${new Date(receiptData.date).toLocaleDateString("en-IN")}

---

Your payment receipt is attached to this email. For any questions please contact our support team.

Best Regards,
The Gruhakalpa Housing Co-Operative Society Ltd.`
          : `Dear ${receiptData.name},

Thank you for your payment.

Your account is generated 
link             : https://gruhakalpa-frontend.pages.dev/memberlogin
Username         : ${membershipId}
password         : ${memberDoc.mobile}
Membership ID    : ${membershipId}
Amount Paid      : Rs.${amountpaid.toLocaleString("en-IN")}
Payment Mode     : ${receiptData.paymentmode}
Transaction ID   : ${receiptData.transactionid}
Date             : ${new Date(receiptData.date).toLocaleDateString("en-IN")}

---

Your payment receipt is attached to this email. For any questions please contact our support team.

Best Regards,
The Gruhakalpa Housing Co-Operative Society Ltd.`;

        // Company copy message
        const companyMessage = `New Receipt Generated

Member Name      : ${receiptData.name}
${categoryLine}  : ${membershipId}
Customer Email   : ${userEmail || "Not provided"}
Mobile           : ${receiptData.mobilenumber || "Not provided"}

---

Amount Paid      : Rs.${amountpaid.toLocaleString("en-IN")}
Booking Amount   : Rs.${bookingamount.toLocaleString("en-IN")}
Total Received   : Rs.${receiptData.totalreceived.toLocaleString("en-IN")}
Payment Mode     : ${receiptData.paymentmode}
Payment Type     : ${receiptData.paymenttype}
Transaction ID   : ${receiptData.transactionid}
Date             : ${new Date(receiptData.date).toLocaleDateString("en-IN")}
Project          : ${isDeposit ? (depositLabel || "N/A") : (receiptData.projectname || "N/A")}

---

PDF receipt is attached.
Gruhakalpa Admin System`;

        const emailPromises = [];

        // 1. Send to CUSTOMER email (from form)
        if (userEmail && userEmail.trim()) {
          console.log(`📧 Sending to customer: ${userEmail}`);
          emailPromises.push(
            sendMail(
              userEmail.trim(),
              `Payment Receipt - ${receipt_no}`,
              customerMessage,
              pdfBase64,
              pdfFilename,
            )
              .then(() =>
                console.log(`✅ Email sent to customer: ${userEmail}`),
              )
              .catch((error) =>
                console.error(
                  `⚠️ Failed to send to customer ${userEmail}:`,
                  error.message,
                ),
              ),
          );
        } else {
          console.log(`⚠️ No customer email provided`);
        }

        // 2. Send to COMPANY email (from .env)
        const companyEmail = process.env.COMPANY_EMAIL;
        if (companyEmail && companyEmail.trim()) {
          console.log(`📧 Sending to company: ${companyEmail}`);
          emailPromises.push(
            sendMail(
              companyEmail.trim(),
              `[COMPANY COPY] New Receipt - ${receipt_no}`,
              companyMessage,
              pdfBase64,
              pdfFilename,
            )
              .then(() =>
                console.log(`✅ Email sent to company: ${companyEmail}`),
              )
              .catch((error) =>
                console.error(
                  `⚠️ Failed to send to company ${companyEmail}:`,
                  error.message,
                ),
              ),
          );
        } else {
          console.log(`⚠️ COMPANY_EMAIL not configured in .env`);
        }

        await Promise.all(emailPromises);
        console.log(
          `📧 Email sending completed. Total sent: ${emailPromises.length}\n`,
        );
      } catch (emailError) {
        console.error("⚠️ Email sending failed:", emailError.message);
      }
    });
  } catch (error) {
    console.error("❌ Error creating receipt:", error);
    if (error.code === 11000) {
      const duplicateField = Object.keys(error.keyValue || {})[0] || "field";
      const duplicateValue = error.keyValue
        ? error.keyValue[duplicateField]
        : "";
      return res.status(409).json({
        success: false,
        message: `A receipt with ${duplicateField} '${duplicateValue}' already exists. Please use a different receipt number.`,
        error: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: "Error creating receipt",
      error: error.message,
    });
  }
};

// Get all receipts
exports.getAllReceipts = async (req, res) => {
  try {
    // Optional filters (used e.g. by the Fixed Deposit form to pull only a
    // given member's fixed_deposit receipts). No params = all receipts.
    const { membershipid, paymentcategory, projectname } = req.query;
    const filter = {};
    if (membershipid) filter.membershipid = membershipid;
    if (paymentcategory) filter.paymentcategory = paymentcategory;
    if (projectname) filter.projectname = projectname;

    const receipts = await Receipt.find(filter).sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      data: receipts,
    });
  } catch (error) {
    console.error("❌ Error fetching receipts:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching receipts",
      error: error.message,
    });
  }
};

// Get receipt by ID
exports.getReceiptById = async (req, res) => {
  try {
    const receipt = await Receipt.findById(req.params.id);

    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: "Receipt not found",
      });
    }

    res.status(200).json({
      success: true,
      data: receipt,
    });
  } catch (error) {
    console.error("❌ Error fetching receipt:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching receipt",
      error: error.message,
    });
  }
};

// Download receipt PDF — proxy-streams from Cloudinary to avoid 401 auth errors
exports.downloadReceiptPDF = async (req, res) => {
  try {
    const receipt = await Receipt.findById(req.params.id).select(
      "pdfUrl receipt_no projectname membershipid seniority_no",
    );

    if (!receipt) {
      return res
        .status(404)
        .json({ success: false, message: "Receipt not found" });
    }

    if (!receipt.pdfUrl) {
      return res.status(404).json({
        success: false,
        message: "PDF not available for this receipt",
      });
    }

    // ✅ Proxy-stream the PDF from Cloudinary through the backend
    // This avoids 401 errors caused by Cloudinary access restrictions
    const https = require("https");
    const http = require("http");

    const projectPart = (receipt.projectname || "").replace(
      /[^a-zA-Z0-9]/g,
      "_",
    );
    const idPart = (receipt.membershipid || receipt.seniority_no || "").replace(
      /[^a-zA-Z0-9]/g,
      "_",
    );
    const receiptPart = (receipt.receipt_no || "receipt").replace(
      /[^a-zA-Z0-9]/g,
      "_",
    );
    const filename = `${projectPart}_${idPart}_${receiptPart}.pdf`;

    // Set response headers so the browser treats it as a file download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Access-Control-Allow-Origin", "*");

    const protocol = receipt.pdfUrl.startsWith("https") ? https : http;
    protocol
      .get(receipt.pdfUrl, (pdfStream) => {
        if (pdfStream.statusCode === 200) {
          pdfStream.pipe(res);
        } else {
          console.error("⚠️ Cloudinary returned status:", pdfStream.statusCode);
          // Fallback: return URL so frontend can try directly
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Content-Disposition", "");
          res.json({ success: true, pdfUrl: receipt.pdfUrl });
        }
      })
      .on("error", (err) => {
        console.error("⚠️ Proxy stream error:", err.message);
        res
          .status(500)
          .json({ success: false, message: "Error streaming PDF" });
      });
  } catch (error) {
    console.error("❌ Error fetching receipt PDF URL:", error);
    res.status(500).json({ success: false, message: "Error fetching PDF" });
  }
};

exports.backfillReceipts = async (req, res) => {
  try {
    const receipts = await Receipt.find({});
    let updated = 0;

    for (const r of receipts) {
      if (!r.membershipid) continue;
      if (r.bookingamount != null && r.totalreceived != null) continue;

      const bookingDoc = await SiteBooking.findOne({
        seniority_no: r.membershipid,
      });
      const bookingamount = Number(bookingDoc?.bookingamount || 0);
      const amountpaid = Number(r.amountpaid || 0);

      await Receipt.updateOne(
        { _id: r._id },
        {
          $set: {
            bookingamount,
            totalreceived: bookingamount + amountpaid,
          },
        },
      );

      updated++;
    }

    res.status(200).json({
      success: true,
      message: `✅ Updated ${updated} receipt(s).`,
    });
  } catch (error) {
    console.error("❌ Backfill failed:", error);
    res.status(500).json({
      success: false,
      message: "❌ Backfill failed",
      error: error.message,
    });
  }
};