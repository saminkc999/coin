// api/routes/games.js
import express from "express";
import { connectDB } from "../config/db.js";
import Game from "../models/Game.js";
import GameEntry from "../models/GameEntry.js"; // ✅ needed for aggregate & history
import UserActivity from "../models/UserActivity.js";
import { safeNum } from "../utils/numbers.js";

const router = express.Router();

/**
 * If mounted as:
 *   app.use("/api", gameRoutes)
 *
 * Routes:
 *   GET    /api/games                       -> with ?q= returns string[] (names), else enriched Game[]
 *                                             optional ?year=YYYY&month=MM filters GameEntry totals by month
 *   POST   /api/games
 *   PUT    /api/games/:id
 *   DELETE /api/games/:id
 *   POST   /api/games/:id/add-moves         -> logs UserActivity only
 *   POST   /api/games/:id/reset-recharge
 *   GET    /api/games/:id/recharge-history  -> full history of deposits for this game
 */
// GET /api/games
router.get("/games", async (req, res) => {
  try {
    await connectDB();

    const q = (req.query.q || "").toString().trim();

    // Monthly filtering params
    const year = Number(req.query.year);
    const month = Number(req.query.month);

    let dateFilter = {};

    // 👉 Apply month filter ONLY if both are valid
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      month >= 1 &&
      month <= 12
    ) {
      const mm = String(month).padStart(2, "0");
      const prefix = `${year}-${mm}`; // YYYY-MM

      // filter by GameEntry.date ("YYYY-MM-DD")
      dateFilter = { date: { $regex: `^${prefix}` } };

      console.log("🎯 Games monthly filter:", dateFilter);
    } else {
      console.log("➡️ No monthly filter used");
    }

    // If searching → return names only
    if (q) {
      const filter = { name: { $regex: q, $options: "i" } };
      const names = await Game.distinct("name", filter);

      return res.json(
        names
          .filter((n) => typeof n === "string" && n.trim().length > 0)
          .sort((a, b) => a.localeCompare(b))
      );
    }

    // Get all games
    const games = await Game.find({}).sort({ createdAt: 1 }).lean();
    const gameNames = games.map((g) => g.name);

    /**
     * Group GameEntry by (gameName, username, date)
     * For each group (one username, one day, one game):
     *   freeplaySum, depositSum, redeemSum
     * Then in JS:
     *   perDayNet = redeemSum - depositSum - freeplaySum
     *   netPerGame = Σ perDayNet
     */
    const totals = await GameEntry.aggregate([
      {
        $match: {
          gameName: { $in: gameNames },
          ...dateFilter,
        },
      },
      {
        $group: {
          _id: {
            gameName: "$gameName",
            username: "$username",
            date: "$date", // "YYYY-MM-DD"
          },
          freeplay: {
            $sum: {
              $cond: [
                { $eq: ["$type", "freeplay"] },
                { $ifNull: ["$amountFinal", "$amount"] },
                0,
              ],
            },
          },
          deposit: {
            $sum: {
              $cond: [
                { $eq: ["$type", "deposit"] },
                { $ifNull: ["$amountFinal", "$amount"] },
                0,
              ],
            },
          },
          redeem: {
            $sum: {
              $cond: [
                { $eq: ["$type", "redeem"] },
                { $ifNull: ["$amountFinal", "$amount"] },
                0,
              ],
            },
          },
        },
      },
    ]);

    // Build totals per game:
    // - sum of freeplay/deposit/redeem (for display)
    // - netPerGame = Σ (redeem - deposit - freeplay) per username per day
    const totalsByGame = {};
    for (const t of totals) {
      const gameName = t._id.gameName;

      if (!totalsByGame[gameName]) {
        totalsByGame[gameName] = {
          freeplay: 0,
          deposit: 0, // total coin recharged (sum of deposits)
          redeem: 0,
          net: 0, // per-day per-username net
        };
      }

      const freeplay = t.freeplay ?? 0;
      const deposit = t.deposit ?? 0;
      const redeem = t.redeem ?? 0;

      const g = totalsByGame[gameName];
      g.freeplay += freeplay;
      g.deposit += deposit;
      g.redeem += redeem;

      // per-day-per-username net: redeem - deposit - freeplay
      const perDayNet = redeem - deposit - freeplay;
      g.net += perDayNet;
    }

    // Merge totals into game objects, with totalCoins based on net
    const enriched = games.map((g) => {
      const s = totalsByGame[g.name] || {
        freeplay: 0,
        deposit: 0,
        redeem: 0,
        net: 0,
      };

      const coinsRecharged = Number(g.coinsRecharged) || 0;

      // totalCoins = recharge + Σ(per-day-per-username net)
      // net = redeem - deposit - freeplay
      let totalCoins = coinsRecharged + s.net;
      if (totalCoins < 0) totalCoins = 0;

      // separate field for total coin recharged (sum of deposits)
      const totalRecharged = s.deposit;

      return {
        ...g,
        freeplay: s.freeplay,
        deposit: s.deposit,
        redeem: s.redeem,
        totalRecharged, // 👈 total coin recharged (for separate table/column)
        coinsRecharged, // manual/base recharge from Game model
        totalCoins, // final net coins according to your rule
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error("GET /api/games error:", err);
    res.status(500).json({ message: "Failed to load games" });
  }
});

// POST /api/games  (create new game)
router.post("/games", async (req, res) => {
  const { name, coinsRecharged = 0, lastRechargeDate = null } = req.body;

  if (!name || typeof name !== "string") {
    return res.status(400).json({ message: "Game name is required" });
  }

  try {
    await connectDB();

    // Optional: prevent duplicate names (comment out if you allow duplicates)
    const exists = await Game.findOne({ name }).lean();
    if (exists) {
      return res
        .status(409)
        .json({ message: "Game with this name already exists" });
    }

    const newGame = await Game.create({
      id: Date.now(), // numeric id used by frontend
      name,
      coinsRecharged,
      lastRechargeDate,
    });

    res.status(201).json(newGame);
  } catch (err) {
    console.error("POST /api/games error:", err);
    res.status(500).json({ message: "Failed to create game" });
  }
});

// PUT /api/games/:id  (update recharge & lastRechargeDate)
router.put("/games/:id", async (req, res) => {
  const { id } = req.params;
  const { coinsRecharged, lastRechargeDate, totalCoins } = req.body;

  try {
    await connectDB();

    const game = await Game.findOne({ id: Number(id) });
    if (!game) return res.status(404).json({ message: "Game not found" });

    if (typeof coinsRecharged === "number") {
      game.coinsRecharged = coinsRecharged;
    }

    if (lastRechargeDate !== undefined) {
      game.lastRechargeDate = lastRechargeDate;
    }

    if (typeof totalCoins === "number") {
      game.totalCoins = totalCoins;
    }

    await game.save();

    res.json(game);
  } catch (err) {
    console.error("PUT /api/games/:id error:", err);
    res.status(500).json({ message: "Failed to update game" });
  }
});

// DELETE /api/games/:id
router.delete("/games/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await connectDB();

    const result = await Game.findOneAndDelete({ id: Number(id) }).lean();
    if (!result) return res.status(404).json({ message: "Game not found" });

    res.json(result);
  } catch (err) {
    console.error("DELETE /api/games/:id error:", err);
    res.status(500).json({ message: "Failed to delete game" });
  }
});

