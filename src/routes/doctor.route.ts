import { Router } from "express";
import {
  createDoctor,
  deleteDoctor,
  getDoctorById,
  getDoctors,
  loginDoctor,
  toggleDoctorAvailability,
  updateDoctor,
} from "../controllers/doctor.controller.js";
import upload from "../middlewares/multerMiddleware.js";
import { authMiddleware } from "../middlewares/AuthMiddleware.js";
const router = Router();

router.route("/").get(getDoctors).post(upload.single("image"), createDoctor);

router
  .route("/:id")
  .get(getDoctorById)
  .put(authMiddleware, upload.single("image"), updateDoctor)
  .delete(deleteDoctor);

router.route("/:id/availability").put(toggleDoctorAvailability);
router.route("/login").post(loginDoctor);

export default router;
