import dotenv from "dotenv";
import type { Request, Response, NextFunction } from "express";

import AppointmentModel from "../models/Appointment.js";
import DoctorModel from "../models/Doctor.js";
import Stripe from "stripe";
import { getAuth } from "@clerk/express";
import asyncWrapper from "../utils/asyncWrapper.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from "../errors/index.js";
import AppError from "../errors/AppError.js";
import mongoose, { Types } from "mongoose";
import type { IAppointment } from "../interfaces/index.js";
import clerkClient from "@clerk/clerk-sdk-node";
// import { ClerkClient } from "@clerk/express";

dotenv.config();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL;
const MAJOR_ADMIN_ID = process.env.MAJOR_ADMIN_ID || null;
const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" })
  : null;

// This return a finite number or null if invalid
const safeNumber = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Build frontend base URL for success/cancel redirects after payment
const buildFrontendBase = (req: Request) => {
  if (FRONTEND_URL) return FRONTEND_URL.replace(/\/$/, "");
  const origin = req.get("origin") || req.get("referer");
  if (origin) return origin.replace(/\/$/, "");
  const host = req.get("host");
  if (host) return `${req.protocol || "http"}://${host}`.replace(/\/$/, "");
  return null;
};

// This functions tries to resolve the ~Clerk user ID~ from various possible locations in the request, including req.auth and getAuth(req).
// It returns the user ID if found, or null if not found or if any errors occur during the process.
function resolveClerkUserId(req: Request) {
  try {
    const auth = req.auth || {};
    const fromReq = auth?.userId || auth?.user_id || auth?.user?.id || auth?.user?.id || null;
    if (fromReq) return fromReq;
    try {
      const serverAuth = getAuth ? getAuth(req) : null;
      return serverAuth?.userId || null;
    } catch (e) {
      return null;
    }
  } catch (e) {
    return null;
  }
}

// to getAppointments
export const getAppointments = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      doctorId,
      mobile,
      status,
      search = "",
      limit: limitRaw = 50,
      page: pageRaw = 1,
      patientClerkId,
      createdBy,
    } = req.query;

    const limit = Math.min(200, Math.max(1, parseInt(String(limitRaw), 10) || 50));
    const page = Math.max(1, parseInt(String(pageRaw), 10) || 1);
    const skip = (page - 1) * limit;

    // * To filter appointments based on query params * //
    const filter: Record<string, unknown> = {};
    if (doctorId) filter.doctorId = doctorId;
    if (mobile) filter.mobile = mobile;
    if (status) filter.status = status;
    if (patientClerkId) filter.createdBy = patientClerkId;
    if (createdBy) filter.createdBy = createdBy;
    if (search) {
      const re = new RegExp(String(search), "i");
      filter.$or = [{ patientName: re }, { mobile: re }, { notes: re }];
    }

    const appointments = await Promise.all([
      AppointmentModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("doctorId", "name specialization imageUrl owner image")
        .lean(),
      AppointmentModel.countDocuments(filter),
    ]);
    const total = appointments[1];
    res.json({
      success: true,
      data: { appointments: appointments[0] },
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  },
);

export const getAppointmentsByPatient = asyncWrapper(async (req: Request, res: Response) => {
  const queryCreatedBy = String(req.query.createdBy || "").trim();
  const clerkUserId = req.auth?.userId || resolveClerkUserId(req);
  const createdBy = queryCreatedBy || clerkUserId;

  console.log(`createdBy (query or req.auth):`, {
    queryCreatedBy,
    clerkUserId,
    resolvedCreatedBy: createdBy,
  });

  if (!createdBy && req.query.mobile) {
    throw new UnauthorizedError(
      "Mobile-based filtering is not allowed without authentication. Please log in to view your appointments.",
    );
  }

  const filter: Record<string, unknown> = {};

  if (createdBy) {
    filter.createdBy = createdBy;
  }

  if (req.query.mobile) {
    filter.mobile = String(req.query.mobile).trim();
  }

  const appointments = await AppointmentModel.find(filter).sort({ date: 1, time: 1 }).lean();

  res.status(200).json({
    success: true,
    data: {
      appointments,
    },
  });
  // .populate("doctorId", "name specialization imageUrl owner image")
});

