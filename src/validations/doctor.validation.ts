import { body } from "express-validator";

export const CREATE_DOCTOR_VALIDATION = [
  body("name")
    .isString()
    .trim()
    .withMessage("Name must be a string")
    .notEmpty()
    .withMessage("Name is required"),
  body("email")
    .isEmail()
    .withMessage("Invalid email format")
    .notEmpty()
    .withMessage("Email is required"),
  body("password")
    .isString()
    .trim()
    .withMessage("Password must be a string")
    .notEmpty()
    .withMessage("Password is required"),
];
