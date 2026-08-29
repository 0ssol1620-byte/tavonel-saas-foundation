import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

// T2 code-owned brand object: a compiler path crossing a stable T-shaped frame.
export default function TavonelIcon() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "64px",
        height: "64px",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid #d9d3c7",
        borderRadius: "14px",
        background: "#fcfaf6",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          width: "34px",
          height: "34px",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "4px",
            left: "3px",
            width: "28px",
            height: "5px",
            borderRadius: "2px",
            background: "#2b44c4",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "4px",
            left: "15px",
            width: "5px",
            height: "27px",
            borderRadius: "2px",
            background: "#17161a",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: "8px",
            width: "20px",
            height: "3px",
            borderRadius: "2px",
            background: "#0e6675",
            transform: "rotate(-32deg)",
          }}
        />
      </div>
    </div>,
    size,
  );
}
