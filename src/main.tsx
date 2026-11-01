import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// StrictMode не используем: игровой цикл и WebGL-контекст создаются один раз
createRoot(document.getElementById("root")!).render(<App />);
