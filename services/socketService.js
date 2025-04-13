module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Join user's personal room (for private notifications)
    socket.on("setup", (userId) => {
      socket.join(userId);
      socket.emit("connected");
    });

    // Join a chat room
    socket.on("join-chat", (chatId) => {
      socket.join(chatId);
    });

    // Handle new message
    socket.on("new-message", (newMessage) => {
      const chat = newMessage.chat;
      socket.to(chat._id).emit("message-received", newMessage);
    });

    // Handle typing indicator
    socket.on("typing", (chatId) => {
      socket.to(chatId).emit("typing");
    });
    socket.on("stop-typing", (chatId) => {
      socket.to(chatId).emit("stop-typing");
    });

    // Handle disconnect
    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.id}`);
    });
  });
};
