import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import asyncWrapper from "../utils/asyncWrapper.js";
import DoctorModel from "../models/Doctor.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors/index.js";
import { deleteImageFromCloudinary, uploadImageToCloudinary } from "../utils/cloudinary.js";

const parseTimeToMinutes = (t = "") => {
  const [time = "0:00", ampm = ""] = (t || "").split(" ");
  const [hh = 0, mm = 0] = time.split(":").map(Number);
  let h = hh % 12;
  if ((ampm || "").toUpperCase() === "PM") h += 12;
  return h * 60 + (mm || 0);
};

function dedupeAndSortSchedule(schedule = {}) {
  const out: any = {};
  Object.entries(schedule).forEach(([date, slots]) => {
    if (!Array.isArray(slots)) return;
    const uniq = Array.from(new Set(slots));
    uniq.sort((a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b));
    out[date] = uniq;
  });
  return out;
}

function parseScheduleInput(s: any) {
  if (!s) return {};
  if (typeof s === "string") {
    try {
      s = JSON.parse(s);
    } catch {
      return {};
    }
  }
  return dedupeAndSortSchedule(s || {});
}

function normalizeDocForClient(raw = {}) {
  const doc: any = { ...raw };

  // convert Mongoose Map to plain object
  if (doc.schedule && typeof doc.schedule.forEach === "function") {
    const obj: any = {};
    doc.schedule.forEach((val: any, key: any) => {
      obj[key] = Array.isArray(val) ? val : [];
    });
    doc.schedule = obj;
  } else if (!doc.schedule || typeof doc.schedule !== "object") {
    doc.schedule = {};
  }

  doc.availability = doc.availability === undefined ? "Available" : doc.availability;
  doc.patients = doc.patients ?? "";
  doc.rating = doc.rating ?? 0;
  doc.fee = doc.fee ?? doc.fees ?? 0;

  return doc;
}

export const createDoctor = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body;
    const emailLc = (body.email || "").toLowerCase();

    if (await DoctorModel.findOne({ email: emailLc })) {
      throw new ConflictError("Email already exists");
    }

    let imageURL = body.imageUrl || null;
    let imagePublicId = body.imagePublicId || null;

    if (req.file?.path) {
      const uploaded = await uploadImageToCloudinary(req.file.path, "doctors");
      imageURL = uploaded?.url || uploaded?.secure_url || imageURL;
      imagePublicId = uploaded?.public_id || imagePublicId || uploaded?.publicId;
    }

    const schedule = parseScheduleInput(body.schedule);

    const salt = await bcrypt.genSalt(10);
    const hashPassword = await bcrypt.hash(body.password, salt);

    const doc = new DoctorModel({
      email: emailLc,
      password: hashPassword,
      name: body.name,
      specialization: body.specialization || "",
      imageUrl: imageURL,
      imagePublicId,
      availability: body.availability || "Available",
      experience: body.experience || "",
      qualifications: body.qualifications || "",
      location: body.location || "",
      about: body.about || "",
      fee: body.fee !== undefined ? Number(body.fee) : 0,
      schedule,
      success: body.success || "",
      patients: body.patients || "",
      rating: body.rating !== undefined ? Number(body.rating) : 0,
    });
    await doc.save();

    const secret = process.env.JWT_SECRET!;
    if (!secret) {
      throw new Error("JWT_SECRET is not defined in environment variables");
    }

    const token = await jwt.sign(
      {
        id: doc._id.toString(),
        email: doc.email,
        role: "doctor",
      },
      secret,
      { expiresIn: "7d" },
    );

    const normalizedDoc = normalizeDocForClient(doc.toObject());
    delete normalizedDoc.password;
    res.status(201).json({
      success: true,
      message: "Doctor created successfully",
      data: {
        doctor: normalizedDoc,
      },
      token,
    });
  },
);

export const getDoctors = asyncWrapper(async (req: Request, res: Response, next: NextFunction) => {
  const { q = "" } = req.query;

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 10));
  const skip = (page - 1) * limit;

  const match: any = {};

  if (q && typeof q === "string" && q.trim()) {
    const re = new RegExp(q.trim(), "i");
    match.$or = [{ name: re }, { specialization: re }, { specialty: re }, { email: re }];
  }

  const docs = await DoctorModel.aggregate([
    { $match: match },
    {
      $lookup: {
        from: "appointments",
        localField: "_id",
        foreignField: "doctorId",
        as: "appointments",
      },
    },
    {
      $addFields: {
        appointmentsTotal: { $size: "$appointments" },
        appointmentsCompleted: {
          $size: {
            $filter: {
              input: "$appointments",
              as: "a",
              cond: { $in: ["$$a.status", ["Confirmed", "Completed"]] },
            },
          },
        },
        appointmentsCanceled: {
          $size: {
            $filter: {
              input: "$appointments",
              as: "a",
              cond: { $eq: ["$$a.status", "Canceled"] },
            },
          },
        },
        earnings: {
          $sum: {
            $map: {
              input: {
                $filter: {
                  input: "$appointments",
                  as: "a",
                  cond: { $in: ["$$a.status", ["Confirmed", "Completed"]] },
                },
              },
              as: "p",
              in: { $ifNull: ["$$p.fees", 0] },
            },
          },
        },
      },
    },
    { $project: { appointments: 0 } },
    { $sort: { name: 1 } },
    { $skip: skip },
    { $limit: limit },
  ]);

  const normalized = docs.map((d) => ({
    _id: d._id,
    id: d._id,
    name: d.name || "",
    specialization: d.specialization || d.speciality || "",
    fee: d.fee ?? d.fees ?? d.consultationFee ?? 0,
    imageUrl: d.imageUrl || d.image || d.avatar || null,
    appointmentsTotal: d.appointmentsTotal || 0,
    appointmentsCompleted: d.appointmentsCompleted || 0,
    appointmentsCanceled: d.appointmentsCanceled || 0,
    earnings: d.earnings || 0,
    availability: d.availability ?? "Available",
    schedule: d.schedule && typeof d.schedule === "object" ? d.schedule : {},
    patients: d.patients ?? "",
    rating: d.rating ?? 0,
    about: d.about ?? "",
    experience: d.experience ?? "",
    qualifications: d.qualifications ?? "",
    location: d.location ?? "",
    success: d.success ?? "",
    raw: d,
  }));

  const total = await DoctorModel.countDocuments(match);
  res.json({
    success: true,
    data: {
      doctors: normalized,
    },
    meta: { page, limit, total },
  });
});

