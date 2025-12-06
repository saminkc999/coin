// src/apiConfig.ts
import axios from "axios";
import { showToast } from "./Toast";

/**
 * Smart base URL logic
 */
export const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:5000"
    : "https://shopie-shimely-production.up.railway.app");

export const apiClient = axios.create({
  baseURL: `${API_BASE}`,
  withCredentials: false,
  headers: { "Content-Type": "application/json" },
});

/* -------------------------------
   REQUEST INTERCEPTOR
-------------------------------- */
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/* -------------------------------
   RESPONSE INTERCEPTOR
   🔥 AUTO LOGOUT ON 401
-------------------------------- */
apiClient.interceptors.response.use(
  (response) => response, // pass through

  (error) => {
    if (error.response?.status === 401) {
      // Clear stored login info
      localStorage.removeItem("token");
      localStorage.removeItem("username");
      localStorage.removeItem("email");

      // User message
      showToast.error("You cannot fill the form. You are not signed in.");

      // Redirect to login screen
      setTimeout(() => {
        window.location.href = "/login"; // adjust if needed
      }, 800);
    }

    return Promise.reject(error);
  }
);
// shopie-shimely-production.up.railway.app