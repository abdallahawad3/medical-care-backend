import jwt from "jsonwebtoken";

import type { Request, Response, NextFunction } from "express";
import { NotFoundError, UnauthorizedError } from "../errors/index.js";
import DoctorModel from "../models/Doctor.js";
export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    throw new UnauthorizedError("Authorization header missing");
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    throw new UnauthorizedError("Token missing");
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!);
    if (payload && (payload as { role: string }).role !== "doctor") {
      throw new UnauthorizedError("Insufficient permissions");
    }

    const doctorId = (payload as { id: string }).id;
    const doctor = await DoctorModel.findById(doctorId).select("-password");
    if (!doctor) {
      throw new NotFoundError("Doctor not found");
    }

    req.doctor = doctor;
    next(); 
  } catch (error) {
    throw new UnauthorizedError("Invalid token");
  }
};
