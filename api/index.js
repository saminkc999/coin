import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./config/db.js";

import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/games.js";
import paymentRoutes from "./routes/payments.js";
import loginRoutes from "./routes/logins.js";
import statsRoutes from "./routes/stats.js";
import healthRoutes from "./routes/health.js";
import adminUserRoutes from "./routes/adminUsers.js";
import facebookLeadRoutes from "./routes/facebookLeads.js";
import gameEntryRoutes from "./routes/gameEntries.js";
import salariesRouter from "./routes/salary.js";
import schedulesRouter from "./routes/schedules.js";
import facebookDetailRoutes from "./routes/facebookDetailRoutes.js";

import gameLoginRoutes from "./routes/gameLogin.js";
if (process.env.NODE_ENV !== "production") {
  dotenv.config(); // local dev only
}

const app = express();

const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || "https://coin-delta-eight.vercel.app";

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  FRONTEND_ORIGIN,
];

// ✅ CORS
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// ✅ JSON
app.use(express.json());
app.use((req, _res, next) => {
  console.log("Origin:", req.headers.origin);
  next();
});

// ✅ Log requests
app.use((req, _res, next) => {
  console.log("📥", req.method, req.url);
  next();
});

// ✅ Health route for Railway test
app.get("/", (_req, res) => res.send("✅ API is running"));

// ✅ Mount routes
app.use("/api/auth", authRoutes);
app.use("/api/logins", loginRoutes);
app.use("/api", gameRoutes);
app.use("/api", paymentRoutes);
app.use("/api", statsRoutes);
app.use("/api", healthRoutes);
app.use("/api/admin/users", adminUserRoutes);
app.use("/api/facebook-leads", facebookLeadRoutes);
app.use("/api/game-entries", gameEntryRoutes);
app.use("/api/facebook-details", facebookDetailRoutes);

app.use("/api/salaries", salariesRouter);
app.use("/api/game-logins", gameLoginRoutes);
app.use("/api/schedules", schedulesRouter);

// ✅ Start server
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, "0.0.0.0", () =>
      console.log(`✅ Backend running on port ${PORT}`)
    );
  } catch (err) {
    console.error("🚨 Failed to start server:", err.message || err);
    process.exit(1);
  }
}

startServer();