export const createAppointment = asyncWrapper(async (req: Request, res: Response) => {
  const {
    doctorId,
    patientName,
    mobile,
    age = "",
    gender = "",
    date,
    time,
    fee,
    fees,
    notes = "",
    email,
    paymentMethod,
    owner: ownerFromBody = null,
    doctorName: doctorNameFromBody,
    specialty: specialtyFromBody,
    doctorImageUrl: doctorImageUrlFromBody,
    doctorImagePublicId: doctorImagePublicIdFromBody,
  } = req.body || {};

  const clerkUserId = req.auth?.userId || resolveClerkUserId(req);
  if (!doctorId || !patientName || !mobile || !date || !time) {
    throw new BadRequestError("Missing required fields: doctorId, patientName, mobile, date, time");
  }

  const numericFee = safeNumber(fee) ?? safeNumber(fees) ?? 0;
  if (numericFee < 0 || isNaN(numericFee)) {
    throw new BadRequestError("Fee must be a valid non-negative number");
  }

  // Duplicate booking prevention: check if there's already a pending/confirmed appointment for same doctor + patient + date
  const existing = await AppointmentModel.findOne({
    doctorId,
    patientName: String(patientName).trim(),
    date: String(date),
    time: String(time),
    status: { $in: ["Pending", "Confirmed"] },
  });

  if (existing) {
    throw new ConflictError(
      "An appointment for this doctor and patient on the specified date and time already exists.",
    );
  }
  let doctor = null;
  try {
    doctor = await DoctorModel.findById(doctorId).lean();
    if (!doctor) {
      throw new NotFoundError("Doctor not found with the provided doctorId");
    }
    // Resolve owner, names, images, etc.
    let resolvedOwner = ownerFromBody || doctor?.owner || null;
    if (!resolvedOwner) resolvedOwner = MAJOR_ADMIN_ID || String(doctorId);

    const doctorName =
      (doctor.name && String(doctor.name).trim()) ||
      (doctorNameFromBody && String(doctorNameFromBody).trim()) ||
      "";
    const specialty =
      (doctor.specialization && String(doctor.specialization).trim()) ||
      (specialtyFromBody && String(specialtyFromBody).trim()) ||
      "";

    const doctorImageUrl =
      (doctor.imageUrl && String(doctor.imageUrl).trim()) ||
      (doctor.image && String(doctor.image).trim()) ||
      (doctor.avatarUrl && String(doctor.avatarUrl).trim()) ||
      (doctor.profileImage && doctor.profileImage.url && String(doctor.profileImage.url).trim()) ||
      (doctorImageUrlFromBody && String(doctorImageUrlFromBody).trim()) ||
      "";

    const doctorImagePublicId =
      (doctor.imagePublicId && String(doctor.imagePublicId).trim()) ||
      (doctor.profileImage &&
        doctor.profileImage.publicId &&
        String(doctor.profileImage.publicId).trim()) ||
      (doctorImagePublicIdFromBody && String(doctorImagePublicIdFromBody).trim()) ||
      "";

    const doctorImage = { url: doctorImageUrl, publicId: doctorImagePublicId };

    const base = {
      doctorId: String(doctor._id || doctorId),
      doctorName,
      specialty,
      doctorImage,
      patientName: String(patientName).trim(),
      mobile: String(mobile).trim(),
      age: age ? Number(age) : null,
      gender: gender ? String(gender) : "",
      date: String(date),
      time: String(time),
      fees: numericFee,
      status: "Pending",
      payment: {
        method: paymentMethod === "Cash" ? "Cash" : "Online",
        status: "Pending",
        amount: numericFee,
      },
      notes: notes || "",
      createdBy: clerkUserId,
      owner: resolvedOwner,
      sessionId: null,
    };

    // Free appointment
    if (numericFee === 0) {
      const created = await AppointmentModel.create({
        ...base,
        status: "Confirmed",
        payment: { method: base.payment.method, status: "Paid", amount: 0 },
        paidAt: new Date(),
      });
      res.status(201).json({ success: true, appointment: created, checkoutUrl: null });
    }

    // Cash payment
    if (paymentMethod === "Cash") {
      const created = await AppointmentModel.create({
        ...base,
        status: "Pending",
        payment: { method: "Cash", status: "Pending", amount: numericFee },
      });
      res.status(201).json({ success: true, appointment: created, checkoutUrl: null });
    }

    // Online: Stripe
    if (!stripe)
      throw new AppError("Stripe not configured on server", 500, "STRIPE_NOT_CONFIGURED");

    const frontBase = buildFrontendBase(req);
    if (!frontBase) {
      throw new AppError(
        "Unable to determine frontend URL for payment redirects. Please set FRONTEND_URL environment variable or ensure request has valid origin/referer header.",
        500,
        "FRONTEND_URL_ERROR",
      );
    }

    const successUrl = `${frontBase}/appointment/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontBase}/appointment/cancel`;

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        customer_email: email || undefined,
        line_items: [
          {
            price_data: {
              currency: "inr",
              product_data: { name: `Appointment - ${String(patientName).slice(0, 40)}` },
              unit_amount: Math.round(numericFee * 100),
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          doctorId: String(doctorId),
          doctorName: doctorName || "",
          specialty: specialty || "",
          patientName: base.patientName,
          mobile: base.mobile,
          clerkUserId: clerkUserId || "",
        },
      });
    } catch (stripeErr) {
      console.error("Stripe create session error:", stripeErr);
      const message = (stripeErr as { raw?: { message?: string } })?.raw?.message || "Stripe error";
      throw new AppError(message, 500, "STRIPE_ERROR");
    }

    try {
      const providerId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;

      const created = await AppointmentModel.create({
        ...base,
        sessionId: session.id,
        payment: {
          ...base.payment,
          ...(providerId ? { providerId } : {}),
        },
        status: "Pending",
      });
      res
        .status(201)
        .json({ success: true, appointment: created, checkoutUrl: session.url || null });
    } catch (dbErr) {
      console.error("DB error saving appointment after stripe session:", dbErr);
      throw new AppError(
        "Failed to create appointment after initiating payment. Please contact support.",
        500,
        "APP_ERROR",
      );
    }
  } catch (error) {}
});

