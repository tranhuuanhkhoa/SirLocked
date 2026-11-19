/** Small file helpers: every working file lives under <repo>/tmp, ids are sanitised before they become folders. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { StudioError } from './bridge-client.js';
import type { StudioConfig } from './config.js';

/** A request or draft id as a folder name: letters, digits, dash and underscore only. */
export function safeId(value: string, label = 'id'): string {
  const text = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(text)) throw new StudioError('BAD_ID', `${label} không hợp lệ: "${text}".`);
  return text;
}

export function bridgeDir(config: StudioConfig, id: string): string {
  const dir = path.join(config.tmpRoot, 'bridge', safeId(id));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function tmpDir(config: StudioConfig, ...parts: string[]): string {
  const dir = path.join(config.tmpRoot, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolves a path given by Claude: absolute, or relative to the repo root. */
export function resolveInput(config: StudioConfig, file: string): string {
  if (!file || typeof file !== 'string') throw new StudioError('BAD_PATH', 'Thiếu đường dẫn file.');
  return path.isAbsolute(file) ? path.normalize(file) : path.resolve(config.repoRoot, file);
}

export function requireFile(config: StudioConfig, file: string): string {
  const resolved = resolveInput(config, file);
  if (!existsSync(resolved)) throw new StudioError('FILE_NOT_FOUND', `Không thấy file: ${display(config, resolved)}`);
  return resolved;
}

/** Repo-relative, forward slashes: short and the same on Windows and Linux. */
export function display(config: StudioConfig, file: string): string {
  const relative = path.relative(config.repoRoot, file);
  return (relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file).split(path.sep).join('/');
}

export function readJsonFile<T = any>(file: string): T {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new StudioError('FILE_NOT_FOUND', `Không đọc được ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  text = text.replace(/^﻿/, '');
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(text);
  if (fenced) text = fenced[1];
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new StudioError('INVALID_JSON', `${path.basename(file)} không phải JSON hợp lệ: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function writeJsonFile(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeTextFile(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
}
