// src/UserDashboard.tsx
import { useEffect, useState, type FC } from "react";
import { apiClient } from "../apiConfig";

import Sidebar, { type SidebarSection } from "../admin/Sidebar";
import UserSessionBar from "./UserSessionBar";
import PaymentHistory from "./PaymentHistory";
import UserTable from "./UserTable";
import UserCharts from "./UserCharts";

import type { Game } from "../admin/Gamerow";
import GameEntryForm from "./GameEntryForm";
import RecentEntriesTable, { GameEntry } from "./RecentEntriesTable";
import PaymentCombinedTable from "./PaymentCombinedTable";
import PendingPayments from "./PendingPaymentsTable";
import GameLogins from "../admin/GameLogin";
import GameLoginsTable from "./GameLoginsTable";
// ✅ NEW

const GAMES_API = "/api/games";
const PAY_API = "/api";
const COIN_VALUE = 0.15;
const GAME_ENTRIES_API = "/api/game-entries";

interface UserDashboardProps {
  username: string;
  email?: string;
  onLogout: () => void;
}

const UserDashboard: FC<UserDashboardProps> = ({
  username,
  email,
  onLogout,
}) => {
  const [games, setGames] = useState<Game[]>([]);
  const [activeSection, setActiveSection] =
    useState<SidebarSection>("overview");
  const [recent, setRecent] = useState<GameEntry[]>([]);
  const [paymentTotals, setPaymentTotals] = useState({
    cashapp: 0,
    paypal: 0,
    chime: 0,
  });

  // Optional: work-session (from UserSessionBar)
  const [workSignedIn, setWorkSignedIn] = useState(false);

  // Simple auth check each render
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const isAuthed = !!token && !!username;

  // -----------------------------
  // Helpers
  // -----------------------------
  async function fetchGames() {
    try {
      const { data } = await apiClient.get(GAMES_API);
      setGames(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to fetch games:", error);
      setGames([]);
    }
  }

  async function loadRecent() {
    try {
      const { data } = await apiClient.get<GameEntry[]>(GAME_ENTRIES_API, {
        params: { username },
      });
      setRecent(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load recent entries:", err);
    }
  }

  async function preloadTotals() {
    try {
      const { data } = await apiClient.get(`${PAY_API}/totals`);
      if (data && typeof data === "object") {
        setPaymentTotals({
          cashapp: Number(data.cashapp) || 0,
          paypal: Number(data.paypal) || 0,
          chime: Number(data.chime) || 0,
        });
      }
    } catch (err) {
      console.warn("Could not preload totals:", err);
    }
  }

  // -----------------------------
  // Load games + entries + totals
  // -----------------------------
  useEffect(() => {
    if (!isAuthed) return; // don't load if not authed
    void fetchGames();
    void loadRecent();
    void preloadTotals();
  }, [username, isAuthed]);

  // -----------------------------
  // Auth guard UI
  // -----------------------------
  if (!isAuthed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white shadow-md rounded-lg p-6 max-w-md text-center">
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            You cannot fill the form
          </h1>
          <p className="text-gray-600 mb-4">
            You are not signed in. Please log in again to continue.
          </p>
          <button
            onClick={onLogout}
            className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            Go to login
          </button>
        </div>
      </div>
    );
  }

  // -----------------------------
  // Render UI
  // -----------------------------
  return (
    <div className="min-h-screen bg-gray-50 flex font-sans">
      {/* LEFT: Sidebar */}
      <Sidebar
        mode="user"
        active={activeSection}
        onChange={setActiveSection}
        onLogout={onLogout}
        username={username}
      />

      {/* RIGHT: Main area */}
      <div className="flex-1 flex flex-col">
        <UserSessionBar
          username={username}
          email={email}
          onLogout={onLogout}
          // @ts-expect-error if prop not yet added in UserSessionBar
          onSessionChange={setWorkSignedIn}
        />

        <header className="flex flex-wrap items-center gap-3 px-4 sm:px-8 py-4 border-b bg-white">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">
            {activeSection === "overview" && "Overview"}
            {activeSection === "games" && "Games"}
            {activeSection === "charts" && "Charts"}
            {activeSection === "paymentsHistory" && "Payment History"}
            {activeSection === "depositRecord" && "Recent Game Entries"}
            {activeSection === "gameEntries" && "Game Entries"}
            {activeSection === "gameLogins" && "Game Logins" /* ✅ NEW */}
            {activeSection === "settings" && "Settings"}
          </h1>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-8">
          {/* OVERVIEW TAB */}
          {activeSection === "overview" && (
            <>
              <div className="grid grid-cols-1 gap-6 mb-8">
                {workSignedIn ? (
                  <GameEntryForm username={username} />
                ) : (
                  <div className="w-full border rounded-xl bg-white p-6 text-center text-sm text-gray-600">
                    <p className="font-semibold mb-1">
                      You cannot fill the form.
                    </p>
                    <p>Please sign in using the green button above.</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-6 mb-8">
                {workSignedIn ? (
                  <PendingPayments username={username} />
                ) : (
                  <div className="w-full border rounded-xl bg-white p-6 text-center text-sm text-gray-600">
                    <p>Pending Payments are locked until you sign in.</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* GAME ENTRIES / PAYMENTS COMBINED TAB */}
          {activeSection === "gameEntries" && (
            <div className="mt-4">
              {workSignedIn ? (
                <PaymentCombinedTable username={username} />
              ) : (
                <div className="w-full border rounded-xl bg-white p-6 text-center text-sm text-gray-600">
                  <p>You must sign in before accessing Game Entries.</p>
                </div>
              )}
            </div>
          )}

          {/* GAMES TAB – per-user games table */}
          {activeSection === "games" && (
            <div className="mt-4">
              <UserTable username={username} />
            </div>
          )}

          {/* ✅ NEW: GAME LOGINS TAB – just table/forms for user/admin logins */}
          {activeSection === "gameLogins" && (
            <div className="mt-4">
              <GameLogins
                showAdminForm={false}
                showUserForm={false}
                showAdminTable={false}
                showUserTable={true}
              />
              <GameLoginsTable />
            </div>
          )}

          {/* CHARTS TAB */}
          {activeSection === "charts" && (
            <div className="mt-4">
              <UserCharts games={games} coinValue={COIN_VALUE} />
            </div>
          )}

          {/* PAYMENTS HISTORY TAB */}
          {activeSection === "paymentsHistory" && (
            <div className="mt-4">
              <PaymentHistory apiBase={PAY_API} />
            </div>
          )}

          {/* RECENT GAME ENTRIES */}
          {activeSection === "depositRecord" && (
            <div className="mt-4">
              <RecentEntriesTable
                recent={recent}
                onRefresh={loadRecent}
                title="Recent Game Entries"
              />
            </div>
          )}

          {/* SETTINGS */}
          {activeSection === "settings" && (
            <div className="text-sm text-gray-600 mt-8">
              <p>More sections coming soon (settings, reports, etc.).</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default UserDashboard;
