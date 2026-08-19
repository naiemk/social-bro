import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import "./index.css";
import React from "react";
import App from "./App";

const queryClient = new QueryClient();

interface ElizaConfig {
  agentId: string;
  apiBase: string;
}

declare global {
  interface Window {
    ELIZA_CONFIG?: ElizaConfig;
  }
}

function Root() {
  React.useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<Root />);
}

export interface AgentPanel {
  name: string;
  path: string;
  component: React.ComponentType<any>;
  icon?: string;
  public?: boolean;
  shortLabel?: string;
}

interface PanelProps {
  agentId: string;
}

const PanelComponent: React.FC<PanelProps> = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
};

export const panels: AgentPanel[] = [
  {
    name: "Dashboard",
    path: "dashboard",
    component: PanelComponent,
    icon: "LayoutDashboard",
    public: false,
    shortLabel: "Dash",
  },
];

export * from "./utils";
