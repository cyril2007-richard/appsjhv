/**
 * Zero-dependency Firebase Realtime Database Client
 * Works natively in browser without requiring extra npm packages.
 */

const FIREBASE_CONFIG = {
  databaseURL: "https://iris-11574-default-rtdb.firebaseio.com",
};

export const database = {};

export function ref(db: any, path: string) {
  const cleanPath = path.replace(/^\/+|\/+$/g, "");
  return {
    url: `${FIREBASE_CONFIG.databaseURL}/${cleanPath}.json`,
    path: cleanPath,
  };
}

export function onValue(
  reference: { url: string; path: string },
  callback: (snapshot: { val: () => any }) => void
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  let isMounted = true;
  let lastJson = "";

  const poll = async () => {
    if (!isMounted) return;
    try {
      const resp = await fetch(reference.url, { cache: "no-store" });
      if (!resp.ok || !isMounted) return;
      const data = await resp.json();
      const json = JSON.stringify(data ?? null);
      if (json !== lastJson) {
        lastJson = json;
        callback({ val: () => data });
      }
    } catch (e) {
      // Ignore network hiccups
    }
  };

  poll();
  const interval = setInterval(poll, 2000);

  return () => {
    isMounted = false;
    clearInterval(interval);
  };
}

export async function update(
  reference: { url: string; path: string },
  data: Record<string, any>
): Promise<boolean> {
  try {
    const resp = await fetch(reference.url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return resp.ok;
  } catch (e) {
    console.error("Firebase update failed:", e);
    return false;
  }
}

export async function set(
  reference: { url: string; path: string },
  data: any
): Promise<boolean> {
  try {
    const resp = await fetch(reference.url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return resp.ok;
  } catch (e) {
    console.error("Firebase set failed:", e);
    return false;
  }
}

export function getDB(path: string) {
  const r = ref(database, path);
  return {
    listen: (cb: (d: any) => void) => onValue(r, (snap) => cb(snap.val())),
    update: (d: any) => update(r, d),
    set: (d: any) => set(r, d),
  };
}
