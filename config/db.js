const mongoose = require("mongoose");
require("dotenv").config(); // Make sure environment variables are loaded

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // Remove deprecated options if using Mongoose v6+
      // useNewUrlParser: true, // Deprecated
      // useUnifiedTopology: true, // Deprecated
      // useCreateIndex: true, // Deprecated
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1); // Exit process with failure
  }
};

module.exports = connectDB;
