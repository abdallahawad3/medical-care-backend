import { Router } from "express";
import multer from "multer";
import {
  createService,
  deleteService,
  getServiceById,
  getServices,
  updateService,
} from "../controllers/service.controller.js";

const router = Router();
const upload = multer({ dest: "/temp" });

router.get("/", getServices);
router.get("/:id", getServiceById);

router.post("/", upload.single("image"), createService);
router.put("/:id", upload.single("image"), updateService);
router.delete("/:id", deleteService);

export default router;
