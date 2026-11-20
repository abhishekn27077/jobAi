/**
 * CareerOS — Recruiter Email Intelligence & Entity Extraction
 * Classifies recruiter emails, extracts interview schedules, assessment deadlines,
 * recruiter contacts, and next actions with transparent confidence scoring.
 */

import { getDatabase } from '../db/schema.js';

export function classifyAndExtractRecruiterEmail({
  subject = '',
  body = '',
  from = '',
  date = null,
  knownJobs = null
}) {
  const fullText = `${subject}\n${body}`;
  const lowerText = fullText.toLowerCase();

  // 1. Recruiter Contact Extraction
  const recruiter = extractRecruiterDetails(from, fullText);

  // 2. Company and Job Role Matching
  const match = matchCompanyAndJob(subject, body, knownJobs);

  // 3. Category & Urgency Classification
  const classification = classifyCategory(subject, lowerText);

  // 4. Interview Schedule Extraction
  const interviewDetails = extractInterviewSchedule(fullText, date);

  // 5. Assessment Deadline Extraction
  const assessmentDetails = extractAssessmentDetails(fullText, date);

  // 6. Meeting Link Extraction
  const meetingLink = extractMeetingLink(fullText);

  // 7. Requested Documents / Information
  const requestedInfo = extractRequestedInfo(lowerText);

  // 8. Next Action Synthesis
  const nextAction = determineNextAction(classification.type, interviewDetails, assessmentDetails, requestedInfo);

  // Confidence calculation
  let confidence = 'high';
  let requiresManualReview = false;

  if (classification.type === 'UNCERTAIN_MANUAL_REVIEW') {
    confidence = 'uncertain';
    requiresManualReview = true;
  } else if (!match.company && classification.type !== 'APPLICATION_ACKNOWLEDGED') {
    confidence = 'medium';
  }

  return {
    category: classification.type,
    urgency: classification.urgency,
    summary: classification.summary,
    company: match.company,
    role: match.role,
    jobId: match.jobId,
    recruiter,
    interview: interviewDetails,
    assessment: assessmentDetails,
    meetingLink,
    requestedInfo,
    nextAction,
    confidence,
    requiresManualReview,
    originalDate: date || new Date().toISOString()
  };
}

/**
 * Standard classifier for backwards-compatibility with existing tests and modules.
 */
export function classifyRecruiterEmail(subject = '', body = '') {
  const fullText = `${subject} ${body}`.toLowerCase();
  const c = classifyCategory(subject, fullText);
  return {
    type: c.type,
    urgency: c.urgency,
    summary: c.summary
  };
}

function classifyCategory(subject = '', lowerText = '') {
  const lowerSub = subject.toLowerCase();

  // Offer of Employment
  if (/offer\s*(letter|of\s*employment)|pleased\s*to\s*offer|compensation\s*proposal|extend\s*an\s*offer/i.test(lowerText)) {
    return {
      type: 'OFFER',
      urgency: 'HIGH',
      summary: 'Job offer letter or compensation proposal received'
    };
  }

  // Interview Invitation
  if (/interview|technical\s*round|coding\s*interview|discussion\s*with|tech\s*screen|hiring\s*manager\s*round|zoom\s*interview|google\s*meet\s*interview/i.test(lowerText) ||
      (/schedule|invitation/i.test(lowerSub) && /interview|call|discussion/i.test(lowerSub))) {
    return {
      type: 'INTERVIEW_INVITATION',
      urgency: 'HIGH',
      summary: 'Recruiter or platform inviting candidate for interview/assessment'
    };
  }

  // Assessment / Online Test
  if (/hackerrank|coderbyte|online\s*assessment|coding\s*test|technical\s*assignment|take-home\s*task/i.test(lowerText)) {
    return {
      type: 'ASSESSMENT',
      urgency: 'HIGH',
      summary: 'Online coding assessment or technical challenge assigned'
    };
  }

  // Rejection
  if (/unfortunately|not\s*moving\s*forward|other\s*candidates|pursue\s*other|regret\s*to\s*inform|not\s*shortlisted|closed\s*the\s*position/i.test(lowerText)) {
    return {
      type: 'REJECTION',
      urgency: 'LOW',
      summary: 'Application status update: Position closed or not selected'
    };
  }

  // Application Confirmation
  if (/application\s*received|thank\s*you\s*for\s*applying|received\s*your\s*application|successfully\s*submitted/i.test(lowerText)) {
    return {
      type: 'APPLICATION_ACKNOWLEDGED',
      urgency: 'LOW',
      summary: 'Automated confirmation that application was received'
    };
  }

  // Recruiter request for details
  if (/share\s*(your\s*)?(updated\s*)?resume|current\s*ctc|notice\s*period|availability\s*for\s*a\s*quick\s*call/i.test(lowerText)) {
    return {
      type: 'RECRUITER_REQUEST',
      urgency: 'MEDIUM',
      summary: 'Recruiter requesting candidate documents or availability details'
    };
  }

  // General inquiry
  if (/career|opportunity|role|openings|profile/i.test(lowerText)) {
    return {
      type: 'GENERAL_INQUIRY',
      urgency: 'MEDIUM',
      summary: 'Recruiter communication or status follow-up'
    };
  }

  return {
    type: 'UNCERTAIN_MANUAL_REVIEW',
    urgency: 'MEDIUM',
    summary: 'Unclassified email requiring manual human review'
  };
}

