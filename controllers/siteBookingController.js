const SiteBooking = require("../models/SiteBooking");
const Member = require("../models/Member");
const Receipt = require("../models/Receipt");
const cloudinary = require("../cloudinaryConfig");

const safeInt = (value) => {
  const parsed = parseInt(value);
  return isNaN(parsed) ? undefined : parsed;
};

// Normalise a mobile number to a comparable Number (strips spaces, +91, etc.)
const normaliseMobile = (value) => {
  if (value === undefined || value === null) return undefined;
  const digits = String(value).replace(/\D/g, "").slice(-10); // keep last 10 digits
  if (!digits) return undefined;
  const parsed = parseInt(digits, 10);
  return isNaN(parsed) ? undefined : parsed;
};

// Map a set of due dates onto an installments array. dueDates may arrive as:
//   - an array aligned by index to installments, OR
//   - already embedded on each installment entry ({ label, amount, dueDate }).
const buildInstallments = (installments, dueDates) => {
  if (!Array.isArray(installments)) return [];
  return installments.map((it, i) => {
    const dd =
      (it && it.dueDate) ||
      (Array.isArray(dueDates) ? dueDates[i] : undefined) ||
      null;
    return {
      label: String((it && it.label) || `Installment ${i + 1}`),
      amount: parseInt(it && it.amount) || 0,
      dueDate: dd ? new Date(dd) : undefined,
    };
  });
};

exports.updateSiteBookingById = async (req, res) => {
  try {
    const {
      membership_id,
      name,
      mobilenumber,
      projectname,
      sitedimension,
      totalamount,
      date,
      designation,
      nominees,
      downpayment,
      downPaymentDate,
      installments,
      installmentDueDates,
    } = req.body;

    // ── 1. Fetch the ORIGINAL booking so we know the old membership_id ────────
    const originalBooking = await SiteBooking.findById(req.params.id);
    if (!originalBooking) {
      return res
        .status(404)
        .json({ success: false, message: "Site booking not found" });
    }
    const oldSeniorityNo = originalBooking.membership_id;

    // ── 2. Build SiteBooking update fields ───────────────────────────────────
    const updateFields = {};
    if (membership_id !== undefined) updateFields.membership_id = membership_id;
    if (name !== undefined) updateFields.name = name;
    if (mobilenumber !== undefined) updateFields.mobilenumber = mobilenumber;
    if (projectname !== undefined) updateFields.projectname = projectname;
    if (sitedimension !== undefined) updateFields.sitedimension = sitedimension;
    if (designation !== undefined) updateFields.designation = designation;
    if (nominees !== undefined) updateFields.nominees = nominees;
    if (date !== undefined) updateFields.date = new Date(date);
    if (downpayment !== undefined) {
      const dp = parseInt(downpayment);
      if (!isNaN(dp)) updateFields.downpayment = dp;
    }
    if (downPaymentDate !== undefined)
      updateFields.downPaymentDate = downPaymentDate
        ? new Date(downPaymentDate)
        : undefined;
    if (installments !== undefined)
      updateFields.installments = buildInstallments(
        installments,
        installmentDueDates,
      );
    if (totalamount !== undefined) {
      const parsed = parseFloat(totalamount);
      if (!isNaN(parsed)) updateFields.totalamount = parsed;
    }

    // ── 3. Update SiteBooking ────────────────────────────────────────────────
    await SiteBooking.updateOne({ _id: req.params.id }, { $set: updateFields });

    // ── 4. Propagate to Member ───────────────────────────────────────────────
    const memberUpdateFields = {};
    if (updateFields.membership_id !== undefined)
      memberUpdateFields.membership_id = updateFields.membership_id;
    if (updateFields.name !== undefined)
      memberUpdateFields.name = updateFields.name;

    if (Object.keys(memberUpdateFields).length > 0) {
      await Member.updateOne(
        { membership_id: oldSeniorityNo },
        { $set: memberUpdateFields },
      );
    }

    // ── 5. Propagate to Receipt ──────────────────────────────────────────────
    const receiptUpdateFields = {};
    if (updateFields.membership_id !== undefined)
      receiptUpdateFields.membership_id = updateFields.membership_id;
    if (updateFields.name !== undefined)
      receiptUpdateFields.name = updateFields.name;
    if (updateFields.projectname !== undefined)
      receiptUpdateFields.projectname = updateFields.projectname;
    if (updateFields.sitedimension !== undefined)
      receiptUpdateFields.sitedimension = updateFields.sitedimension;

    if (Object.keys(receiptUpdateFields).length > 0) {
      await Receipt.updateMany(
        { membership_id: oldSeniorityNo },
        { $set: receiptUpdateFields },
      );
    }

    res.status(200).json({
      success: true,
      message:
        "Site booking updated successfully! Changes also applied to Member and Receipt records.",
    });
  } catch (error) {
    console.error("Update site booking error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating site booking",
      error: error.message,
    });
  }
};

