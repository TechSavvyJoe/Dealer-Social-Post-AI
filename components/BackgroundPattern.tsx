import React from "react";

export const BackgroundPattern: React.FC = () => {
  return (
    <div
      className="absolute inset-0 pointer-events-none z-0 opacity-40"
      style={{
        backgroundImage: `
        radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.15), transparent 50%),
        linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px)
      `,
        backgroundSize: "100% 100%, 40px 40px, 40px 40px",
      }}
    />
  );
};
