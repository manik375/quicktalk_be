const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Setup cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'neumochat_profile_pics',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif'], 
    transformation: [{ width: 500, height: 500, crop: 'limit' }], // Resize to max 500x500
    // Use filename as public_id for easier management
    public_id: (req, file) => `user_${req.user._id}_${Date.now()}`
  }
});

// File filter to ensure only images are uploaded
const fileFilter = (req, file, cb) => {
  const filetypes = /jpeg|jpg|png|gif/;
  // Check extension
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  // Check mime type
  const mimetype = filetypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

// Setup multer upload for profile pics
const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
  fileFilter: fileFilter
});

// Middleware that handles file upload errors
const uploadProfilePic = (req, res, next) => {
  // Use multer's upload.single middleware, but wrap it to handle errors
  const uploadSingle = upload.single('profilePic');
  
  uploadSingle(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        // A Multer error occurred (e.g., file size exceeded)
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ message: 'File too large. Maximum size is 2MB.' });
        }
        return res.status(400).json({ message: `Upload error: ${err.message}` });
      } else {
        // An unknown error occurred
        return res.status(400).json({ message: err.message });
      }
    }
    // If everything went well, move to the next middleware
    next();
  });
};

module.exports = { uploadProfilePic }; 