// POST /api/games/:id/add-moves
// Now this ONLY logs UserActivity. It no longer mutates Game coin fields.
router.post("/games/:id/add-moves", async (req, res) => {
  const { id } = req.params;
  const {
    freeplayDelta = 0,
    redeemDelta = 0,
    depositDelta = 0,
    username = "Unknown User",
    freeplayTotal,
    redeemTotal,
    depositTotal,
  } = req.body;

  try {
    await connectDB();

    const game = await Game.findOne({ id: Number(id) });
    if (!game) {
      return res.status(404).json({ message: "Game not found" });
    }

    const freeplay = safeNum(freeplayDelta);
    const redeem = safeNum(redeemDelta);
    const deposit = safeNum(depositDelta);

    // We NO LONGER change any game.coinsXXX here, because
    // totals are computed from GameEntry + coinsRecharged.

    // Update last recharge date only if there was a deposit
    if (deposit > 0) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      game.lastRechargeDate = `${yyyy}-${mm}-${dd}`;
      await game.save();
    }

    // Log user activity
    if (freeplay || redeem || deposit) {
      await UserActivity.create({
        username,
        gameId: game.id,
        gameName: game.name,
        freeplay,
        redeem,
        deposit,
        freeplayTotal:
          typeof freeplayTotal === "number" ? freeplayTotal : undefined,
        redeemTotal: typeof redeemTotal === "number" ? redeemTotal : undefined,
        depositTotal:
          typeof depositTotal === "number" ? depositTotal : undefined,
      });
    }

    return res.json({
      message: "Moves logged",
      game,
    });
  } catch (err) {
    console.error("POST /api/games/:id/add-moves error:", err);
    return res.status(500).json({ message: "Failed to update game moves" });
  }
});

