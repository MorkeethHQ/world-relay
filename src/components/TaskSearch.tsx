"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Task, TaskCategory } from "@/lib/types";

type SortOption = "newest" | "bounty_desc" | "bounty_asc" | "deadline_asc";

const CATEGORIES: { value: TaskCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "photo", label: "Photo" },
  { value: "delivery", label: "Delivery" },
  { value: "check-in", label: "Check-in" },
  { value: "custom", label: "Custom" },
  { value: "feedback", label: "Feedback" },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "bounty_desc", label: "Highest Bounty" },
  { value: "bounty_asc", label: "Lowest Bounty" },
  { value: "deadline_asc", label: "Ending Soon" },
];

const CATEGORY_ICONS: Record<string, string> = {
  photo: "📸",
  delivery: "📦",
  "check-in": "📍",
  custom: "✏️",
  feedback: "💬",
};

function timeLeft(deadline: string): string {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / 3600_000);
  const mins = Math.floor((ms % 3600_000) / 60_000);
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function SkeletonCard() {
  const shimmer =
    "bg-[length:200%_100%] bg-gradient-to-r from-gray-100 via-gray-200 to-gray-100 animate-[shimmer_1.5s_infinite]";
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3 bg-white border border-gray-100 shadow-sm">
      <div className="flex items-start gap-2">
        <div className={`w-5 h-5 rounded shrink-0 ${shimmer}`} />
        <div className="flex-1 flex flex-col gap-1.5">
          <div className={`h-4 rounded-md w-full ${shimmer}`} />
          <div className={`h-4 rounded-md w-3/4 ${shimmer}`} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full shrink-0 ${shimmer}`} />
        <div className={`h-3 rounded-md w-28 ${shimmer}`} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`h-6 rounded-full w-14 ${shimmer}`} />
          <div className={`h-6 rounded-lg w-20 ${shimmer}`} />
        </div>
        <div className={`h-5 rounded-md w-16 ${shimmer}`} />
      </div>
    </div>
  );
}

type SearchResult = {
  tasks: Task[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  filters_applied: Record<string, string | number>;
};

export function TaskSearch({ initialTasks }: { initialTasks?: Task[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<TaskCategory | "all">("all");
  const [sort, setSort] = useState<SortOption>("newest");
  const [minBounty, setMinBounty] = useState("");
  const [maxBounty, setMaxBounty] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [tasks, setTasks] = useState<Task[]>(initialTasks || []);
  const [total, setTotal] = useState(initialTasks?.length || 0);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTasks = useCallback(
    async (newOffset = 0, append = false) => {
      setLoading(true);
      setHasSearched(true);

      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (category !== "all") params.set("category", category);
      params.set("status", "open");
      params.set("sort", sort);
      if (minBounty) params.set("min_bounty", minBounty);
      if (maxBounty) params.set("max_bounty", maxBounty);
      params.set("limit", "20");
      params.set("offset", String(newOffset));

      try {
        const res = await fetch(`/api/tasks/search?${params.toString()}`);
        if (!res.ok) throw new Error("Search failed");
        const data: SearchResult = await res.json();
        if (append) {
          setTasks((prev) => [...prev, ...data.tasks]);
        } else {
          setTasks(data.tasks);
        }
        setTotal(data.pagination.total);
        setHasMore(data.pagination.hasMore);
        setOffset(newOffset);
      } catch (err) {
        console.error("Task search error:", err);
      } finally {
        setLoading(false);
      }
    },
    [query, category, sort, minBounty, maxBounty]
  );

  // Debounced search on query/filter changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchTasks(0);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchTasks]);

  const loadMore = () => {
    if (!loading && hasMore) {
      fetchTasks(offset + 20, true);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Search input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-gray-400"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks..."
          className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300 transition-all"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setCategory(cat.value)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              category === cat.value
                ? "bg-gray-900 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {cat.value !== "all" && (
              <span className="mr-1">{CATEGORY_ICONS[cat.value]}</span>
            )}
            {cat.label}
          </button>
        ))}
      </div>

      {/* Sort + Filters toggle */}
      <div className="flex items-center justify-between gap-2">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            showFilters
              ? "bg-gray-900 text-white"
              : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
          Filters
        </button>
      </div>

      {/* Bounty range filters (collapsible) */}
      {showFilters && (
        <div className="flex items-center gap-2 animate-[fadeIn_0.2s_ease-out]">
          <span className="text-xs text-gray-500 shrink-0">Bounty:</span>
          <input
            type="number"
            value={minBounty}
            onChange={(e) => setMinBounty(e.target.value)}
            placeholder="Min $"
            min="0"
            className="w-20 px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
          <span className="text-xs text-gray-400">-</span>
          <input
            type="number"
            value={maxBounty}
            onChange={(e) => setMaxBounty(e.target.value)}
            placeholder="Max $"
            min="0"
            className="w-20 px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
          {(minBounty || maxBounty) && (
            <button
              onClick={() => { setMinBounty(""); setMaxBounty(""); }}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Results count */}
      {hasSearched && !loading && (
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] text-gray-400">
            {total} {total === 1 ? "task" : "tasks"} found
          </span>
          {(query || category !== "all" || minBounty || maxBounty) && (
            <button
              onClick={() => {
                setQuery("");
                setCategory("all");
                setMinBounty("");
                setMaxBounty("");
                setSort("newest");
              }}
              className="text-[11px] text-gray-500 hover:text-gray-700 underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Loading state */}
      {loading && !tasks.length && (
        <div className="flex flex-col gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Empty state */}
      {!loading && hasSearched && tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <p className="text-sm text-gray-500 font-medium">No tasks match your filters</p>
          <p className="text-xs text-gray-400">Try adjusting your search or filters</p>
        </div>
      )}

      {/* Task results */}
      {tasks.length > 0 && (
        <div className="flex flex-col gap-3">
          {tasks.map((task) => (
            <TaskResultCard key={task.id} task={task} />
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && !loading && (
        <button
          onClick={loadMore}
          className="w-full py-3 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all"
        >
          Load more tasks
        </button>
      )}

      {/* Loading indicator for pagination */}
      {loading && tasks.length > 0 && (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}

function TaskResultCard({ task }: { task: Task }) {
  const deadline = timeLeft(task.deadline);
  const isExpired = deadline === "expired";

  return (
    <a
      href={`/task/${task.id}`}
      className="block rounded-2xl p-4 bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all active:scale-[0.98]"
    >
      {/* Description + category icon */}
      <div className="flex items-start gap-2 mb-2">
        <span className="text-base shrink-0 mt-0.5">
          {CATEGORY_ICONS[task.category] || "✏️"}
        </span>
        <p className="text-sm text-gray-900 leading-snug line-clamp-2">
          {task.description}
        </p>
      </div>

      {/* Location */}
      <div className="flex items-center gap-1.5 mb-3">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 shrink-0">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <span className="text-xs text-gray-500 truncate">{task.location}</span>
      </div>

      {/* Bottom row: bounty, category pill, agent, deadline */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Bounty badge */}
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-100">
            ${task.bountyUsdc}
          </span>

          {/* Category pill */}
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-medium bg-gray-100 text-gray-600">
            {task.category}
          </span>

          {/* Agent icon */}
          {task.agent && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[10px] bg-gray-50 border border-gray-100"
              title={task.agent.name}
            >
              <span>{task.agent.icon}</span>
              <span className="text-gray-500 max-w-[60px] truncate">{task.agent.name}</span>
            </span>
          )}
        </div>

        {/* Deadline countdown */}
        <span
          className={`text-[11px] font-medium ${
            isExpired
              ? "text-red-500"
              : deadline.includes("m") && !deadline.includes("h")
              ? "text-orange-500"
              : "text-gray-400"
          }`}
        >
          {isExpired ? "Expired" : deadline}
        </span>
      </div>
    </a>
  );
}
