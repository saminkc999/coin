import React, { useState } from "react";
import axios, { AxiosError } from "axios";
import { API_BASE } from "./apiConfig";
import { showToast } from "./Toast";

interface RegisterFormProps {
  onSwitchToLogin: () => void;
  onSuccess: (username: string) => void;
}

const RegisterForm: React.FC<RegisterFormProps> = ({
  onSwitchToLogin,
  onSuccess,
}) => {
  const [userName, setUserName] = useState(""); // ✅ fixed naming
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (password !== confirmPassword) {
      const msg = "Passwords do not match";
      setError(msg);
      showToast.error(msg);
      return;
    }

    if (password.length < 6) {
      const msg = "Password must be at least 6 characters";
      setError(msg);
      showToast.error(msg);
      return;
    }

    setLoading(true);

    try {
      const { data } = await axios.post(
        `${API_BASE}/api/auth/register`,
        { UserName: userName.trim(), email: email.trim(), password }, // ✅ keep backend field UserName
        { headers: { "Content-Type": "application/json" } }
      );

      const user = data?.user;

      const requiresApproval =
        data?.requiresApproval === true ||
        user?.isApproved === false ||
        user?.status === "pending";

      if (requiresApproval) {
        const msg = "Account created. Waiting for admin approval before login.";
        setSuccess(msg);
        showToast.info(msg);
        return;
      }

      // --- Immediate auto-login for approved accounts ---
      if (data?.token) localStorage.setItem("token", data.token);
      if (user?.role) localStorage.setItem("role", user.role);
      if (user?.email) localStorage.setItem("userEmail", user.email); // ✅ used by sessions

      const resolvedUsername =
        user?.username ||
        user?.name ||
        userName.trim() ||
        email.split("@")[0] ||
        "New User";

      showToast.success("Account created successfully!");
      onSuccess(resolvedUsername);
    } catch (err) {
      console.error("❌ Register failed:", err);
      const axiosErr = err as AxiosError<any>;

      const msg =
        axiosErr.response?.data?.message ||
        axiosErr.message ||
        "Unexpected error during registration.";

      setError(msg);
      showToast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-xl font-bold text-slate-800 mb-4">
        Create Account 🐾
      </h2>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Full Name
        </label>
        <input
          type="text"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="e.g. Alex Sharma"
          value={userName}
          onChange={(e) => setUserName(e.target.value)} // ✅ fixed setter
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Email
        </label>
        <input
          type="email"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Password
        </label>
        <input
          type="password"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Confirm Password
        </label>
        <input
          type="password"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="••••••••"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

      <button
        type="submit"
        disabled={loading}
        className={`w-full mt-2 rounded-lg py-2 text-sm font-semibold text-white transition ${
          loading
            ? "bg-blue-400 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700"
        }`}
      >
        {loading ? "Creating account..." : "Register"}
      </button>

      <p className="mt-4 text-xs text-center text-slate-500">
        Already have an account?{" "}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-blue-600 hover:underline"
        >
          Log in
        </button>
      </p>
    </form>
  );
};

export default RegisterForm;