// confirmPayment
export const confirmPayment = asyncWrapper(async (req: Request, res: Response) => {
  const { session_id } = req.query;
  if (!session_id || typeof session_id !== "string") {
    throw new BadRequestError("Missing or invalid session_id in query");
  }

  if (!stripe) {
    throw new AppError("Stripe not configured on server", 500, "STRIPE_NOT_CONFIGURED");
  }

  let session;

  try {
    session = await stripe.checkout.sessions.retrieve(String(session_id));
  } catch (err) {
    console.error("Stripe retrieve session error:", err);
    const message = (err as { raw?: { message?: string } })?.raw?.message || "Stripe error";
    throw new AppError(message, 500, "STRIPE_ERROR");
  }
  if (!session) {
    throw new NotFoundError("Payment session not found with the provided session_id");
  }

  if (session.payment_status !== "paid") {
    throw new BadRequestError("Payment for this session is not completed yet");
  }

  if (session.mode !== "payment") {
    throw new BadRequestError("Invalid session mode");
  }
  let appt: typeof AppointmentModel.prototype | null = null;
  appt = await AppointmentModel.findOneAndUpdate(
    { sessionId: session_id },
    {
      "payment.status": "Paid",
      "payment.providerId": session.payment_intent || null,
      status: "Confirmed",
      paidAt: new Date(),
    },
    { new: true },
  );

  // fallback: try match via metadata (doctorId + mobile + patientName)
  if (!appt) {
    const meta = session.metadata || {};
    if (meta.doctorId && meta.mobile && meta.patientName) {
    
      appt = await AppointmentModel.findOneAndUpdate(
        {
          doctorId: new Types.ObjectId(meta.doctorId),
          mobile: meta.mobile,
          patientName: meta.patientName,
          fees: Math.round((session.amount_total || 0) / 100) || undefined,
        },
        {
          "payment.status": "Paid",
          "payment.providerId": session.payment_intent || null,
          status: "Confirmed",
          paidAt: new Date(),
          sessionId: session_id,
        },
        { new: true },
      );
    }
  }

  // last attempt: find appointment created in last 15 minutes with matching amount
  if (!appt) {
    const amount = Math.round((session.amount_total || 0) / 100);
    const fifteenAgo = new Date(Date.now() - 1000 * 60 * 15);
    appt = await AppointmentModel.findOneAndUpdate(
      { fees: amount, createdAt: { $gte: fifteenAgo } },
      {
        "payment.status": "Paid",
        "payment.providerId": session.payment_intent || null,
        status: "Confirmed",
        paidAt: new Date(),
        sessionId: session_id,
      },
      { new: true },
    );
  }

  if (!appt) {
    res
      .status(404)
      .json({ success: false, message: "Appointment not found for this payment session" });
  }

  res.status(200).json({ success: true, appointment: appt });
});
// Try match by sessionId first

