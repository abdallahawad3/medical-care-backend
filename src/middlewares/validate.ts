import type { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import { BadRequestError } from "../errors/index.js";

export const validator = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map((err) => ({
      field: err.type === "field" ? err.path : "unknown",
      message: err.msg,
    }));
    throw new BadRequestError(formattedErrors.map((err) => err.message).join(", "));
  }

  next();
};
