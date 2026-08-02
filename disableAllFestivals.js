require("dotenv").config();
const mongoose = require("mongoose");
const FestivalGreeting = require("./models/FestivalGreeting");

// One-time: turn every festival OFF, so nothing auto-sends until staff
// manually switch a festival on. Run once after deploying the "default off"
// change:   node disableAllFestivals.js
(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const res = await FestivalGreeting.updateMany({}, { $set: { enabled: false } });
    console.log(`✅ Set ${res.modifiedCount} festival(s) to OFF.`);
  } catch (e) {
    console.error("❌ Error:", e.message);
  } finally {
    mongoose.disconnect();
  }
})();