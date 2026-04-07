import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { clerkMiddleware } from "@clerk/express";
import connectDB from "./config/db.js";
import globalErrorHandler from "./middlewares/globalError.js";
import DoctorRoute from "./routes/doctor.route.js";
import ServiceRoute from "./routes/service.route.js";
import AppointmentRoute from "./routes/appointment.router.js";
import ServiceAppointmentRoute from "./routes/serviceAppointment.route.js";
dotenv.config();

const app = express();

const allowedOrigins = ["http://localhost:5173", "http://localhost:5173"];
// Middleware
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json());
app.use(clerkMiddleware());
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// DB Connection
await connectDB();
// Routes

app.use("/api/doctors", DoctorRoute);
app.use("/api/services", ServiceRoute);
app.use("/api/appointments", AppointmentRoute);
app.use("/api/service-appointments", ServiceAppointmentRoute);
app.use(globalErrorHandler);
app.listen(process.env.PORT!, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});