function extractRecruiterDetails(from = '', text = '') {
  let name = null;
  let email = null;
  let phone = null;

  // From header parser: "Priya Sharma <priya@techcorp.com>"
  if (from) {
    const match = from.match(/^(?:"?([^"<]+)"?\s*)?<?([^>]+)>?$/);
    if (match) {
      name = (match[1] || '').trim();
      email = (match[2] || '').trim();
    } else if (from.includes('@')) {
      email = from.trim();
    }
  }

  // Fallback to signature name if from had only email or company
  if (!name || /no-?reply|support|notifications?|mailer|jobs/i.test(name)) {
    const signMatch = text.match(/(?:regards|best|thanks|sincerely),?\s*\n+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i);
    if (signMatch && !/hiring\s*team|recruitment\s*team/i.test(signMatch[1])) {
      name = signMatch[1].trim();
    } else {
      name = name || 'Hiring Team';
    }
  }

  // Phone extractor (+91 or 10 digits)
  const phoneMatch = text.match(/(?:\+91[-\s]?)?[6-9]\d{4}[-\s]?\d{5}\b/);
  if (phoneMatch) {
    phone = phoneMatch[0].trim();
  }

  return { name, email, phone };
}

function matchCompanyAndJob(subject = '', body = '', knownJobs = null) {
  let company = null;
  let role = null;
  let jobId = null;

  // Retrieve jobs from DB if not provided
  let jobsList = knownJobs;
  if (!jobsList) {
    try {
      const db = getDatabase();
      jobsList = db.prepare('SELECT id, company, title FROM jobs ORDER BY id DESC LIMIT 500').all();
    } catch {
      jobsList = [];
    }
  }

  const combined = `${subject} ${body}`.toLowerCase();

  // Try matching known companies from database first
  for (const j of jobsList) {
    if (!j.company) continue;
    const compLower = j.company.toLowerCase().trim();
    if (compLower.length >= 3 && combined.includes(compLower)) {
      company = j.company;
      role = j.title;
      jobId = j.id;
      break;
    }
  }

  // Regex fallback: "at [Company]" in subject
  if (!company) {
    const atMatch = subject.match(/(?:at|with|@)\s+([A-Z][A-Za-z0-9&.\s]{1,25})/i);
    if (atMatch && !/interview|application|zoom|google/i.test(atMatch[1])) {
      company = atMatch[1].trim();
    }
  }

  // Regex fallback: "Application for [Role]"
  if (!role) {
    const roleMatch = subject.match(/(?:for|role of|position of)\s+([A-Za-z\s]{3,35})(?:\s+at|\s+with|\s+-|$)/i);
    if (roleMatch && !/interview|assessment|candidacy/i.test(roleMatch[1])) {
      role = roleMatch[1].trim();
    }
  }

  return { company, role, jobId };
}

function extractInterviewSchedule(text = '', baseDate = null) {
  // Look for dates like: "Nov 25, 2026", "25th November 2026", "25-11-2026", "Wednesday, 25 Nov"
  const datePattern = /(?:on\s+)?(?:(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+)?(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|\d{4}-\d{2}-\d{2})\s*(?:,?\s*(\d{4}))?/i;
  const timePattern = /(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))?\s*(ist|utc|pst|est|gmt)?/i;

  const dateMatch = text.match(datePattern);
  const timeMatch = text.match(timePattern);

  if (!dateMatch && !timeMatch) {
    return null;
  }

  const rawDateStr = dateMatch ? dateMatch[0].trim() : '';
  const rawTimeStr = timeMatch ? timeMatch[0].trim() : '';
  const timezone = (timeMatch && timeMatch[3]) ? timeMatch[3].toUpperCase() : 'IST';

  // Construct best-effort ISO dates
  let startTime = null;
  let endTime = null;

  try {
    const parsedYear = (dateMatch && dateMatch[3]) ? dateMatch[3] : '2026';
    const dayMonth = dateMatch ? dateMatch[2].replace(/(st|nd|rd|th)/i, '') : '25 Nov';
    const fullDateText = `${dayMonth} ${parsedYear}`;

    const dateObj = new Date(fullDateText);
    if (!isNaN(dateObj.getTime())) {
      // Parse hour/min from time match
      let hours = 14; // Default 2 PM
      let minutes = 0;

      if (timeMatch && timeMatch[1]) {
        const timePart = timeMatch[1].toLowerCase();
        const isPm = timePart.includes('pm');
        const digits = timePart.replace(/[^\d:]/g, '').split(':');
        let h = parseInt(digits[0], 10);
        const m = digits[1] ? parseInt(digits[1], 10) : 0;
        if (isPm && h < 12) h += 12;
        if (!isPm && timePart.includes('am') && h === 12) h = 0;
        hours = h;
        minutes = m;
      }

      dateObj.setHours(hours, minutes, 0, 0);
      startTime = dateObj.toISOString();

      const endObj = new Date(dateObj.getTime() + 45 * 60 * 1000); // 45 min default duration
      endTime = endObj.toISOString();
    }
  } catch {}

  return {
    rawDate: rawDateStr,
    rawTime: rawTimeStr,
    timezone,
    startTime,
    endTime,
    hasConfirmedTime: Boolean(startTime && rawTimeStr)
  };
}

