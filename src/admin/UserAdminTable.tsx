import React, { FC, useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Loader2, AlertTriangle, CheckCircle2, Clock, Ban } from "lucide-react";

import { apiClient } from "../apiConfig";
import { DataTable } from "../DataTable";

export interface UserSummary {
  _id: string;
  username?: string;
  email?: string;
  totalPayments: number;
  totalFreeplay: number;
  totalDeposit: number;
  totalRedeem: number;

  // from backend
  isAdmin?: boolean;
  isApproved?: boolean;
  status?: string; // "pending" | "active" | "blocked" | etc.

  // NEW: session info from backend /api/admin/users
  isOnline?: boolean;
  lastSignInAt?: string | null;
  lastSignOutAt?: string | null;
}

export interface UserAdminTableProps {
  onViewHistory: (username: string) => void;
}

const fmtAmount = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const UserAdminTable: FC<UserAdminTableProps> = ({ onViewHistory }) => {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionUserId, setActionUserId] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await apiClient.get<UserSummary[]>(
        "/api/admin/users"
      );

      const safeData = Array.isArray(data) ? data : [];

      // 🔥 FILTER OUT ADMIN LOGINS HERE
      const filtered = safeData.filter((u) => {
        // if backend has isAdmin flag
        if (u.isAdmin) return false;

        // extra safety: hide username "admin"
        if (u.username && u.username.toLowerCase() === "admin") return false;

        return true;
      });

      setUsers(filtered);
    } catch (e) {
      console.error("Failed to load users:", e);
      setError("Failed to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm("Delete this user?")) return;
    try {
      setActionUserId(id);
      await apiClient.delete(`/api/admin/users/${id}`);
      await fetchUsers();
    } catch (e) {
      console.error("Failed to delete user:", e);
    } finally {
      setActionUserId(null);
    }
  };

  const columns = useMemo<ColumnDef<UserSummary, any>[]>(() => {
    return [
      // NEW: Online / Offline column
      {
        id: "online",
        header: "Online",
        cell: ({ row }) => {
          const u = row.original;
          const isOnline = Boolean(u.isOnline);

          if (isOnline) {
            return (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Online
              </span>
            );
          }

          return (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 bg-slate-50 px-2 py-1 rounded-full">
              <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
              Offline
            </span>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const u = row.original;
          const status = (u.status || "").toLowerCase();
          const isApproved = u.isApproved;

          // Decide label + icon + styles
          if (status === "blocked") {
            return (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2 py-1 rounded-full">
                <Ban size={12} />
                Blocked
              </span>
            );
          }

          if (status === "pending" || isApproved === false) {
            return (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 bg-slate-50 px-2 py-1 rounded-full">
                <Clock size={12} />
                Pending
              </span>
            );
          }

          // default → treat as approved/active
          return (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">
              <CheckCircle2 size={12} />
              Approved
            </span>
          );
        },
      },
      {
        accessorKey: "username",
        header: "Username",
        cell: ({ row }) => (
          <span className="font-medium text-gray-800">
            {row.original.username || "-"}
          </span>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => row.original.email || "-",
      },
      {
        accessorKey: "totalDeposit",
        header: "Deposit",
        cell: ({ row }) => fmtAmount(row.original.totalDeposit || 0),
      },
      {
        accessorKey: "totalFreeplay",
        header: "Freeplay",
        cell: ({ row }) => fmtAmount(row.original.totalFreeplay || 0),
      },
      {
        accessorKey: "totalRedeem",
        header: "Redeem",
        cell: ({ row }) => fmtAmount(row.original.totalRedeem || 0),
      },
      {
        accessorKey: "totalPayments",
        header: "Payments",
        cell: ({ row }) => fmtAmount(row.original.totalPayments || 0),
      },
    ];
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">User list</h2>

        <button
          onClick={fetchUsers}
          disabled={loading}
          className="text-xs px-3 py-1 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-60"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      <DataTable<UserSummary, any>
        columns={columns}
        data={users}
        isLoading={loading}
        emptyMessage="No users found."
        onRowClick={(user) => {
          if (user.username) onViewHistory(user.username);
        }}
        rowActions={{
          onEdit: (user) => {
            if (user.username) onViewHistory(user.username);
          },
          onDelete: (user) => {
            if (user._id) handleDeleteUser(user._id);
          },
        }}
      />

      {actionUserId && (
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          Processing action for user: {actionUserId}
        </div>
      )}
    </div>
  );
};

export default UserAdminTable;
