// routes/adminUsers.js
import express from "express";
import User from "../models/User.js";
import LoginSession from "../models/LoginSession.js";
import GameEntry from "../models/GameEntry.js";
import { requireAuth, requireAdmin } from "./auth.js";
import DeletedUsername from "../models/DeletedUsername.js";

const router = express.Router();

// ✅ helpers
const normUsernameKey = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();

const emailLocalFromUsername = (uname) =>
  String(uname || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GET /api/admin/users
 * Optional: ?status=pending | active | blocked
 *
 * Update:
 * ✅ Only create "virtual" users from GameEntry.username
 * ✅ NEVER create users from LoginSession
 * ✅ NEVER use createdBy for usernames/totals
 * ✅ Hide virtual users when ?status=active (so approved list stays clean)
 *
 * Fix:
 * ✅ "take this username as" = treat usernames case-insensitively everywhere
 *   - missing detection uses lower-case key
 *   - DeletedUsername uses lower-case key
 *   - approve/delete virtual works even if case differs
 * ✅ more stable virtual emails
 */
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;

    const baseUserQuery = {};
    if (status) baseUserQuery.status = status;

    // Hide virtual placeholder emails when viewing ACTIVE users
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

    const realUsernames = allUsers
      .map((u) => (u.username ? String(u.username).trim() : ""))
      .filter(Boolean);

    // ✅ case-insensitive set for dedupe
    const realUsernameLowerSet = new Set(realUsernames.map(normUsernameKey));

    const existingEmails = new Set(
      allUsers
        .map((u) => (u.email ? String(u.email).trim().toLowerCase() : ""))
        .filter(Boolean)
    );

    // 2) Deleted usernames (ignored forever) — store/compare as lowercase keys
    const deletedRows = await DeletedUsername.find({}, "username").lean();
    const deletedUsernameLowerSet = new Set(
      deletedRows.map((d) => normUsernameKey(d.username)).filter(Boolean)
    );

    // 3) Collect usernames ONLY from GameEntry.username (trim-safe)
    const gameUserAgg = await GameEntry.aggregate([
      { $match: { username: { $ne: null, $ne: "" } } },
      { $group: { _id: { $trim: { input: "$username" } } } },
    ]);

    const gameUsernames = gameUserAgg
      .map((r) => (r._id ? String(r._id).trim() : ""))
      .filter(Boolean);

    // ✅ de-dupe case-insensitively, but keep a "display" version
    const seenKeys = new Set();
    const uniqueGameUsernames = [];
    for (const uname of gameUsernames) {
      const key = normUsernameKey(uname);
      if (!key) continue;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      uniqueGameUsernames.push(String(uname).trim()); // keep original display
    }

    // 4) Auto-create missing users (virtual users only) — case-insensitive check
    const missingUsernames = uniqueGameUsernames.filter((u) => {
      const key = normUsernameKey(u);
      return (
        !realUsernameLowerSet.has(key) && !deletedUsernameLowerSet.has(key)
      );
    });

    if (missingUsernames.length) {
      const docs = [];

      for (const uname of missingUsernames) {
        const clean = String(uname).trim();
        const key = normUsernameKey(clean);
        if (!clean || !key) continue;

        // ✅ base local-part
        const baseLocal = emailLocalFromUsername(clean);
        if (!baseLocal) continue;

        let email = `${baseLocal}@noemail.local`;
        let i = 1;

        while (existingEmails.has(email)) {
          email = `${baseLocal}+${i}@noemail.local`;
          i++;
        }

        existingEmails.add(email);
        realUsernameLowerSet.add(key);

        docs.push({
          username: clean, // keep display
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
    for (const r of sessionsAgg) sessionsByUser[r._id] = r;

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

    // Support "virtual:<username>" too (case-insensitive)
    if (id.startsWith("virtual:")) {
      const username = id.slice("virtual:".length).trim();
      if (!username)
        return res.status(400).json({ message: "Invalid virtual id" });

      const rx = new RegExp(`^${escapeRegex(username)}$`, "i");

      const user = await User.findOneAndUpdate(
        { username: rx },
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

    // "virtual:<username>" delete (case-insensitive)
    if (id.startsWith("virtual:")) {
      const username = id.slice("virtual:".length).trim();
      if (!username)
        return res.status(400).json({ message: "Invalid virtual id" });

      const rx = new RegExp(`^${escapeRegex(username)}$`, "i");

      // ✅ store deleted key lowercase to block future auto-create
      const deletedKey = normUsernameKey(username);
      await DeletedUsername.updateOne(
        { username: deletedKey },
        { $set: { username: deletedKey } },
        { upsert: true }
      );

      await LoginSession.deleteMany({ username: rx });
      await GameEntry.deleteMany({ username: rx });
      await User.deleteOne({ username: rx });

      return res.json({
        message: `Deleted virtual user "${username}" (and related data).`,
      });
    }

    // normal delete (real User document)
    const user = await User.findById(id).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    const username = user.username ? String(user.username).trim() : "";
    const deletedKey = normUsernameKey(username);

    if (username) {
      await DeletedUsername.updateOne(
        { username: deletedKey },
        { $set: { username: deletedKey } },
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
