import { ImageResponse } from "next/og";
import { ENGINE_VERSION } from "@/lib/types";

export const runtime = "nodejs";
export const alt = "The Handover ward board: a sealed handover brief for one person's medication schedule.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social card drawn in the same visual system as the app: ward wall, lamp, ruling, chalk. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#07100f",
          color: "#eaf2ec",
          padding: 64,
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", fontSize: 20, letterSpacing: 6, color: "#f2b134" }}>
            {"03:00 \u00b7 shift changed"}
          </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 78, lineHeight: 1.02, fontWeight: 700 }}>The handover board</div>
          <div style={{ fontSize: 78, lineHeight: 1.02, fontWeight: 700, color: "#f2b134" }}>
            for one person you love.
          </div>
          <div style={{ fontSize: 26, color: "#9db4ac", maxWidth: 900 }}>
            Log the dose. Let a deterministic engine say what the next caregiver will get wrong. Seal the brief.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: 20, color: "#6b837b" }}>
          <div style={{ display: "flex", gap: 14 }}>
            <span style={{ border: "1px solid #6fd8a4", color: "#6fd8a4", padding: "6px 14px" }}>READY</span>
            <span style={{ border: "1px solid #f2b134", color: "#f2b134", padding: "6px 14px" }}>CAUTION</span>
            <span style={{ border: "1px solid #ff6a52", color: "#ff6a52", padding: "6px 14px" }}>HOLD</span>
          </div>
          <div style={{ fontSize: 20, color: "#6b837b" }}>
            {`engine ${ENGINE_VERSION} \u00b7 openFDA + RxNorm \u00b7 SHA-384 sealed`}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}