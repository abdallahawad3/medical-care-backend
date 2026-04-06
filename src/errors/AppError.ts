import type { CODE_TYPES } from "../types/index.js";

class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number,
    public code: CODE_TYPES = "ERROR",
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
export default AppError;
