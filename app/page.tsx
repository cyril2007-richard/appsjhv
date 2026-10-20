"use client";

import { useEffect, useState, useRef } from "react";
import { database } from "./firebase";
import { ref, onValue, update, set } from "firebase/database";

type CallData = {
  state?: "idle" | "calling" | "ringing" | "in_call" | "ended" | "declined";
  room?: string;
  initiator?: "pi" | "caregiver";
  timestamp?: number;
};

type VitalsData = {
  heartRate?: number;
  spo2?: number;
  battery?: number;
  steps?: number;
  bodyTemp?: number;
  stress?: string;
  fallDetected?: boolean;
};

type LocationData = {
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  speed?: number;
  address?: string;
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<"call" | "vitals" | "location">("call");

  // Call state
  const [callData, setCallData] = useState<CallData>({ state: "idle" });
  const [streamUrl, setStreamUrl] = useState<string>("");
  const userId = "blind_user_1";
  const ringAudioRef = useRef<HTMLAudioElement | null>(null);

  // Vitals state
  const [vitals, setVitals] = useState<VitalsData>({
    heartRate: 74,
    spo2: 98,
    battery: 86,
    steps: 3420,
    bodyTemp: 36.6,
    stress: "Low",
    fallDetected: false,
  });

  // Location state (defaults to Lagos / Nigeria tech hub coords)
  const [location, setLocation] = useState<LocationData>({
    latitude: 6.5244,
    longitude: 3.3792,
    accuracy: 5,
    speed: 1.2,
    address: "Yaba, Lagos, Nigeria",
  });

  useEffect(() => {
    // 1. Call sync
    const callRef = ref(database, `users/${userId}/call`);
    const unsubCall = onValue(callRef, (snapshot) => {
      const data = (snapshot.val() as CallData) || { state: "idle" };
      setCallData(data);
      if (data.room && data.room.startsWith("http")) {
        setStreamUrl(data.room);
      }
    });

    // 2. Vitals telemetry sync
    const vitalsRef = ref(database, `users/${userId}/vitals`);
    const unsubVitals = onValue(vitalsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setVitals((prev) => ({ ...prev, ...data }));
      }
    });

    // 3. Location GPS sync
    const locationRef = ref(database, `users/${userId}/location`);
    const unsubLocation = onValue(locationRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setLocation((prev) => ({ ...prev, ...data }));
      }
    });

    return () => {
      unsubCall();
      unsubVitals();
      unsubLocation();
    };
  }, []);

  const state = callData.state || "idle";
  const initiator = callData.initiator;

  // Sound effects logic for incoming ringing
  useEffect(() => {
    if (state === "ringing" && initiator === "pi") {
      ringAudioRef.current?.play().catch(() => {});
    } else {
      if (ringAudioRef.current) {
        ringAudioRef.current.pause();
        ringAudioRef.current.currentTime = 0;
      }
    }
  }, [state, initiator]);

  const handleDial = () => {
    const callRef = ref(database, `users/${userId}/call`);
    update(callRef, {
      state: "ringing",
      initiator: "caregiver",
      room: streamUrl || "",
      timestamp: Math.floor(Date.now() / 1000),
    });
  };

  const handleAccept = () => {
    const callRef = ref(database, `users/${userId}/call`);
    update(callRef, {
      state: "in_call",
      timestamp: Math.floor(Date.now() / 1000),
    });
  };

  const handleEnd = () => {
    const callRef = ref(database, `users/${userId}/call`);
    update(callRef, {
      state: "ended",
      timestamp: Math.floor(Date.now() / 1000),
    });

    setTimeout(() => {
      set(callRef, {
        state: "idle",
        room: "",
        initiator: "",
        timestamp: Math.floor(Date.now() / 1000),
      });
    }, 1200);
  };

  const feedSrc =
    state === "in_call" && streamUrl
      ? streamUrl.endsWith("/video_feed")
        ? streamUrl
        : `${streamUrl.replace(/\/$/, "")}/video_feed`
      : "";

  const mapEmbedUrl = `https://maps.google.com/maps?q=${location.latitude || 6.5244},${location.longitude || 3.3792}&hl=en&z=16&output=embed`;

  return (
    <div className="flex min-h-screen flex-col items-center bg-[#121212] text-zinc-100 p-4 font-sans pb-24">
      {/* App Header */}
      <header className="flex w-full max-w-xl items-center justify-between rounded-2xl bg-[#1c1c1e] px-5 py-4 border border-zinc-800 shadow-md">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 rounded-full bg-[#FF6B35] animate-pulse" />
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white leading-tight">IRIS Caregiver</h1>
            <p className="text-[11px] text-zinc-400">Vhorde Technologies</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-zinc-900 px-3.5 py-1.5 border border-zinc-700">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              state === "in_call"
                ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                : state === "ringing" || state === "calling"
                ? "bg-amber-400 animate-ping"
                : "bg-zinc-500"
            }`}
          />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            {state.replace("_", " ")}
          </span>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="mt-4 flex w-full max-w-xl rounded-2xl bg-[#1c1c1e] p-1.5 border border-zinc-800 gap-1">
        <button
          onClick={() => setActiveTab("call")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === "call"
              ? "bg-[#FF6B35] text-white shadow-md"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <span>🎥</span>
          <span>Video Call</span>
        </button>
        <button
          onClick={() => setActiveTab("vitals")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === "vitals"
              ? "bg-[#FF6B35] text-white shadow-md"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <span>❤️</span>
          <span>Vitals</span>
        </button>
        <button
          onClick={() => setActiveTab("location")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === "location"
              ? "bg-[#FF6B35] text-white shadow-md"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <span>📍</span>
          <span>Location</span>
        </button>
      </div>

      {/* ── TAB 1: VIDEO CALL & STREAM ── */}
      {activeTab === "call" && (
        <main className="mt-4 flex w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-[#1c1c1e] border border-zinc-800 shadow-2xl">
          <div className="relative aspect-[4/3] w-full bg-black flex items-center justify-center overflow-hidden">
            {feedSrc ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={feedSrc}
                alt="IRIS Live Glasses Stream"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-zinc-500 p-6 text-center">
                <svg className="h-12 w-12 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
                <p className="text-sm font-medium">
                  {state === "ringing"
                    ? initiator === "pi"
                      ? "📲 Incoming call from smart glasses..."
                      : "📞 Dialing smart glasses..."
                    : state === "in_call"
                    ? "Connecting video feed..."
                    : "Live video feed idle"}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4 p-6">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Target User:</span>
              <span className="font-mono text-zinc-200 bg-zinc-900 px-2 py-1 rounded-md border border-zinc-800">
                {userId}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-400 font-medium">Glasses HTTP Stream URL:</label>
              <input
                type="text"
                value={streamUrl}
                onChange={(e) => setStreamUrl(e.target.value)}
                placeholder="http://192.168.1.xxx:5000"
                className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm text-white placeholder-zinc-600 border border-zinc-800 focus:outline-none focus:border-[#FF6B35]"
              />
            </div>

            <div className="mt-2 flex gap-3">
              {state === "idle" || state === "ended" || state === "declined" ? (
                <button
                  onClick={handleDial}
                  className="flex-1 rounded-xl bg-[#FF6B35] py-3.5 text-sm font-bold text-white shadow-lg transition-all hover:bg-[#e85a26] active:scale-[0.98]"
                >
                  📞 Call Smart Glasses
                </button>
              ) : null}

              {state === "ringing" && initiator === "pi" ? (
                <button
                  onClick={handleAccept}
                  className="flex-1 rounded-xl bg-emerald-600 py-3.5 text-sm font-bold text-white shadow-lg transition-all hover:bg-emerald-500 active:scale-[0.98]"
                >
                  ✅ Accept Call
                </button>
              ) : null}

              {state !== "idle" && state !== "ended" && state !== "declined" ? (
                <button
                  onClick={handleEnd}
                  className="flex-1 rounded-xl bg-rose-600 py-3.5 text-sm font-bold text-white shadow-lg transition-all hover:bg-rose-500 active:scale-[0.98]"
                >
                  ❌ End Call
                </button>
              ) : null}
            </div>
          </div>
        </main>
      )}

      {/* ── TAB 2: LIVE VITALS TELEMETRY ── */}
      {activeTab === "vitals" && (
        <main className="mt-4 flex w-full max-w-xl flex-col gap-4">
          {/* Fall alert card if triggered */}
          {vitals.fallDetected && (
            <div className="flex items-center gap-3 rounded-2xl bg-rose-950/80 border border-rose-500 p-4 text-rose-200 animate-bounce">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className="font-bold text-sm text-rose-100">Fall Detected Alert</h3>
                <p className="text-xs text-rose-300">Wearer may have fallen or experienced rapid impact.</p>
              </div>
            </div>
          )}

          {/* Vitals Grid */}
          <div className="grid grid-cols-2 gap-3.5">
            {/* Heart Rate */}
            <div className="flex flex-col justify-between rounded-2xl bg-[#1c1c1e] p-5 border border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Heart Rate</span>
                <span className="text-xl animate-pulse">❤️</span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-3xl font-extrabold text-white">{vitals.heartRate ?? 72}</span>
                <span className="text-xs text-zinc-400">BPM</span>
              </div>
              <span className="mt-2 text-[11px] text-emerald-400">Normal resting rate</span>
            </div>

            {/* Blood Oxygen SpO2 */}
            <div className="flex flex-col justify-between rounded-2xl bg-[#1c1c1e] p-5 border border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">SpO2 Oxygen</span>
                <span className="text-xl">🫁</span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-3xl font-extrabold text-white">{vitals.spo2 ?? 98}</span>
                <span className="text-xs text-zinc-400">%</span>
              </div>
              <span className="mt-2 text-[11px] text-emerald-400">Optimal saturation</span>
            </div>

            {/* Battery Level */}
            <div className="flex flex-col justify-between rounded-2xl bg-[#1c1c1e] p-5 border border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Battery</span>
                <span className="text-xl">🔋</span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-3xl font-extrabold text-white">{vitals.battery ?? 85}</span>
                <span className="text-xs text-zinc-400">%</span>
              </div>
              <div className="mt-2 h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#FF6B35] rounded-full"
                  style={{ width: `${vitals.battery ?? 85}%` }}
                />
              </div>
            </div>

            {/* Steps Count */}
            <div className="flex flex-col justify-between rounded-2xl bg-[#1c1c1e] p-5 border border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Step Count</span>
                <span className="text-xl">👟</span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-3xl font-extrabold text-white">
                  {(vitals.steps ?? 3420).toLocaleString()}
                </span>
                <span className="text-xs text-zinc-400">steps</span>
              </div>
              <span className="mt-2 text-[11px] text-zinc-400">Daily mobility goal</span>
            </div>

            {/* Body Temperature */}
            <div className="flex flex-col justify-between rounded-2xl bg-[#1c1c1e] p-5 border border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Body Temp</span>
                <span className="text-xl">🌡️</span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-3xl font-extrabold text-white">{vitals.bodyTemp ?? 36.6}</span>
                <span className="text-xs text-zinc-400">°C</span>
              </div>
              <span className="mt-2 text-[11px] text-emerald-400">Normal</span>
            </div>

            {/* Stress State */}
            <div className="flex flex-col justify-between rounded-2xl bg-[#1c1c1e] p-5 border border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Stress Index</span>
                <span className="text-xl">🧘</span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold text-white">{vitals.stress ?? "Low"}</span>
              </div>
              <span className="mt-2 text-[11px] text-emerald-400">Calm & steady</span>
            </div>
          </div>
        </main>
      )}

      {/* ── TAB 3: LIVE GPS LOCATION ON GOOGLE MAPS ── */}
      {activeTab === "location" && (
        <main className="mt-4 flex w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-[#1c1c1e] border border-zinc-800 shadow-2xl">
          {/* Google Maps iFrame */}
          <div className="relative aspect-[4/3] w-full bg-zinc-950 overflow-hidden">
            <iframe
              title="Wearer GPS Location"
              src={mapEmbedUrl}
              className="h-full w-full border-0"
              loading="lazy"
              allowFullScreen
            />
          </div>

          <div className="flex flex-col gap-3.5 p-6">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Current Coordinates
                </span>
                <p className="font-mono text-sm font-bold text-white mt-0.5">
                  {location.latitude?.toFixed(5)}, {location.longitude?.toFixed(5)}
                </p>
              </div>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-xl bg-[#FF6B35] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#e85a26] transition-all"
              >
                <span>Open App</span>
                <span>↗</span>
              </a>
            </div>

            {location.address && (
              <div className="flex flex-col gap-1 rounded-xl bg-zinc-900 p-3 border border-zinc-800">
                <span className="text-[10px] text-zinc-500 uppercase font-semibold">Street Address / Landmark</span>
                <p className="text-xs text-zinc-200 font-medium">{location.address}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-zinc-900 p-3 border border-zinc-800">
                <span className="text-zinc-500">GPS Accuracy:</span>
                <p className="text-sm font-semibold text-zinc-200 mt-0.5">±{location.accuracy ?? 5} m</p>
              </div>
              <div className="rounded-xl bg-zinc-900 p-3 border border-zinc-800">
                <span className="text-zinc-500">Movement Speed:</span>
                <p className="text-sm font-semibold text-zinc-200 mt-0.5">{location.speed ?? 1.2} km/h</p>
              </div>
            </div>
          </div>
        </main>
      )}

      <audio
        ref={ringAudioRef}
        loop
        src="https://cdn.freesound.org/previews/274/274183_5121236-lq.mp3"
        preload="auto"
      />
    </div>
  );
}