// POST /api/games/:id/reset-recharge
router.post("/games/:id/reset-recharge", async (req, res) => {
  const { id } = req.params;

  try {
    await connectDB();

    const game = await Game.findOneAndUpdate(
      { id: Number(id) },
      { $set: { coinsRecharged: 0, lastRechargeDate: null } },
      { new: true }
    ).lean();

    if (!game) {
      return res.status(404).json({ message: "Game not found" });
    }

    res.json(game);
  } catch (err) {
    console.error("POST /api/games/:id/reset-recharge error:", err);
    res.status(500).json({ message: "Failed to reset game recharge" });
  }
});

/**
 * GET /api/games/:id/recharge-history
 *
 * Returns all deposit (recharge) entries for a specific game.
 * Optional query: ?year=YYYY&month=MM to filter by month.
 */
router.get("/games/:id/recharge-history", async (req, res) => {
  const { id } = req.params;

  try {
    await connectDB();

    const game = await Game.findOne({ id: Number(id) }).lean();
    if (!game) {
      return res.status(404).json({ message: "Game not found" });
    }

    const year = Number(req.query.year);
    const month = Number(req.query.month);

    // ✅ JS only – no type annotation
    let dateFilter = {};
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      month >= 1 &&
      month <= 12
    ) {
      const mm = String(month).padStart(2, "0");
      const prefix = `${year}-${mm}`;
      dateFilter = { date: { $regex: `^${prefix}` } };
    }

    // Fetch all deposit (recharge) entries for this game
    const entries = await GameEntry.find({
      gameName: game.name,
      type: "deposit",
      ...dateFilter,
    })
      .sort({ date: 1, _id: 1 }) // oldest first
      .lean();

    // Build running before/after coins
    let running = 0;

    const history = entries.map((e) => {
      const amt = Number(e.amountFinal ?? e.amount ?? 0) || 0;

      const beforeCoins = running;
      const afterCoins = beforeCoins + amt;
      running = afterCoins;

      return {
        id: e._id,

        // GAME METADATA YOU REQUESTED
        name: game.name,
        lastRechargeDate: game.lastRechargeDate || null,
        updatedAt: game.updatedAt,

        // HISTORY ENTRY INFO
        date: e.date,
        amount: amt,
        beforeCoins,
        afterCoins,
        username: e.username,
        createdBy: e.createdBy,
        method: e.method,
      };
    });

    return res.json(history);
  } catch (err) {
    console.error("GET /api/games/:id/recharge-history error:", err);
    return res.status(500).json({ message: "Failed to load recharge history" });
  }
});

export default router;
