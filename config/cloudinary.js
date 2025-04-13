import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export const uploadToCloudinary = async (file) => {
  try {
    const result = await cloudinary.uploader.upload(file.path, {
      resource_type: 'auto',
      folder: 'quicktalk'
    });
    
    // Delete file from server after upload
    fs.unlinkSync(file.path);
    
    return result;
  } catch (error) {
    fs.unlinkSync(file.path); // Ensure file gets deleted even if upload fails
    throw error;
  }
};