"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type FeedbackTemplate = {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  pointsReward: number;
  requiresPhoto: boolean;
};

type Props = {
  address: string | null;
  onComplete?: () => void;
};

function resizeImage(file: File, maxWidth = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unavailable"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

export function FeedbackTasks({ address, onComplete }: Props) {
  const [templates, setTemplates] = useState<FeedbackTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [response, setResponse] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/feedback-tasks")
      .then((r) => r.json())
      .then((data) => setTemplates(data.tasks || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleImageCapture = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const resized = await resizeImage(file, 800);
        setImageData(resized);
      } catch {
        const reader = new FileReader();
        reader.onload = () => setImageData(reader.result as string);
        reader.readAsDataURL(file);
      }
    },
    []
  );

  const handleSubmit = useCallback(
    async (templateId: string) => {
      if (!address) return;
      const template = templates.find((t) => t.id === templateId);
      if (!template) return;
      if (template.requiresPhoto && !imageData) {
        setError("This task needs a photo");
        return;
      }
      if (!template.requiresPhoto && !response.trim()) {
        setError("Write something first");
        return;
      }

      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/feedback-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address,
            templateId,
            response: response.trim() || undefined,
            image: imageData || undefined,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setError(err.error || "Something went wrong");
          return;
        }

        const data = await res.json();
        setCompleted((prev) => new Map(prev).set(templateId, data.pointsEarned));
        setActiveId(null);
        setResponse("");
        setImageData(null);
        onComplete?.();
      } catch {
        setError("Failed to submit. Try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [address, templates, response, imageData, onComplete]
  );

  if (loading) {
    return (
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
        <div className="h-4 w-32 bg-gray-100 rounded-md animate-pulse mb-3" />
        <div className="h-16 bg-gray-50 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (templates.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">
          Try something — earn points
        </p>
        <span className="text-[9px] text-gray-300">no wallet needed</span>
      </div>

      {templates.map((t) => {
        const isDone = completed.has(t.id);
        const isActive = activeId === t.id;

        if (isDone) {
          return (
            <div
              key={t.id}
              className="rounded-2xl bg-white border-2 border-green-100 shadow-sm p-4 flex items-center gap-3 animate-[fadeIn_0.3s_ease-out]"
            >
              <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-200 flex items-center justify-center shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{t.title}</p>
                <p className="text-xs text-green-600 font-medium">+{completed.get(t.id)} points earned</p>
              </div>
            </div>
          );
        }

        return (
          <div
            key={t.id}
            className={`rounded-2xl bg-white border shadow-sm transition-all duration-200 ${
              isActive ? "border-gray-300 ring-1 ring-gray-200" : "border-gray-100"
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setActiveId(isActive ? null : t.id);
                setError(null);
                setResponse("");
                setImageData(null);
              }}
              className="w-full px-4 py-3.5 flex items-center gap-3 text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-lg shrink-0">
                {t.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 leading-snug">{t.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-gray-400">+{t.pointsReward} pts</span>
                  {t.requiresPhoto && (
                    <span className="text-[9px] text-gray-300 flex items-center gap-0.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                      photo
                    </span>
                  )}
                </div>
              </div>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`text-gray-300 transition-transform duration-200 shrink-0 ${isActive ? "rotate-180" : ""}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {isActive && (
              <div className="px-4 pb-4 animate-[fadeIn_0.2s_ease-out]">
                <p className="text-xs text-gray-500 leading-relaxed mb-3">{t.description}</p>

                <div className="flex flex-col gap-2.5">
                  {t.requiresPhoto && (
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={handleImageCapture}
                      />
                      {imageData ? (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="relative w-full h-32 rounded-xl overflow-hidden border border-gray-200 group"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={imageData} alt="Proof" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="text-white text-xs font-medium">Change</span>
                          </div>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full h-20 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center gap-2 hover:border-gray-300 hover:bg-gray-50 transition-colors"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                          </svg>
                          <span className="text-xs text-gray-400">Tap to take a photo</span>
                        </button>
                      )}
                    </div>
                  )}

                  <textarea
                    value={response}
                    onChange={(e) => setResponse(e.target.value)}
                    placeholder={t.requiresPhoto ? "Add a note (optional)" : "Type your response..."}
                    rows={2}
                    className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300 transition-all"
                  />

                  {error && <p className="text-xs text-red-500">{error}</p>}

                  <button
                    type="button"
                    onClick={() => handleSubmit(t.id)}
                    disabled={submitting || (!address)}
                    className="w-full py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:bg-gray-300 disabled:text-gray-500 active:scale-[0.98] transition-all"
                  >
                    {submitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Submitting...
                      </span>
                    ) : !address ? (
                      "Sign in to submit"
                    ) : (
                      `Submit — earn ${t.pointsReward} pts`
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