export const getDoctorById = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const doc = await DoctorModel.findById(id).select("-password").lean();
    if (!doc) {
      throw new NotFoundError("Doctor not found");
    }
    const normalizedDoc = normalizeDocForClient(doc);
    res.json({ success: true, data: { doctor: normalizedDoc } });
  },
);

export const updateDoctor = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const body = req.body || {};

    if (!req.doctor || String(req.doctor._id || req.doctor.id) !== String(id)) {
      throw new ForbiddenError("Not authorized to update this doctor");
    }

    const existing = await DoctorModel.findById(id);
    if (!existing) throw new NotFoundError("Doctor not found");

    if (req.file?.path) {
      const uploaded = await uploadImageToCloudinary(req.file.path, "doctors");
      if (uploaded) {
        const previousPublicId = existing.imagePublicId;
        existing.imageUrl = uploaded.secure_url || uploaded.url || existing.imageUrl || null;
        existing.imagePublicId = uploaded.public_id || uploaded.publicId || existing.imagePublicId;
        if (previousPublicId && previousPublicId !== existing.imagePublicId) {
          deleteImageFromCloudinary(previousPublicId).catch((e) =>
            console.warn("deleteFromCloudinary warning:", e?.message || e),
          );
        }
      }
    } else if (body.imageUrl) {
      existing.imageUrl = body.imageUrl;
    }

    if (body.schedule) existing.schedule = parseScheduleInput(body.schedule);

    const updatable = [
      "name",
      "specialization",
      "experience",
      "qualifications",
      "location",
      "about",
      "fee",
      "availability",
      "success",
      "patients",
      "rating",
    ];

    updatable.forEach((k) => {
      if (body[k] !== undefined) (existing as any)[k] = body[k];
    });

    if (body.email && body.email !== existing.email) {
      const other = await DoctorModel.findOne({ email: body.email.toLowerCase() });
      if (other && other._id.toString() !== id) {
        res.status(409).json({ success: false, message: "Email already in use" });
      }
      existing.email = body.email.toLowerCase();
    }

    if (body.password) existing.password = body.password;

    await existing.save();

    const out = normalizeDocForClient(existing.toObject());
    delete out.password;
    res.json({ success: true, data: out });
  },
);

// To Delete a doctor (not used in current implementation, but can be useful for admin functionality)
export const deleteDoctor = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const existing = await DoctorModel.findById(id);
    if (!existing) throw new NotFoundError("Doctor not found");

    if (existing.imagePublicId) {
      await deleteImageFromCloudinary(existing.imagePublicId).catch((e) =>
        console.warn("deleteFromCloudinary warning:", e?.message || e),
      );
    }

    await DoctorModel.deleteOne({ _id: id });
    res.json({ success: true, message: "Doctor deleted successfully" });
  },
);

// To toggle doctor availability (not used in current implementation, but can be useful for quick status updates)
export const toggleDoctorAvailability = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    if (!req.doctor || String(req.doctor._id || req.doctor.id) !== String(id)) {
      throw new ForbiddenError("Not authorized to update this doctor's availability");
    }

    const existing = await DoctorModel.findById(id);
    if (!existing) throw new NotFoundError("Doctor not found");

    existing.availability = existing.availability === "Available" ? "Unavailable" : "Available";
    await existing.save();
    delete (existing as any).password;

    const normalizedDoc = normalizeDocForClient(existing.toObject());
    res.status(200).json({ success: true, data: { DoctorModel: normalizedDoc } });
  },
);

// To login a doctor

export const loginDoctor = asyncWrapper(async (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;
  const emailLc = (email || "").toLowerCase();
  const doctor = await DoctorModel.findOne({ email: emailLc }).select("+password");
  if (!doctor) {
    throw new NotFoundError("Doctor not found");
  }
  console.log(password, doctor);
  const isMatch = await bcrypt.compare(password, doctor.password);
  console.log("isMatch ===>", isMatch);
  if (!isMatch) {
    throw new ForbiddenError("Invalid credentials");
  }
  const secret = process.env.JWT_SECRET!;

  if (!secret) {
    throw new Error("JWT_SECRET is not defined in environment variables");
  }

  const token = await jwt.sign(
    {
      id: doctor._id.toString(),
      email: doctor.email,
      role: "doctor",
    },
    secret,
    { expiresIn: "7d" },
  );

  const normalizedDoc = normalizeDocForClient(doctor.toObject());
  delete normalizedDoc.password;
  res.json({
    success: true,
    message: "Login successful",
    data: {
      doctor: normalizedDoc,
    },
    token,
  });
});