exports.createSiteBooking = async (req, res) => {
  try {
    const membership_id = req.body.membership_id;
    if (!membership_id) {
      return res
        .status(400)
        .json({ success: false, message: "membership_id is required" });
    }

    const memberDoc = await Member.findOne({ membership_id: membership_id });
    if (!memberDoc) {
      return res.status(404).json({
        success: false,
        message: "Member not found for this seniority number",
      });
    }

    // Resolve the client's mobile number (member record is authoritative,
    // fall back to whatever the form submitted).
    const mobilenumber = normaliseMobile(
      memberDoc.mobilenumber || memberDoc.mobile || req.body.mobilenumber,
    );

    // ── Duplicate check by MOBILE NUMBER ─────────────────────────────────────
    // One client (identified by mobile) may only hold one active site booking.
    // Cancelled bookings are ignored so a client can re-book after cancelling.
    if (mobilenumber !== undefined) {
      const existingByMobile = await SiteBooking.findOne({
        mobilenumber,
        cancelled: { $ne: true },
      });
      if (existingByMobile) {
        return res.status(409).json({
          success: false,
          code: "DUPLICATE_MOBILE",
          message: `Site booking already exists for this user (mobile ${mobilenumber}) under membership ${existingByMobile.membership_id}.`,
        });
      }
    }

    // ── Secondary safety net: duplicate by membership id ─────────────────────
    const existingByMembership = await SiteBooking.findOne({
      membership_id: membership_id,
      cancelled: { $ne: true },
    });
    if (existingByMembership) {
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_MEMBERSHIP",
        message: `Site booking already exists for this user (membership ${membership_id}).`,
      });
    }

    const siteBooking = new SiteBooking({
      membership_id: req.body.membership_id,
      name: req.body.name,
      mobilenumber: mobilenumber,
      date: new Date(req.body.date),
      projectname: req.body.projectname,
      sitedimension: req.body.sitedimension,
      totalamount: parseInt(req.body.totalamount),
      downpayment: parseInt(req.body.downpayment) || 0,
      // NEW: scheduled due date for the down payment.
      downPaymentDate: req.body.downPaymentDate
        ? new Date(req.body.downPaymentDate)
        : undefined,
      // NEW: accept the full installment schedule with per-installment due
      // dates (array of { label, amount, dueDate }). Also accepts a parallel
      // installmentDueDates[] array aligned by index for flexibility.
      installments: buildInstallments(
        req.body.installments,
        req.body.installmentDueDates,
      ),
      paymentplan: req.body.paymentplan === "full" ? "full" : "installments",
      designation: req.body.designation,
      nominees: req.body.nominees || [],
    });

    await siteBooking.save();
    res.status(201).json({ success: true, message: "Created Successfully!" });

    // Fire site-booking WhatsApp + email in the background.
    setImmediate(() => {
      require("../utils/eventNotifications").notifySiteBooking(siteBooking);
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Error creating site booking" });
  }
};

exports.getAllSiteBookings = async (req, res) => {
  try {
    const siteBookings = await SiteBooking.find({});
    res.send(siteBookings);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching site bookings");
  }
};

exports.updateSiteBooking = async (req, res) => {
  try {
    const fields = {
      membership_id: req.body.membership_id,
      name: req.body.name,
      mobilenumber: req.body.mobilenumber,
      projectname: req.body.projectname,
      date: new Date(req.body.date),
      sitedimension: req.body.sitedimension,
      transactionid: req.body.transactionid,
      totalamount: parseInt(req.body.totalamount),
      bookingamount: safeInt(req.body.bookingamount),
      downpayment: safeInt(req.body.downpayment),
      paymentmode: req.body.paymentmode,
    };

    await SiteBooking.updateOne(
      { membership_id: req.params.id },
      { $set: fields },
    );
    res.send("updated Successfully!..");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error updating site booking");
  }
};

// Cancel site booking
exports.cancelSiteBooking = async (req, res) => {
  try {
    const { bookingId } = req.body;
    const penaltyAmount = Number(req.body.penaltyAmount) || 0;

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Cancellation PDF is required" });
    }

    // Find the booking first to get membership_id
    const booking = await SiteBooking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Site booking not found" });
    }

    // Check if already cancelled
    if (booking.cancelled) {
      return res
        .status(400)
        .json({ success: false, message: "Site booking is already cancelled" });
    }

    // Upload PDF to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "cancellations", resource_type: "raw", format: "pdf" },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        },
      );
      stream.end(req.file.buffer);
    });

    // Mark sitebooking as cancelled — DO NOT DELETE
    await SiteBooking.updateOne(
      { _id: bookingId },
      {
        $set: {
          cancelled: true,
          cancellationPdfUrl: result.secure_url,
          cancellationPenalty: penaltyAmount,
          cancelledAt: new Date(),
        },
      },
    );

    // Also mark matching receipt as cancelled
    await Receipt.updateMany(
      { membership_id: booking.membership_id },
      {
        $set: {
          cancelled: true,
          cancelledAt: new Date(),
        },
      },
    );

    res.status(200).json({
      success: true,
      message: "Site booking cancelled successfully!",
      cancellationPdfUrl: result.secure_url,
      cancellationPenalty: penaltyAmount,
    });
  } catch (error) {
    console.error("Cancel site booking error:", error);
    res
      .status(500)
      .json({ success: false, message: "Error cancelling site booking" });
  }
};