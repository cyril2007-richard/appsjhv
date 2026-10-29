"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { database, ref, onValue, update, set } from "./firebase";

type CallData = {
  state?: "idle" | "calling" | "ringing" | "in_call" | "ended" | "declined";
  room?: string;
  initiator?: "pi" | "caregiver" | "";
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
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(true);
  const [callDuration, setCallDuration] = useState(0);

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

  // Dynamic live location state
  const [location, setLocation] = useState<LocationData>({
    latitude: undefined,
    longitude: undefined,
    accuracy: undefined,
    speed: undefined,
    address: "Locating live GPS...",
  });
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Live GPS lookup & reverse geocoding
  const fetchLiveGPS = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setLocationError("Geolocation is not supported by your device browser.");
      return;
    }

    setIsLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy, speed } = pos.coords;
        let resolvedAddress = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`
          );
          if (res.ok) {
            const data = await res.json();
            if (data && data.address) {
              const road = data.address.road || data.address.suburb || data.address.neighbourhood || "";
              const city = data.address.city || data.address.town || data.address.county || "";
              const country = data.address.country || "";
              const formatted = [road, city, country].filter(Boolean).join(", ");
              if (formatted) resolvedAddress = formatted;
              else if (data.display_name) resolvedAddress = data.display_name.split(",").slice(0, 3).join(",");
            }
          }
        } catch (e) {
          // Fallback to coordinates
        }

        const newLoc: LocationData = {
          latitude,
          longitude,
          accuracy: Math.round(accuracy),
          speed: speed ? Math.round(speed * 3.6) : 0,
          address: resolvedAddress,
        };

        setLocation(newLoc);
        setIsLocating(false);

        // Sync live position to Firebase so all caregivers & companion apps update
        try {
          const locationRef = ref(database, `users/${userId}/location`);
          update(locationRef, newLoc);
        } catch (e) {}
      },
      (err) => {
        console.warn("GPS lookup error:", err);
        setLocationError(
          err.code === 1
            ? "Location permission denied. Please allow GPS access in your browser."
            : "Unable to acquire GPS signal. Check your device location settings."
        );
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  }, [userId]);

  // Real-time synchronization
  useEffect(() => {
    // 1. Call sync
    const callRef = ref(database, `users/${userId}/call`);
    const unsubCall = onValue(callRef, (snapshot) => {
      const data = (snapshot.val() as CallData) || { state: "idle" };
      setCallData(data);
      if (data.room && typeof data.room === "string" && data.room.startsWith("http")) {
        setStreamUrl(data.room);
      }
    });

    // 2. Vitals telemetry sync
    const vitalsRef = ref(database, `users/${userId}/vitals`);
    const unsubVitals = onValue(vitalsRef, (snapshot) => {
      const data = snapshot.val();
      if (data && typeof data === "object") {
        setVitals((prev) => ({ ...prev, ...data }));
      }
    });

    // 3. Location GPS sync from Firebase
    const locationRef = ref(database, `users/${userId}/location`);
    const unsubLocation = onValue(locationRef, (snapshot) => {
      const data = snapshot.val();
      if (data && typeof data === "object" && data.latitude && data.longitude) {
        setLocation((prev) => ({ ...prev, ...data }));
      }
    });

    return () => {
      unsubCall();
      unsubVitals();
      unsubLocation();
    };
  }, [userId]);

  // Initial live GPS trigger and watch
  useEffect(() => {
    fetchLiveGPS();

    if (typeof window !== "undefined" && "geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, accuracy, speed } = pos.coords;
          setLocation((prev) => ({
            ...prev,
            latitude,
            longitude,
            accuracy: Math.round(accuracy),
            speed: speed ? Math.round(speed * 3.6) : prev.speed,
          }));
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 10000 }
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, [fetchLiveGPS]);

  // Auto refresh GPS when entering location tab if not yet found
  useEffect(() => {
    if (activeTab === "location" && !location.latitude) {
      fetchLiveGPS();
    }
  }, [activeTab, location.latitude, fetchLiveGPS]);

  const state = callData.state || "idle";
  const initiator = callData.initiator;

  // In-call duration timer
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (state === "in_call") {
      setCallDuration(0);
      timer = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [state]);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Sound effects logic for incoming ringing
  useEffect(() => {
    if (state === "ringing" && initiator === "pi") {
      ringAudioRef.current?.play().catch(() => {});
    } else {
      if (ringAudioRef.current) {
        ringAudioRef.current.pause();
        try {
          ringAudioRef.current.currentTime = 0;
        } catch (e) {}
      }
    }
  }, [state, initiator]);

  // Optimistic UI dial handler
  const handleDial = () => {
    setCallData((prev) => ({
      ...prev,
      state: "calling",
      initiator: "caregiver",
    }));

    const callRef = ref(database, `users/${userId}/call`);
    update(callRef, {
      state: "ringing",
      initiator: "caregiver",
      room: streamUrl || "",
      timestamp: Math.floor(Date.now() / 1000),
    });
  };

  // Optimistic UI accept handler
  const handleAccept = () => {
    setCallData((prev) => ({
      ...prev,
      state: "in_call",
    }));

    const callRef = ref(database, `users/${userId}/call`);
    update(callRef, {
      state: "in_call",
      timestamp: Math.floor(Date.now() / 1000),
    });
  };

  // Optimistic UI end handler
  const handleEnd = () => {
    setCallData({ state: "idle", room: "", initiator: "" });

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

  // Resolve camera feed URL
  const activeRoom = callData.room && callData.room.startsWith("http") ? callData.room : streamUrl;
  const feedSrc =
    state === "in_call" && activeRoom
      ? activeRoom.endsWith("/video_feed")
        ? activeRoom
        : `${activeRoom.replace(/\/$/, "")}/video_feed`
      : "";

  const hasCoords = typeof location.latitude === "number" && typeof location.longitude === "number";
  const mapEmbedUrl = hasCoords
    ? `https://maps.google.com/maps?q=${location.latitude},${location.longitude}&hl=en&z=17&output=embed`
    : "";

  return (
    <div className="min-h-screen w-full bg-[#F2F2F7] text-black font-sans flex flex-col justify-between sm:max-w-md sm:mx-auto sm:shadow-2xl sm:border-x sm:border-[#E5E5EA]">
      {/* ── iOS NAVIGATION TOP BAR ── */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-5 pt-4 pb-3 bg-white/80 backdrop-blur-xl border-b border-[#E5E5EA]">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="IRIS Logo" className="h-9 w-9 object-contain rounded-xl shadow-sm" />
          <div>
            <span className="text-[10px] font-bold tracking-widest text-[#8E8E93] uppercase">IRIS COMPANION</span>
            <h1 className="text-xl font-bold tracking-tight text-black leading-tight">
              {activeTab === "call" ? "FaceTime" : activeTab === "vitals" ? "Health" : "Find My"}
            </h1>
          </div>
        </div>

        {/* Apple Style Device Battery & Online Status Badge */}
        <div className="flex items-center gap-2 bg-[#E5E5EA]/70 px-3 py-1.5 rounded-full text-xs font-semibold text-[#3C3C43]">
          <span
            className={`h-2 w-2 rounded-full ${
              state === "in_call"
                ? "bg-[#34C759]"
                : state === "ringing" || state === "calling"
                ? "bg-[#FF9500] animate-pulse"
                : "bg-[#34C759]"
            }`}
          />
          <span className="capitalize">{state === "in_call" ? "Live" : state === "idle" ? "Online" : state}</span>
        </div>
      </header>

      {/* ── SCROLLABLE SCREEN CONTENT ── */}
      <main className="flex-1 px-4 py-4 pb-28">
        {/* ══════════════════════════════════════════════════════════════
            TAB 1: CALLING APP UI (Apple FaceTime Layout)
           ══════════════════════════════════════════════════════════════ */}
        {activeTab === "call" && (
          <div className="flex flex-col h-full justify-between gap-4">
            {/* Call State: IN CALL (FaceTime Video Viewfinder Screen) */}
            {state === "in_call" ? (
              <div className="relative flex-1 min-h-[460px] w-full rounded-[32px] overflow-hidden bg-black shadow-2xl flex flex-col justify-between p-4">
                {feedSrc ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={feedSrc}
                    alt="Live Video"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white/70 gap-3">
                    <div className="h-12 w-12 rounded-full border-2 border-[#34C759] border-t-transparent animate-spin" />
                    <p className="text-xs font-medium tracking-wide">Connecting Smart Glasses Video Feed...</p>
                  </div>
                )}

                {/* FaceTime Top Header Overlay */}
                <div className="relative z-10 flex items-center justify-between rounded-full bg-black/40 backdrop-blur-md px-4 py-2 text-white">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#34C759] animate-pulse" />
                    <span className="text-xs font-semibold">IRIS Smart Glasses</span>
                  </div>
                  <span className="text-xs font-mono font-medium">{formatDuration(callDuration)}</span>
                </div>

                {/* FaceTime Bottom In-Call Action Bar */}
                <div className="relative z-10 flex items-center justify-center gap-6 pb-2">
                  {/* Mute Button */}
                  <button
                    onClick={() => setIsMuted(!isMuted)}
                    className={`flex h-12 w-12 items-center justify-center rounded-full backdrop-blur-md transition-all ${
                      isMuted ? "bg-white text-black" : "bg-black/50 text-white border border-white/20 active:scale-95"
                    }`}
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </button>

                  {/* End Call Button (Big Red Circle) */}
                  <button
                    onClick={handleEnd}
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FF3B30] text-white shadow-xl hover:bg-[#E03126] active:scale-95 transition-all"
                  >
                    <svg className="h-7 w-7 fill-current" viewBox="0 0 24 24">
                      <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.99.99 0 0 1 0-1.41C3.28 8.75 7.42 7 12 7s8.72 1.75 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
                    </svg>
                  </button>

                  {/* Speaker Button */}
                  <button
                    onClick={() => setIsSpeaker(!isSpeaker)}
                    className={`flex h-12 w-12 items-center justify-center rounded-full backdrop-blur-md transition-all ${
                      isSpeaker ? "bg-white text-black" : "bg-black/50 text-white border border-white/20 active:scale-95"
                    }`}
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : state === "ringing" && initiator === "pi" ? (
              /* Call State: INCOMING CALL SCREEN */
              <div className="flex flex-col items-center justify-between min-h-[440px] py-10 bg-white rounded-[32px] p-6 shadow-sm border border-[#E5E5EA]">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-24 w-24 rounded-3xl bg-[#F2F2F7] p-3 flex items-center justify-center shadow-inner border border-[#E5E5EA]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo.png" alt="IRIS Logo" className="h-full w-full object-contain" />
                  </div>
                  <h2 className="text-2xl font-bold text-black mt-2">IRIS Wearer</h2>
                  <p className="text-sm font-semibold text-[#FF9500] animate-pulse">Incoming FaceTime Video Call...</p>
                </div>

                <div className="flex w-full items-center justify-around px-4">
                  {/* Decline */}
                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={handleEnd}
                      className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FF3B30] text-white shadow-lg active:scale-95 transition-all"
                    >
                      <svg className="h-7 w-7 fill-current" viewBox="0 0 24 24">
                        <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.99.99 0 0 1 0-1.41C3.28 8.75 7.42 7 12 7s8.72 1.75 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
                      </svg>
                    </button>
                    <span className="text-xs font-semibold text-[#8E8E93]">Decline</span>
                  </div>

                  {/* Accept */}
                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={handleAccept}
                      className="flex h-16 w-16 items-center justify-center rounded-full bg-[#34C759] text-white shadow-lg active:scale-95 transition-all animate-bounce"
                    >
                      <svg className="h-7 w-7 fill-current" viewBox="0 0 24 24">
                        <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2z"/>
                      </svg>
                    </button>
                    <span className="text-xs font-semibold text-[#34C759]">Accept</span>
                  </div>
                </div>
              </div>
            ) : state === "calling" || (state === "ringing" && initiator === "caregiver") ? (
              /* Call State: OUTGOING DIALING SCREEN */
              <div className="flex flex-col items-center justify-between min-h-[440px] py-10 bg-white rounded-[32px] p-6 shadow-sm border border-[#E5E5EA]">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-24 w-24 rounded-3xl bg-[#F2F2F7] p-3 flex items-center justify-center shadow-inner border border-[#E5E5EA]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo.png" alt="IRIS Logo" className="h-full w-full object-contain" />
                  </div>
                  <h2 className="text-2xl font-bold text-black mt-2">IRIS Wearer</h2>
                  <p className="text-sm font-medium text-[#8E8E93]">Connecting FaceTime Video...</p>
                </div>

                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={handleEnd}
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FF3B30] text-white shadow-lg active:scale-95 transition-all"
                  >
                    <svg className="h-7 w-7 fill-current" viewBox="0 0 24 24">
                      <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.99.99 0 0 1 0-1.41C3.28 8.75 7.42 7 12 7s8.72 1.75 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
                    </svg>
                  </button>
                  <span className="text-xs font-semibold text-[#8E8E93]">Cancel</span>
                </div>
              </div>
            ) : (
              /* Call State: IDLE (Apple Contact Card & FaceTime Video Trigger) */
              <div className="flex flex-col gap-4">
                {/* Contact Hero Card */}
                <div className="flex flex-col items-center gap-3 p-8 bg-white rounded-[32px] border border-[#E5E5EA] shadow-sm">
                  <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-[#F2F2F7] p-3 border border-[#E5E5EA] shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo.png" alt="IRIS Smart Glasses" className="h-full w-full object-contain" />
                    <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-[#34C759] border-2 border-white" />
                  </div>
                  <div className="text-center">
                    <h2 className="text-2xl font-bold text-black tracking-tight">IRIS Wearer</h2>
                    <p className="text-xs font-semibold text-[#34C759] mt-0.5">Smart Glasses Online</p>
                  </div>

                  {/* iOS Contact Quick Action Pills */}
                  <div className="grid grid-cols-3 gap-2.5 w-full mt-3">
                    <button
                      onClick={handleDial}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-[#F2F2F7] hover:bg-[#E5E5EA] active:scale-95 transition-all cursor-pointer"
                    >
                      <span className="text-lg">📹</span>
                      <span className="text-[11px] font-semibold text-[#007AFF]">Video</span>
                    </button>
                    <button
                      onClick={() => setActiveTab("vitals")}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-[#F2F2F7] hover:bg-[#E5E5EA] active:scale-95 transition-all cursor-pointer"
                    >
                      <span className="text-lg">❤️</span>
                      <span className="text-[11px] font-semibold text-[#FF2D55]">Health</span>
                    </button>
                    <button
                      onClick={() => setActiveTab("location")}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-[#F2F2F7] hover:bg-[#E5E5EA] active:scale-95 transition-all cursor-pointer"
                    >
                      <span className="text-lg">📍</span>
                      <span className="text-[11px] font-semibold text-[#34C759]">Find My</span>
                    </button>
                  </div>
                </div>

                {/* FaceTime Primary Green Action Button */}
                <button
                  onClick={handleDial}
                  className="w-full flex items-center justify-center gap-2.5 rounded-2xl bg-[#34C759] py-4 text-base font-semibold text-white shadow-lg hover:bg-[#2EB84F] active:scale-[0.98] transition-all cursor-pointer"
                >
                  <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                    <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                  </svg>
                  <span>FaceTime Video</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            TAB 2: VITALS TELEMETRY (Apple Health Design Language)
           ══════════════════════════════════════════════════════════════ */}
        {activeTab === "vitals" && (
          <div className="flex flex-col gap-3.5">
            {vitals.fallDetected && (
              <div className="flex items-center gap-3 rounded-2xl bg-[#FF3B30]/10 border border-[#FF3B30] p-4 text-[#FF3B30] shadow-sm">
                <span className="text-2xl">⚠️</span>
                <div>
                  <h4 className="font-bold text-sm">Fall Detected Alert</h4>
                  <p className="text-xs text-[#FF3B30]/90">Immediate impact or fall detected on the device.</p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-[#8E8E93] px-1">Highlights</span>

              {/* Heart Rate Card */}
              <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-[#E5E5EA] shadow-sm">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FF2D55]/10 text-[#FF2D55] text-lg">
                    ❤️
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-[#8E8E93]">Heart Rate</h3>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-2xl font-bold text-black">{vitals.heartRate ?? 74}</span>
                      <span className="text-xs font-semibold text-[#8E8E93]">BPM</span>
                    </div>
                  </div>
                </div>
                <span className="text-xs font-medium text-[#34C759] bg-[#34C759]/10 px-2.5 py-1 rounded-full">Normal</span>
              </div>

              {/* Blood Oxygen SpO2 */}
              <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-[#E5E5EA] shadow-sm">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#007AFF]/10 text-[#007AFF] text-lg">
                    🫁
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-[#8E8E93]">Blood Oxygen</h3>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-2xl font-bold text-black">{vitals.spo2 ?? 98}</span>
                      <span className="text-xs font-semibold text-[#8E8E93]">%</span>
                    </div>
                  </div>
                </div>
                <span className="text-xs font-medium text-[#34C759] bg-[#34C759]/10 px-2.5 py-1 rounded-full">Optimal</span>
              </div>

              {/* Steps Card */}
              <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-[#E5E5EA] shadow-sm">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FF9500]/10 text-[#FF9500] text-lg">
                    👟
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-[#8E8E93]">Steps</h3>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-2xl font-bold text-black">{(vitals.steps ?? 3420).toLocaleString()}</span>
                      <span className="text-xs font-semibold text-[#8E8E93]">steps</span>
                    </div>
                  </div>
                </div>
                <span className="text-xs font-medium text-[#8E8E93]">Goal: 6k</span>
              </div>

              {/* Battery Card */}
              <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-[#E5E5EA] shadow-sm">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#34C759]/10 text-[#34C759] text-lg">
                    🔋
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-[#8E8E93]">Glasses Battery</h3>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-2xl font-bold text-black">{vitals.battery ?? 86}</span>
                      <span className="text-xs font-semibold text-[#8E8E93]">%</span>
                    </div>
                  </div>
                </div>
                <div className="w-16 h-2 bg-[#E5E5EA] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#34C759] rounded-full"
                    style={{ width: `${vitals.battery ?? 86}%` }}
                  />
                </div>
              </div>

              {/* Body Temp */}
              <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-[#E5E5EA] shadow-sm">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5856D6]/10 text-[#5856D6] text-lg">
                    🌡️
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-[#8E8E93]">Body Temperature</h3>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-2xl font-bold text-black">{vitals.bodyTemp ?? 36.6}</span>
                      <span className="text-xs font-semibold text-[#8E8E93]">°C</span>
                    </div>
                  </div>
                </div>
                <span className="text-xs font-medium text-[#34C759] bg-[#34C759]/10 px-2.5 py-1 rounded-full">Normal</span>
              </div>

              {/* Stress Level */}
              <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-[#E5E5EA] shadow-sm">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#007AFF]/10 text-[#007AFF] text-lg">
                    🧘
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-[#8E8E93]">Stress Index</h3>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-2xl font-bold text-black">{vitals.stress ?? "Low"}</span>
                    </div>
                  </div>
                </div>
                <span className="text-xs font-medium text-[#34C759] bg-[#34C759]/10 px-2.5 py-1 rounded-full">Steady</span>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            TAB 3: LOCATION (Apple Find My Design Language - Live GPS)
           ══════════════════════════════════════════════════════════════ */}
        {activeTab === "location" && (
          <div className="flex flex-col gap-3.5">
            {/* Find My Map Container */}
            <div className="relative aspect-[4/3] w-full rounded-[28px] overflow-hidden bg-[#E5E5EA] border border-[#E5E5EA] shadow-sm flex items-center justify-center">
              {hasCoords ? (
                <iframe
                  title="Live GPS Location"
                  src={mapEmbedUrl}
                  className="h-full w-full border-0"
                  loading="lazy"
                  allowFullScreen
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#007AFF]/10">
                    <span className="absolute h-full w-full rounded-full bg-[#007AFF]/20 animate-ping" />
                    <span className="text-2xl">📍</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-black">Acquiring Live GPS...</h3>
                    <p className="text-xs text-[#8E8E93] mt-0.5">Please allow location access on your phone</p>
                  </div>
                  <button
                    onClick={fetchLiveGPS}
                    className="mt-2 rounded-xl bg-[#007AFF] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0066D6] active:scale-95 transition-all cursor-pointer"
                  >
                    Enable / Refresh Location
                  </button>
                </div>
              )}

              {hasCoords && (
                <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-white/90 backdrop-blur-md px-3 py-1 shadow-sm text-xs font-semibold text-black">
                  <span className="h-2 w-2 rounded-full bg-[#007AFF] animate-ping" />
                  <span>Live GPS</span>
                </div>
              )}
            </div>

            {/* Error banner if permission denied */}
            {locationError && (
              <div className="flex items-center justify-between rounded-2xl bg-[#FF9500]/10 border border-[#FF9500]/30 p-3.5 text-xs text-[#FF9500] font-medium">
                <div className="flex items-center gap-2">
                  <span>⚠️</span>
                  <span>{locationError}</span>
                </div>
                <button
                  onClick={fetchLiveGPS}
                  className="underline font-bold ml-2 cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Find My Places Sheet Card */}
            <div className="flex flex-col gap-3 p-4 bg-white rounded-[24px] border border-[#E5E5EA] shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#8E8E93]">Current Position</span>
                  <h3 className="text-sm font-bold text-black mt-0.5 leading-snug">
                    {location.address || "Detecting address..."}
                  </h3>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={fetchLiveGPS}
                    disabled={isLocating}
                    title="Refresh GPS"
                    className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#F2F2F7] text-[#007AFF] hover:bg-[#E5E5EA] active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <svg className={`h-4 w-4 ${isLocating ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                  </button>

                  {hasCoords && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded-xl bg-[#007AFF] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0066D6] active:scale-95 transition-all"
                    >
                      <span>Maps</span>
                      <span>↗</span>
                    </a>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#F2F2F7] text-xs">
                <div>
                  <span className="text-[11px] text-[#8E8E93]">Coordinates</span>
                  <p className="font-mono text-xs font-semibold text-black mt-0.5">
                    {hasCoords ? `${location.latitude?.toFixed(4)}, ${location.longitude?.toFixed(4)}` : "—"}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] text-[#8E8E93]">Accuracy</span>
                  <p className="text-xs font-semibold text-black mt-0.5">
                    {typeof location.accuracy === "number" ? `Within ±${location.accuracy} m` : "—"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── iOS TAB BAR (NATIVE BLURRED BOTTOM DOCK) ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around bg-white/85 backdrop-blur-xl border-t border-[#E5E5EA] px-6 py-2.5 sm:max-w-md sm:mx-auto">
        {/* FaceTime / Call Tab */}
        <button
          onClick={() => setActiveTab("call")}
          className={`flex flex-col items-center gap-1 transition-colors cursor-pointer ${
            activeTab === "call" ? "text-[#007AFF]" : "text-[#8E8E93] hover:text-[#3C3C43]"
          }`}
        >
          <svg className="h-6 w-6" fill={activeTab === "call" ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={activeTab === "call" ? 0 : 2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          <span className="text-[10px] font-semibold">FaceTime</span>
        </button>

        {/* Health / Vitals Tab */}
        <button
          onClick={() => setActiveTab("vitals")}
          className={`flex flex-col items-center gap-1 transition-colors cursor-pointer ${
            activeTab === "vitals" ? "text-[#007AFF]" : "text-[#8E8E93] hover:text-[#3C3C43]"
          }`}
        >
          <svg className="h-6 w-6" fill={activeTab === "vitals" ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={activeTab === "vitals" ? 0 : 2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
          </svg>
          <span className="text-[10px] font-semibold">Health</span>
        </button>

        {/* Find My / Location Tab */}
        <button
          onClick={() => setActiveTab("location")}
          className={`flex flex-col items-center gap-1 transition-colors cursor-pointer ${
            activeTab === "location" ? "text-[#007AFF]" : "text-[#8E8E93] hover:text-[#3C3C43]"
          }`}
        >
          <svg className="h-6 w-6" fill={activeTab === "location" ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={activeTab === "location" ? 0 : 2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
          </svg>
          <span className="text-[10px] font-semibold">Find My</span>
        </button>
      </nav>

      {/* Ringing audio element */}
      <audio
        ref={ringAudioRef}
        loop
        src="https://cdn.freesound.org/previews/274/274183_5121236-lq.mp3"
        preload="auto"
      />
    </div>
  );
}
