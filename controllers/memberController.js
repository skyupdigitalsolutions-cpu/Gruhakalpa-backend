const Member = require("../models/Member");
const cloudinary = require("../cloudinaryConfig");

// Generate a unique, sequential membership receipt number (digits only, e.g. 000001).
// Reads the highest existing number and increments; strips any non-digit
// characters from legacy values so old prefixed numbers still sort correctly.
const generateMembershipReceiptNumber = async () => {
  const existing = await Member.find(
    { membership_receipt_no: { $ne: null } },
    { membership_receipt_no: 1 },
  ).lean();

  let max = 0;
  for (const m of existing) {
    const n = parseInt(String(m.membership_receipt_no).replace(/\D/g, ""), 10);
    if (!isNaN(n) && n > max) max = n;
  }

  let next = max + 1;
  let receiptNo = String(next).padStart(6, "0");
  let attempts = 0;
  // Guard against races / duplicates — bump until unused.
  while (attempts < 100) {
    const exists = await Member.findOne({ membership_receipt_no: receiptNo });
    if (!exists) break;
    next++;
    receiptNo = String(next).padStart(6, "0");
    attempts++;
  }
  return receiptNo;
};

exports.updateMemberById = async (req, res) => {
  try {
    const updated = await Member.updateOne(
      { _id: req.params.id },
      { $set: req.body },
    );
    if (updated.matchedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Member not found" });
    }
    res
      .status(200)
      .json({ success: true, message: "Member updated successfully!" });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating member",
      error: error.message,
    });
  }
};
// Helper function to safely parse numbers (for genuine quantities like fees /
// application number — NOT for identifiers such as aadhaar / phone numbers).
const safeParseInt = (value, fieldName) => {
  if (value === "" || value === null || value === undefined) {
    throw new Error(`${fieldName} is required`);
  }
  const parsed = parseInt(value);
  if (isNaN(parsed)) {
    throw new Error(`${fieldName} must be a valid number`);
  }
  return parsed;
};

// Helper for required identifier fields (aadhaar, mobile). These are kept as
// strings so the exact digits are preserved — parsing them to Number mangles
// spaces, leading zeros, and 12-digit values (scientific notation).
const safeString = (value, fieldName) => {
  if (value === "" || value === null || value === undefined) {
    throw new Error(`${fieldName} is required`);
  }
  return String(value).trim();
};

