const multer = require("multer");

const storage = multer.memoryStorage(); // store file in memory, not disk
const upload = multer({ storage });

module.exports = upload;