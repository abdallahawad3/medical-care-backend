import type mongoose from "mongoose";

export interface IAppointment {
  owner: string;
  createdBy?: string | null;

  patientName: string;
  mobile: string;
  age?: number | null;
  gender?: string;

  doctorId: mongoose.Types.ObjectId | undefined;
  doctorName?: string;
  specialty?: string;

  date: string;
  time: string;
  fees: number;

  status: "Pending" | "Confirmed" | "Completed" | "Canceled" | "Rescheduled";

  payment: {
    method: "Cash" | "Online";
    status: "Pending" | "Paid" | "Failed" | "Refunded";
    amount: number;
    providerId?: string;
    meta?: any;
  };

  sessionId?: string | null;
  paidAt?: Date | null;
}
