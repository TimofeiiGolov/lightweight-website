import { useEffect, useRef } from "react";
import { Game } from "./core/Game";

let started = false;

/** React служит только контейнером: весь симулятор — чистый TypeScript + Three.js */
export default function App() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (started || !ref.current) return;
    started = true;
    new Game(ref.current);
  }, []);
  return <div ref={ref} className="game-root" />;
}