function extractAssessmentDetails(text = '', baseDate = null) {
  // Check for deadlines: "within 48 hours", "deadline: 28th Nov"
  const deadlineMatch = text.match(/within\s*(\d+)\s*(hours?|days?)|deadline(?:\s*is)?:?\s*([^.\n]+)/i);
  let deadline = null;

  if (deadlineMatch) {
    if (deadlineMatch[1] && deadlineMatch[2]) {
      const num = parseInt(deadlineMatch[1], 10);
      const isDays = deadlineMatch[2].startsWith('day');
      const ms = num * (isDays ? 24 * 3600 * 1000 : 3600 * 1000);
      const now = baseDate ? new Date(baseDate).getTime() : Date.now();
      deadline = new Date(now + ms).toISOString();
    } else if (deadlineMatch[3]) {
      deadline = deadlineMatch[3].trim();
    }
  }

  // Extract test platform
  let platform = 'Coding Assessment';
  if (/hackerrank/i.test(text)) platform = 'HackerRank';
  else if (/coderbyte/i.test(text)) platform = 'Coderbyte';
  else if (/codesignal/i.test(text)) platform = 'CodeSignal';
  else if (/leetcode/i.test(text)) platform = 'LeetCode';

  return {
    isAssessment: /assessment|coding\s*test|take-home|hackerrank|coderbyte/i.test(text),
    platform,
    deadline
  };
}

function extractMeetingLink(text = '') {
  // Google Meet
  const gMeet = text.match(/https:\/\/meet\.google\.com\/[a-zA-Z0-9_-]+/i);
  if (gMeet) return gMeet[0];

  // Zoom
  const zoom = text.match(/https:\/\/[a-z0-9.]*zoom\.us\/j\/[0-9?=&_-]+/i);
  if (zoom) return zoom[0];

  // Teams
  const teams = text.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"]+/i);
  if (teams) return teams[0];

  return null;
}

function extractRequestedInfo(lowerText = '') {
  const items = [];
  if (/updated\s*resume|latest\s*resume|send.*cv/i.test(lowerText)) items.push('Updated Resume / CV');
  if (/github|portfolio|work\s*sample/i.test(lowerText)) items.push('GitHub / Portfolio URL');
  if (/notice\s*period|availability\s*to\s*join/i.test(lowerText)) items.push('Notice Period / Availability');
  if (/current\s*ctc|expected\s*(ctc|salary)/i.test(lowerText)) items.push('Salary Expectations');
  if (/transcripts?|degree\s*certificate|marksheet/i.test(lowerText)) items.push('Academic Transcripts (MCA/BCA)');
  return items;
}

function determineNextAction(category, interview, assessment, requestedInfo) {
  if (category === 'INTERVIEW_INVITATION') {
    if (interview && interview.hasConfirmedTime) {
      return `Confirm attendance for scheduled interview on ${interview.rawDate || 'the proposed date'} at ${interview.rawTime || 'the proposed time'}.`;
    }
    return 'Reply with candidate interview availability (weekdays 10 AM - 6 PM IST).';
  }
  if (category === 'ASSESSMENT') {
    if (assessment && assessment.deadline) {
      return `Complete ${assessment.platform} assessment before deadline (${assessment.deadline}).`;
    }
    return `Complete ${assessment.platform} technical assessment.`;
  }
  if (category === 'OFFER') {
    return 'Review offer terms, compensation structure, and start date with advisor.';
  }
  if (category === 'RECRUITER_REQUEST') {
    return `Reply with requested details: ${requestedInfo.join(', ') || 'requested information'}.`;
  }
  if (category === 'REJECTION') {
    return 'No action needed. Application logged and status updated to Rejected.';
  }
  if (category === 'APPLICATION_ACKNOWLEDGED') {
    return 'No action needed. Application confirmation logged.';
  }
  return 'Review message and determine appropriate follow-up.';
}
