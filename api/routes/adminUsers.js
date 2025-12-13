// routes/adminUsers.js
import express from "express";
import User from "../models/User.js";
import LoginSession from "../models/LoginSession.js";
import GameEntry from "../models/GameEntry.js";
import { requireAuth, requireAdmin } from "./auth.js";
import DeletedUsername from "../models/DeletedUsername.js";

const router = express.Router();

/**
 * GET /api/admin/users
 * Optional: ?status=pending | active | blocked
 *
 * Update:
 * ✅ Only create "virtual" users from GameEntry.username
 * ✅ NEVER create users from LoginSession
 * ✅ NEVER use createdBy for usernames/totals
 * ✅ Hide virtual users when ?status=active (so approved list stays clean)
 */
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;

    const baseUserQuery = {};
    if (status) baseUserQuery.status = status;

    // If admin is viewing ACTIVE users, exclude virtual placeholder emails automatically
    const excludeVirtualForActive =
      status === "active" || status === "blocked" || status === "pending";

    if (excludeVirtualForActive && status === "active") {
      baseUserQuery.email = { $not: /@noemail\.local$/i };
    }

    const loadUsersForResponse = async () =>
      User.find(
        baseUserQuery,
        "username email lastSignInAt lastSignOutAt role isAdmin createdAt isApproved status"
      )
        .sort({ createdAt: -1 })
        .lean();

    // 1) Load ALL users for dedupe
    const allUsers = await User.find({}, "username email").lean();

    const realUsernameSet = new Set(
      allUsers
        .map((u) => (u.username ? String(u.username).trim() : ""))
        .filter(Boolean)
    );

    const existingEmails = new Set(
      allUsers
        .map((u) => (u.email ? String(u.email).trim().toLowerCase() : ""))
        .filter(Boolean)
    );

    // 2) Deleted usernames (ignored forever)
    const deletedRows = await DeletedUsername.find({}, "username").lean();
    const deletedUsernameSet = new Set(
      deletedRows
        .map((d) => (d.username ? String(d.username).trim() : ""))
        .filter(Boolean)
    );

    // 3) Collect usernames ONLY from GameEntry.username (trim-safe)
    const gameUserAgg = await GameEntry.aggregate([
      { $match: { username: { $ne: null, $ne: "" } } },
      { $group: { _id: { $trim: { input: "$username" } } } },
    ]);

    const gameUsernames = gameUserAgg
      .map((r) => (r._id ? String(r._id).trim() : ""))
      .filter(Boolean);

    const uniqueGameUsernames = [...new Set(gameUsernames)];

    // 4) Auto-create missing users (virtual users only)
    const missingUsernames = uniqueGameUsernames.filter(
      (u) => !realUsernameSet.has(u) && !deletedUsernameSet.has(u)
    );

    if (missingUsernames.length) {
      const docs = [];

      for (const uname of missingUsernames) {
        const clean = String(uname).trim();
        if (!clean) continue;

        const baseLocal = clean.toLowerCase().replace(/\s+/g, "");
        let email = `${baseLocal}@noemail.local`;
        let i = 1;

        while (existingEmails.has(email)) {
          email = `${baseLocal}+${i}@noemail.local`;
          i++;
        }

        existingEmails.add(email);
        realUsernameSet.add(clean);

        docs.push({
          username: clean,
          email,
          passwordHash: "no-password",
          role: "user",
          isAdmin: false,
          isApproved: false,
          status: "pending",
        });
      }

      if (docs.length) {
        try {
          await User.insertMany(docs, { ordered: false });
        } catch (e) {
          console.error("Error auto-creating users from GameEntry:", e);
        }
      }
    }

    // 5) Load users for response
    const users = await loadUsersForResponse();
    if (!users.length) return res.json([]);

    const usernames = users
      .map((u) => (u.username ? String(u.username).trim() : ""))
      .filter(Boolean);

    // 6) Totals (username ONLY, trim-safe)
    const totalsAgg = await GameEntry.aggregate([
      { $addFields: { usernameTrim: { $trim: { input: "$username" } } } },
      { $match: { usernameTrim: { $in: usernames } } },
      {
        $group: {
          _id: "$usernameTrim",
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
    for (const r of totalsAgg) {
      totalsByUser[r._id] = {
        totalDeposit: r.totalDeposit || 0,
        totalRedeem: r.totalRedeem || 0,
        totalFreeplay: r.totalFreeplay || 0,
      };
    }

    // 7) Latest login sessions (trim-safe, newest per user)
    const sessionsAgg = await LoginSession.aggregate([
      { $addFields: { usernameTrim: { $trim: { input: "$username" } } } },
      { $match: { usernameTrim: { $in: usernames } } },
      { $sort: { signInAt: -1 } },
      {
        $group: {
          _id: "$usernameTrim",
          lastSignInAt: { $first: "$signInAt" },
          lastSignOutAt: { $first: "$signOutAt" },
        },
      },
    ]);

    const sessionsByUser = {};
    for (const r of sessionsAgg) {
      sessionsByUser[r._id] = r;
    }

    // 8) Merge
    const enhanced = users.map((u) => {
      const uname = u.username ? String(u.username).trim() : "";

      const totals = totalsByUser[uname] || {
        totalDeposit: 0,
        totalRedeem: 0,
        totalFreeplay: 0,
      };

      const session = sessionsByUser[uname];
      const isOnline = Boolean(
        session?.lastSignInAt && !session?.lastSignOutAt
      );

      return {
        ...u,
        ...totals,
        totalPayments: totals.totalRedeem || 0,
        lastSignInAt: session?.lastSignInAt || null,
        lastSignOutAt: session?.lastSignOutAt || null,
        isOnline,
      };
    });

    return res.json(enhanced);
  } catch (err) {
    console.error("Error fetching users:", err);
    return res.status(500).json({ message: "Failed to fetch users" });
  }
});

// ✅ APPROVE USER
// PATCH /api/admin/users/:id/approve
router.patch("/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Support "virtual:<username>" too
    if (id.startsWith("virtual:")) {
      const username = id.slice("virtual:".length).trim();
      if (!username)
        return res.status(400).json({ message: "Invalid virtual id" });

      const user = await User.findOneAndUpdate(
        { username },
        { $set: { isApproved: true, status: "active" } },
        { new: true }
      ).lean();

      if (!user) return res.status(404).json({ message: "User not found" });
      return res.json({ message: "User approved", user });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: { isApproved: true, status: "active" } },
      { new: true }
    ).lean();

    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json({ message: "User approved", user });
  } catch (err) {
    console.error("Approve user error:", err);
    return res.status(500).json({ message: "Failed to approve user" });
  }
});

// ✅ DELETE USER
// DELETE /api/admin/users/:id
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // "virtual:<username>" delete
    if (id.startsWith("virtual:")) {
      const username = id.slice("virtual:".length).trim();
      if (!username)
        return res.status(400).json({ message: "Invalid virtual id" });

      // prevent re-auto-create from GameEntry usernames
      await DeletedUsername.updateOne(
        { username },
        { $set: { username } },
        { upsert: true }
      );

      await LoginSession.deleteMany({ username });
      await GameEntry.deleteMany({ username });
      await User.deleteOne({ username });

      return res.json({
        message: `Deleted virtual user "${username}" (and related data).`,
      });
    }

    // normal delete (real User document)
    const user = await User.findById(id).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    const username = user.username ? String(user.username).trim() : "";

    if (username) {
      await DeletedUsername.updateOne(
        { username },
        { $set: { username } },
        { upsert: true }
      );

      await LoginSession.deleteMany({ username });
      await GameEntry.deleteMany({ username });
    }

    await User.deleteOne({ _id: id });

    return res.json({ message: "User deleted" });
  } catch (err) {
    console.error("Delete user error:", err);
    return res.status(500).json({ message: "Failed to delete user" });
  }
});

export default router;