// Add new member
exports.addMember = async (req, res) => {
  try {
    // Helper: upload a single file buffer to Cloudinary
    const uploadToCloudinary = (fileBuffer, folder) => {
      return new Promise((resolve, reject) => {
        // ✅ Guard: skip upload if buffer is empty or missing
        if (!fileBuffer || fileBuffer.length === 0) {
          return reject(new Error("Empty file buffer — skipping upload"));
        }
        const stream = cloudinary.uploader.upload_stream(
          { folder },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          },
        );
        stream.end(fileBuffer);
      });
    };

    // ✅ Safe upload helper — returns null instead of throwing on empty/missing files
    const safeUpload = async (fileField, folder) => {
      if (!req.files || !req.files[fileField] || !req.files[fileField][0])
        return null;
      const buffer = req.files[fileField][0].buffer;
      if (!buffer || buffer.length === 0) {
        console.warn(`⚠️ Skipping ${fileField} — empty buffer received`);
        return null;
      }
      try {
        const result = await uploadToCloudinary(buffer, folder);
        return result.secure_url;
      } catch (err) {
        console.warn(
          `⚠️ Cloudinary upload failed for ${fileField}:`,
          err.message,
        );
        return null;
      }
    };

    // Upload all provided files to Cloudinary
    const imageUrl = await safeUpload("Image", "members/photos");
    const panCardUrl = await safeUpload("PanCard", "members/pancards");
    const aadharCardUrl = await safeUpload("AadharCard", "members/aadharcards");
    const applicationDocUrl = await safeUpload(
      "ApplicationDoc",
      "members/applications",
    );
    // Validate and parse all number fields
    const memberData = {
      membership_id: req.body.membership_id,
      name: req.body.name,
      membershiptype: req.body.membershiptype,
      date: new Date(req.body.date),
      membershipday: req.body.membershipday,
      dob: new Date(req.body.dob),
      father: req.body.father,
      birthplace: req.body.birthplace,
      email: req.body.email,
      alternateemail: req.body.alternateemail,
      permanentaddress: req.body.permanentaddress,
      correspondenceaddress: req.body.correspondenceaddress,
      nomineename: req.body.nomineename,
      nomineeage: req.body.nomineeage,
      nomineerelationship: req.body.nomineerelationship,
      nomineeaddress: req.body.nomineeaddress,
      agreetermsconditions: req.body.agreetermsconditions === "true",
      agreecommunication: req.body.agreecommunication === "true",
      image: imageUrl,
      pancard: panCardUrl,
      aadharcard: aadharCardUrl,
      applicationdoc: applicationDocUrl,
    };

    // Identifier fields — kept as strings to preserve exact digits.
    memberData.aadharnumber = safeString(
      req.body.aadharnumber,
      "Aadhar number",
    );
    memberData.mobile = safeString(req.body.mobile, "Mobile number");

    // Genuine numeric quantities — safe to parse as integers.
    memberData.applicationno = safeParseInt(
      req.body.applicationno,
      "Application number",
    );
    memberData.membershipfees = safeParseInt(
      req.body.membershipfees,
      "Membership fees",
    );

    // Optional identifier fields - keep as strings when provided
    if (req.body.alternatemobile && req.body.alternatemobile !== "") {
      memberData.alternatemobile = String(req.body.alternatemobile).trim();
    }

    if (req.body.nomineenumber && req.body.nomineenumber !== "") {
      memberData.nomineenumber = String(req.body.nomineenumber).trim();
    }

    // Receipt number: use the admin-entered value if provided (digits only),
    // otherwise auto-generate the next sequential number.
    const providedReceiptNo = String(req.body.membership_receipt_no || "").replace(
      /\D/g,
      "",
    );
    if (providedReceiptNo) {
      const duplicate = await Member.findOne({
        membership_receipt_no: providedReceiptNo,
      });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: `Receipt number ${providedReceiptNo} already exists. Please use a different number.`,
        });
      }
      memberData.membership_receipt_no = providedReceiptNo;
    } else {
      memberData.membership_receipt_no = await generateMembershipReceiptNumber();
    }

    // Save with a retry guard: if the auto-generated receipt number loses a
    // race to a concurrent insert, the DB unique index throws E11000 — we then
    // regenerate the next number and retry. A user-supplied number is never
    // silently changed; its collision falls through to the 409 handler below.
    let member;
    let saveAttempts = 0;
    while (true) {
      try {
        member = new Member(memberData);
        await member.save();
        break;
      } catch (err) {
        const isReceiptDup =
          err.code === 11000 &&
          err.keyValue &&
          err.keyValue.membership_receipt_no !== undefined;
        if (isReceiptDup && !providedReceiptNo && saveAttempts < 5) {
          saveAttempts++;
          memberData.membership_receipt_no =
            await generateMembershipReceiptNumber();
          continue;
        }
        throw err;
      }
    }

    res.status(201).json({
      success: true,
      message: "Member Added Successfully!",
      data: member,
    });
  } catch (error) {
    console.error("Error adding member:", error);

    // Send detailed error message
    if (
      error.message.includes("is required") ||
      error.message.includes("must be a valid number")
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    // Handle MongoDB duplicate key error (E11000)
    if (error.code === 11000) {
      const duplicateField = Object.keys(error.keyValue || {})[0] || "field";
      const duplicateValue = error.keyValue
        ? error.keyValue[duplicateField]
        : "";
      return res.status(409).json({
        success: false,
        message:
          duplicateValue === null
            ? `A database index conflict occurred. Please contact your administrator to drop the stale '${duplicateField}' index from the membership collection.`
            : duplicateField === "membership_receipt_no"
              ? `Receipt number ${duplicateValue} already exists. Please use a different number.`
              : `A member with this ${duplicateField} (${duplicateValue}) already exists.`,
        error: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error adding member",
      error: error.message,
    });
  }
};

// Get all members
exports.getAllMembers = async (req, res) => {
  try {
    const members = await Member.find({}).sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      data: members,
    });
  } catch (error) {
    console.error("Error fetching members:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching members",
      error: error.message,
    });
  }
};

// Update member
exports.updateMember = async (req, res) => {
  try {
    // Validate and parse all number fields
    const memberData = {
      membership_id: req.body.membership_id,
      name: req.body.name,
      membershiptype: req.body.membershiptype,
      date: new Date(req.body.date),
      membershipday: req.body.membershipday,
      dob: new Date(req.body.dob),
      father: req.body.father,
      birthplace: req.body.birthplace,
      email: req.body.email,
      alternateemail: req.body.alternateemail,
      permanentaddress: req.body.permanentaddress,
      correspondenceaddress: req.body.correspondenceaddress,
      nomineename: req.body.nomineename,
      nomineeage: req.body.nomineeage,
      nomineerelationship: req.body.nomineerelationship,
      nomineeaddress: req.body.nomineeaddress,
      agreetermsconditions: req.body.agreetermsconditions === "true",
      agreecommunication: req.body.agreecommunication === "true",
    };

    // Identifier fields — kept as strings to preserve exact digits.
    memberData.aadharnumber = safeString(
      req.body.aadharnumber,
      "Aadhar number",
    );
    memberData.mobile = safeString(req.body.mobile, "Mobile number");

    // Genuine numeric quantities — safe to parse as integers.
    memberData.applicationno = safeParseInt(
      req.body.applicationno,
      "Application number",
    );
    memberData.membershipfees = safeParseInt(
      req.body.membershipfees,
      "Membership fees",
    );

    // Optional identifier fields - keep as strings when provided
    if (req.body.alternatemobile && req.body.alternatemobile !== "") {
      memberData.alternatemobile = String(req.body.alternatemobile).trim();
    }

    if (req.body.nomineenumber && req.body.nomineenumber !== "") {
      memberData.nomineenumber = String(req.body.nomineenumber).trim();
    }

    const updatedMember = await Member.updateOne(
      { membership_id: req.params.id },
      { $set: memberData },
    );

    if (updatedMember.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Successfully Updated!",
    });
  } catch (error) {
    console.error("Error updating member:", error);

    if (
      error.message.includes("is required") ||
      error.message.includes("must be a valid number")
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Error updating member",
      error: error.message,
    });
  }
};