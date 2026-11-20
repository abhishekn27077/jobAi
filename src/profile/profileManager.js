import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROFILE_JSON_PATH = path.resolve(__dirname, '../../data/candidate_profile.json');
const LOCAL_PROFILE_JSON_PATH = path.resolve(__dirname, '../../data/candidate_profile.local.json');
const PROFILE_MD_PATH = path.resolve(__dirname, '../../data/candidate_profile.md');

let cachedProfile = null;

export function reloadCandidateProfile() {
  cachedProfile = null;
  return loadCandidateProfile();
}

export function loadCandidateProfile() {
  if (cachedProfile) return cachedProfile;

  if (!fs.existsSync(PROFILE_JSON_PATH)) {
    throw new Error(`Profile not found at: ${PROFILE_JSON_PATH}`);
  }

  const raw = fs.readFileSync(PROFILE_JSON_PATH, 'utf-8');
  const baseProfile = JSON.parse(raw);

  // Deep-merge local profile if available (contains private contact information kept out of git)
  let mergedProfile = { ...baseProfile };
  if (fs.existsSync(LOCAL_PROFILE_JSON_PATH)) {
    try {
      const localRaw = fs.readFileSync(LOCAL_PROFILE_JSON_PATH, 'utf-8');
      const localData = JSON.parse(localRaw);
      mergedProfile.personal = {
        ...baseProfile.personal,
        ...(localData.personal || {})
      };
      if (localData.status) {
        mergedProfile.status = { ...baseProfile.status, ...localData.status };
      }
    } catch (e) {
      console.warn('[ProfileManager] Could not parse local profile override:', e.message);
    }
  }

  // Environment variable overrides (highest precedence for private secrets/contact info)
  if (process.env.CANDIDATE_PHONE) {
    mergedProfile.personal.phone = process.env.CANDIDATE_PHONE;
  }
  if (process.env.CANDIDATE_EMAIL) {
    mergedProfile.personal.email = process.env.CANDIDATE_EMAIL;
  }
  if (process.env.CANDIDATE_FULL_NAME) {
    mergedProfile.personal.fullName = process.env.CANDIDATE_FULL_NAME;
  }

  cachedProfile = mergedProfile;
  return cachedProfile;
}

export function getProfileMarkdown() {
  if (!fs.existsSync(PROFILE_MD_PATH)) {
    throw new Error(`Profile markdown not found at: ${PROFILE_MD_PATH}`);
  }
  return fs.readFileSync(PROFILE_MD_PATH, 'utf-8');
}

export function getAllCandidateSkills() {
  const profile = loadCandidateProfile();
  const allSkills = new Set();

  if (profile.skills) {
    for (const group of Object.values(profile.skills)) {
      if (Array.isArray(group)) {
        for (const skill of group) {
          allSkills.add(skill.toLowerCase());
        }
      }
    }
  }

  // Also include project tech stack
  if (profile.projects) {
    for (const proj of profile.projects) {
      if (proj.techStack) {
        for (const t of proj.techStack) {
          allSkills.add(t.toLowerCase());
        }
      }
    }
  }

  return Array.from(allSkills);
}
