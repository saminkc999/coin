// routes/adminUsers.js
import express from "express";
import mongoose from "mongoose";
import User from "../models/User.js";
import LoginSession from "../models/LoginSession.js";
import GameEntry from "../models/GameEntry.js";
import { requireAuth, requireAdmin } from "./auth.js";
import DeletedUsername from "../models/DeletedUsername.js"; // NEW

const router = express.Router();

/**
 * GET /api/admin/users
 * Optional: ?status=pending | active | blocked
 *
 * Option B behavior:
 *  - Load ALL users for auto-create logic (usernames + emails)
 *  - Collect all usernames from GameEntry (username or createdBy)
 *  - Auto-create missing User rows with UNIQUE placeholder email/password
 *  - Then load filtered users (baseUserQuery) for the response
 */
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;

    const baseUserQuery = {};
    if (status) {
      baseUserQuery.status = status;
    }

    // Helper: load users for the RESPONSE (respect status filter)
    const loadUsersForResponse = async () =>
      User.find(
        baseUserQuery,
        "username email lastSignInAt lastSignOutAt role isAdmin createdAt isApproved status"
      )
        .sort({ createdAt: -1 })
        .lean();

    // 1) Load ALL users (no status filter) for auto-create dedupe logic
    const allUsers = await User.find({}, "username email").lean();

    const allUsernames = allUsers
      .map((u) => (u.username ? String(u.username).trim() : ""))
      .filter(Boolean);
    const realUsernameSet = new Set(allUsernames);

    const existingEmails = new Set(
      allUsers
        .map((u) => (u.email ? String(u.email).trim().toLowerCase() : ""))
        .filter(Boolean)
    );

    // 1b) Load usernames that were explicitly deleted/ignored
    const deletedRows = await DeletedUsername.find({}, "username").lean(); // NEW
    const deletedUsernameSet = new Set(
      deletedRows
        .map((d) => (d.username ? String(d.username).trim() : ""))
        .filter(Boolean)
    );

    // 2) usernames from GameEntry
    const gameUserAgg = await GameEntry.aggregate([
      {
        $project: {
          effectiveUsername: {
            $cond: [
              {
                $and: [
                  { $ne: ["$username", null] },
                  { $ne: ["$username", ""] },
                ],
              },
              "$username",
              "$createdBy",
            ],
          },
        },
      },
      {
        $match: {
          effectiveUsername: { $ne: null },
        },
      },
      {
        $group: {
          _id: {
            $trim: { input: "$effectiveUsername" },
          },
        },
      },
    ]);

    const gameUsernames = gameUserAgg
      .map((row) => (row._id ? String(row._id).trim() : ""))
      .filter(Boolean);

    // de-duplicate game usernames
    const uniqueGameUsernames = [...new Set(gameUsernames)];

    // 3) which game usernames are missing in User collection
    //    AND not in DeletedUsername
    const missingUsernames = uniqueGameUsernames.filter(
      (uname) => !realUsernameSet.has(uname) && !deletedUsernameSet.has(uname)
    );

    // 4) auto-create missing users (placeholder) with UNIQUE placeholder emails
    if (missingUsernames.length > 0) {
      const docsToInsert = [];

      for (const uname of missingUsernames) {
        const clean = uname.trim();
        if (!clean) continue;

        const baseLocal = clean.toLowerCase().replace(/\s+/g, "");
        let candidate = `${baseLocal}@noemail.local`;
        let counter = 1;

        // ensure placeholder email is unique across ALL users
        while (existingEmails.has(candidate)) {
          candidate = `${baseLocal}+${counter}@noemail.local`;
          counter += 1;
        }
        existingEmails.add(candidate);

        docsToInsert.push({
          username: clean,
          email: candidate,
          passwordHash: "no-password",
          role: "user",
          isAdmin: false,
          isApproved: false,
          status: "pending",
          totalPayments: 0,
          totalFreeplay: 0,
          totalDeposit: 0,
          totalRedeem: 0,
        });
      }

      if (docsToInsert.length > 0) {
        try {
          await User.insertMany(docsToInsert, { ordered: false });
        } catch (insertErr) {
          // if some race or rare duplicate happens, just log and continue
          console.error("Error auto-creating users from GameEntry:", insertErr);
        }
      }
    }

    // 5) Now load users for the RESPONSE (respecting ?status=...)
    let users = await loadUsersForResponse();

    if (!users.length) {
      return res.json([]);
    }

    // 6) username list from filtered users
    const usernames = users
      .map((u) => (u.username ? String(u.username).trim() : ""))
      .filter(Boolean);

    // 7) totals from GameEntry
    const totalsAgg = await GameEntry.aggregate([
      {
        $match: {
          $or: [
            { username: { $in: usernames } },
            { createdBy: { $in: usernames } },
          ],
        },
      },
      {
        $addFields: {
          effectiveUsername: {
            $ifNull: ["$username", "$createdBy"],
          },
        },
      },
      {
        $group: {
          _id: "$effectiveUsername",
          totalDeposit: {
            $sum: {
              $cond: [
                { $eq: ["$type", "deposit"] },
                { $ifNull: ["$amountFinal", "$amount"] },
                0,
              ],
            },
          },
          totalRedeem: {
            $sum: {
              $cond: [
                { $eq: ["$type", "redeem"] },
                { $ifNull: ["$amountFinal", "$amount"] },
                0,
              ],
            },
          },
          totalFreeplay: {
            $sum: {
              $cond: [
                { $eq: ["$type", "freeplay"] },
                { $ifNull: ["$amountFinal", "$amount"] },
                0,
              ],
            },
          },
        },
      },
    ]);

    const totalsByUser = {};
    for (const row of totalsAgg) {
      const uname = row._id;
      totalsByUser[uname] = {
        totalDeposit: row.totalDeposit || 0,
        totalRedeem: row.totalRedeem || 0,
        totalFreeplay: row.totalFreeplay || 0,
      };
    }

    // 8) latest login sessions
    const sessionsAgg = await LoginSession.aggregate([
      {
        $match: {
          username: { $in: usernames },
        },
      },
      { $sort: { signInAt: -1 } },
      {
        $group: {
          _id: "$username",
          lastSignInAt: { $first: "$signInAt" },
          lastSignOutAt: { $first: "$signOutAt" },
        },
      },
    ]);

    const sessionsByUser = {};
    for (const row of sessionsAgg) {
      sessionsByUser[row._id] = {
        lastSignInAt: row.lastSignInAt || null,
        lastSignOutAt: row.lastSignOutAt || null,
      };
    }

    // 9) merge
    const enhanced = users.map((u) => {
      const base = { ...u };

      const totals = totalsByUser[u.username] || {
        totalDeposit: 0,
        totalRedeem: 0,
        totalFreeplay: 0,
      };

      base.totalDeposit = totals.totalDeposit;
      base.totalRedeem = totals.totalRedeem;
      base.totalFreeplay = totals.totalFreeplay;
      base.totalPayments = totals.totalRedeem || 0;

      const session = sessionsByUser[u.username];
      let isOnline = false;

      if (session) {
        const lastSignInAt = session.lastSignInAt || null;
        const lastSignOutAt = session.lastSignOutAt || null;

        base.lastSignInAt = lastSignInAt || base.lastSignInAt || null;
        base.lastSignOutAt = lastSignOutAt || base.lastSignOutAt || null;

        if (lastSignInAt && !lastSignOutAt) {
          isOnline = true;
        }
      }

      base.isOnline = isOnline;
      return base;
    });

    return res.json(enhanced);
  } catch (err) {
    console.error("Error fetching users:", err);
    return res.status(500).json({ message: "Failed to fetch users" });
  }
});

