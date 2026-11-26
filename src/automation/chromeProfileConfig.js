/**
 * CareerOS — Local Chrome Profile Configuration & Safe Launcher
 * Connects CareerOS Form Assistant to the user's chosen local Chrome profile
 * (e.g., "Abhishek • Work" / Profile 21) so existing LinkedIn, Naukri, and Indeed
 * sessions are available without storing or touching credentials.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'chrome_profile_config.json');

export function getDefaultChromeUserDataDir() {
  if (process.env.CAREEROS_CHROME_USER_DATA_DIR) {
    return process.env.CAREEROS_CHROME_USER_DATA_DIR;
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Google', 'Chrome', 'User Data');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  }
  return path.join(os.homedir(), '.config', 'google-chrome');
}

export function findChromeExecutable() {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
    return candidates.find(p => p && fs.existsSync(p)) || null;
  }
  return null;
}

/**
 * Lists local Chrome profiles from Chrome's Local State metadata (names & emails only).
 */
export function listLocalChromeProfiles(customUserDataDir = null) {
  const userDataDir = customUserDataDir || getDefaultChromeUserDataDir();
  const localStatePath = path.join(userDataDir, 'Local State');
  if (!fs.existsSync(localStatePath)) {
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    const cache = raw?.profile?.info_cache || {};
    return Object.entries(cache).map(([directory, info]) => ({
      directory,
      name: info.name || directory,
      userName: info.user_name || '',
      isWorkProfile:
        (info.user_name || '').toLowerCase() === 'abhishekn27123@gmail.com' ||
        (info.name || '').toLowerCase() === 'work'
    }));
  } catch {
    return [];
  }
}

export function getChromeProfileConfig() {
  const defaultDir = getDefaultChromeUserDataDir();
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return {
        enabled: parsed.enabled !== false,
        userDataDir: parsed.userDataDir || defaultDir,
        profileDirectory: parsed.profileDirectory || 'Profile 21',
        profileLabel: parsed.profileLabel || 'Abhishek • Work (abhishekn27123@gmail.com)',
        cdpUrl: parsed.cdpUrl || 'http://127.0.0.1:9222'
      };
    } catch {
      // Fall through to auto-detect
    }
  }

  const profiles = listLocalChromeProfiles(defaultDir);
  const workProfile = profiles.find(p => p.isWorkProfile) || profiles.find(p => p.directory === 'Profile 21') || profiles[0];
  return {
    enabled: Boolean(workProfile),
    userDataDir: defaultDir,
    profileDirectory: workProfile ? workProfile.directory : 'Profile 21',
    profileLabel: workProfile
      ? `${workProfile.name}${workProfile.userName ? ` (${workProfile.userName})` : ''}`
      : 'Abhishek • Work (abhishekn27123@gmail.com)',
    cdpUrl: 'http://127.0.0.1:9222'
  };
}

export function saveChromeProfileConfig({
  enabled = true,
  userDataDir = null,
  profileDirectory = 'Profile 21',
  profileLabel = '',
  cdpUrl = 'http://127.0.0.1:9222'
} = {}) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const resolvedDir = userDataDir || getDefaultChromeUserDataDir();
  const profiles = listLocalChromeProfiles(resolvedDir);
  const matched = profiles.find(p => p.directory === profileDirectory);
  const label = profileLabel || (matched ? `${matched.name}${matched.userName ? ` (${matched.userName})` : ''}` : profileDirectory);

  const next = {
    enabled: Boolean(enabled),
    userDataDir: resolvedDir,
    profileDirectory: String(profileDirectory || 'Profile 21'),
    profileLabel: label,
    cdpUrl: String(cdpUrl || 'http://127.0.0.1:9222'),
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/**
 * Opens an external http/https URL directly in the user's configured Chrome profile
 * when Chrome is already running and holds the User Data directory lock.
 */
export function openUrlInChromeProfile(targetUrl, config = null) {
  const parsed = new URL(targetUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP/HTTPS URLs can be opened in Chrome.');
  }
  const cfg = config || getChromeProfileConfig();
  const chromeExe = findChromeExecutable();
  if (!chromeExe) {
    throw new Error('Google Chrome executable not found on this system.');
  }

  const child = spawn(
    chromeExe,
    [`--profile-directory=${cfg.profileDirectory}`, targetUrl],
    { detached: true, stdio: 'ignore', shell: false }
  );
  child.unref();
  return { opened: true, profileDirectory: cfg.profileDirectory, profileLabel: cfg.profileLabel };
}

/**
 * Probes Chrome's local CDP endpoint to determine whether an already-running
 * Chrome session is genuinely reachable for Playwright/Antigravity attachment.
 */
export async function probeChromeCdpConnection(cdpUrl = null) {
  const cfg = getChromeProfileConfig();
  const target = (cdpUrl || cfg.cdpUrl || 'http://127.0.0.1:9222').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const res = await fetch(`${target}/json/version`, { signal: controller.signal });
    if (!res.ok) return { cdpConnected: false, browser: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    return {
      cdpConnected: true,
      browser: data.Browser || 'Chrome',
      webSocketDebuggerUrl: Boolean(data.webSocketDebuggerUrl)
    };
  } catch (err) {
    return { cdpConnected: false, browser: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

export async function getChromeConnectionStatus() {
  const cfg = getChromeProfileConfig();
  const chromeExe = findChromeExecutable();
  const probe = await probeChromeCdpConnection(cfg.cdpUrl);
  return {
    enabled: cfg.enabled,
    chromeInstalled: Boolean(chromeExe),
    profileDirectory: cfg.profileDirectory,
    profileLabel: cfg.profileLabel,
    cdpUrl: cfg.cdpUrl,
    cdpConnected: probe.cdpConnected,
    cdpBrowser: probe.browser,
    connectionMode: probe.cdpConnected
      ? 'cdp_live_attached'
      : (cfg.enabled && chromeExe ? 'profile_launch_or_tab_fallback' : 'isolated_playwright')
  };
}
