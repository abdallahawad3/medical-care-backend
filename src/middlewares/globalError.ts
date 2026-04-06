import type { Request, Response, NextFunction } from "express";
import { ValidationError } from "../errors/index.js";
import AppError from "../errors/AppError.js";
const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err.name === "ValidationError") {
    throw new ValidationError(err.message);
  }

  if (err.name === "CastError") {
    throw new ValidationError("Invalid ID format");
  }

  // 🔥 Unknown Errors
  if (!(err instanceof AppError)) {
    err = new AppError("Internal Server Error", 500, "APP_ERROR");
  }

  // 🔥 Dev vs Prod
  if (process.env.NODE_ENV === "development") {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        code: err.code,
        stack: err.stack,
      },
    });
  }

  // 🔥 Production
  res.status(err.statusCode).json({
    success: false,
    error: {
      message: err.message,
      code: err.code,
    },
  });
};

export default globalErrorHandler;
