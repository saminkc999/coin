// api/routes/logins.js
import express from "express";
import { connectDB } from "../config/db.js";
import LoginSession from "../models/LoginSession.js";
import User from "../models/User.js"; // 👈 adjust path/name if needed

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

    // 1️⃣ Find the user
    const user = await User.findOne({ username }).lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 2️⃣ Check approval status
    if (user.status !== "approved") {
      return res.status(403).json({
        message: "User is not approved yet. Login will not be recorded.",
      });
    }

    // 3️⃣ Only approved users reach here ⇒ create session
    const session = await LoginSession.create({
      username,
      email: email || null, // store email also
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

/**
 * 🔴 POST /api/logins/end
 * Body: { sessionId, signOutAt }
 */
router.post("/end", async (req, res) => {
  try {
    const { sessionId, signOutAt } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required" });
    }

    const session = await LoginSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    session.signOutAt = signOutAt ? new Date(signOutAt) : new Date();
    await session.save();

    return res.json(formatSession(session));
  } catch (err) {
    console.error("Error in POST /api/logins/end:", err);
    res
      .status(500)
      .json({ message: "Failed to end session", error: err.message });
  }
});

/**
 * 🧾 GET /api/logins
 * Optional:
 *   ?username=foo     -> filter by username
 *   ?latest=1         -> only latest session
 * Returns ONLY:
 *   - sessions with username + email present
 *   - AND whose user is approved
 */
router.get("/", async (req, res) => {
  try {
    const { username, latest } = req.query;

    // base filter: must have username + email
    const filter = {
      username: { $exists: true, $ne: "" },
      email: { $exists: true, $ne: null },
    };

    if (username && typeof username === "string") {
      // if username is provided, override username filter with exact match
      filter.username = username;
    }

    let query = LoginSession.find(filter).sort({ signInAt: -1 });

    if (latest === "1" || latest === "true") {
      query = query.limit(1);
    } else {
      query = query.limit(200);
    }

    const sessions = await query.lean();

    // 🔎 keep only sessions whose user is approved
    const usernames = [...new Set(sessions.map((s) => s.username))];

    const approvedUsers = await User.find({
      username: { $in: usernames },
      status: "approved", // adjust if you use a different field/value
    }).lean();

    const approvedSet = new Set(approvedUsers.map((u) => u.username));

    const approvedSessions = sessions
      .filter((s) => approvedSet.has(s.username))
      .map(formatSession);

    console.log(
      "📜 GET /api/logins => filter:",
      filter,
      "total:",
      sessions.length,
      "approved+hasEmail:",
      approvedSessions.length
    );

    res.json(approvedSessions);
  } catch (err) {
    console.error("Error in GET /api/logins:", err);
    res
      .status(500)
      .json({ message: "Failed to load sessions", error: err.message });
  }
});

/**
 * 🧾 GET /api/logins/:username
 * Returns only the *latest* session for this user
 * AND only if:
 *   - user is approved
 *   - session has email
 */
router.get("/:username", async (req, res) => {
  try {
    const { username } = req.params;

    if (!username) {
      return res.status(400).json({ message: "username is required" });
    }

    // Check user is approved first
    const user = await User.findOne({ username }).lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user.status !== "approved") {
      return res.status(403).json({
        message: "User is not approved. No login sessions available.",
      });
    }

    const session = await LoginSession.findOne({
      username,
      email: { $exists: true, $ne: null }, // must have email
    })
      .sort({ signInAt: -1 })
      .lean();

    if (!session) {
      return res.status(404).json({
        message: "No session with username and email found for this user",
      });
    }

    res.json(formatSession(session));
  } catch (err) {
    console.error("Error in GET /api/logins/:username:", err);
    res.status(500).json({
      message: "Failed to load user session",
      error: err.message,
    });
  }
});

/**
 * 🗑️ DELETE /api/logins/user/:username
 * Delete all login records for this user
 */
router.delete("/user/:username", async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) {
      return res.status(400).json({ message: "Username is required" });
    }

    const result = await LoginSession.deleteMany({ username });

    res.json({
      message: "User login activity deleted",
      username,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error("Error deleting user login activity:", err);
    res.status(500).json({
      message: "Failed to delete user login activity",
      error: err.message,
    });
  }
});

export default router;
