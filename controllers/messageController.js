// server/controllers/messageController.js
const asyncHandler = require("express-async-handler");
const Message = require("../models/Message");
const User = require("../models/User");
const Chat = require("../models/Chat");

// @desc    Send a new message & Emit via Socket
// @route   POST /api/message
// @access  Private
exports.sendMessage = asyncHandler(async (req, res) => {
  const { content, chatId } = req.body;

  // --- Validation ---
  if (!content || !chatId) {
    console.log("sendMessage Validation Error: Missing content or chatId");
    res.status(400);
    throw new Error("Message content and chatId are required");
  }

  // --- Authorization Check (User must be part of the chat) ---
  // This check is crucial for security.
  const chatExists = await Chat.findOne({
    _id: chatId,
    users: { $elemMatch: { $eq: req.user._id } }, // Check if sender is in users array
  });
  if (!chatExists) {
    console.log(
      `sendMessage Auth Error: User ${req.user._id} not part of chat ${chatId}`
    );
    res.status(403); // Forbidden
    throw new Error("User is not authorized to send messages to this chat");
  }

  const newMessageData = {
    sender: req.user._id,
    content: content,
    chat: chatId,
  };

  try {
    // --- Database Operations ---

    // 1. Create the message document
    let message = await Message.create(newMessageData);

    // 2. Populate the message document with necessary details for response and emission
    //    - Populate sender: name, pic, email, status (_id is included by default)
    //    - Populate chat: _id, users (for emission targeting)
    //    - Populate users within the chat object: _id (needed for targeting if emitting individually, although room emission is better)

    message = await message.populate("sender", "name pic email status"); // Populate sender details

    message = await message.populate({
      // Populate chat details, specifically the users array
      path: "chat",
      select: "users", // Only select users array from the chat object
      // If you needed more chat info, add it here: 'users isGroupChat chatName'
      // No need to populate users deeply here IF we emit to the room `chatId`
    });

    // Check if population worked, especially chat and users
    if (!message.chat || !message.chat.users) {
      console.error(
        "sendMessage Error: Failed to populate chat or chat.users for message:",
        message._id
      );
      // Throw an internal server error because population should have worked
      res.status(500);
      throw new Error(
        "Failed to retrieve necessary chat details after saving message."
      );
    }

    // 3. Update the parent chat document's latestMessage field
    await Chat.findByIdAndUpdate(chatId, {
      latestMessage: message._id,
      // updatedAt is handled automatically by Mongoose timestamps: true
    });

    // --- Socket.IO Emission ---
    const io = req.io; // Access the io instance from the request object (attached via middleware)
    const targetRoomId = chatId.toString(); // Use the chat ID as the room identifier

    console.log(
      `sendMessage EMIT: Broadcasting to room ${targetRoomId} for message ${message._id}`
    );

    // Emit 'message received' to all sockets joined to the targetRoomId
    // Send the fully populated message object needed by the client UI
    io.to(targetRoomId).emit("message received", message);

    // Emit 'latest message update' also to the room for chat list previews
    // The payload is the same fully populated message object
    io.to(targetRoomId).emit("latest message update", message);

    // --- API Response ---
    // Send the newly created and populated message back to the original sender
    res.status(201).json(message);
  } catch (error) {
    // Log the detailed error on the server
    console.error("sendMessage Controller Error:", error);
    // Determine appropriate status code
    if (!res.statusCode || res.statusCode < 400) {
      // If no specific error code set yet
      res.status(500); // Default to internal server error
    }
    // Throw error to be caught by the global error handler middleware
    throw new Error("Failed to send message: " + error.message);
  }
});

// @desc    Get all messages for a chat
// @route   GET /api/message/:chatId
// @access  Private (Requires logged-in user)
exports.fetchMessages = asyncHandler(async (req, res) => {
  const { chatId } = req.params;

  // 1. Validate chatId format
  if (!chatId.match(/^[0-9a-fA-F]{24}$/)) {
    res.status(400);
    throw new Error("Invalid Chat ID format");
  }

  // 2. Verify user is part of the chat (Authorization)
  const chat = await Chat.findOne({
    _id: chatId,
    users: { $elemMatch: { $eq: req.user._id } }, // Check if requester is in users array
  });
  if (!chat) {
    // Use 403 Forbidden if chat exists but user is not part of it,
    // or 404 if chat doesn't exist (or combine for simplicity if needed)
    res.status(403);
    throw new Error("Not authorized to view messages for this chat");
  }

  try {
    // 3. Fetch messages for the given chatId
    const messages = await Message.find({ chat: chatId })
      .populate("sender", "name pic email status") // Populate necessary sender details
      // No need to populate 'chat' here, we already know the chatId
      .sort({ createdAt: 1 }); // Sort by creation time, oldest first

    res.status(200).json(messages);
  } catch (error) {
    console.error("fetchMessages Controller Error:", error);
    res.status(500); // Default to internal server error for fetch issues
    throw new Error("Failed to fetch messages: " + error.message);
  }
});
