require("dotenv").config();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const FestivalGreeting = require("../models/FestivalGreeting");
const AutomationUser = require("../models/AutomationUser");
const Member = require("../models/Member");
const MessageLog = require("../models/MessageLog");
const ReminderSettings = require("../models/ReminderSettings");
const cloudinary = require("../cloudinaryConfig");
const { sendWhatsAppTemplate } = require("../utils/msg91Whatsapp");
const { fetchMsg91Templates } = require("../utils/msg91Templates");

// ─────────────────────────────────────────────────────────────────────────
// Date auto-map, keyed by MSG91 template NAME.
// When a template is fetched from MSG91, we look up its festival date here so
// the admin never sets dates manually. Dates are month/day (recurring). Moving
// festivals use an approximate default the admin can still override in the DB.
// Keys match the template names you created (wa_gk_* / wa_* etc.). Add/edit
// entries here if you rename templates.
// ─────────────────────────────────────────────────────────────────────────
const DATE_MAP = {
  wa_gk_new_year: [1, 1],
  wa_gk_makar_sankranti_pongal: [1, 14],
  wa_gk_republic_day: [1, 26],
  wa_gk_ugadi: [3, 30],
  wa_gk_eid_ul_fitr: [3, 20],
  wa_gk_independence_day: [8, 15],
  wa_gk_dussehra_vijayadashami: [10, 20],
  wa_gk_kannada_rajyotsava: [11, 1],
  wa_gk_christmas: [12, 25],
  wa_gk_gandhi_jayanti: [10, 2],
  wa_gk_maha_shivratri: [2, 15],
  wa_gk_holi: [3, 14],
  wa_gk_gudi_padwa: [3, 30],
  wa_gk_ram_navami: [4, 6],
  wa_gk_hanuman_jayanti: [4, 12],
  wa_gk_akshaya_tritiya: [4, 30],
  wa_gk_vasant_panchami: [1, 26],
  wa_gk_buddha_purnima: [5, 12],
  wa_gk_guru_purnima: [7, 10],
  wa_gk_nag_panchami: [8, 9],
  wa_gk_raksha_bandhan: [8, 28],
  wa_gk_krishna_janmashtami: [9, 4],
  wa_gk_onam: [9, 5],
  wa_gk_vishwakarma_puja: [9, 17],
  wa_gk_navratri: [10, 11],
  wa_gk_durga_ashtami: [10, 18],
  wa_gk_maha_navami: [10, 19],
  wa_gk_dhanteras: [11, 8],
  wa_gk_govardhan_puja: [11, 10],
  wa_gk_tulsi_vivah: [11, 13],
  wa_gk_ayudha_puja: [10, 19],
  wa_gk_saraswati_puja: [1, 26],
  wa_gk_varamahalakshmi_vratam: [8, 8],
  wa_gk_ramadan_begins: [2, 18],
  wa_gk_eid_ul_adha_bakrid: [5, 27],
  wa_gk_muharram: [6, 26],
  wa_gk_milad_un_nabi: [8, 25],
  wa_gk_guru_nanak_jayanti: [11, 24],
  wa_gk_mahavir_jayanti: [4, 10],
  wa_gk_paryushan: [8, 20],
  wa_gk_diwali_jain: [11, 8],
  wa_gk_constitution_day: [11, 26],
  wa_gk_women_s_day: [3, 8],
  wa_gk_mother_s_day: [5, 10],
  wa_gk_father_s_day: [6, 21],
  wa_gk_friendship_day: [8, 2],
  wa_gk_teachers_day: [9, 5],
  wa_gk_children_s_day: [11, 14],
  wa_gk_world_environment_day: [6, 5],
  wa_gk_international_yoga_day: [6, 21],
  wa_gk_black_friday: [11, 27],
  wa_gk_new_year_s_eve: [12, 31],
  wa_gk_nadaprabhu_kempegowda_jayanti: [6, 27],
  // Existing greeting templates you already made:
  wa_deepavali: [10, 20],
  ganesh_greetings: [9, 6],
};

// Turn a template name into a readable festival name for display.
const prettyName = (tpl) =>
  tpl
    .replace(/^wa_gk_/, "")
    .replace(/^wa_/, "")
    .replace(/_/g, " ")
    .replace(/\bs\b/g, "'s")
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));

// ── AUTOMATION LOGIN ──────────────────────────────────────────────────────

