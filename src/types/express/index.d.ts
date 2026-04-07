import { Request } from "express";

declare global {
  namespace Express {
    interface Request {
      file?: Express.Multer.File;
      doctor?: DoctorPayload;
      auth?: {
        userId?: string;
        user_id?: string;
        user?: {
          id?: string;
        };
      };
    }
  }
}
