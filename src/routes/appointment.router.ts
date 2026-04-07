import { Router } from "express";
import {
  createAppointment,
  getAppointments,
  updateAppointment,
  cancelAppointment,
  confirmPayment,
  getAppointmentsByDoctor,
  getAppointmentsByPatient,
  getPatientsByDoctor,
  getStats,
} from "../controllers/appointment.controller.js";
import { clerkMiddleware, requireAuth } from "@clerk/express";

const router = Router();

router.get("/", getAppointments);
router.get("/confirm", confirmPayment);
router.get("/stats/summary", getStats);

//Authenticated routes
router.post("/", clerkMiddleware(), requireAuth(), createAppointment);
router.get("/me", clerkMiddleware(), requireAuth(), getAppointmentsByPatient);
router.get("/doctor/:doctorId", clerkMiddleware(), requireAuth(), getAppointmentsByDoctor);

router.post("/:id/cancel", cancelAppointment);
router.get("/patient/count", getPatientsByDoctor);
router.put("/:id", updateAppointment);
export default router;
