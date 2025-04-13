// server/routes/chatRoutes.js
const express = require("express");
const router = express.Router();
const {
  accessChat,
  fetchChats,
  createGroupChat,
  renameGroup,
  addToGroup,
  removeFromGroup,
  deleteGroup, // Import deleteGroup
  // Import other controllers if you added them (updateGroupAbout, etc.)
  updateGroupAbout,
  transferAdmin,
  getChatById,
  updateGroupPic,
} = require("../controllers/chatController");
const { protect } = require("../middleware/authMiddleware"); // Ensure protect middleware is imported

// Apply protect middleware to ALL chat routes defined below
router.use(protect);

// --- Specific Chat Actions (using ID in URL) ---
router
  .route("/:chatId")
  .get(getChatById) // GET /api/chat/:chatId -> Get specific chat
  .delete(deleteGroup); // DELETE /api/chat/:chatId -> Delete a group chat (admin only)

// --- General Chat Routes ---
router
  .route("/")
  .post(accessChat) // POST /api/chat (userId in body) -> Creates or accesses a 1-on-1 chat
  .get(fetchChats); // GET /api/chat -> Fetches all chats for the logged-in user

// --- Group Specific Actions (using body for IDs) ---
router.route("/group").post(createGroupChat); // POST /api/chat/group (chatName, users[], about in body) -> Creates a new group chat

router.route("/rename").put(renameGroup); // PUT /api/chat/rename (chatId, chatName in body) -> Renames a group (admin only)

router.route("/update-about").put(updateGroupAbout); // PUT /api/chat/update-about (chatId, about in body) -> Updates group description (admin only)

router.route("/update-pic").put(updateGroupPic); // PUT /api/chat/update-pic (chatId, groupPic URL in body) -> Updates group picture (admin only)

router.route("/groupadd").put(addToGroup); // PUT /api/chat/groupadd (chatId, userIds[] in body) -> Adds users to a group (admin only)

router.route("/groupremove").put(removeFromGroup); // PUT /api/chat/groupremove (chatId, userId in body) -> Removes a user (admin or self-removal)

router.route("/transfer-admin").put(transferAdmin); // PUT /api/chat/transfer-admin (chatId, newAdminId in body) -> Transfers admin role (admin only)

module.exports = router;
