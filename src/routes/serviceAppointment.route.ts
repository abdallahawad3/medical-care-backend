import { Router } from "express";
import {
  cancelServiceAppointment,
  confirmPayment,
  createServiceAppointment,
  getPatientAppointments,
  getServiceAppointmentById,
  getServiceAppointmentStats,
  getServiceAppointments,
  updateServiceAppointment,
} from "../controllers/service.appointment.controller.js";
import { clerkMiddleware, requireAuth } from "@clerk/express";

const router = Router();

router.get("/", getServiceAppointments);
router.get("/confirm", confirmPayment);
router.get("/stats/summary", getServiceAppointmentStats);

router.post("/", clerkMiddleware(), requireAuth(), createServiceAppointment);
router.get("/me", clerkMiddleware(), requireAuth(), getPatientAppointments);
router.get("/:id", getServiceAppointmentById);
router.put("/:id", updateServiceAppointment);
router.post("/cancel", cancelServiceAppointment);

export default router;
