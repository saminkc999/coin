// api/routes/logins.js
import express from "express";
import { connectDB } from "../config/db.js";
import LoginSession from "../models/LoginSession.js";
import User from "../models/User.js"; // 👈 add this (adjust path/name if needed)

const router = express.Router();

// Ensure DB connection for all routes
router.use(async (_req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("❌ DB connection error in logins:", err);
    res.status(500).json({ message: "Database connection failed" });
  }
});

// Helper: format any session consistently + add isOnline flag
function formatSession(s) {
  const signIn = s.signInAt ? new Date(s.signInAt).toISOString() : null;
  const signOut = s.signOutAt ? new Date(s.signOutAt).toISOString() : null;

  const isOnline = signIn && !signOut; // 👈 ONLINE condition

  return {
    _id: String(s._id),
    username: s.username,
    email: s.email || null,
    signInAt: signIn,
    signOutAt: signOut,
    isOnline,
    createdAt:
      s.createdAt && s.createdAt.toISOString
        ? s.createdAt.toISOString()
        : undefined,
    updatedAt:
      s.updatedAt && s.updatedAt.toISOString
        ? s.updatedAt.toISOString()
        : undefined,
  };
}

/**
 * 🟢 POST /api/logins/start
 * Body: { username, email?, signInAt }
 * Only records login if user is approved.
 */
router.post("/start", async (req, res) => {
  try {
    const { username, email, signInAt } = req.body;

    if (!username || typeof username !== "string") {
      return res.status(400).json({ message: "username is required" });
    }

    // 👇 Check approval before creating session
    const user = await User.findOne({ username }).lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // adjust "approved" to whatever you actually use: "active", "approved", etc.
    if (user.status !== "approved") {
      return res
        .status(403)
        .json({ message: "User is not approved yet. Login not recorded." });
    }

    const session = await LoginSession.create({
      username,
      email: email || null,
      signInAt: signInAt ? new Date(signInAt) : new Date(),
    });

    res.status(201).json(formatSession(session));
  } catch (err) {
    console.error("Error in POST /api/logins/start:", err);
    res
      .status(500)
      .json({ message: "Failed to start session", error: err.message });
  }
});
