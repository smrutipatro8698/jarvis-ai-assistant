import { ReactNode } from 'react';

interface HUDLayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  bottom: ReactNode;
}

export function HUDLayout({ left, center, right, bottom }: HUDLayoutProps) {
  return (
    <div className="hud-layout">
      <div className="hud-layout__left">{left}</div>
      <div className="hud-layout__center">{center}</div>
      <div className="hud-layout__right">{right}</div>
      <div className="hud-layout__bottom">{bottom}</div>
    </div>
  );
}