/**
 * GET /api/admin/users/approved-basic
 *
 * Returns ONLY approved users (status='active' and/or isApproved=true),
 * excludes placeholder emails (@noemail.local),
 * and returns just unique { _id, username, email }.
 */
router.get("/approved-basic", requireAuth, requireAdmin, async (req, res) => {
  try {
    const docs = await User.find(
      {
        $or: [{ isApproved: true }, { status: "active" }],
        email: {
          $ne: null,
          $not: /@noemail\.local$/i, // exclude placeholder emails
        },
      },
      "username email createdAt"
    )
      .sort({ createdAt: -1 })
      .lean();

    const seenEmails = new Set();
    const result = [];

    for (const u of docs) {
      const username = u.username ? String(u.username).trim() : "";
      const email = u.email ? String(u.email).trim() : "";

      if (!username || !email) continue;

      const emailKey = email.toLowerCase();
      if (seenEmails.has(emailKey)) {
        // skip duplicate email rows
        continue;
      }
      seenEmails.add(emailKey);

      result.push({
        _id: String(u._id),
        username,
        email,
      });
    }

    return res.json(result);
  } catch (err) {
    console.error("Error fetching approved-basic users:", err);
    return res
      .status(500)
      .json({ message: "Failed to fetch approved users (basic)" });
  }
});

