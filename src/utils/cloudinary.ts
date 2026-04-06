import { v2 as cloudinary } from "cloudinary";
import fs from "node:fs";

// 1- configure cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

// 2- create a function to upload image to cloudinary
const uploadImageToCloudinary = async (imagePath: string, folder: string = "Doctor") => {
  try {
    const result = await cloudinary.uploader.upload(imagePath, {
      folder,
      resource_type: "image",
    });

    // Remove the local file after uploading
    fs.unlinkSync(imagePath);
    return result;
  } catch (error) {
    console.error("Error uploading image to Cloudinary:", error);
    throw error;
  }
};

// to delete image from cloudinary
const deleteImageFromCloudinary = async (publicId: string) => {
  try {
    if (!publicId) {
      throw new Error("Public ID is required to delete image from Cloudinary");
    }
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error("Error deleting image from Cloudinary:", error);
    throw error;
  }
};

export { uploadImageToCloudinary, deleteImageFromCloudinary };
