import { BridgeClient } from '../bridge-client.js';
import type { StudioConfig } from '../config.js';

export interface ToolContext {
  config: StudioConfig;
  client: BridgeClient;
}

export function createContext(config: StudioConfig, fetchImpl: typeof fetch = fetch): ToolContext {
  return { config, client: new BridgeClient(config, fetchImpl) };
}

/** Shortens long strings in a summary so a tool result stays small. */
export function clip(text: unknown, max = 200): string {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max)}… (${value.length} ký tự)`;
}
