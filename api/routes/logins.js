// api/routes/logins.js
import express from "express";
import { connectDB } from "../config/db.js";
import LoginSession from "../models/LoginSession.js";
import User from "../models/User.js";

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

  const isOnline = signIn && !signOut;

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
 * ✅ GET /api/logins/ping
 * Quick deployment check (remove later if you want)
 */
router.get("/ping", (_req, res) => {
  res.json({ ok: true });
});

/**
 * 🟢 POST /api/logins/start
 * Body: { email, signInAt? }
 * Records login ONLY if user is approved.
 * Uses canonical username/email from User document.
 *
 * ✅ FIX: ensure only ONE active session per user by closing older open sessions.
 */
router.post("/start", async (req, res) => {
  try {
    const { email, signInAt } = req.body;

    if (!email || typeof email !== "string") {
      return res.status(400).json({ message: "email is required" });
    }

    // Keep case as-is (your system is case-sensitive)
    const rawEmail = email.trim();

    // 1️⃣ Find the user by EMAIL (matches your frontend login)
    const user = await User.findOne({ email: rawEmail }).lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 2️⃣ Check approval status
    const isApprovedUser = user.isApproved === true || user.status === "active";
    if (!isApprovedUser) {
      return res.status(403).json({
        message: "User is not approved yet. Login will not be recorded.",
        code: "NOT_APPROVED",
      });
    }

    if (user.status === "blocked") {
      return res.status(403).json({
        message: "User is blocked. Login will not be recorded.",
        code: "BLOCKED",
      });
    }

    // ✅ 3️⃣ Close any previous OPEN sessions for this user
    // (prevents multiple signOutAt: null sessions)
    await LoginSession.updateMany(
      { username: user.username, signOutAt: null },
      { $set: { signOutAt: new Date() } }
    );

    // 4️⃣ Create session with canonical values from DB
    const session = await LoginSession.create({
      username: user.username, // ✅ always DB username
      email: user.email, // ✅ always DB email
      signInAt: signInAt ? new Date(signInAt) : new Date(),
      signOutAt: null, // ✅ explicit (keeps query consistent)
    });

    return res.status(201).json(formatSession(session));
  } catch (err) {
    console.error("Error in POST /api/logins/start:", err);
    return res
      .status(500)
      .json({ message: "Failed to start session", error: err.message });
  }
});

/**
 * 🔴 POST /api/logins/end
 * Body: { sessionId, signOutAt? }
 */
/**
 * 🔴 POST /api/logins/end
 * Body: { sessionId, signOutAt? }
 */
router.post("/end", async (req, res) => {
  try {
    const { sessionId, signOutAt } = req.body;

    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ message: "sessionId is required" });
    }

    // ✅ prevent CastError -> 500
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Invalid sessionId" });
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
    return res
      .status(500)
      .json({ message: "Failed to end session", error: err.message });
  }
});

/**
 * 🧾 GET /api/logins
 * Optional:
 *   ?username=foo  -> filter by username
 *   ?latest=1      -> only latest session
 *
 * Returns only:
 *  - sessions with username + email present
 *  - sessions whose user is approved
 */
router.get("/", async (req, res) => {
  try {
    const { username, latest } = req.query;

    const filter = {
      username: { $exists: true, $ne: "" },
      email: { $exists: true, $ne: null },
    };

    if (username && typeof username === "string") {
      filter.username = username;
    }

    let query = LoginSession.find(filter).sort({ signInAt: -1 });

    if (latest === "1" || latest === "true") query = query.limit(1);
    else query = query.limit(200);

    const sessions = await query.lean();

    const usernames = [...new Set(sessions.map((s) => s.username))];

    const approvedUsers = await User.find({
      username: { $in: usernames },
      $or: [{ isApproved: true }, { status: "active" }],
    }).lean();

    const approvedSet = new Set(approvedUsers.map((u) => u.username));

    const approvedSessions = sessions
      .filter((s) => approvedSet.has(s.username))
      .map(formatSession);

    return res.json(approvedSessions);
  } catch (err) {
    console.error("Error in GET /api/logins:", err);
    return res
      .status(500)
      .json({ message: "Failed to load sessions", error: err.message });
  }
});

/**
 * 🧾 GET /api/logins/:username
 * Returns only the latest session for this user,
 * only if user is approved and session has email.
 */
router.get("/:username", async (req, res) => {
  try {
    const { username } = req.params;

    if (!username) {
      return res.status(400).json({ message: "username is required" });
    }

    const user = await User.findOne({ username }).lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isApprovedUser = user.isApproved === true || user.status === "active";
    if (!isApprovedUser) {
      return res.status(403).json({
        message: "User is not approved. No login sessions available.",
      });
    }

    const session = await LoginSession.findOne({
      username,
      email: { $exists: true, $ne: null },
    })
      .sort({ signInAt: -1 })
      .lean();

    if (!session) {
      return res.status(404).json({
        message: "No session with username and email found for this user",
      });
    }

    return res.json(formatSession(session));
  } catch (err) {
    console.error("Error in GET /api/logins/:username:", err);
    return res.status(500).json({
      message: "Failed to load user session",
      error: err.message,
    });
  }
});

/**
 * 🗑️ DELETE /api/logins/user/:username
 */
router.delete("/user/:username", async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) {
      return res.status(400).json({ message: "Username is required" });
    }

    const result = await LoginSession.deleteMany({ username });

    return res.json({
      message: "User login activity deleted",
      username,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error("Error deleting user login activity:", err);
    return res.status(500).json({
      message: "Failed to delete user login activity",
      error: err.message,
    });
  }
});

export default router;
