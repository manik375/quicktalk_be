// server/controllers/chatController.js
const asyncHandler = require("express-async-handler");
const Chat = require("../models/Chat.js");
const User = require("../models/User.js");
const Message = require("../models/Message.js"); // Import Message model
const mongoose = require("mongoose");

// --- Helper function for common chat population ---
const populateChat = async (chat) => {
  // Check if chat is a valid Mongoose document before attempting population
  if (!chat || !(chat instanceof mongoose.Document)) {
    console.warn("[populateChat] Invalid document provided or null value.");
    return null;
  }
  try {
    // Ensure population paths are correct and exclude sensitive fields
    const populated = await chat.populate([
      {
        path: "users",
        select: "-password -refreshToken -createdAt -updatedAt -__v",
      },
      {
        path: "groupAdmin",
        select: "-password -refreshToken -createdAt -updatedAt -__v",
      },
      {
        path: "latestMessage",
        populate: {
          path: "sender",
          select: "name pic email status", // Select fields needed for latest message display
        },
      },
    ]);
    return populated;
  } catch (error) {
    console.error(`[populateChat] Error populating chat ${chat?._id}:`, error);
    return null; // Return null on population error
  }
};

// @desc    Access or create 1-on-1 chat
// @route   POST /api/chat
// @access  Private
exports.accessChat = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const requesterId = req.user?._id; // Use consistent variable name
  const io = req.io; // Get socket.io instance

  console.log(
    `[accessChat] Attempting access/create for targetUser: ${userId} by requester: ${requesterId}`
  );

  if (!userId) {
    console.warn("[accessChat] Failed: UserId parameter is required.");
    return res
      .status(400)
      .json({ success: false, message: "UserId parameter is required" });
  }
  if (!requesterId) {
    console.error(
      "[accessChat] Failed: req.user not found. Ensure 'protect' middleware is active."
    );
    return res
      .status(401)
      .json({ success: false, message: "User not authenticated" });
  }
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    console.warn(
      `[accessChat] Failed: Invalid target userId format: ${userId}`
    );
    return res
      .status(400)
      .json({ success: false, message: "Invalid target user ID format." });
  }
  if (userId === requesterId.toString()) {
    console.warn(
      `[accessChat] Failed: User ${requesterId} attempting to chat with self.`
    );
    return res
      .status(400)
      .json({ success: false, message: "Cannot create a chat with yourself." });
  }

  try {
    const targetUserExists = await User.findById(userId).select("_id");
    if (!targetUserExists) {
      console.warn(`[accessChat] Failed: Target user ${userId} not found.`);
      return res
        .status(404)
        .json({ success: false, message: "Target user not found" });
    }

    console.log(
      `[accessChat] Target user ${userId} exists. Checking for existing 1-on-1 chat...`
    );

    let existingChat = await Chat.findOne({
      isGroupChat: false,
      users: { $all: [requesterId, userId], $size: 2 }, // Ensure exactly these two users
    });

    if (existingChat) {
      console.log(
        `[accessChat] Existing 1-on-1 chat found: ${existingChat._id}. Populating...`
      );
      const fullChat = await populateChat(existingChat);
      if (!fullChat) {
        console.error(
          `[accessChat] Failed to populate existing chat ${existingChat._id}.`
        );
        return res
          .status(500)
          .json({ success: false, message: "Failed to retrieve chat details" });
      }
      console.log(
        `[accessChat] Responding with existing chat ${fullChat._id}.`
      );
      res.status(200).json({ success: true, chat: fullChat }); // Use 200 OK for existing resource
    } else {
      console.log(
        `[accessChat] No existing 1-on-1 chat found. Creating new chat...`
      );
      const newChatData = {
        chatName: "sender", // Name not really used for 1-on-1
        isGroupChat: false,
        users: [requesterId, userId],
      };

      const createdChat = await Chat.create(newChatData);
      console.log(
        `[accessChat] New chat created: ${createdChat._id}. Finding and Populating...`
      );

      // Re-fetch to ensure we have a mongoose document instance for populateChat
      const chatToPopulate = await Chat.findById(createdChat._id);
      if (!chatToPopulate) {
        console.error(
          `[accessChat] Could not re-find created chat ${createdChat._id}.`
        );
        return res
          .status(500)
          .json({ success: false, message: "Failed to process created chat." });
      }

      const fullChat = await populateChat(chatToPopulate);
      if (!fullChat) {
        console.error(
          `[accessChat] Failed to populate newly created chat ${createdChat._id}.`
        );
        return res
          .status(500)
          .json({ success: false, message: "Failed to create chat details" });
      }

      // --- Socket Event: Notify the *other* user about the new chat ---
      if (io && fullChat) {
        const otherUserId = userId.toString(); // The user being chatted with
        console.log(
          `[Socket Emit PREP] Emitting 'new_chat' to user ${otherUserId} for chat ${fullChat._id}.`
        );
        // Emit to the other user's specific room (assuming setup in socket server)
        io.to(otherUserId).emit("new_chat", fullChat);
      } else {
        console.error(
          "[accessChat ERROR] req.io not available for new_chat emit!"
        );
      }
      // --- End Socket Event ---

      console.log(
        `[accessChat] Responding with newly created chat ${fullChat._id}.`
      );
      res.status(201).json({ success: true, chat: fullChat }); // Use 201 Created for new resource
    }
  } catch (error) {
    console.error(
      `!!! [accessChat] Internal Server Error for target ${userId}:`,
      error
    );
    res.status(500).json({
      success: false,
      message: "Server error during chat access/creation.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// @desc    Get all chats for user
// @route   GET /api/chat
// @access  Private
exports.fetchChats = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  console.log(`[fetchChats] Request received for user: ${userId}`);

  if (!userId) {
    console.error(
      "[fetchChats] Error: User information (req.user._id) not found."
    );
    return res
      .status(401)
      .json({ success: false, message: "User not authenticated" });
  }

  try {
    console.log(`[fetchChats] Executing Chat.find for user ID: ${userId}`);
    // Find chats where user is a member, initially without population
    const chats = await Chat.find({
      users: { $elemMatch: { $eq: userId } },
    }).sort({ updatedAt: -1 });

    console.log(
      `[fetchChats] Found ${chats?.length ?? 0} chats initially for user ${userId}.`
    );
    if (!chats || chats.length === 0) {
      console.log(`[fetchChats] No chats found for user ${userId}.`);
      return res.status(200).json({ success: true, count: 0, chats: [] });
    }

    console.log(
      `[fetchChats] Starting population for ${chats.length} chats...`
    );
    // Populate each chat individually using the helper
    const populatedChatsPromises = chats.map((chat) => populateChat(chat));
    const populatedResults = await Promise.allSettled(populatedChatsPromises);

    const successfullyPopulatedChats = [];
    populatedResults.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value) {
        successfullyPopulatedChats.push(result.value);
      } else {
        const originalChatId = chats[index]?._id || "unknown";
        console.error(
          `[fetchChats] Failed to populate chat ID: ${originalChatId}. Reason:`,
          result.reason || "Populate helper returned null"
        );
        // Decide if you want to include partially populated or errored chats
        // For now, we only include successfully populated ones.
      }
    });

    console.log(
      `[fetchChats] Successfully populated ${successfullyPopulatedChats.length} out of ${chats.length} chats.`
    );
    console.log(`[fetchChats] Sending successful response for user ${userId}.`);
    res.status(200).json({
      success: true,
      count: successfullyPopulatedChats.length,
      chats: successfullyPopulatedChats,
    });
  } catch (error) {
    console.error(
      `!!! [fetchChats] Internal Server Error caught for user ${userId}:`,
      error
    );
    res.status(500).json({
      success: false,
      message: "Failed to fetch chats due to an unexpected server error.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// @desc    Create new group chat
// @route   POST /api/chat/group
// @access  Private
exports.createGroupChat = asyncHandler(async (req, res) => {
  const { chatName, users, about } = req.body; // users is expected as array of IDs from frontend
  const creatorId = req.user?._id;
  const io = req.io;
  console.log(
    `[createGroupChat] Attempt by creator ${creatorId}. Name: ${chatName}, MembersToAdd: ${users}, About: ${about}`
  );

  if (!creatorId) {
    console.error("[createGroupChat] User not authenticated.");
    return res
      .status(401)
      .json({ success: false, message: "User not authenticated" });
  }
  // Frontend should send at least 2 *other* users for a group of 3+
  if (
    !chatName?.trim() ||
    !users ||
    !Array.isArray(users) ||
    users.length < 2 // Need creator + 2 others = minimum 3 total
  ) {
    console.warn("[createGroupChat] Invalid input data.");
    return res.status(400).json({
      success: false,
      message: "Group name and at least 2 other users (IDs) are required.",
    });
  }

  // Validate user IDs format and create unique list including creator
  const memberIds = [...new Set(users.map((id) => id?.toString()))]; // Handle potential null/undefined in input array
  if (memberIds.some((id) => !id || !mongoose.Types.ObjectId.isValid(id))) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid user ID format provided." });
  }

  // Add creator and ensure uniqueness again
  const finalUsers = [...new Set([creatorId.toString(), ...memberIds])];

  // Final check for minimum size (should be >= 3)
  if (finalUsers.length < 3) {
    console.warn(
      `[createGroupChat] Insufficient unique valid members after adding creator: ${finalUsers.length}`
    );
    return res
      .status(400)
      .json({
        success: false,
        message:
          "Group requires at least 3 unique members (including creator).",
      });
  }

  try {
    console.log(
      `[createGroupChat] Creating group with ${finalUsers.length} members.`
    );
    const groupChatData = {
      chatName: chatName.trim(),
      isGroupChat: true,
      users: finalUsers, // Store the array of user IDs
      groupAdmin: creatorId,
      about: about?.trim() || "",
    };
    const createdGroup = await Chat.create(groupChatData);
    console.log(
      `[createGroupChat] Group created: ${createdGroup._id}. Finding and Populating...`
    );

    // Re-fetch the created group to ensure we have a document instance for population
    const groupToPopulate = await Chat.findById(createdGroup._id);
    if (!groupToPopulate) {
      console.error(
        `[createGroupChat] Could not re-find created group ${createdGroup._id}.`
      );
      // Consider cleanup? Or just report error.
      return res
        .status(500)
        .json({ success: false, message: "Failed processing created group." });
    }

    const fullGroupChat = await populateChat(groupToPopulate);
    if (!fullGroupChat) {
      console.error(
        `[createGroupChat] Failed populate new group ${createdGroup._id}.`
      );
      return res
        .status(500)
        .json({
          success: false,
          message: "Failed getting full group details.",
        });
    }

    // --- Socket Event: Notify added members (excluding creator) ---
    if (io && fullGroupChat) {
      console.log(
        `[createGroupChat Socket] Notifying members for group ${fullGroupChat._id}`
      );
      fullGroupChat.users.forEach((user) => {
        const userIdString = user._id.toString();
        if (userIdString !== creatorId.toString()) {
          console.log(
            `[Socket Emit PREP] Emitting 'added to group' to user ${userIdString} for chat ${fullGroupChat._id}.`
          );
          // Emit to the user's specific room
          io.to(userIdString).emit("added to group", fullGroupChat);
        }
      });
    } else {
      console.error(
        "[createGroupChat ERROR] req.io not available for socket emits!"
      );
    }
    // --- End Socket Event ---

    console.log(
      `[createGroupChat] Sending success response for group ${fullGroupChat._id}.`
    );
    res
      .status(201) // Use 201 Created
      .json({
        success: true,
        chat: fullGroupChat,
        message: "Group chat created successfully",
      });
  } catch (error) {
    console.error(
      `!!! [createGroupChat] Internal Server Error for name ${chatName}:`,
      error
    );
    // Check for specific Mongoose errors like validation?
    res.status(500).json({
      success: false,
      message: "Failed to create group chat due to a server error.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// @desc    Rename group
// @route   PUT /api/chat/rename
// @access  Private (Admin only)
exports.renameGroup = asyncHandler(async (req, res) => {
  const { chatId, chatName } = req.body;
  const requesterId = req.user?._id;
  const io = req.io;
  console.log(
    `[renameGroup] Attempt by user ${requesterId} for chat ${chatId} to name: ${chatName}`
  );

  if (!requesterId) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  if (!chatId || !chatName?.trim()) {
    return res
      .status(400)
      .json({ success: false, message: "Chat ID and new name required" });
  }
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid Chat ID format." });
  }

  try {
    // Find and update in one step, requesting the new version
    const updatedChatRaw = await Chat.findOneAndUpdate(
      {
        _id: chatId,
        isGroupChat: true,
        groupAdmin: requesterId, // Verify admin in the query itself
      },
      { $set: { chatName: chatName.trim() } },
      { new: true } // Return the modified document
    );

    if (!updatedChatRaw) {
      // Check if chat exists but user is not admin
      const chatExists = await Chat.findById(chatId);
      if (!chatExists) {
        return res
          .status(404)
          .json({ success: false, message: "Chat not found" });
      } else if (!chatExists.isGroupChat) {
        return res
          .status(400)
          .json({ success: false, message: "Only groups can be renamed" });
      } else if (chatExists.groupAdmin?.toString() !== requesterId.toString()) {
        return res
          .status(403)
          .json({ success: false, message: "Admin only action" });
      } else {
        // Should not happen if findOneAndUpdate includes admin check, but fallback
        return res
          .status(500)
          .json({
            success: false,
            message: "Failed to rename group for unknown reason.",
          });
      }
    }

    console.log(`[renameGroup] Chat ${chatId} renamed. Populating...`);
    const updatedChat = await populateChat(updatedChatRaw); // Populate the updated document

    if (!updatedChat) {
      console.error(
        `[renameGroup] Renamed chat ${chatId}, but failed populate.`
      );
      // Return the raw update if population fails, but indicate the issue
      return res.status(200).json({
        success: true,
        chat: updatedChatRaw.toObject(), // Send raw object
        message: "Group renamed, but failed to refresh details.",
      });
    }

    // --- Socket Event for Group Update ---
    if (io) {
      console.log(
        `[Socket Emit PREP] Emitting 'group updated' (rename) to room ${chatId}`
      );
      io.to(chatId).emit("group updated", updatedChat); // Send populated chat
    } else {
      console.error("[renameGroup ERROR] req.io not available!");
    }
    // --- End Socket Event ---

    console.log(
      `[renameGroup] Sending successful response for chat ${chatId}.`
    );
    res.status(200).json({
      success: true,
      chat: updatedChat, // Send populated chat
      message: "Group renamed successfully",
    });
  } catch (error) {
    console.error(
      `!!! [renameGroup] Internal Server Error for chat ${chatId}:`,
      error
    );
    res.status(500).json({
      success: false,
      message: "Failed to rename group due to a server error.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// @desc    Update group about/description
// @route   PUT /api/chat/update-about
// @access  Private (Admin only)
exports.updateGroupAbout = asyncHandler(async (req, res) => {
  const { chatId, about } = req.body;
  const requesterId = req.user?._id;
  const io = req.io;
  console.log(
    `[updateGroupAbout] Attempt by user ${requesterId} for chat ${chatId}`
  );

  if (!requesterId) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  // Allow empty string for 'about'
  if (!chatId || about === undefined || about === null) {
    return res
      .status(400)
      .json({ success: false, message: "Chat ID and 'about' text required" });
  }
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid Chat ID format." });
  }

  try {
    // Use findOneAndUpdate for atomicity and admin check
    const updatedChatRaw = await Chat.findOneAndUpdate(
      {
        _id: chatId,
        isGroupChat: true,
        groupAdmin: requesterId,
      },
      { $set: { about: about.trim() } },
      { new: true }
    );

    if (!updatedChatRaw) {
      const chatExists = await Chat.findById(chatId);
      if (!chatExists) {
        return res
          .status(404)
          .json({ success: false, message: "Chat not found" });
      } else if (!chatExists.isGroupChat) {
        return res
          .status(400)
          .json({ success: false, message: "Only groups can be updated" });
      } else if (chatExists.groupAdmin?.toString() !== requesterId.toString()) {
        return res
          .status(403)
          .json({ success: false, message: "Admin only action" });
      } else {
        return res
          .status(500)
          .json({ success: false, message: "Failed to update description." });
      }
    }

    console.log(
      `[updateGroupAbout] Chat ${chatId} description updated. Populating...`
    );
    const updatedChat = await populateChat(updatedChatRaw);

    if (!updatedChat) {
      console.error(
        `[updateGroupAbout] Updated about for chat ${chatId}, but failed populate.`
      );
      return res.status(200).json({
        success: true,
        chat: updatedChatRaw.toObject(),
        message: "Group description updated, but failed to refresh details.",
      });
    }

    // --- Socket Event for Group Update ---
    if (io) {
      console.log(
        `[Socket Emit PREP] Emitting 'group updated' (about change) to room ${chatId}`
      );
      io.to(chatId).emit("group updated", updatedChat); // Send populated chat
    } else {
      console.error("[updateGroupAbout ERROR] req.io not available!");
    }
    // --- End Socket Event ---

    console.log(
      `[updateGroupAbout] Sending successful response for chat ${chatId}.`
    );
    res.status(200).json({
      success: true,
      chat: updatedChat,
      message: "Group description updated successfully",
    });
  } catch (error) {
    console.error(
      `!!! [updateGroupAbout] Internal Server Error for chat ${chatId}:`,
      error
    );
    res.status(500).json({
      success: false,
      message: "Failed to update description due to a server error.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// @desc    Add user(s) to group
// @route   PUT /api/chat/groupadd
// @access  Private (Admin only)
exports.addToGroup = asyncHandler(async (req, res) => {
  const { chatId, userIds } = req.body; // Expecting an array of user IDs
  const requesterId = req.user?._id;
  const io = req.io;
  console.log(
    `[addToGroup] Attempt by admin ${requesterId} to add users ${userIds} to chat ${chatId}`
  );

  if (!requesterId) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  if (!chatId || !userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Chat ID and a non-empty array of user IDs are required",
    });
  }
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid Chat ID format." });
  }
  const invalidUserIds = userIds.filter(
    (id) => !id || !mongoose.Types.ObjectId.isValid(id) // Check for null/undefined too
  );
  if (invalidUserIds.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Invalid or missing User ID format provided for: ${invalidUserIds.join(", ")}`,
    });
  }

  try {
    // Find the chat and verify admin status upfront
    const chat = await Chat.findOne({
      _id: chatId,
      isGroupChat: true,
      groupAdmin: requesterId,
    });

    if (!chat) {
      // Check specific reason for failure
      const chatExists = await Chat.findById(chatId);
      if (!chatExists) {
        return res
          .status(404)
          .json({ success: false, message: "Chat not found" });
      } else if (!chatExists.isGroupChat) {
        return res
          .status(400)
          .json({ success: false, message: "Not a group chat" });
      } else if (chatExists.groupAdmin?.toString() !== requesterId.toString()) {
        return res
          .status(403)
          .json({ success: false, message: "Admin only action" });
      } else {
        return res
          .status(500)
          .json({
            success: false,
            message: "Failed to verify chat/admin status.",
          });
      }
    }

    // Process user IDs to add: ensure unique, valid, exist, and not already members
    const uniqueUserIdsToAdd = [...new Set(userIds.map((id) => id.toString()))];
    const currentMemberIds = chat.users.map((user) => user.toString());

    // Filter out the admin and users already in the group
    const potentialNewMemberIds = uniqueUserIdsToAdd.filter(
      (id) => id !== requesterId.toString() && !currentMemberIds.includes(id)
    );

    if (potentialNewMemberIds.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No new valid users selected, or all selected users are already in the group.",
      });
    }

    // Verify that all potential new members actually exist in the User collection
    const existingUsers = await User.find({
      _id: { $in: potentialNewMemberIds },
    }).select("_id");
    const finalNewMemberIds = existingUsers.map((u) => u._id.toString());

    if (finalNewMemberIds.length !== potentialNewMemberIds.length) {
      const nonExistentIds = potentialNewMemberIds.filter(
        (id) => !finalNewMemberIds.includes(id)
      );
      console.warn(
        `[addToGroup WARN] Some users to add do not exist: ${nonExistentIds}`
      );
      // Decide whether to proceed with the valid ones or fail
      if (finalNewMemberIds.length === 0) {
        return res
          .status(400)
          .json({
            success: false,
            message: "None of the selected users exist.",
          });
      }
      // Or continue with adding only the valid ones... Let's continue for now.
      console.log(
        `[addToGroup INFO] Proceeding with adding valid users: ${finalNewMemberIds}`
      );
    }

    if (finalNewMemberIds.length === 0) {
      // This case should be caught earlier, but double-check
      return res
        .status(400)
        .json({ success: false, message: "No valid new members to add." });
    }

    // Add the verified new members using $addToSet for safety (though filtered already)
    const updateResult = await Chat.updateOne(
      { _id: chatId },
      { $addToSet: { users: { $each: finalNewMemberIds } } }
    );

    if (updateResult.modifiedCount === 0 && updateResult.matchedCount === 0) {
      console.error(
        `[addToGroup ERROR] Failed to find/update chat ${chatId} during add operation.`
      );
      return res
        .status(404)
        .json({ success: false, message: "Chat not found during update." });
    }
    // Even if modifiedCount is 0 (e.g., race condition where users were added), proceed to populate and emit

    console.log(
      `[addToGroup SUCCESS] Members added/verified in DB for ${chatId}. Populating...`
    );

    // Re-fetch the chat to populate correctly
    const chatAfterUpdate = await Chat.findById(chatId);
    const updatedChat = await populateChat(chatAfterUpdate);

    if (!updatedChat) {
      console.error(
        `[addToGroup ERROR] Added users, but failed populate chat ${chatId}.`
      );
      return res
        .status(200) // Return 200 because the action likely succeeded, but population failed
        .json({
          success: true,
          chat: chatAfterUpdate ? chatAfterUpdate.toObject() : null, // Send raw if available
          message: `Added ${finalNewMemberIds.length} member(s), but failed to refresh full details.`,
        });
    }
    console.log(`[addToGroup SUCCESS] Chat ${chatId} populated after add.`);

    // --- Socket Emits for Add Member ---
    if (io) {
      // 1. Notify everyone in the group (including old members, admin, and new members) that the group was updated
      console.log(
        `[Socket Emit PREP] Emitting 'group updated' to room ${chatId} after add.`
      );
      io.to(chatId).emit("group updated", updatedChat);

      // 2. Explicitly notify each *newly added* member they were added
      finalNewMemberIds.forEach((newMemberId) => {
        console.log(
          `[Socket Emit PREP] Emitting 'added to group' to new user ${newMemberId}.`
        );
        io.to(newMemberId).emit("added to group", updatedChat);
      });
    } else {
      console.error("[addToGroup ERROR] req.io not available!");
    }
    // --- End Socket Emits ---

    console.log(`[addToGroup RESPONSE] Sending success response.`);
    return res.status(200).json({
      success: true,
      chat: updatedChat,
      message: `Successfully added ${finalNewMemberIds.length} member(s).`,
    });
  } catch (error) {
    console.error(
      `!!! [addToGroup FATAL ERROR] Chat: ${chatId}. Error:`,
      error
    );
    res.status(500).json({
      success: false,
      message: "Server error while adding users to the group.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// @desc    Remove user from group (Handles self-removal/leaving)
// @route   PUT /api/chat/groupremove
// @access  Private (Admin only or self-removal)
exports.removeFromGroup = asyncHandler(async (req, res) => {
  const { chatId, userId } = req.body; // userId = ID of user being removed/leaving
  const requesterId = req.user?._id;
  const io = req.io;

  console.log(
    `[removeFromGroup START] Requester: ${requesterId}, UserToRemove: ${userId}, Chat: ${chatId}`
  );
  if (!requesterId) {
    console.error("[removeFromGroup FAIL] Requester ID missing.");
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  if (!chatId || !userId) {
    console.error(
      "[removeFromGroup FAIL] Missing Chat ID or User ID to remove."
    );
    return res
      .status(400)
      .json({
        success: false,
        message: "Chat ID and User ID to remove are required",
      });
  }
  if (
    !mongoose.Types.ObjectId.isValid(chatId) ||
    !mongoose.Types.ObjectId.isValid(userId)
  ) {
    console.error("[removeFromGroup FAIL] Invalid ID format.");
    return res
      .status(400)
      .json({ success: false, message: "Invalid ID format provided." });
  }

  try {
    const chat = await Chat.findById(chatId);
    if (!chat) {
      console.warn(`[removeFromGroup WARN] Chat ${chatId} not found.`);
      return res
        .status(404)
        .json({ success: false, message: "Chat not found" });
    }
    if (!chat.isGroupChat) {
      console.warn(
        `[removeFromGroup WARN] Chat ${chatId} is not a group chat.`
      );
      return res
        .status(400)
        .json({
          success: false,
          message: "Cannot remove members from a non-group chat",
        });
    }

    const userToRemoveId = userId.toString();
    const requesterIdString = requesterId.toString();
    const isAdmin = chat.groupAdmin?.toString() === requesterIdString;
    const isSelfRemoval = userToRemoveId === requesterIdString;

    console.log(
      `[removeFromGroup PERMS] isSelfRemoval: ${isSelfRemoval}, isAdmin: ${isAdmin}`
    );

    // --- Authorization Checks ---
    if (!isAdmin && !isSelfRemoval) {
      console.warn(
        `[removeFromGroup DENIED] Non-admin trying to remove another user.`
      );
      return res
        .status(403)
        .json({
          success: false,
          message: "Only admins can remove other users.",
        });
    }

    // Find the user in the chat's user list
    const userExistsInChat = chat.users.some(
      (u) => u.toString() === userToRemoveId
    );
    if (!userExistsInChat) {
      console.warn(
        `[removeFromGroup WARN] User ${userToRemoveId} not found in chat ${chatId}.`
      );
      return res
        .status(400)
        .json({
          success: false,
          message: "User specified is not a member of this group.",
        });
    }

    // Special case: Admin trying to remove themselves
    if (isAdmin && isSelfRemoval) {
      // TODO: Implement admin transfer logic before allowing self-removal if other members exist.
      // For now, let's prevent admin self-removal if they are the sole admin and others remain.
      if (chat.users.length > 1) {
        console.warn(
          `[removeFromGroup DENIED] Admin ${requesterIdString} attempted self-removal from group ${chatId} with other members present. Requires admin transfer.`
        );
        return res
          .status(400)
          .json({
            success: false,
            message: "Admin must transfer ownership before leaving the group.",
          });
      } else {
        // If admin is the *only* user left, allow removal (effectively deleting the group contextually)
        console.log(
          `[removeFromGroup INFO] Admin ${requesterIdString} is the last member, allowing self-removal.`
        );
      }
    }

    // --- Perform Removal ---
    console.log(
      `[removeFromGroup ACTION] Removing user ${userToRemoveId} from chat ${chatId}.`
    );
    // Use $pull to remove the user ID from the array
    const updateResult = await Chat.findByIdAndUpdate(
      chatId,
      { $pull: { users: userToRemoveId } },
      { new: true } // Get the updated document AFTER removal
    );

    if (!updateResult) {
      // This should ideally not happen if the chat was found earlier, but check anyway
      console.error(
        `[removeFromGroup ERROR] Chat ${chatId} not found during the update operation.`
      );
      return res
        .status(404)
        .json({
          success: false,
          message: "Chat not found during removal update.",
        });
    }

    console.log(
      `[removeFromGroup SUCCESS] User ${userToRemoveId} removed from DB for ${chatId}. Populating...`
    );

    // Populate the fully updated chat
    const updatedChat = await populateChat(updateResult);
    if (!updatedChat) {
      console.error(
        `[removeFromGroup ERROR] Failed to populate chat ${chatId} after user removal.`
      );
      // Decide response: send raw data or indicate failure?
      return res
        .status(200) // Action succeeded, but couldn't get fresh data
        .json({
          success: true,
          message: "User removed, but failed to refresh group details.",
          chatId: chatId,
          removedUserId: userToRemoveId,
          chat: updateResult.toObject(), // Send the raw updated object
        });
    }
    console.log(
      `[removeFromGroup SUCCESS] Populated chat ${chatId} after removal.`
    );

    // --- Socket Emission for Remove/Leave ---
    if (io) {
      // 1. Notify the user who was removed/left
      const removedPayload = { chatId: chatId, chatName: updatedChat.chatName }; // Send chatName for context
      console.log(
        `[Socket Emit PREP] Emitting 'removed from group' to user ${userToRemoveId}. Data:`,
        removedPayload
      );
      io.to(userToRemoveId).emit("removed from group", removedPayload);

      // 2. Notify all *remaining* members in the group chat room with the updated chat object
      console.log(
        `[Socket Emit PREP] Emitting 'user left group' to room ${chatId} with updated chat data.`
      );
      io.to(chatId).emit("user left group", updatedChat); // <<<< SEND UPDATED CHAT OBJECT

      // 3. Force the removed user's socket(s) out of the chat room
      try {
        const sockets = await io.in(userToRemoveId).fetchSockets();
        sockets.forEach((socket) => {
          if (socket.rooms.has(chatId)) {
            socket.leave(chatId);
            console.log(
              `[Socket Action] Forced socket ${socket.id} (User: ${userToRemoveId}) to leave room ${chatId}`
            );
          }
        });
      } catch (e) {
        console.error(
          `[Socket Action] Error fetching/leaving sockets for user ${userToRemoveId} from room ${chatId}:`,
          e
        );
      }
    } else {
      console.error(
        "[removeFromGroup ERROR] req.io not available for socket emits!"
      );
    }
    // --- End Socket Emission ---

    // --- HTTP Response ---
    console.log(`[removeFromGroup RESPONSE] Sending success response.`);
    // Send the updated chat back to the admin who performed the action
    // For self-removal, the frontend handles removal based on socket event or simple success message
    res.status(200).json({
      success: true,
      message: isSelfRemoval
        ? "You have left the group."
        : "User removed successfully.",
      chat: updatedChat, // Send updated chat state back
      removedUserId: userToRemoveId, // Include removed ID for frontend confirmation if needed
    });
  } catch (error) {
    console.error(
      `!!! [removeFromGroup FATAL ERROR] Chat: ${chatId}, User: ${userId}. Error:`,
      error
    );
    res.status(500).json({
      success: false,
      message: "Server error while removing user from the group.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// @desc    Transfer admin role to another user
// @route   PUT /api/chat/transfer-admin
// @access  Private (Admin only)
exports.transferAdmin = asyncHandler(async (req, res) => {
  const { chatId, newAdminId } = req.body;
  const requesterId = req.user?._id;
  const io = req.io;
  console.log(
    `[transferAdmin] Attempt by ${requesterId} to transfer admin for chat ${chatId} to ${newAdminId}`
  );

  if (!requesterId) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  if (!chatId || !newAdminId) {
    return res
      .status(400)
      .json({ success: false, message: "Chat ID and new admin ID required" });
  }
  if (
    !mongoose.Types.ObjectId.isValid(chatId) ||
    !mongoose.Types.ObjectId.isValid(newAdminId)
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid ID format." });
  }
  if (requesterId.toString() === newAdminId) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Cannot transfer admin role to yourself.",
      });
  }

  try {
    // Use findOneAndUpdate to ensure atomicity and verify conditions
    const updatedChatRaw = await Chat.findOneAndUpdate(
      {
        _id: chatId,
        isGroupChat: true,
        groupAdmin: requesterId, // Current user must be admin
        users: newAdminId, // Target user must be a member
      },
      { $set: { groupAdmin: newAdminId } },
      { new: true }
    );

    if (!updatedChatRaw) {
      // Detailed check for why it failed
      const chat = await Chat.findById(chatId);
      if (!chat) {
        return res
          .status(404)
          .json({ success: false, message: "Chat not found" });
      } else if (!chat.isGroupChat) {
        return res
          .status(400)
          .json({ success: false, message: "Not a group chat" });
      } else if (chat.groupAdmin?.toString() !== requesterId.toString()) {
        return res
          .status(403)
          .json({
            success: false,
            message: "Only the current admin can transfer the role.",
          });
      } else if (!chat.users.some((u) => u.toString() === newAdminId)) {
        return res
          .status(400)
          .json({
            success: false,
            message: "The selected user is not a member of this group.",
          });
      } else {
        return res
          .status(500)
          .json({ success: false, message: "Failed to transfer admin role." });
      }
    }

    console.log(
      `[transferAdmin] Admin role transferred to ${newAdminId} for ${chatId}. Populating...`
    );
    const updatedChat = await populateChat(updatedChatRaw); // Populate the updated chat

    if (!updatedChat) {
      console.error(
        `[transferAdmin] Transferred admin, but failed populate chat ${chatId}.`
      );
      return res.status(200).json({
        success: true,
        chat: updatedChatRaw.toObject(), // Send raw object
        message: "Admin role transferred, but failed to refresh details.",
      });
    }

    // --- Socket Event for Group Update ---
    if (io) {
      console.log(
        `[Socket Emit PREP] Emitting 'group updated' (admin transfer) to room ${chatId}`
      );
      io.to(chatId).emit("group updated", updatedChat); // Send populated chat
    } else {
      console.error("[transferAdmin ERROR] req.io not available!");
    }
    // --- End Socket Event ---

    console.log(`[transferAdmin] Sending success response.`);
    return res.status(200).json({
      success: true,
      chat: updatedChat, // Send populated chat
      message: "Admin role transferred successfully.",
    });
  } catch (error) {
    console.error(
      `!!! [transferAdmin] Internal Server Error for chat ${chatId}:`,
      error
    );
    res.status(500).json({
      success: false,
      message: "Failed to transfer admin role due to a server error.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// @desc    Get single chat by ID (including user check)
// @route   GET /api/chat/:chatId
// @access  Private
exports.getChatById = asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const requesterId = req.user?._id;
  console.log(
    `[getChatById] Request for chat ${chatId} by user ${requesterId}`
  );

  if (!requesterId) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid Chat ID format" });
  }

  try {
    // Find the chat and ensure the requesting user is a member
    const chat = await Chat.findOne({
      _id: chatId,
      users: { $elemMatch: { $eq: requesterId } }, // Check membership
    });

    if (!chat) {
      // If not found or user not a member
      return res
        .status(404) // Or 403 Forbidden if you want to distinguish
        .json({
          success: false,
          message: "Chat not found or you do not have permission to access it.",
        });
    }

    // Populate the found chat
    const populatedChat = await populateChat(chat);
    if (!populatedChat) {
      console.error(
        `[getChatById] Found chat ${chatId}, but failed to populate.`
      );
      return res.status(500).json({
        success: false,
        message: "Found chat but failed to retrieve full details.",
        // Optionally send raw data if needed: chat: chat.toObject()
      });
    }

    console.log(
      `[getChatById] Successfully retrieved and populated chat ${chatId}.`
    );
    return res.status(200).json({ success: true, chat: populatedChat });
  } catch (error) {
    console.error(
      `!!! [getChatById] Internal Server Error for chat ${chatId}:`,
      error
    );
    res.status(500).json({
      success: false,
      message: "Server error while retrieving the chat.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// @desc    Update group profile picture
// @route   PUT /api/chat/update-pic
// @access  Private (Admin only)
exports.updateGroupPic = asyncHandler(async (req, res) => {
  // TODO: Implement actual file upload (e.g., Cloudinary) instead of just URL
  const { chatId, groupPic } = req.body; // Assuming groupPic is a URL for now
  const requesterId = req.user?._id;
  const io = req.io;
  console.log(
    `[updateGroupPic] Attempt by user ${requesterId} for chat ${chatId}`
  );

  if (!requesterId) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  if (!chatId || !groupPic) {
    // Basic check for URL presence
    return res
      .status(400)
      .json({ success: false, message: "Chat ID and picture URL required." });
  }
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid Chat ID format." });
  }
  // Add basic URL validation if desired
  // try { new URL(groupPic); } catch (_) { return res.status(400).json(...); }

  try {
    // Use findOneAndUpdate for atomicity and admin check
    const updatedChatRaw = await Chat.findOneAndUpdate(
      {
        _id: chatId,
        isGroupChat: true,
        groupAdmin: requesterId,
      },
      { $set: { groupPic: groupPic } }, // Assuming groupPic is just a URL string
      { new: true }
    );

    if (!updatedChatRaw) {
      const chatExists = await Chat.findById(chatId);
      if (!chatExists) {
        return res
          .status(404)
          .json({ success: false, message: "Chat not found" });
      } else if (!chatExists.isGroupChat) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Can only set picture for groups.",
          });
      } else if (chatExists.groupAdmin?.toString() !== requesterId.toString()) {
        return res
          .status(403)
          .json({ success: false, message: "Only admin can update picture." });
      } else {
        return res
          .status(500)
          .json({ success: false, message: "Failed to update group picture." });
      }
    }

    console.log(
      `[updateGroupPic] Chat ${chatId} picture updated. Populating...`
    );
    const updatedChat = await populateChat(updatedChatRaw); // Populate the result

    if (!updatedChat) {
      console.error(
        `[updateGroupPic] Updated pic for chat ${chatId}, but failed populate.`
      );
      return res.status(200).json({
        success: true,
        chat: updatedChatRaw.toObject(), // Send raw object
        message: "Group picture updated, but failed to refresh details.",
      });
    }

    // --- Socket Event for Group Update ---
    if (io) {
      console.log(
        `[Socket Emit PREP] Emitting 'group updated' (pic change) to room ${chatId}`
      );
      io.to(chatId).emit("group updated", updatedChat); // Send populated chat
    } else {
      console.error("[updateGroupPic ERROR] req.io not available!");
    }
    // --- End Socket Event ---

    console.log(
      `[updateGroupPic] Sending success response for chat ${chatId}.`
    );
    res.status(200).json({
      success: true,
      chat: updatedChat, // Send populated chat
      message: "Group picture updated successfully.",
    });
  } catch (error) {
    console.error(
      `!!! [updateGroupPic] Internal Server Error for chat ${chatId}:`,
      error
    );
    res.status(500).json({
      success: false,
      message: "Failed to update group picture due to a server error.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// @desc    Delete group chat
// @route   DELETE /api/chat/:chatId
// @access  Private (Admin only)
exports.deleteGroup = asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const requesterId = req.user?._id;
  const io = req.io;
  console.log(
    `[deleteGroup] Attempt by user ${requesterId} to delete group ${chatId}`
  );

  if (!requesterId) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated" });
  }
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid Chat ID format" });
  }

  try {
    // Find the chat first to verify admin and get details for socket event
    const chat = await Chat.findOne({
      _id: chatId,
      isGroupChat: true,
      groupAdmin: requesterId,
    });

    if (!chat) {
      // Check specific reason for failure
      const chatExists = await Chat.findById(chatId);
      if (!chatExists) {
        return res
          .status(404)
          .json({ success: false, message: "Group chat not found." });
      } else if (!chatExists.isGroupChat) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Cannot delete a non-group chat this way.",
          });
      } else if (chatExists.groupAdmin?.toString() !== requesterId.toString()) {
        return res
          .status(403)
          .json({
            success: false,
            message: "Only the group admin can delete the group.",
          });
      } else {
        return res
          .status(500)
          .json({
            success: false,
            message: "Failed to verify group/admin status for deletion.",
          });
      }
    }

    const chatName = chat.chatName; // Get name for event payload

    // --- Socket Event for Group Deletion (Emit BEFORE deleting from DB) ---
    if (io) {
      const eventData = { chatId: chatId, chatName: chatName };
      console.log(
        `[Socket Emit PREP] Emitting 'group deleted' to room ${chatId}. Data:`,
        eventData
      );
      io.to(chatId).emit("group deleted", eventData); // Notify members in the room

      // Force all connected sockets out of the chat room
      try {
        const socketsInRoom = await io.in(chatId).fetchSockets();
        socketsInRoom.forEach((socket) => {
          socket.leave(chatId);
          console.log(
            `[Socket Action] Forced socket ${socket.id} to leave deleted room ${chatId}`
          );
        });
      } catch (e) {
        console.error(
          `[Socket Action] Error forcing sockets to leave room ${chatId}:`,
          e
        );
      }
    } else {
      console.error(
        "[deleteGroup ERROR] req.io not available for socket emits!"
      );
    }
    // --- End Socket Event ---

    // Proceed with database deletion
    console.log(`[deleteGroup ACTION] Deleting chat document ${chatId}`);
    await Chat.deleteOne({ _id: chatId }); // Use deleteOne or findByIdAndDelete

    console.log(
      `[deleteGroup ACTION] Deleting messages associated with chat ${chatId}`
    );
    const messageDeletionResult = await Message.deleteMany({ chat: chatId });
    console.log(
      `[deleteGroup SUCCESS] Deleted chat document and ${messageDeletionResult.deletedCount} associated messages.`
    );

    // Respond to the HTTP request
    return res.status(200).json({
      success: true,
      message: `Group chat "${chatName}" deleted successfully.`,
      chatId: chatId, // Send back the ID for confirmation
    });
  } catch (error) {
    console.error(
      `!!! [deleteGroup FATAL ERROR] Chat: ${chatId}. Error:`,
      error
    );
    res.status(500).json({
      success: false,
      message: "Failed to delete group chat due to a server error.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});
