const Brevo = require("@getbrevo/brevo");

// Initialize Brevo Transactional Email API
const apiInstance = new Brevo.TransactionalEmailsApi();

// Validate configuration at module load
const validateConfig = () => {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.SENDER_EMAIL;

  const isConfigured =
    apiKey &&
    !apiKey.includes("your_") &&
    senderEmail &&
    !senderEmail.includes("your_");

  return isConfigured;
};

if (validateConfig()) {
  apiInstance.authentications["apiKey"].apiKey = process.env.BREVO_API_KEY;
}

console.log("📧 Email Configuration Status:");
console.log("   Service: Brevo API (Free - 9000 emails/month)");
console.log(
  "   API Key:",
  process.env.BREVO_API_KEY && !process.env.BREVO_API_KEY.includes("your_")
    ? "✅ CONFIGURED"
    : "❌ NOT CONFIGURED (placeholder)",
);
console.log(
  "   Sender Email:",
  process.env.SENDER_EMAIL && !process.env.SENDER_EMAIL.includes("your_")
    ? `✅ ${process.env.SENDER_EMAIL}`
    : "❌ NOT CONFIGURED (placeholder)",
);
console.log(
  "   Company Email:",
  process.env.COMPANY_EMAIL ? `✅ ${process.env.COMPANY_EMAIL}` : "❌ NOT SET",
);

if (!validateConfig()) {
  console.warn("\n⚠️ WARNING: Brevo email configuration incomplete!");
  console.warn("   Email sending WILL FAIL until you:");
  console.warn("   1. Set BREVO_API_KEY in .env with your actual API key");
  console.warn("   2. Set SENDER_EMAIL in .env with a verified sender email");
  console.warn(
    "   Get your API key from: https://app.brevo.com/settings/account/api\n",
  );
}

/**
 * Validate email format
 * @param {string} email - Email address to validate
 * @returns {boolean} - True if valid email format
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Send an email via Brevo.
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject line
 * @param {string} text - Plain text body
 * @param {string|null} pdfBase64 - Base64-encoded PDF attachment (optional)
 * @param {string|null} pdfFilename - Filename for the PDF attachment (optional)
 * @returns {Promise<Object>} - { success: boolean, messageId: string, error?: string }
 */
const sendMail = async (
  to,
  subject,
  text,
  pdfBase64 = null,
  pdfFilename = null,
) => {
  try {
    // Validate configuration
    if (!validateConfig()) {
      const errorMsg = "❌ Brevo configuration incomplete - email not sent";
      console.error(errorMsg);
      throw new Error(
        "Email service not configured. Please check BREVO_API_KEY and SENDER_EMAIL in .env",
      );
    }

    // Validate recipient email
    if (!isValidEmail(to)) {
      const errorMsg = `❌ Invalid recipient email format: ${to}`;
      console.error(errorMsg);
      throw new Error(`Invalid email address: ${to}`);
    }

    console.log(`📧 Preparing email to: ${to}`);
    console.log(`   Subject: ${subject}`);

    const sendSmtpEmail = new Brevo.SendSmtpEmail();

    sendSmtpEmail.sender = {
      name: "Navanagara Society",
      email: process.env.SENDER_EMAIL,
    };

    sendSmtpEmail.to = [{ email: to }];
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.textContent = text;

    // Attach PDF if provided and within Brevo's size limits (~10 MB)
    if (pdfBase64 && pdfFilename) {
      // Calculate PDF size
      const pdfSizeKB = Math.round((pdfBase64.length * 3) / 4 / 1024);
      console.log(`📎 PDF Size: ${pdfSizeKB} KB`);
      
      if (pdfSizeKB > 9000) {
        console.warn(
          `⚠️ PDF too large to attach (${pdfSizeKB} KB) — sending without attachment`,
        );
      } else {
        sendSmtpEmail.attachment = [
          {
            name: pdfFilename,
            content: pdfBase64,
          },
        ];
        console.log(`✅ PDF attached: ${pdfFilename} (${pdfSizeKB} KB)`);
      }
    } else {
      console.warn('⚠️ No PDF to attach');
      if (!pdfBase64) console.log('   ❌ pdfBase64 is MISSING or empty');
      if (!pdfFilename) console.log('   ❌ pdfFilename is MISSING or empty');
    }

    console.log("🔄 Sending via Brevo API...");
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);

    const messageId =
      data?.messageId ||
      data?.body?.messageId ||
      data?.response?.body?.messageId ||
      "sent";

    console.log(`✅ Email sent successfully via Brevo`);
    console.log(`✅ Message ID: ${messageId}`);
    console.log(`✅ Recipient: ${to}\n`);

    return {
      success: true,
      messageId,
      recipient: to,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errBody = error?.response?.body || error?.response?.text || {};
    const errMessage = error?.message || "Unknown error";

    console.error(`\n❌ Email sending FAILED`);
    console.error(`   To: ${to}`);
    console.error(`   Subject: ${subject}`);
    console.error(`   Error: ${errMessage}`);

    if (Object.keys(errBody).length > 0) {
      console.error(`   Details: ${JSON.stringify(errBody)}`);
    }
    console.error("");

    // Re-throw with more context
    const contextError = new Error(
      `Failed to send email to ${to}: ${errMessage}\n` +
        (Object.keys(errBody).length > 0
          ? `Details: ${JSON.stringify(errBody)}`
          : ""),
    );
    throw contextError;
  }
};

module.exports = sendMail;