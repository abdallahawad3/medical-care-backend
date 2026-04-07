import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import Stripe from "stripe";
import asyncWrapper from "../utils/asyncWrapper.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/index.js";
import ServiceAppointmentModel from "../models/ServiceAppointment.js";
import ServiceModel from "../models/Service.js";

const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? new Stripe(stripeKey, { apiVersion: "2022-11-15" }) : null;

// Helper functions
const safeNumber = (val: any) => {
  if (val === undefined || val === null || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
};

function parseTimeString(timeStr: any) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const t = timeStr.trim();
  const m = t.match(/([0-9]{1,2}):?([0-9]{0,2})\s*(AM|PM|am|pm)?/);
  if (!m) return null;
  let hh = parseInt(String(m[1]), 10);
  let mm = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = (m[3] || "").toUpperCase();
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

  if (ampm) {
    if (hh < 1 || hh > 12 || mm < 0 || mm > 59) return null;
    return { hour: hh, minute: mm, ampm };
  }

  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  if (hh === 0) return { hour: 12, minute: mm, ampm: "AM" };
  if (hh === 12) return { hour: 12, minute: mm, ampm: "PM" };
  if (hh > 12) return { hour: hh - 12, minute: mm, ampm: "PM" };
  return { hour: hh, minute: mm, ampm: "AM" };
}

const buildFrontendBase = (req: Request) => {
  const env = process.env.FRONTEND_URL;
  if (env) return env.replace(/\/$/, "");
  const origin = req.get("origin") || req.get("referer") || null;
  return origin ? origin.replace(/\/$/, "") : null;
};

