// ─────────────────────────────────────────────────────────────────────────
// MSG91 WhatsApp sender
//
// Sends an approved WhatsApp template message via MSG91's v5 bulk API.
// Requires (in .env):
//   MSG91_AUTHKEY            — your MSG91 auth key
//   MSG91_WHATSAPP_NUMBER    — default integrated (business) number
// The integrated number / template names can also be overridden per-call
// from ReminderSettings.
//
// Uses Node's global fetch (Node 18+). No extra dependency required.
// ─────────────────────────────────────────────────────────────────────────

const MSG91_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";

// Normalise an Indian mobile number to MSG91 format: country code + number,
// no "+", no spaces. Assumes India (91) when a bare 10-digit number is given.
const normalizePhone = (raw) => {
  let s = String(raw || "").replace(/[^\d]/g, "");
  if (!s) return "";
  if (s.length === 10) s = "91" + s;
  if (s.length === 11 && s.startsWith("0")) s = "91" + s.slice(1);
  return s;
};

const isConfigured = () =>
  !!process.env.MSG91_AUTHKEY &&
  !process.env.MSG91_AUTHKEY.includes("your_");

/**
 * Send a WhatsApp template message.
 * @param {Object} opts
 * @param {string} opts.to            Recipient phone (any format; normalised here)
 * @param {string} opts.templateName  Approved MSG91 template name
 * @param {string} [opts.integratedNumber]  Overrides MSG91_WHATSAPP_NUMBER
 * @param {string} [opts.languageCode="en"]
 * @param {string[]} [opts.bodyValues=[]]  Ordered body variable values (body_1, body_2, ...)
 * @returns {Promise<{success:boolean, messageId?:string, error?:string, raw?:any}>}
 */
const sendWhatsAppTemplate = async ({
  to,
  templateName,
  integratedNumber,
  languageCode = "en",
  bodyValues = [],
  bodyNames = null,
}) => {
  try {
    if (!isConfigured()) {
      return {
        success: false,
        error:
          "MSG91 not configured — set MSG91_AUTHKEY in .env before sending WhatsApp.",
      };
    }

    const phone = normalizePhone(to);
    if (!phone) return { success: false, error: `Invalid phone number: ${to}` };

    const number = integratedNumber || process.env.MSG91_WHATSAPP_NUMBER;
    if (!number)
      return {
        success: false,
        error:
          "No WhatsApp integrated number configured (settings or MSG91_WHATSAPP_NUMBER).",
      };

    if (!templateName)
      return { success: false, error: "No WhatsApp template name configured." };

    // Build the body component map. WhatsApp templates use EITHER positional
    // variables ({{1}},{{2}}...) OR named variables ({{name}},{{amount}}...).
    // - Positional  -> keys must be body_1, body_2, ...
    // - Named       -> keys must be the exact variable names from the template
    // Pass `bodyNames` (same length/order as bodyValues) to use named params.
    // MSG91 rejects with "Parameter name is missing or empty" if the keys
    // don't match what the approved template expects.
    const components = {};
    bodyValues.forEach((val, i) => {
      const key =
        Array.isArray(bodyNames) && bodyNames[i]
          ? String(bodyNames[i])
          : `body_${i + 1}`;
      const v = String(val ?? "");
      // MSG91 reads the body param from the "value" field for positional
      // ({{1}}..{{N}}) templates. Sending only "text" makes params reach Meta
      // empty (localizable_params 0); sending both "value" and "text" trips
      // MSG91's "Parameter name is missing or empty". So send "value" alone.
      components[key] = { type: "text", value: v };
    });

    // Log exactly what we're about to send so the real payload is visible.
    console.log(
      "📤 MSG91 WhatsApp send →",
      JSON.stringify({ templateName, to: phone, components }),
    );

    const payload = {
      integrated_number: String(number),
      content_type: "template",
      payload: {
        messaging_product: "whatsapp",
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode || "en", policy: "deterministic" },
          to_and_components: [
            {
              to: [phone],
              components,
            },
          ],
        },
      },
    };

    const res = await fetch(MSG91_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: process.env.MSG91_AUTHKEY,
      },
      body: JSON.stringify(payload),
    });

    let data;
    const raw = await res.text();
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }

    // Log the raw MSG91 response so real delivery failures are visible in the
    // backend console (helps diagnose "shows Sent but nothing arrives").
    console.log(`📲 MSG91 WhatsApp response [${res.status}]:`, raw);

    // MSG91 frequently returns HTTP 200 even when the request actually failed
    // (bad/unapproved template, number not allowed, WABA not live, variable
    // mismatch). Inspect the BODY too — not just the HTTP status.
    const bodyError =
      data &&
      typeof data === "object" &&
      (data.type === "error" ||
        data.hasError === true ||
        data.status === "error" ||
        data.status === "fail" ||
        data.status === "failed" ||
        !!data.error ||
        (Array.isArray(data.errors) && data.errors.length > 0));

    if (!res.ok || bodyError) {
      const msg =
        (data &&
          (data.message ||
            data.error ||
            (Array.isArray(data.errors) && JSON.stringify(data.errors)))) ||
        `MSG91 returned status ${res.status}`;
      return { success: false, error: String(msg), raw: data };
    }

    // Genuine acceptance. NOTE: this means MSG91 QUEUED the message — it does
    // NOT guarantee WhatsApp delivered it to the handset. Check MSG91's
    // dashboard delivery report (by request_id) for the final Meta status.
    const messageId =
      (data &&
        (data.request_id ||
          data.messageId ||
          data.data?.request_id ||
          (typeof data.data === "string" ? data.data : null) ||
          data.message)) ||
      "queued";

    return { success: true, messageId: String(messageId), raw: data };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

module.exports = { sendWhatsAppTemplate, normalizePhone, isConfigured };