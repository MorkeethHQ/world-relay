"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Task, TaskStatus } from "@/lib/types";

const STATUS_COLORS: Record<TaskStatus, string> = {
  open: "#22c55e",
  claimed: "#eab308",
  completed: "#3b82f6",
  failed: "#ef4444",
  expired: "#6b7280",
  cancelled: "#9ca3af",
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  claimed: "Claimed",
  completed: "Completed",
  failed: "Failed",
  expired: "Expired",
  cancelled: "Cancelled",
};

function markerRadius(bountyUsdc: number): number {
  if (bountyUsdc >= 5) return 14;
  if (bountyUsdc >= 2) return 12;
  return 10;
}

function makeIcon(color: string, radius: number = 10) {
  const size = radius * 2;
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`,
    iconSize: [size, size],
    iconAnchor: [radius, radius],
  });
}

function makeClusterIcon(count: number) {
  const size = Math.min(40, 24 + count * 2);
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:rgba(59,130,246,0.85);border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700;">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Simple client-side clustering: group markers within a pixel distance at the current zoom
function clusterTasks(
  tasks: Task[],
  map: L.Map,
  clusterPixelRadius: number = 40
): { tasks: Task[]; center: { lat: number; lng: number } }[] {
  const clusters: { tasks: Task[]; center: { lat: number; lng: number } }[] = [];

  for (const task of tasks) {
    if (task.lat == null || task.lng == null) continue;
    const pt = map.latLngToContainerPoint([task.lat, task.lng]);
    let merged = false;

    for (const cluster of clusters) {
      const cPt = map.latLngToContainerPoint([cluster.center.lat, cluster.center.lng]);
      const dx = pt.x - cPt.x;
      const dy = pt.y - cPt.y;
      if (Math.sqrt(dx * dx + dy * dy) < clusterPixelRadius) {
        cluster.tasks.push(task);
        // Recompute center as average
        const all = cluster.tasks;
        cluster.center = {
          lat: all.reduce((s, t) => s + (t.lat || 0), 0) / all.length,
          lng: all.reduce((s, t) => s + (t.lng || 0), 0) / all.length,
        };
        merged = true;
        break;
      }
    }

    if (!merged) {
      clusters.push({ tasks: [task], center: { lat: task.lat, lng: task.lng } });
    }
  }

  return clusters;
}

function truncate(str: string, len: number) {
  return str.length > len ? str.slice(0, len) + "..." : str;
}

type FilterStatus = TaskStatus | "all";

export default function TaskMapFull() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<FilterStatus>("all");

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) return;
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {
      // silently ignore fetch errors
    }
  }, []);

  // Initial fetch + auto-refresh every 10s
  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 10_000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([48.8566, 2.3522], 3); // default view; fitBounds will override

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { maxZoom: 19 }
    ).addTo(map);

    L.control.zoom({ position: "topright" }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    markersRef.current = layerGroup;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markersRef.current = null;
    };
  }, []);

  const hasFitBounds = useRef(false);

  // Update markers when tasks or filter change
  useEffect(() => {
    const group = markersRef.current;
    const map = mapInstanceRef.current;
    if (!group || !map) return;

    group.clearLayers();

    const visible = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);
    const geoVisible = visible.filter((t) => t.lat != null && t.lng != null);

    // Fit bounds to include all markers on first load
    if (!hasFitBounds.current && geoVisible.length > 0) {
      const bounds = L.latLngBounds(
        geoVisible.map((t) => [t.lat!, t.lng!] as [number, number])
      );
      // Check if all tasks are essentially in one city (bounds span < 0.1 deg)
      const latSpan = bounds.getNorth() - bounds.getSouth();
      const lngSpan = bounds.getEast() - bounds.getWest();
      if (latSpan < 0.05 && lngSpan < 0.05) {
        map.setView(bounds.getCenter(), 13);
      } else {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      }
      hasFitBounds.current = true;
    }

    // Use simple clustering at low zoom levels
    const zoom = map.getZoom();
    const shouldCluster = zoom < 10 && geoVisible.length > 3;

    if (shouldCluster) {
      const clusters = clusterTasks(geoVisible, map, 50);
      for (const cluster of clusters) {
        if (cluster.tasks.length === 1) {
          // Single task - render normally
          const task = cluster.tasks[0];
          addTaskMarker(task, group);
        } else {
          // Cluster marker
          const icon = makeClusterIcon(cluster.tasks.length);
          const clusterBounty = cluster.tasks.reduce((s, t) => s + t.bountyUsdc, 0);
          const popupHtml = `
            <div style="font-family:system-ui,sans-serif;color:#e5e7eb;max-width:200px;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:600;">${cluster.tasks.length} tasks</p>
              <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;">Total bounty: $${clusterBounty.toFixed(2)} USDC</p>
              <p style="margin:0;font-size:10px;color:#6b7280;">Zoom in to see individual tasks</p>
            </div>
          `;
          L.marker([cluster.center.lat, cluster.center.lng], { icon })
            .bindPopup(popupHtml, {
              className: "dark-popup",
              closeButton: true,
              maxWidth: 220,
            })
            .addTo(group);
        }
      }
    } else {
      for (const task of geoVisible) {
        addTaskMarker(task, group);
      }
    }

    function addTaskMarker(task: Task, layer: L.LayerGroup) {
      const pinColor = STATUS_COLORS[task.status] || "#6b7280";
      const radius = markerRadius(task.bountyUsdc);
      const icon = makeIcon(pinColor, radius);
      const statusLabel = STATUS_LABELS[task.status] || task.status;

      const agentHtml = task.agent
        ? `<p style="margin:0 0 4px;font-size:11px;color:#9ca3af;">
            <span style="font-size:13px;">${task.agent.icon}</span> ${task.agent.name}
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${task.agent.color};margin-left:4px;vertical-align:middle;"></span>
          </p>`
        : "";

      const descriptionTruncated = truncate(task.description, 80);

      const popupHtml = `
        <div style="font-family:system-ui,sans-serif;color:#e5e7eb;max-width:220px;">
          ${agentHtml}
          <p style="margin:0 0 6px;font-size:13px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${descriptionTruncated}</p>
          <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;">💰 $${task.bountyUsdc} USDC</p>
          <p style="margin:0 0 4px;font-size:11px;">
            <span style="display:inline-block;padding:1px 6px;border-radius:9999px;font-size:10px;font-weight:600;background:${STATUS_COLORS[task.status]}22;color:${STATUS_COLORS[task.status]};">${statusLabel}</span>
          </p>
          <a href="/task/${task.id}" style="display:inline-block;margin-top:6px;font-size:12px;color:#60a5fa;text-decoration:none;font-weight:500;">View Task &rarr;</a>
        </div>
      `;

      L.marker([task.lat!, task.lng!], { icon })
        .bindPopup(popupHtml, {
          className: "dark-popup",
          closeButton: true,
          maxWidth: 240,
        })
        .addTo(layer);
    }

    // Re-cluster on zoom change
    const onZoom = () => {
      // Trigger re-render by re-running this effect via a state change
      // But since we can't do that directly, we'll re-run the clustering inline
      group.clearLayers();
      const currentZoom = map.getZoom();
      const doCluster = currentZoom < 10 && geoVisible.length > 3;
      if (doCluster) {
        const clusters = clusterTasks(geoVisible, map, 50);
        for (const cluster of clusters) {
          if (cluster.tasks.length === 1) {
            addTaskMarker(cluster.tasks[0], group);
          } else {
            const cIcon = makeClusterIcon(cluster.tasks.length);
            const cBounty = cluster.tasks.reduce((s, t) => s + t.bountyUsdc, 0);
            const cPopup = `
              <div style="font-family:system-ui,sans-serif;color:#e5e7eb;max-width:200px;">
                <p style="margin:0 0 4px;font-size:13px;font-weight:600;">${cluster.tasks.length} tasks</p>
                <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;">Total bounty: $${cBounty.toFixed(2)} USDC</p>
                <p style="margin:0;font-size:10px;color:#6b7280;">Zoom in to see individual tasks</p>
              </div>
            `;
            L.marker([cluster.center.lat, cluster.center.lng], { icon: cIcon })
              .bindPopup(cPopup, { className: "dark-popup", closeButton: true, maxWidth: 220 })
              .addTo(group);
          }
        }
      } else {
        for (const task of geoVisible) {
          addTaskMarker(task, group);
        }
      }
    };

    map.on("zoomend", onZoom);
    return () => {
      map.off("zoomend", onZoom);
    };
  }, [tasks, filter]);

  const visibleTasks =
    filter === "all" ? tasks : tasks.filter((t) => t.status === filter);
  const geoTasks = visibleTasks.filter(
    (t) => t.lat != null && t.lng != null
  );
  const totalBounty = geoTasks.reduce((sum, t) => sum + t.bountyUsdc, 0);

  const filters: { label: string; value: FilterStatus; color: string }[] = [
    { label: "All", value: "all", color: "#ffffff" },
    { label: "Open", value: "open", color: STATUS_COLORS.open },
    { label: "Claimed", value: "claimed", color: STATUS_COLORS.claimed },
    { label: "Completed", value: "completed", color: STATUS_COLORS.completed },
  ];

  return (
    <div className="relative w-full h-full">
      {/* Filter bar */}
      <div className="absolute top-3 left-3 right-14 z-[1000] flex gap-1 sm:gap-1.5 overflow-x-auto">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className="px-2.5 sm:px-3 py-1.5 rounded-full text-[10px] sm:text-[11px] font-semibold transition-all border shrink-0 min-h-[36px]"
            style={{
              background:
                filter === f.value ? f.color + "22" : "rgba(0,0,0,0.6)",
              color: filter === f.value ? f.color : "#9ca3af",
              borderColor:
                filter === f.value ? f.color + "55" : "rgba(255,255,255,0.1)",
              backdropFilter: "blur(8px)",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Stats overlay */}
      <div
        className="absolute bottom-4 left-3 z-[1000] rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-[10px] sm:text-[11px] border border-white/10"
        style={{
          background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="text-gray-400">
          <span className="text-white font-semibold">{geoTasks.length}</span>{" "}
          tasks on map
        </div>
        <div className="text-gray-400 mt-0.5">
          <span className="text-green-400 font-semibold">
            ${totalBounty.toFixed(2)}
          </span>{" "}
          total bounty
        </div>
      </div>

      {/* Map container */}
      <div ref={mapRef} className="w-full h-full" />

      {/* Dark popup styles */}
      <style jsx global>{`
        .dark-popup .leaflet-popup-content-wrapper {
          background: rgba(15, 15, 15, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        }
        .dark-popup .leaflet-popup-tip {
          background: rgba(15, 15, 15, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .dark-popup .leaflet-popup-close-button {
          color: #9ca3af !important;
        }
        .dark-popup .leaflet-popup-close-button:hover {
          color: #fff !important;
        }
      `}</style>
    </div>
  );
}