// POST /automation/login  { username, password }
exports.automationLogin = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: "Username and password required" });
    const user = await AutomationUser.findOne({ username: String(username).trim() });
    if (!user) return res.status(401).json({ success: false, message: "Invalid credentials" });
    const okPass = await bcrypt.compare(password, user.password);
    if (!okPass) return res.status(401).json({ success: false, message: "Invalid credentials" });
    const token = jwt.sign(
      { id: user._id, username: user.username, role: "automation" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );
    res.json({ success: true, token, name: user.name, username: user.username });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Middleware — protect automation routes with the automation token.
exports.requireAutomationAuth = (req, res, next) => {
  try {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer "))
      return res.status(401).json({ success: false, message: "No token" });
    const decoded = jwt.verify(h.slice(7), process.env.JWT_SECRET);
    if (decoded.role !== "automation")
      return res.status(403).json({ success: false, message: "Wrong token type" });
    req.automation = decoded;
    next();
  } catch (e) {
    res.status(401).json({ success: false, message: "Invalid token" });
  }
};

// ── TEMPLATES (live from MSG91) ───────────────────────────────────────────

// GET /automation/templates
// Fetches templates live from MSG91, auto-maps each to its festival date, and
// merges in any saved config (uploaded image, enabled flag, last-sent year).
exports.getTemplates = async (req, res) => {
  try {
    const fetched = await fetchMsg91Templates();
    const saved = await FestivalGreeting.find({}).lean();
    const savedByTpl = {};
    saved.forEach((s) => { savedByTpl[s.templateName] = s; });

    const now = new Date();

    const rows = (fetched.templates || []).map((t) => {
      const map = DATE_MAP[t.name];
      const s = savedByTpl[t.name] || {};
      return {
        templateName: t.name,
        name: prettyName(t.name),
        category: t.category,
        language: t.language,
        status: t.status,
        body: t.body || "",
        hasDate: !!map,
        month: s.month || (map ? map[0] : null),
        day: s.day || (map ? map[1] : null),
        imageUrl: s.imageUrl || "",
        enabled: s.enabled !== undefined ? s.enabled : false,
        lastSentYear: s.lastSentYear || null,
        sentThisYear: s.lastSentYear === now.getFullYear(),
      };
    });

    res.json({
      success: fetched.success,
      note: fetched.note,
      count: rows.length,
      data: rows,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Ensure a FestivalGreeting doc exists for a template (creating from DATE_MAP).
const ensureDoc = async (templateName) => {
  let doc = await FestivalGreeting.findOne({ templateName });
  if (!doc) {
    const map = DATE_MAP[templateName];
    doc = await FestivalGreeting.create({
      key: templateName,
      name: prettyName(templateName),
      templateName,
      month: map ? map[0] : 1,
      day: map ? map[1] : 1,
      enabled: false, // default OFF — staff must switch it on to auto-send
    });
  }
  return doc;
};

// POST /automation/templates/:templateName/image  { imageBase64 }
exports.uploadImage = async (req, res) => {
  try {
    const { templateName } = req.params;
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ success: false, message: "imageBase64 required" });
    const doc = await ensureDoc(templateName);

    if (doc.imagePublicId) {
      try { await cloudinary.uploader.destroy(doc.imagePublicId); } catch (_) {}
    }
    const dataUri = imageBase64.startsWith("data:")
      ? imageBase64 : `data:image/png;base64,${imageBase64}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: "festival-greetings",
      public_id: `${templateName}_${new Date().getFullYear()}`,
      overwrite: true,
      resource_type: "image",
      access_mode: "public",
    });
    doc.imageUrl = result.secure_url;
    doc.imagePublicId = result.public_id;
    doc.imageUploadedAt = new Date();
    await doc.save();
    res.json({ success: true, imageUrl: doc.imageUrl });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// PUT /automation/templates/:templateName  { enabled, month, day }
exports.updateTemplate = async (req, res) => {
  try {
    const { templateName } = req.params;
    const doc = await ensureDoc(templateName);
    if (req.body.enabled !== undefined) doc.enabled = !!req.body.enabled;
    if (req.body.month !== undefined) doc.month = Number(req.body.month);
    if (req.body.day !== undefined) doc.day = Number(req.body.day);
    await doc.save();
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// PUT /automation/templates-toggle-all  { enabled: true|false }
// Turns EVERY festival on or off at once. Creates docs for any that don't
// exist yet so the setting sticks. Use with care — enabling all means every
// festival will auto-send to all members on its date.
exports.toggleAllTemplates = async (req, res) => {
  try {
    const enabled = !!req.body.enabled;
    // Ensure a doc exists for every known template, then set the flag.
    for (const templateName of Object.keys(DATE_MAP)) {
      await ensureDoc(templateName);
    }
    const result = await FestivalGreeting.updateMany({}, { $set: { enabled } });
    res.json({ success: true, enabled, updated: result.modifiedCount });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── SENDING ───────────────────────────────────────────────────────────────

const sendToAllMembers = async (doc, { markYear = true } = {}) => {
  const settings = await ReminderSettings.getSettings();
  const wa = settings.whatsapp || {};
  if (!wa.enabled) return { sent: 0, failed: 0, skipped: 0, note: "WhatsApp disabled" };

  const members = await Member.find({}, { name: 1, mobile: 1, membership_id: 1 }).lean();
  let sent = 0, failed = 0, skipped = 0;
  for (const m of members) {
    const mobile = m.mobile || m.mobilenumber || "";
    if (!mobile) { skipped++; continue; }
    try {
      const r = await sendWhatsAppTemplate({
        to: String(mobile),
        templateName: doc.templateName,
        integratedNumber: wa.integratedNumber,
        languageCode: wa.languageCode || "en",
        bodyValues: [m.name || "Member"],
        // Templates use an IMAGE header — send the uploaded image inline.
        imageUrl: doc.imageUrl || null,
      });
      await MessageLog.create({
        membership_id: m.membership_id || "", name: m.name || "",
        kind: "event", milestone: `festival_${doc.templateName}`,
        channel: "whatsapp", to: String(mobile), provider: "msg91",
        body: `${doc.name} greeting`,
        status: r.success ? "sent" : "failed", error: r.success ? "" : r.error || "",
        providerMessageId: r.messageId || "", sentBy: "automation",
      });
      r.success ? sent++ : failed++;
    } catch (e) { failed++; }
  }
  if (markYear) {
    doc.lastSentYear = new Date().getFullYear();
    doc.lastSentAt = new Date();
    doc.lastSentCount = sent;
    await doc.save();
  }
  console.log(`🎉 Festival "${doc.name}" → sent ${sent}, failed ${failed}, skipped ${skipped}`);
  return { sent, failed, skipped };
};
exports.sendToAllMembers = sendToAllMembers;

// POST /automation/templates/:templateName/test  { mobile }
exports.testSend = async (req, res) => {
  try {
    const { templateName } = req.params;
    const { mobile, name } = req.body;
    if (!mobile) return res.status(400).json({ success: false, message: "mobile required" });
    const doc = await ensureDoc(templateName);
    const settings = await ReminderSettings.getSettings();
    const wa = settings.whatsapp || {};
    const r = await sendWhatsAppTemplate({
      to: String(mobile), templateName,
      integratedNumber: wa.integratedNumber, languageCode: wa.languageCode || "en",
      bodyValues: [name || "Member"],
      // Templates use an IMAGE header — send the uploaded image inline.
      imageUrl: doc.imageUrl || null,
    });
    res.json({ success: r.success, result: r });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── Staff "upload image" reminders ────────────────────────────────────────
// Two automation staff get a WhatsApp (approved template) reminding them to
// upload the festival's image, on the schedule:
//   3 days before  → 10:00
//   2 days before  → 10:00
//   1 day before   → 10:00 AND 14:00
// Config via .env:
//   AUTOMATION_STAFF_NUMBERS   comma-separated, e.g. 9538281101,9876543210
//   AUTOMATION_STAFF_TEMPLATE  approved template name, e.g. wa_gk_staff_upload_reminder
// The staff template body should take {{1}} = festival name, {{2}} = date.
const STAFF_NUMBERS = (process.env.AUTOMATION_STAFF_NUMBERS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const STAFF_TEMPLATE = process.env.AUTOMATION_STAFF_TEMPLATE || "wa_gk_staff_upload_reminder";

const fmtDMY = (mo, day) => `${String(day).padStart(2, "0")}/${String(mo).padStart(2, "0")}`;

const sendStaffReminder = async (doc, slotKey) => {
  if (!STAFF_NUMBERS.length) return { note: "No staff numbers configured" };
  const settings = await ReminderSettings.getSettings();
  const wa = settings.whatsapp || {};
  if (!wa.enabled) return { note: "WhatsApp disabled" };

  for (const num of STAFF_NUMBERS) {
    try {
      const r = await sendWhatsAppTemplate({
        to: String(num),
        templateName: STAFF_TEMPLATE,
        integratedNumber: wa.integratedNumber,
        languageCode: wa.languageCode || "en",
        // {{1}} = festival name, {{2}} = festival date (DD/MM)
        bodyValues: [doc.name, fmtDMY(doc.month, doc.day)],
      });
      await MessageLog.create({
        membership_id: "", name: "Automation Staff",
        kind: "event", milestone: `staff_reminder_${doc.templateName}_${slotKey}`,
        channel: "whatsapp", to: String(num), provider: "msg91",
        body: `Upload image reminder for ${doc.name}`,
        status: r.success ? "sent" : "failed", error: r.success ? "" : r.error || "",
        providerMessageId: r.messageId || "", sentBy: "automation",
      });
    } catch (e) {
      console.error(`⚠️ Staff reminder failed for ${num}:`, e.message);
    }
  }
  console.log(`📢 Staff reminder sent for "${doc.name}" (${slotKey}) to ${STAFF_NUMBERS.length} staff.`);
};

// Days between today and a festival's month/day THIS year (0 = today).
const daysUntil = (mo, day) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let target = new Date(now.getFullYear(), mo - 1, day);
  const diff = Math.round((target - today) / (24 * 60 * 60 * 1000));
  return diff;
};

// Called frequently by the scheduler. Handles BOTH:
//  • member festival greeting on the festival date at ~09:30
//  • staff "upload image" reminders on day-3/2/1 at 10:00 (and 14:00 on day-1)
// Each slot is gated to a time window and marked so it fires once per year.
exports.runDueFestivals = async () => {
  const now = new Date();
  const y = now.getFullYear();
  const hour = now.getHours();
  const minute = now.getMinutes();
  let firedGreetings = 0;

  // MASTER kill-switch: member greetings only send when this is ON. Staff
  // reminders still fire (they only reach 2 staff, and prompt them to prepare).
  const settings = await ReminderSettings.getSettings();
  const masterOn = settings.festivalAutomationEnabled === true;

  // Iterate EVERY festival (from the date map). Staff reminders fire regardless
  // of the on/off toggle (staff must be prompted to prepare). The member
  // greeting only fires when BOTH the master switch AND that festival's toggle
  // are ON — protecting the full membership from accidental sends.
  for (const [templateName, [mo, day]] of Object.entries(DATE_MAP)) {
    const dLeft = daysUntil(mo, day);

    // Only touch/create a doc when something is actually due today.
    const staffDue =
      (dLeft === 3 && hour === 10) ||
      (dLeft === 2 && hour === 10) ||
      (dLeft === 1 && hour === 10) ||
      (dLeft === 1 && hour === 14);
    const greetingDue = dLeft === 0 && hour === 9 && minute >= 30;
    if (!staffDue && !greetingDue) continue;

    const doc = await ensureDoc(templateName);

    // ── Member greeting: on the day, 09:30 window — ONLY if master ON + enabled ──
    if (greetingDue && masterOn && doc.enabled) {
      const slot = `${y}_day_0930`;
      const already = doc.memberGreetingSlot && doc.memberGreetingSlot.get(slot);
      if (!already) {
        await sendToAllMembers(doc, { markYear: true });
        if (!doc.memberGreetingSlot) doc.memberGreetingSlot = new Map();
        doc.memberGreetingSlot.set(slot, true);
        doc.markModified("memberGreetingSlot");
        await doc.save();
        firedGreetings++;
      }
    }

    // ── Staff reminders: fire regardless of enabled (prompt staff to prepare) ──
    const staffSlots = [];
    if (dLeft === 3 && hour === 10) staffSlots.push(`${y}_d3_10`);
    if (dLeft === 2 && hour === 10) staffSlots.push(`${y}_d2_10`);
    if (dLeft === 1 && hour === 10) staffSlots.push(`${y}_d1_10`);
    if (dLeft === 1 && hour === 14) staffSlots.push(`${y}_d1_14`);

    for (const slot of staffSlots) {
      const already = doc.staffReminderSlots && doc.staffReminderSlots.get(slot);
      if (!already) {
        await sendStaffReminder(doc, slot);
        if (!doc.staffReminderSlots) doc.staffReminderSlots = new Map();
        doc.staffReminderSlots.set(slot, true);
        doc.markModified("staffReminderSlots");
        await doc.save();
      }
    }
  }

  return firedGreetings;
};

// GET /automation/master — read the master festival-automation switch.
exports.getMaster = async (req, res) => {
  try {
    const settings = await ReminderSettings.getSettings();
    res.json({ success: true, festivalAutomationEnabled: settings.festivalAutomationEnabled === true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// PUT /automation/master  { enabled: true|false }
exports.setMaster = async (req, res) => {
  try {
    const settings = await ReminderSettings.getSettings();
    settings.festivalAutomationEnabled = !!req.body.enabled;
    await settings.save();
    res.json({ success: true, festivalAutomationEnabled: settings.festivalAutomationEnabled });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// GET /automation/staff — returns the staff-reminder template info + config,
// shown as its own section in the panel (separate from festival templates).
exports.getStaffTemplate = async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        templateName: STAFF_TEMPLATE,
        name: "Staff Upload Reminder",
        category: "UTILITY",
        language: "en",
        status: "APPROVED",
        staffNumbers: STAFF_NUMBERS,
        schedule: "3 days before (10 AM), 2 days before (10 AM), 1 day before (10 AM & 2 PM)",
        variables: "{{1}} = festival name, {{2}} = date",
        configured: STAFF_NUMBERS.length > 0,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// POST /automation/templates/:templateName/test-staff
// Returns festivals sorted by how soon they are from TODAY (soonest first),
// wrapping around the year. Each entry includes daysAway.
// Next N festivals from today, built from the full DATE_MAP so it always knows
// every festival's date — even ones with no saved doc and even ones toggled
// OFF (staff still need reminding to prepare them). Merges saved image/enabled
// state when a doc exists.
const upcomingFestivals = async (limit = 2) => {
  const saved = await FestivalGreeting.find({}).lean();
  const savedByTpl = {};
  saved.forEach((s) => { savedByTpl[s.templateName] = s; });

  const withDays = Object.entries(DATE_MAP).map(([templateName, [mo, day]]) => {
    let d = daysUntil(mo, day);
    if (d < 0) d += 365; // already passed this year → next year
    const s = savedByTpl[templateName];
    return {
      doc: s || { templateName, name: prettyName(templateName), month: mo, day, imageUrl: "", enabled: false },
      daysAway: d,
    };
  });
  withDays.sort((a, b) => a.daysAway - b.daysAway);
  return withDays.slice(0, limit);
};

// GET /automation/upcoming — the next N festivals from today (for display).
exports.getUpcoming = async (req, res) => {
  try {
    const list = await upcomingFestivals(Number(req.query.limit) || 2);
    res.json({
      success: true,
      today: new Date().toISOString().slice(0, 10),
      data: list.map(({ doc, daysAway }) => ({
        name: doc.name,
        templateName: doc.templateName,
        date: fmtDMY(doc.month, doc.day),
        daysAway,
        hasImage: !!doc.imageUrl,
      })),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// POST /automation/test-staff
// Sends the staff "upload image" reminder for the ACTUAL upcoming festivals
// (based on today's date) to the configured staff numbers. This mirrors what
// the real reminder does, so the test is meaningful.
exports.testStaffReminder = async (req, res) => {
  try {
    if (!STAFF_NUMBERS.length)
      return res.json({ success: false, message: "No AUTOMATION_STAFF_NUMBERS set in .env" });

    const upcoming = await upcomingFestivals(2);
    if (!upcoming.length)
      return res.json({ success: false, message: "No enabled festivals found." });

    const names = [];
    for (const { doc } of upcoming) {
      await sendStaffReminder(doc, "manual_test");
      names.push(doc.name);
    }
    res.json({ success: true, sentTo: STAFF_NUMBERS, festivals: names, template: STAFF_TEMPLATE });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// POST /automation/run-due?secret=CRON_SECRET
exports.runDueEndpoint = async (req, res) => {
  try {
    const n = await exports.runDueFestivals();
    res.json({ success: true, firedFestivals: n });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};