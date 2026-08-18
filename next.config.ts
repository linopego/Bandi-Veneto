import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next genererebbe a ogni `next dev` un AGENTS.md e un CLAUDE.md: file non
  // richiesti da questo progetto, che sporcherebbero il diff a ogni avvio.
  agentRules: false,
};

export default nextConfig;
