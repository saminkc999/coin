// src/UserSessionBar.tsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { LogIn, LogOut, Clock } from "lucide-react";
import { apiClient } from "../apiConfig";

interface UserSessionBarProps {
  username: string;
  email?: string;
  onLogout: () => void;
  onSessionChange?: (isSignedIn: boolean) => void;
}

const LOGIN_API_BASE = "/api/logins";

// ✅ Validate Mongo ObjectId (prevents bad sessionId causing backend CastError)
const isValidObjectId = (v: any) =>
  typeof v === "string" && /^[a-fA-F0-9]{24}$/.test(v);

const UserSessionBar: React.FC<UserSessionBarProps> = ({
  username,
  email,
  onLogout,
  onSessionChange,
}) => {
  const [now, setNow] = useState(new Date());
  const [signInDateTime, setSignInDateTime] = useState<Date | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [showConfirmLogout, setShowConfirmLogout] = useState(false);

  // ✅ Canonical display identity (from session start response / storage)
  const [displayUser, setDisplayUser] = useState(username);
  const [displayEmail, setDisplayEmail] = useState<string | undefined>(email);

  // ✅ Hard locks to prevent double POSTs (React state updates are async)
  const signInLockRef = useRef(false);
  const signOutLockRef = useRef(false);

  // 🕒 Live clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // 📦 Load saved session from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("userSession");
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved);

      const storedUser = parsed.user;
      const storedSignInAt = parsed.signInAt;
      const storedId = parsed.id || parsed.sessionId || null;
      const storedEmail = parsed.email;

      // match by email if possible, otherwise username
      const emailKey = email || localStorage.getItem("userEmail") || "";
      const sameEmail = !emailKey || storedEmail === emailKey;
      const sameUser = storedUser === username;

      if ((sameEmail || sameUser) && storedSignInAt) {
        // ✅ only restore sessionId if valid
        const safeId = storedId && isValidObjectId(storedId) ? storedId : null;

        setSessionId(safeId);
        setSignInDateTime(new Date(storedSignInAt));
        setIsSignedIn(true);

        // ✅ use canonical values stored
        if (storedUser) setDisplayUser(storedUser);
        if (storedEmail) setDisplayEmail(storedEmail);

        onSessionChange?.(true);
      }
    } catch {
      localStorage.removeItem("userSession");
    }
  }, [username, email, onSessionChange]);

  // Keep display values in sync when props change (fallback)
  useEffect(() => {
    setDisplayUser((prev) => prev || username);
    setDisplayEmail((prev) => prev || email);
  }, [username, email]);

  const formattedTime = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const formattedDateFull = now.toLocaleDateString([], {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });

  const signInTimeStr = signInDateTime
    ? signInDateTime.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  const signInDateStr = signInDateTime
    ? signInDateTime.toLocaleDateString([], {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "2-digit",
      })
    : null;

  // 🟢 SIGN IN handler (work session)
  const handleSignIn = useCallback(async () => {
    if (signInLockRef.current) return;
    if (loading) return;
    if (isSignedIn || sessionId) return;

    // ✅ backend /api/logins/start expects EMAIL
    const effectiveEmail = email || localStorage.getItem("userEmail") || "";
    if (!effectiveEmail) {
      alert("Missing email. Please login again.");
      return;
    }

    try {
      signInLockRef.current = true;
      setLoading(true);

      const signInAt = new Date().toISOString();

      const { data } = await apiClient.post(`${LOGIN_API_BASE}/start`, {
        email: effectiveEmail,
        signInAt,
      });

      // ✅ backend returns _id via formatSession
      const id =
        data._id || data.id || data.sessionId || data.session_id || null;

      // ✅ canonical identity from backend
      const canonicalUsername = data.username || username;
      const canonicalEmail = data.email || effectiveEmail;

      const sessionData = {
        id,
        sessionId: id,
        signInAt,
        user: canonicalUsername,
        email: canonicalEmail,
      };

      localStorage.setItem("userSession", JSON.stringify(sessionData));

      setSessionId(id);
      setIsSignedIn(true);
      setSignInDateTime(new Date(signInAt));

      setDisplayUser(canonicalUsername);
      setDisplayEmail(canonicalEmail);

      onSessionChange?.(true);
    } catch (err) {
      console.error("Failed to sign in:", err);
      alert("Failed to start session. Check console or backend.");
    } finally {
      setLoading(false);
      signInLockRef.current = false;
    }
  }, [email, username, onSessionChange, loading, isSignedIn, sessionId]);

  // 🔴 SIGN OUT handler: ends work session + logs out app
  const handleConfirmSignOut = useCallback(async () => {
    if (signOutLockRef.current) return;
    if (loading) return;

    try {
      signOutLockRef.current = true;
      setLoading(true);

      const sid = sessionId;

      // ✅ only call backend if sessionId is valid
      if (sid && isValidObjectId(sid)) {
        await apiClient.post(`${LOGIN_API_BASE}/end`, {
          sessionId: sid,
          signOutAt: new Date().toISOString(),
        });
      } else {
        console.warn("Skip /api/logins/end (invalid sessionId):", sid);
      }

      // ✅ always clear local
      setIsSignedIn(false);
      setSignInDateTime(null);
      setSessionId(null);
      localStorage.removeItem("userSession");

      onSessionChange?.(false);
      onLogout();
    } catch (err: any) {
      console.error("Failed to sign out:", err);
      const status = err?.response?.status;
      const data = err?.response?.data;
      console.error("Sign out response:", { status, data });
      alert(
        data?.message || "Failed to end session. Check console or backend."
      );
    } finally {
      setLoading(false);
      setShowConfirmLogout(false);
      signOutLockRef.current = false;
    }
  }, [loading, sessionId, onLogout, onSessionChange]);

  // Toggle button
  const handleClickToggle = () => {
    if (loading) return;
    if (isSignedIn) setShowConfirmLogout(true);
    else handleSignIn();
  };

  // ⏱️ AUTO TIMEOUT: sign out after 30 minutes
  useEffect(() => {
    if (!isSignedIn || !signInDateTime) return;

    const TIMEOUT_MS = 30 * 60 * 1000;

    const checkAndLogout = () => {
      const elapsed = Date.now() - signInDateTime.getTime();
      if (elapsed >= TIMEOUT_MS) {
        void handleConfirmSignOut();
      }
    };

    checkAndLogout();
    const id = window.setInterval(checkAndLogout, 60 * 1000);
    return () => window.clearInterval(id);
  }, [isSignedIn, signInDateTime, handleConfirmSignOut]);

  const handleCancelSignOut = () => {
    if (loading) return;
    setShowConfirmLogout(false);
  };

  return (
    <>
      <div className="w-full bg-gradient-to-r from-white via-slate-50 to-slate-100 border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3 flex items-center gap-2">
          {/* LEFT: Clock */}
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">
              Current Time
            </span>
            <div className="mt-2 inline-flex items-center rounded-2xl bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-600 shadow-lg px-4 py-2">
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-white/10 mr-3">
                <Clock className="w-4 h-4 text-white" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-lg sm:text-xl font-extrabold text-white tracking-wider">
                  {formattedTime}
                </span>
                <span className="text-[11px] font-medium text-blue-100">
                  {formattedDateFull}
                </span>
              </div>
            </div>
          </div>

          {/* CENTER: Info */}
          <div className="flex-1 flex justify-center">
            {isSignedIn && signInTimeStr && signInDateStr ? (
              <div className="flex flex-col items-center gap-1 text-[11px] sm:text-xs text-slate-600">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Since{" "}
                    <span className="font-bold text-emerald-700">
                      {signInTimeStr}
                    </span>
                  </div>
                  <span className="text-slate-500">
                    <span className="font-semibold text-slate-700">
                      {displayUser}
                    </span>{" "}
                    signed in on {signInDateStr}
                  </span>
                </div>
                {displayEmail && (
                  <span className="text-[10px] text-slate-500">
                    Email: <span className="font-medium">{displayEmail}</span>
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[11px] sm:text-xs text-slate-500">
                Not signed in
              </span>
            )}
          </div>

          {/* RIGHT: Button */}
          <div className="flex justify-end">
            <button
              onClick={handleClickToggle}
              disabled={loading}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-semibold shadow-md transition-transform transform hover:scale-105 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed ${
                isSignedIn
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : "bg-emerald-500 text-white hover:bg-emerald-600"
              }`}
            >
              {isSignedIn ? (
                <>
                  <LogOut className="w-4 h-4" />
                  {loading ? "Signing out..." : "Sign Out"}
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  {loading ? "Signing in..." : "Sign In"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* LOGOUT CONFIRM MODAL */}
      {showConfirmLogout && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-sm mx-4 rounded-2xl shadow-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-1">
              Sign out from this session?
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              You are currently signed in as{" "}
              <span className="font-semibold text-slate-800">
                {displayUser}
              </span>
              {displayEmail && (
                <>
                  {" "}
                  (<span className="text-slate-700">{displayEmail}</span>)
                </>
              )}
              . Your work log for this session will be closed after you sign
              out.
            </p>

            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={handleCancelSignOut}
                disabled={loading}
                className="px-3 py-1.5 text-xs font-medium rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSignOut}
                disabled={loading}
                className="px-3 py-1.5 text-xs font-semibold rounded-full bg-red-500 text-white hover:bg-red-600 shadow-sm disabled:opacity-60"
              >
                {loading ? "Signing out..." : "Confirm Sign Out"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default UserSessionBar;