/**
 * GET /api/admin/users/:username/game-entries
 */
router.get(
  "/:username/game-entries",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const username = String(req.params.username || "").trim();
      if (!username) {
        return res.status(400).json({ message: "username is required" });
      }

      const entries = await GameEntry.find({ username })
        .sort({ createdAt: -1 })
        .lean();

      return res.json(entries);
    } catch (err) {
      console.error(
        "Error fetching game entries for admin user:",
        err.message || err
      );
      return res
        .status(500)
        .json({ message: "Failed to fetch game entries for user" });
    }
  }
);

/**
 * PATCH /api/admin/users/:id/approve
 * Body (optional): { email: "real@gmail.com" }
 *
 * When approving:
 *  - sets isApproved=true and status="active"
 *  - optionally updates email if provided in body
 *  - creates a login session
 */
router.patch("/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email } = req.body || {};

    const update = {
      isApproved: true,
      status: "active",
      lastSignInAt: new Date(),
    };

    if (email && typeof email === "string" && email.trim()) {
      update.email = email.trim();
    }

    const user = await User.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // optional: this creates a login session when approved
    await LoginSession.create({
      username: user.username,
      email: user.email,
      signInAt: new Date(),
      signOutAt: null,
    });

    res.json(user);
  } catch (err) {
    console.error("Error approving user:", err);
    res.status(500).json({ message: "Failed to approve user" });
  }
});

/**
 * PATCH /api/admin/users/:id/block
 */
router.patch("/:id/block", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByIdAndUpdate(
      id,
      {
        isApproved: false,
        status: "blocked",
      },
      { new: true }
    ).select("username email role isAdmin isApproved status createdAt");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      message: "User blocked successfully",
      user,
    });
  } catch (err) {
    console.error("Error blocking user:", err);
    return res.status(500).json({ message: "Failed to block user" });
  }
});

/**
 * DELETE /api/admin/users/:id
 *
 * Supports:
 *  - Real Mongo ObjectId → delete User + sessions + mark username ignored
 *  - "virtual:<username>" → delete sessions + mark username ignored
 */
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // "virtual:<username>" rows (no User document)
    if (id.startsWith("virtual:")) {
      const username = id.slice("virtual:".length).trim();
      if (!username) {
        return res.status(400).json({ message: "Invalid virtual user id" });
      }

      // remember username so we don't auto-create it again
      await DeletedUsername.updateOne(
        { username },
        { $set: { username } },
        { upsert: true }
      );

      await LoginSession.deleteMany({ username });

      return res.json({
        message: `Activity for virtual user "${username}" deleted (username ignored for auto-create).`,
      });
    }

    // guard against invalid ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    // normal delete for real User documents
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const username = user.username ? String(user.username).trim() : "";

    if (username) {
      // remember username so we don't auto-create it again
      await DeletedUsername.updateOne(
        { username },
        { $set: { username } },
        { upsert: true }
      );

      await LoginSession.deleteMany({ username });
    }

    await User.deleteOne({ _id: id });

    return res.json({
      message: "User deleted and username ignored for auto-create",
    });
  } catch (err) {
    console.error("Error deleting user:", err);
    return res.status(500).json({ message: "Failed to delete user" });
  }
});

export default router;
