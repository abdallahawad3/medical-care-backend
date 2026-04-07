import mongoose from "mongoose";

const ServiceSchema = new mongoose.Schema(
  {
    about: { type: String, default: "" },
    shortDescription: { type: String, default: "" },
    price: { type: Number, default: 0 },
    available: { type: Boolean, default: true },
    imageUrl: { type: String, default: null },
    imagePublicId: { type: String, default: null },
    dates: { type: [String], default: [] },
    slots: { type: Map, of: [String], default: {} },
    instructions: { type: [String], default: [] },
    totalAppointments: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    canceled: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

ServiceSchema.index({ name: "text", about: "text", shortDescription: "text" });

const ServiceModel = mongoose.model("Service", ServiceSchema);

export default ServiceModel;
