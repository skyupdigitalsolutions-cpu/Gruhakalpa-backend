require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./database");
const memberLoginRoutes = require("./routes/memberLoginRoutes");

// ...

// Import routes
const adminRoutes = require("./routes/adminRoutes");
const memberRoutes = require("./routes/memberRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const siteBookingRoutes = require("./routes/siteBookingRoutes");
const receiptRoutes = require("./routes/receiptRoutes");
const superAdminRoutes = require("./routes/SuperadminRoutes");
const inwardOutwardRoutes = require("./routes/inwardOutwardRoutes");
const paymentReminderRoutes = require("./routes/paymentReminderRoutes");
const bankStatementRoutes = require("./routes/bankStatementRoutes");
const { startReminderScheduler } = require("./utils/reminderScheduler");
const depositRoutes = require("./routes/depositRoutes");

const app = express();
connectDB();

app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:3002"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.json({ limit: "50mb" }));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

app.use("/", memberLoginRoutes);
app.use("/", adminRoutes);
app.use("/", memberRoutes);
app.use("/", paymentRoutes);
app.use("/", siteBookingRoutes);
app.use("/", receiptRoutes);
app.use("/", superAdminRoutes);
app.use("/", inwardOutwardRoutes);
app.use("/", paymentReminderRoutes);
app.use("/", bankStatementRoutes);
app.use("/", depositRoutes);

app.get("/test", (req, res) => {
  res.json({
    message: "Backend is running!",
    emailConfigured: !!process.env.BREVO_API_KEY,
    senderEmail: process.env.SENDER_EMAIL || "NOT CONFIGURED",
    companyEmail: process.env.COMPANY_EMAIL || "NOT CONFIGURED",
    port: process.env.PORT || 3001,
  });
});

app.use((req, res) => {
  console.log(`❌ 404 Not Found: ${req.method} ${req.path}`);
  res
    .status(404)
    .json({ success: false, message: `Route ${req.path} not found` });
});

app.use((err, req, res, next) => {
  console.error("❌ Error:", err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(
    `Brevo API Key: ${process.env.BREVO_API_KEY ? "✅ Configured" : "❌ NOT CONFIGURED"}`,
  );
  console.log(
    `Sender Email: ${process.env.SENDER_EMAIL || "❌ NOT CONFIGURED"}`,
  );
  console.log(
    `Company Email: ${process.env.COMPANY_EMAIL || "❌ NOT CONFIGURED"}`,
  );
  console.log(
    `Database: ${process.env.MONGODB_URI ? "Connected" : "Check connection"}`,
  );

  // Start the payment-reminder scheduler (runs auto reminders when enabled)
  startReminderScheduler();
});