function resolveClerkUserId(req: Request) {
  try {
    const auth = req.auth || {};
    const candidate = auth?.userId || auth?.user_id || auth?.user?.id || auth.user?.id || null;
    if (candidate) return candidate;
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

// To Create Service Appointment
const createServiceAppointment = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body || {};
    const clerkUserId = resolveClerkUserId(req);

    if (!clerkUserId) {
      throw new NotFoundError("Authentication is required to create a service appointment.");
    }
    const {
      serviceId,
      serviceName: serviceNameFromBody,
      patientName,
      mobile,
      age,
      gender,
      date,
      time,
      hour,
      minute,
      ampm,
      paymentMethod = "Online",
      amount: amountFromBody,
      fees: feesFromBody,
      email,
      meta = {},
      notes = "",
      serviceImageUrl: serviceImageUrlFromBody,
      serviceImagePublicId: serviceImagePublicIdFromBody,
    } = body;

    if (!serviceId) throw new NotFoundError("serviceId is required");
    if (!patientName || !String(patientName).trim())
      throw new ValidationError("patientName is required");
    if (!mobile || !String(mobile).trim()) throw new ValidationError("mobile is required");
    if (!date || !String(date).trim()) throw new ValidationError("date is required (YYYY-MM-DD)");

    const numericAmount = safeNumber(amountFromBody ?? feesFromBody ?? 0);
    if (numericAmount === null || numericAmount < 0)
      throw new ValidationError("amount/fees must be a valid number");

    let finalHour = hour !== undefined ? safeNumber(hour) : null;
    let finalMinute = minute !== undefined ? safeNumber(minute) : null;
    let finalAmpm = ampm || null;

    if (time && (finalHour === null || finalHour === undefined)) {
      const parsed = parseTimeString(time);
      if (!parsed) throw new ValidationError("time string couldn't be parsed");
      finalHour = parsed.hour;
      finalMinute = parsed.minute;
      finalAmpm = parsed.ampm;
    }

    if (finalHour === null || finalMinute === null || (finalAmpm !== "AM" && finalAmpm !== "PM")) {
      throw new ValidationError(
        "Time missing or invalid — provide time string or hour, minute and ampm.",
      );
    }

    // DUPLICATE BOOKING CHECK
    try {
      const existing = await ServiceAppointmentModel.findOne({
        serviceId: String(serviceId),
        createdBy: clerkUserId,
        date: String(date),
        hour: Number(finalHour),
        minute: Number(finalMinute),
        ampm: finalAmpm,
        status: { $ne: "Canceled" },
      }).lean();
      if (existing)
        throw new ConflictError(
          "You already have a booking for this service at the specified date and time.",
        );
    } catch (chkErr) {
      console.warn("Duplicate booking check failed:", chkErr);
    }

    // Fetch service snapshot (non-fatal)
    let svc = null;
    try {
      svc = await ServiceModel.findById(serviceId).lean();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.warn("Service lookup failed:", errMsg);
    }

    const svcData = svc as {
      name?: string;
      title?: string;
      image?: { url?: string; publicId?: string } | null;
      profileImage?: { url?: string; publicId?: string } | null;
      imageUrl?: string;
      imagePublicId?: string;
    };
    let resolvedServiceName = serviceNameFromBody || svcData?.name || svcData?.title || "Service";
    const svcImageUrlFromDB =
      svc &&
      (String(svcData.imageUrl || svcData.image || svcData.profileImage?.url || "").trim() || "");
    const svcImagePublicIdFromDB =
      svc &&
      (String(
        svcData.imagePublicId || svcData.image?.publicId || svcData.profileImage?.publicId || "",
      ).trim() ||
        "");
    const finalServiceImageUrl =
      svcImageUrlFromDB && svcImageUrlFromDB.length
        ? svcImageUrlFromDB
        : (serviceImageUrlFromBody && String(serviceImageUrlFromBody).trim()) || "";
    const finalServiceImagePublicId =
      svcImagePublicIdFromDB && svcImagePublicIdFromDB.length
        ? svcImagePublicIdFromDB
        : (serviceImagePublicIdFromBody && String(serviceImagePublicIdFromBody).trim()) || "";

    const base = {
      serviceId,
      serviceName: resolvedServiceName,
      serviceImage: { url: finalServiceImageUrl, publicId: finalServiceImagePublicId },
      patientName: String(patientName).trim(),
      mobile: String(mobile).trim(),
      age: age !== undefined && age !== null && String(age).trim() !== "" ? Number(age) : null,
      gender: gender || "",
      date: String(date),
      hour: Number(finalHour),
      minute: Number(finalMinute),
      ampm: finalAmpm,
      fees: numericAmount,
      createdBy: clerkUserId,
      notes: notes || "",
    };

    // Free appointment
    if (numericAmount === 0) {
      const created = await ServiceAppointmentModel.create({
        ...base,
        status: "Pending",
        payment: { method: "Cash", status: "Pending", amount: 0, paidAt: new Date() },
      });
      res.status(201).json({ success: true, appointment: created });
    }

    // Cash booking
    if (paymentMethod === "Cash") {
      const created = await ServiceAppointmentModel.create({
        ...base,
        status: "Pending",
        payment: { method: "Cash", status: "Pending", amount: numericAmount, meta },
      });
      res.status(201).json({ success: true, appointment: created, checkoutUrl: null });
    }

    // Online booking (Stripe)
    if (!stripe)
      throw new ConflictError(
        "Payment processing is not configured. Stripe secret key is missing.",
      );
    const frontendBase = buildFrontendBase(req);
    if (!frontendBase)
      throw new NotFoundError(
        "Frontend base URL not available. Set FRONTEND_URL or provide Origin header.",
      );

    const successUrl = `${frontendBase}/service-appointment/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendBase}/service-appointment/cancel`;

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        ...(email && { customer_email: String(email) }), // Only include if email exists
        line_items: [
          {
            price_data: {
              currency: "inr",
              product_data: {
                name: `Service: ${String(resolvedServiceName).slice(0, 60)}`,
                description: `Appointment on ${base.date} ${base.hour}:${String(base.minute).padStart(2, "0")} ${base.ampm}`,
              },
              unit_amount: Math.round(numericAmount * 100),
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          serviceId: String(serviceId),
          serviceName: String(resolvedServiceName).slice(0, 200),
          patientName: base.patientName,
          mobile: base.mobile,
          clerkUserId: base.createdBy || "",
          serviceImageUrl: finalServiceImageUrl ? String(finalServiceImageUrl).slice(0, 200) : "",
        },
      });
    } catch (stripeErr) {
      console.error("Stripe create session error:", stripeErr);
      const message = (stripeErr as { raw?: { message?: string } })?.raw?.message || "Stripe error";
      throw new ConflictError(`Payment processing failed: ${message}`);
    }

    try {
      const created = await ServiceAppointmentModel.create({
        ...base,
        status: "Confirmed",
        payment: {
          method: "Online",
          status: "Pending",
          amount: numericAmount,
          sessionId: session.id || "",
        },
      });
      res
        .status(201)
        .json({ success: true, appointment: created, checkoutUrl: session.url || null });
    } catch (dbErr) {
      console.error("DB error saving service appointment after stripe session:", dbErr);
      res.status(500).json({ success: false, message: "Failed to create appointment record" });
    }
  },
);

// Confirmation of payment
const confirmPayment = asyncWrapper(async (req: Request, res: Response, next: NextFunction) => {
  const { session_id } = req.query;
  if (!session_id || typeof session_id !== "string") {
    throw new ValidationError("session_id query parameter is required");
  }
  if (!stripe) {
    throw new ConflictError("Payment processing is not configured. Stripe secret key is missing.");
  }
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(String(session_id));
  } catch (err) {
    console.error("Stripe retrieve session error:", err);
    throw new NotFoundError("Payment session not found");
  }

  if (!session || session.payment_status !== "paid") {
    throw new ConflictError("Payment not completed");
  }

  let appt = await ServiceAppointmentModel.findOneAndUpdate(
    { "payment.sessionId": session_id },
    {
      $set: {
        "payment.status": "Confirmed",
        "payment.providerId": session.payment_intent || "",
        "payment.paidAt": new Date(),
        status: "Confirmed",
      },
    },
    { new: true },
  );

  if (!appt && session.metadata?.appointmentId) {
    appt = await ServiceAppointmentModel.findOneAndUpdate(
      { _id: session.metadata.appointmentId },
      {
        $set: {
          "payment.status": "Confirmed",
          "payment.providerId": session.payment_intent || "",
          "payment.paidAt": new Date(),
          status: "Confirmed",
        },
      },
      { new: true },
    );
  }

  if (!appt)
    throw new NotFoundError(
      "Appointment record not found for this payment. Please contact support with your payment details.",
    );
});

