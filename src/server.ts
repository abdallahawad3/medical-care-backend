import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { clerkMiddleware } from "@clerk/express";
import connectDB from "./config/db.js";
import globalErrorHandler from "./middlewares/globalError.js";
import DoctorRoute from "./routes/doctor.route.js";
import ServiceRoute from "./routes/service.route.js";
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(clerkMiddleware());
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// DB Connection
await connectDB();
// Routes

app.use("/api/doctors", DoctorRoute);
app.use("/api/services", ServiceRoute);

app.use(globalErrorHandler);
app.listen(process.env.PORT!, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});
