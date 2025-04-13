// server/models/Chat.js
const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
  {
    chatName: {
      type: String,
      trim: true,
      // Optional: default could be set dynamically based on users if needed
    },
    isGroupChat: {
      type: Boolean,
      default: false,
    },
    users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User", // Reference to the User model
        required: true,
      },
    ],
    latestMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message", // Reference to the Message model
    },
    groupAdmin: {
      // Will be used for group chats later
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    about: {
      type: String,
      trim: true,
      default: "", // Default empty string for the about field
    },
    groupPic: {
      type: String,
      default: "", // Default empty string for group profile picture URL
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

// Optional: Index on users array for faster querying of chats involving specific users
chatSchema.index({ users: 1 });

const Chat = mongoose.model("Chat", chatSchema);

module.exports = Chat;