export const updateAppointment = asyncWrapper(async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body || {};
  const appt = await AppointmentModel.findById(id);

  if (!appt) {
    throw new NotFoundError("Appointment not found with the provided ID");
  }

  const terminal = appt.status === "Completed" || appt.status === "Canceled";
  if (terminal && body.status && body.status !== appt.status) {
    throw new BadRequestError("Cannot change status of a completed/canceled appointment");
  }

  const update: any = {};
  if (body.status) update.status = body.status;
  if (body.notes !== undefined) update.notes = body.notes;

  if (body.date && body.time) {
    if (appt.status === "Completed" || appt.status === "Canceled") {
      throw new BadRequestError("Cannot reschedule a completed or canceled appointment");
    }
    update.date = body.date;
    update.time = body.time;
    update.status = "Rescheduled";
    update.rescheduledTo = { date: body.date, time: body.time };
  }
});

// cancelAppointment
export const cancelAppointment = asyncWrapper(async (req: Request, res: Response) => {
  const { id } = req.params;
  const appt = await AppointmentModel.findById(id);
  if (!appt) {
    throw new NotFoundError("Appointment not found with the provided ID");
  }
  if (appt.status === "Canceled") {
    throw new BadRequestError("Appointment is already canceled");
  }
  appt.status = "Canceled";
  await appt.save();
  res.status(200).json({ success: true, appointment: appt });
});

// getStats
export const getStats = asyncWrapper(async (req: Request, res: Response) => {
  const totalAppointments = await AppointmentModel.countDocuments();
  const statusCountsAgg = await AppointmentModel.aggregate([
    { $match: { "payment.status": "Paid" } },
    { $group: { _id: null, total: { $sum: "$fees" } } },
  ]);
  const revenue = (statusCountsAgg[0] && statusCountsAgg[0].total) || 0;
  const saveDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7); // 7 days ago
  const recentAppointments = await AppointmentModel.countDocuments({
    createdAt: { $gte: saveDaysAgo },
  });

  res.status(200).json({
    success: true,
    data: {
      totalAppointments,
      revenue,
      recentAppointments,
    },
  });
});

//getAppointmentsByDoctor
export const getAppointmentsByDoctor = asyncWrapper(async (req: Request, res: Response) => {
  const { doctorId } = req.params;
  if (!doctorId) {
    throw new BadRequestError("Missing doctorId in request parameters");
  }

  const doctor = await DoctorModel.findById(doctorId);
  if (!doctor) {
    throw new NotFoundError("Doctor not found with the provided doctorId");
  }
  const { mobile, status, search = "", limit: limitRaw = 50, page: pageRaw = 1 } = req.query;
  const limit = Math.min(200, Math.max(1, parseInt(String(limitRaw), 10) || 50));
  const page = Math.max(1, parseInt(String(pageRaw), 10) || 1);
  const skip = (page - 1) * limit;

  const filter: any = { doctorId };
  if (mobile) filter.mobile = mobile;
  if (status) filter.status = status;
  if (search) {
    const re = new RegExp(String(search), "i");
    filter.$or = [{ patientName: re }, { mobile: re }, { notes: re }];
  }

  const appointments = await Promise.all([
    AppointmentModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .populate("doctorId", "name specialization imageUrl owner image"),
    AppointmentModel.countDocuments(filter),
  ]);
  const total = appointments[1];
  res.json({
    success: true,
    data: { appointments: appointments[0] },
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// To get registered patients for a doctor
export const getPatientsByDoctor = asyncWrapper(async (req: Request, res: Response) => {
  const { doctorId } = req.params;
  if (!doctorId) {
    throw new BadRequestError("Missing doctorId in request parameters");
  }
  const doctor = await DoctorModel.findById(doctorId);
  if (!doctor) {
    throw new NotFoundError("Doctor not found with the provided doctorId");
  }
  const totalUsers = await clerkClient.users.getCount();
  res.status(200).json({
    success: true,
    data: {
      totalPatients: totalUsers,
    },
  });
});
