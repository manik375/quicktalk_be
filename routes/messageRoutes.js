// server/routes/messageRoutes.js
const express = require("express");
// Import both controller functions now
const {
  sendMessage,
  fetchMessages,
} = require("../controllers/messageController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Route to send a new message
router.route("/").post(protect, sendMessage);

// Route to fetch all messages for a specific chat
router.route("/:chatId").get(protect, fetchMessages); // Add this line

module.exports = router;
