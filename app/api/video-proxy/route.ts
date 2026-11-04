import { type NextRequest } from "next/server";

/**
 * Server-side proxy for the IRIS MJPEG video feed.
 *
 * Why this exists:
 * 1. ngrok free tier serves an HTML interstitial page for browser requests.
 *    The `ngrok-skip-browser-warning` header bypasses it, but <img> tags
 *    cannot send custom headers — only server-side fetch can.
 * 2. Vercel is HTTPS-only. Proxying through this route avoids mixed-content
 *    blocks even if the underlying stream were plain HTTP.
 *
 * Usage:  GET /api/video-proxy?url=https://xxx.ngrok-free.dev
 *         → streams the MJPEG feed back to the browser.
 */
export async function GET(request: NextRequest) {
  const streamBaseUrl = request.nextUrl.searchParams.get("url");

  if (!streamBaseUrl) {
    return new Response(
      JSON.stringify({ error: "Missing 'url' query parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Only allow HTTPS URLs (security)
  if (!streamBaseUrl.startsWith("https://")) {
    return new Response(
      JSON.stringify({ error: "Only HTTPS stream URLs are supported" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Build the full video feed URL
  const feedUrl = streamBaseUrl.endsWith("/video_feed")
    ? streamBaseUrl
    : `${streamBaseUrl.replace(/\/$/, "")}/video_feed`;

  try {
    const upstream = await fetch(feedUrl, {
      headers: {
        // This header tells ngrok to skip the browser interstitial warning page
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "IRIS-Caregiver-Proxy/1.0",
      },
      // @ts-expect-error — Node fetch supports signal for abort
      signal: request.signal,
    });

    if (!upstream.ok) {
      return new Response(
        JSON.stringify({
          error: `Upstream returned ${upstream.status} ${upstream.statusText}`,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const contentType =
      upstream.headers.get("Content-Type") ||
      "multipart/x-mixed-replace; boundary=iris_frame_boundary";

    // Pipe the upstream MJPEG stream straight to the client
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "X-Accel-Buffering": "no", // Disable nginx/proxy buffering
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: `Failed to connect to camera stream: ${message}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
