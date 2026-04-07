import mongoose, { Schema } from "mongoose";
import { time } from "node:console";

const DoctorSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },

    password: {
      type: String,
      required: true,
      select: false,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    specialization: { type: String, default: "" },
    imageUrl: { type: String, default: null },
    imagePublicId: { type: String, default: null },
    experience: { type: String, default: "" },
    qualifications: { type: String, default: "" },
    location: { type: String, default: "" },
    about: { type: String, default: "" },
    fee: { type: Number, default: 0 },
    availability: {
      type: String,
      enum: ["Available", "Unavailable"],
      default: "Available",
    },
    schedule: { type: Map, of: [String], default: {} },
    success: { type: String, default: "" },
    patients: { type: String, default: "" },
    rating: { type: Number, default: 0 },
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User", // or whatever your owner model is
      default: null,
    },
    image: { type: String, default: null },
    avatarUrl: { type: String, default: null },
    profileImage: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
    },
  },
  { timestamps: true },
);

DoctorSchema.index({ name: "text", specialization: "text" });
const DoctorModel = mongoose.model("Doctor", DoctorSchema);

export default DoctorModel;
