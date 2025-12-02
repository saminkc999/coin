// src/GameLoginsTable.tsx
import React, { useEffect, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "../DataTable"; // your existing reusable table
import { apiClient } from "../apiConfig";

interface GameLogin {
  _id: string;
  gameName?: string;
  gameLink?: string;
}

const GameLoginsTable: React.FC = () => {
  const [rows, setRows] = useState<GameLogin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");

      const { data } = await apiClient.get<GameLogin[]>(
        "https://coin-backend-production-9573.up.railway.app/api/game-logins"
      );

      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Game logins fetch error:", err);
      setError("Failed to load game logins.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const columns: ColumnDef<GameLogin>[] = [
    {
      accessorKey: "gameName",
      header: "Game Name",
      cell: ({ getValue }) => (
        <span className="font-medium text-gray-800">
          {String(getValue() ?? "—")}
        </span>
      ),
    },
    {
      accessorKey: "gameLink",
      header: "Link",
      cell: ({ row }) => {
        const link = row.original.gameLink;
        return link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline text-xs"
          >
            Open
          </a>
        ) : (
          <span className="text-slate-500 text-xs">—</span>
        );
      },
    },
  ];

  return (
    <div className="bg-white shadow-md rounded-2xl p-4 md:p-6 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Game Logins</h2>
        <button
          onClick={loadData}
          disabled={loading}
          className="text-xs px-3 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded mb-3">
          {error}
        </p>
      )}

      <DataTable columns={columns} data={rows} />
    </div>
  );
};

export default GameLoginsTable;
