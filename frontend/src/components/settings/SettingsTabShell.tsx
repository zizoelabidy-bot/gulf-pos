"use client";

import React from "react";

export interface SettingsTabShellProps {
  title?: string;
  maxWidth?: "wide";
  children: React.ReactNode;
}

export function SettingsTabShell({
  title,
  maxWidth,
  children,
}: SettingsTabShellProps) {
  const widthClass = maxWidth === "wide" ? "max-w-5xl" : "max-w-3xl";
  return (
    <div className={`w-full space-y-6 ${widthClass}`}>
      {title && (
        <div className="gulf-settings-section-heading space-y-1">
          <h2 className="text-xl font-bold text-foreground">{title}</h2>
        </div>
      )}
      {children}
    </div>
  );
}
