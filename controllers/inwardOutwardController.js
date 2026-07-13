const InwardOutward = require("../models/InwardOutward");
const cloudinary = require("../cloudinaryConfig");

// Upload one base64 file to Cloudinary. Accepts { name, type (mime), data (base64) }.
// PDFs go up as "raw" so they open/download correctly; images as "image".
const uploadAttachment = async (file, refNo) => {
  const isPdf = (file.type || "").includes("pdf");
  const buffer = Buffer.from(file.data, "base64");
  const safeName = (file.name || "document")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .slice(0, 60);
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "inward_outward",
        resource_type: isPdf ? "raw" : "image",
        ...(isPdf ? { format: "pdf" } : {}),
        public_id: `${refNo.replace(/[^a-zA-Z0-9]/g, "_")}_${safeName}_${Date.now()}`,
        type: "upload",
        access_mode: "public",
      },
      (error, res) => (error ? reject(error) : resolve(res)),
    );
    stream.end(buffer);
  });
  return {
    url: result.secure_url,
    public_id: result.public_id,
    filename: file.name || "document",
    resource_type: isPdf ? "raw" : "image",
  };
};

// Upload an array of base64 files; skips individual failures instead of failing the save
const uploadAttachments = async (files, refNo) => {
  const uploaded = [];
  for (const f of files || []) {
    if (!f || !f.data) continue;
    try {
      uploaded.push(await uploadAttachment(f, refNo));
    } catch (err) {
      console.error("⚠️ Attachment upload failed:", f.name, err.message);
    }
  }
  return uploaded;
};

// Generate next register number per type, per year.
// inward  -> IN/2026/0001, IN/2026/0002 ...
// outward -> OUT/2026/0001 ...
const generateRefNo = async (type) => {
  const prefix = type === "inward" ? "IN" : "OUT";
  const year = new Date().getFullYear();
  const pattern = new RegExp(`^${prefix}/${year}/(\\d+)$`);

  const entries = await InwardOutward.find({ type }, { ref_no: 1 }).lean();
  let max = 0;
  for (const e of entries) {
    const m = (e.ref_no || "").match(pattern);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}/${year}/${String(max + 1).padStart(4, "0")}`;
};

// POST /inwardoutward
exports.createEntry = async (req, res) => {
  try {
    const { type, subject, party_name } = req.body;

    if (!type || !["inward", "outward"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Type must be 'inward' or 'outward'",
      });
    }
    if (!subject || !subject.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Subject is required" });
    }
    if (!party_name || !party_name.trim()) {
      return res.status(400).json({
        success: false,
        message:
          type === "inward"
            ? "Received From is required"
            : "Sent To is required",
      });
    }

    const ref_no = await generateRefNo(type);

    // Upload any attached documents (base64 array from frontend)
    const attachments = await uploadAttachments(req.body.new_attachments, ref_no);

    const entry = new InwardOutward({
      type,
      ref_no,
      date: req.body.date ? new Date(req.body.date) : new Date(),
      subject: subject.trim(),
      document_type: req.body.document_type || "Letter",
      mode: req.body.mode || "By Hand",
      party_name: party_name.trim(),
      party_address: req.body.party_address || "",
      mobile_no: req.body.mobile_no || "",
      tracking_no: req.body.tracking_no || "",
      handled_by: req.body.handled_by || "",
      remarks: req.body.remarks || "",
      created_by: req.body.created_by || req.admin?.username || "Admin",
      attachments,
    });

    await entry.save();
    console.log(`📮 ${type.toUpperCase()} entry created: ${ref_no}`);

    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    console.error("Error creating inward/outward entry:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create entry" });
  }
};

// GET /inwardoutward?type=inward|outward
exports.getEntries = async (req, res) => {
  try {
    const filter = {};
    if (req.query.type && ["inward", "outward"].includes(req.query.type)) {
      filter.type = req.query.type;
    }
    const entries = await InwardOutward.find(filter).sort({
      date: -1,
      createdAt: -1,
    });
    res.json({ success: true, data: entries });
  } catch (err) {
    console.error("Error fetching inward/outward entries:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch entries" });
  }
};

// PUT /inwardoutward/:id
exports.updateEntry = async (req, res) => {
  try {
    // type & ref_no are immutable — the register number must stay consistent
    const { type, ref_no, _id, new_attachments, ...updates } = req.body;
    if (updates.date) updates.date = new Date(updates.date);

    const existing = await InwardOutward.findById(req.params.id);
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Entry not found" });
    }

    // Attachments: frontend sends the list it wants to KEEP in updates.attachments.
    // Anything missing from that list gets removed from Cloudinary too.
    if (Array.isArray(updates.attachments)) {
      const keptIds = new Set(
        updates.attachments.map((a) => a.public_id).filter(Boolean),
      );
      const removed = (existing.attachments || []).filter(
        (a) => a.public_id && !keptIds.has(a.public_id),
      );
      for (const a of removed) {
        try {
          await cloudinary.uploader.destroy(a.public_id, {
            resource_type: a.resource_type === "raw" ? "raw" : "image",
          });
        } catch (err) {
          console.error("⚠️ Cloudinary delete failed:", a.public_id, err.message);
        }
      }
    } else {
      // attachments not sent — keep whatever exists
      updates.attachments = existing.attachments || [];
    }

    // Upload any newly added files and append
    if (Array.isArray(new_attachments) && new_attachments.length > 0) {
      const uploaded = await uploadAttachments(new_attachments, existing.ref_no);
      updates.attachments = [...updates.attachments, ...uploaded];
    }

    const entry = await InwardOutward.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true },
    );

    if (!entry) {
      return res
        .status(404)
        .json({ success: false, message: "Entry not found" });
    }
    res.json({ success: true, data: entry });
  } catch (err) {
    console.error("Error updating inward/outward entry:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update entry" });
  }
};

// DELETE /inwardoutward/:id
exports.deleteEntry = async (req, res) => {
  try {
    const entry = await InwardOutward.findByIdAndDelete(req.params.id);
    if (!entry) {
      return res
        .status(404)
        .json({ success: false, message: "Entry not found" });
    }
    // Remove uploaded documents from Cloudinary as well
    for (const a of entry.attachments || []) {
      if (!a.public_id) continue;
      try {
        await cloudinary.uploader.destroy(a.public_id, {
          resource_type: a.resource_type === "raw" ? "raw" : "image",
        });
      } catch (err) {
        console.error("⚠️ Cloudinary delete failed:", a.public_id, err.message);
      }
    }
    console.log(`🗑️ Inward/Outward entry deleted: ${entry.ref_no}`);
    res.json({ success: true, message: "Entry deleted" });
  } catch (err) {
    console.error("Error deleting inward/outward entry:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete entry" });
  }
};