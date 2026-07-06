/**
 * whatsapp.js
 *
 * Sends WhatsApp messages via the MSG91 WhatsApp API (integrated number).
 *
 * Required environment variables:
 *   MSG91_AUTHKEY            - your MSG91 auth key
 *   MSG91_WHATSAPP_NUMBER    - your integrated WhatsApp sender number (with country code, digits only)
 *   MSG91_WHATSAPP_NAMESPACE - (optional) template namespace, if your account uses one
 *
 * Template names (create these in MSG91 with EXACTLY these names):
 *   payment_reminder   - used for due / upcoming reminders
 *   payment_overdue    - used once the due date has passed
 *
 * Both templates take 5 body variables in this order:
 *   {{1}} name
 *   {{2}} pending amount (number, no currency symbol)
 *   {{3}} installment label (e.g. "Installment 1" or "Full Payment")
 *   {{4}} membership id
 *   {{5}} due date (DD-MM-YYYY)
 */

const MSG91_WHATSAPP_ENDPOINT =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";

// Template names — keep these identical to the names you create in MSG91.
const TEMPLATES = {
  reminder: "payment_reminder",
  overdue: "payment_overdue",
};

function isConfigured() {
  return Boolean(
    process.env.MSG91_AUTHKEY && process.env.MSG91_WHATSAPP_NUMBER,
  );
}

/** Normalise an Indian mobile number to digits with country code (91). */
function normaliseNumber(mobile) {
  let digits = String(mobile).replace(/\D/g, "");
  if (digits.length === 10) digits = "91" + digits; // add India country code
  return digits;
}

/**
 * Send a WhatsApp template message.
 *
 * @param {Object} opts
 * @param {string} opts.to          - recipient mobile number
 * @param {"reminder"|"overdue"} opts.templateType
 * @param {string[]} opts.variables - ordered body variables ({{1}}..{{5}})
 * @returns {Promise<{success:boolean, error?:string}>}
 */
async function sendWhatsApp({ to, templateType, variables }) {
  if (!isConfigured()) {
    console.warn("⚠️ MSG91 WhatsApp not configured — skipping WhatsApp send");
    return { success: false, error: "MSG91 not configured" };
  }

  const templateName = TEMPLATES[templateType] || TEMPLATES.reminder;
  const recipient = normaliseNumber(to);

  // Build the component variables map ({{1}}..{{n}})
  const components = {};
  variables.forEach((val, i) => {
    components[`${i + 1}`] = { type: "text", value: String(val) };
  });

  const payload = {
    integrated_number: normaliseNumber(process.env.MSG91_WHATSAPP_NUMBER),
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: templateName,
        language: { code: "en", policy: "deterministic" },
        namespace: process.env.MSG91_WHATSAPP_NAMESPACE || null,
        to_and_components: [
          {
            to: [recipient],
            components,
          },
        ],
      },
    },
  };

  try {
    const res = await fetch(MSG91_WHATSAPP_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: process.env.MSG91_AUTHKEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error(
        `❌ MSG91 WhatsApp failed (${res.status}) to ${recipient}:`,
        JSON.stringify(data),
      );
      return { success: false, error: data?.message || `HTTP ${res.status}` };
    }

    console.log(
      `✅ WhatsApp [${templateName}] sent to ${recipient}`,
    );
    return { success: true };
  } catch (err) {
    console.error(`❌ MSG91 WhatsApp error to ${recipient}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendWhatsApp, TEMPLATES, isConfigured };