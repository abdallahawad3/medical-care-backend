import AppError from "./AppError.js";

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, "NOT_FOUND_ERROR");
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super(message, 401, "UNAUTHORIZED_ERROR");
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(message, 403, "FORBIDDEN_ERROR");
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(message, 400, "BAD_REQUEST_ERROR");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT_ERROR");
  }
}

export class PaymentRequiredError extends AppError {
  constructor(message: string) {
    super(message, 402, "PAYMENT_REQUIRED_ERROR");
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(message: string) {
    super(message, 405, "METHOD_NOT_ALLOWED_ERROR");
  }
}

export class NotAcceptableError extends AppError {
  constructor(message: string) {
    super(message, 406, "NOT_ACCEPTABLE_ERROR");
  }
}

export class RequestTimeoutError extends AppError {
  constructor(message: string) {
    super(message, 408, "REQUEST_TIMEOUT_ERROR");
  }
}
