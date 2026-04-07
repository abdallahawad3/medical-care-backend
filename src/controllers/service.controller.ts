import type { Request, Response, NextFunction } from "express";
import ServiceModel from "../models/Service.js";
import { uploadImageToCloudinary, deleteImageFromCloudinary } from "../utils/cloudinary.js";
import asyncWrapper from "../utils/asyncWrapper.js";
import { NotFoundError } from "../errors/index.js";

// Helpers function

// Parses a field that can be either a JSON array string, a comma-separated string, or an actual array
const parseJsonArrayField = (field: any) => {
  if (!field) return [];
  if (Array.isArray(field)) return field;
  if (typeof field === "string") {
    try {
      const parsed = JSON.parse(field);
      if (Array.isArray(parsed)) return parsed;
      return typeof parsed === "string" ? [parsed] : [];
    } catch {
      return field
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
};

// Normalizes an array of slot strings into a map of date keys to time arrays
// Expected input format: "15 Aug 2024 • 10:00 AM"
// Output format: { "2024-08-15": ["10:00 AM"] }
function normalizeSlotsToMap(slotStrings = []) {
  const map: any = {};
  slotStrings.forEach((raw: any) => {
    const m = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s*•\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) {
      // fallback: keep raw in an "unspecified" bucket
      map["unspecified"] = map["unspecified"] || [];
      map["unspecified"].push(raw);
      return;
    }
    const [, day, monShort, year, hour, minute, ampm] = m;
    const monthIdx = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ].findIndex((x) => x.toLowerCase() === monShort.toLowerCase());
    const mm = String(monthIdx + 1).padStart(2, "0");
    const dd = String(Number(day)).padStart(2, "0");
    const dateKey = `${year}-${mm}-${dd}`; // YYYY-MM-DD
    const timeStr = `${String(Number(hour)).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${ampm.toUpperCase()}`;
    map[dateKey] = map[dateKey] || [];
    map[dateKey].push(timeStr);
  });
  return map;
}

// Sanitizes a price input by stripping non-numeric characters and converting to a number
// Examples: "$100" -> 100, "100.50" -> 100.5, "abc" -> 0
const sanitizePrice = (v: any) => Number(String(v ?? "0").replace(/[^\d.-]/g, "")) || 0;
// Parses an availability input into a boolean
// Examples: "available", "true" -> true; "unavailable", "false" -> false; undefined -> true
const parseAvailability = (v: any) => {
  const s = String(v ?? "available").toLowerCase();
  return s === "available" || s === "true";
};

export const createService = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const b = req.body || {};
    // Parse and normalize fields that can come in various formats (e.g. JSON string, comma-separated string, or array)
    const instructions = parseJsonArrayField(b.instructions);
    const rawSlots = parseJsonArrayField(b.slots);
    // Normalize slots into a consistent map format and sanitize price and availability inputs for robustness against different client formats
    const slots = normalizeSlotsToMap(rawSlots as []);
    const numericPrice = sanitizePrice(b.price);
    const available = parseAvailability(b.availability);
    let imageUrl = null;
    let imagePublicId = null;

    if (req.file) {
      try {
        const up = await uploadImageToCloudinary(req.file.path, "services");
        imageUrl = up?.secure_url || null;
        imagePublicId = up?.public_id || null;
      } catch (err) {
        console.error("Cloudinary upload error:", err);
      }
    }

    const service = new ServiceModel({
      name: b.name || "",
      about: b.about || "",
      shortDescription: b.shortDescription || "",
      price: numericPrice,
      available,
      instructions,
      slots,
      imageUrl,
      imagePublicId,
    });

    const saved = await service.save();
    res.status(201).json({
      success: true,
      message: "Service created successfully",
      data: {
        service: saved,
      },
    });
  },
);

// Get all services with pagination and optional search
export const getServices = asyncWrapper(async (req: Request, res: Response, next: NextFunction) => {
  const { page = "1", limit = "10", search = "" } = req.query;
  const pageNum = Math.max(1, parseInt(String(page), 10));
  const limitNum = Math.max(1, parseInt(String(limit), 10));
  const skip = (pageNum - 1) * limitNum;

  const list = await ServiceModel.find().sort({ createdAt: -1 }).lean().limit(limitNum).skip(skip);
  res.json({
    success: true,
    data: {
      services: list,
    },
    pagination: {
      page: pageNum,
      limit: limitNum,
    },
  });
});

// Get a single service by ID
export const getServiceById = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const service = await ServiceModel.findById(id).lean();
    if (!service) {
      throw new NotFoundError("Service not found");
    }
    res.json({
      success: true,
      data: {
        service,
      },
    });
  },
);

// Update a service by ID
export const updateService = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const b = req.body || {};
    const existing = await ServiceModel.findById(id);
    if (!existing) {
      throw new NotFoundError("Service not found");
    }
    let updateData: any = {};
    if (b.name !== undefined) updateData.name = b.name;
    if (b.about !== undefined) updateData.about = b.about;
    if (b.shortDescription !== undefined) updateData.shortDescription = b.shortDescription;
    if (b.price !== undefined) updateData.price = sanitizePrice(b.price);
    if (b.availability !== undefined) updateData.available = parseAvailability(b.availability);
    if (b.instructions !== undefined) updateData.instructions = parseJsonArrayField(b.instructions);
    if (b.slots !== undefined)
      updateData.slots = normalizeSlotsToMap(parseJsonArrayField(b.slots) as []);
    if (req.file) {
      try {
        const up = await uploadImageToCloudinary(req.file.path, "services");
        if (up?.secure_url) {
          updateData.imageUrl = up.secure_url;
          updateData.imagePublicId = up.public_id || null;
          if (existing.imagePublicId) {
            try {
              await deleteImageFromCloudinary(existing.imagePublicId);
            } catch (err) {
              console.warn(
                "Cloudinary delete failed:",
                (err as { message: string })?.message || err,
              );
            }
          }
        }
      } catch (err) {
        console.error("Cloudinary upload error:", err);
      }
    }

    const updated = await ServiceModel.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).lean();

    res.json({
      success: true,
      message: "Service updated successfully",
      data: {
        service: updated,
      },
    });
  },
);

export const deleteService = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const existing = await ServiceModel.findById(id);
    if (!existing) {
      throw new NotFoundError("Service not found");
    }

    if (existing.imagePublicId) {
      try {
        await deleteImageFromCloudinary(existing.imagePublicId);
      } catch (err) {
        console.warn("Cloudinary delete failed:", (err as { message: string })?.message || err);
      }
    }

    await ServiceModel.findByIdAndDelete(id);
    res.status(204).json({
      success: true,
      message: "Service deleted successfully",
      data: null,
    });
  },
);