export const getServiceAppointments = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      serviceId,
      mobile,
      status,
      page: pageRaw = 1,
      limit: limitRaw = 50,
      search = "",
    } = req.query;
    const limit = Math.min(200, Math.max(1, parseInt(String(limitRaw), 10) || 50));
    const page = Math.max(1, parseInt(String(pageRaw), 10) || 1);
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (serviceId) filter.serviceId = serviceId;
    if (mobile) filter.mobile = mobile;
    if (status) filter.status = status;
    if (search) {
      const re = new RegExp(String(search), "i");
      filter.$or = [{ patientName: re }, { mobile: re }, { notes: re }];
    }

    const [appointments, total] = await Promise.all([
      ServiceAppointmentModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ServiceAppointmentModel.countDocuments(filter),
    ]);

    res.json({ success: true, appointments, total, page, limit });
  },
);

export const getServiceAppointmentById = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const appointment = await ServiceAppointmentModel.findById(id).lean();
    if (!appointment) throw new NotFoundError("Service appointment not found");
    res.json({ success: true, appointment });
  },
);

export const updateServiceAppointment = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const body = req.body || {};
    let updates: any = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.payment !== undefined) updates.payment = body.payment;
    if (body["payment.status"] !== undefined) updates["payment.status"] = body["payment.status"];

    if (body.rescheduledTo) {
      const { date, time } = body.rescheduledTo || {};
      updates.rescheduledTo = {};
      if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
          throw new ValidationError("rescheduledTo.date must be in YYYY-MM-DD format");
        updates.rescheduledTo.date = date;
        updates.date = date;
      }
      if (time) {
        updates.rescheduledTo.time = String(time);
        const parsed = parseTimeString(String(time));
        if (!parsed) throw new ValidationError("rescheduledTo.time string couldn't be parsed");
        updates.hour = parsed.hour;
        updates.minute = parsed.minute;
        updates.ampm = parsed.ampm;
        updates.time = `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")} ${parsed.ampm}`;
      }
      if (!body.status) updates.status = "Rescheduled";
    }

    if (updates.payment) {
      const method = updates.payment.method || updates.payment?.method;
      if (method && String(method).toLowerCase() === "online")
        updates.status = updates.status || "Confirmed";
      if (updates.payment.status && updates.payment.status === "Confirmed") {
        updates.status = "Confirmed";
        if (updates.payment.paidAt === undefined) updates.payment.paidAt = new Date();
      }
    }
    const updated = await ServiceAppointmentModel.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true },
    ).lean();
    if (!updated) throw new NotFoundError("Service appointment not found");
    res.json({ success: true, appointment: updated });
  },
);

// To cancel appointment
export const cancelServiceAppointment = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const appt = await ServiceAppointmentModel.findById(id);
    if (!appt) throw new NotFoundError("Service appointment not found");
    if (appt.status === "Completed")
      throw new ConflictError("Completed appointments cannot be canceled");

    appt.status = "Canceled";
    await appt.save();
    res.json({ success: true, message: "Service appointment canceled" });
  },
);

// To Get statics
export const getServiceAppointmentStats = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const services = await ServiceAppointmentModel.aggregate([
      {
        $lookup: {
          from: "serviceappointments",
          localField: "_id",
          foreignField: "serviceId",
          as: "appointments",
        },
      },
      {
        $addFields: {
          totalAppointments: { $size: "$appointments" },
          completed: {
            $size: {
              $filter: {
                input: "$appointments",
                as: "a",
                cond: { $eq: ["$$a.status", "Completed"] },
              },
            },
          },
          canceled: {
            $size: {
              $filter: {
                input: "$appointments",
                as: "a",
                cond: { $eq: ["$$a.status", "Canceled"] },
              },
            },
          },
        },
      },
      { $addFields: { earning: { $multiply: ["$completed", "$price"] } } },
      {
        $project: {
          name: 1,
          price: 1,
          image: "$imageUrl",
          totalAppointments: 1,
          completed: 1,
          canceled: 1,
          earning: 1,
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    res.json({ success: true, services, totalServices: services.length });
  },
);

// To get appointments for patient
export const getPatientAppointments = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const clerkUserId = resolveClerkUserId(req);
    const { createdBy, mobile } = req.query;
    const resolvedCreatedBy = String(createdBy || clerkUserId || "").trim();

    if (!resolvedCreatedBy && !mobile)
      throw new ValidationError("Invalid createdBy parameter and no authenticated user");

    const filter: any = {};
    if (resolvedCreatedBy) filter.createdBy = resolvedCreatedBy;
    if (mobile) filter.mobile = String(mobile).trim();

    const list = await ServiceAppointmentModel.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, appointments: list });
  },
);
