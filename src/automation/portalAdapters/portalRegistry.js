import { GreenhouseAdapter } from './greenhouseAdapter.js';
import { LeverAdapter } from './leverAdapter.js';
import { AshbyAdapter } from './ashbyAdapter.js';
import { SmartRecruitersAdapter } from './smartRecruitersAdapter.js';
import { WorkdayAdapter } from './workdayAdapter.js';
import { GenericAdapter } from './genericAdapter.js';

const adapters = [
  new GreenhouseAdapter(),
  new LeverAdapter(),
  new AshbyAdapter(),
  new SmartRecruitersAdapter(),
  new WorkdayAdapter(),
  new GenericAdapter() // Catch-all must remain last
];

/**
 * Detects the most appropriate portal adapter for a given URL.
 */
export function getPortalAdapter(url) {
  if (!url) return new GenericAdapter();
  for (const adapter of adapters) {
    if (adapter.canHandle(url)) {
      return adapter;
    }
  }
  return new GenericAdapter();
}

/**
 * Returns the transparent Portal Support Matrix.
 */
export function getPortalSupportMatrix() {
  return [
    {
      portal: 'Greenhouse',
      supportLevel: 'supported',
      description: 'Full pre-fill of standard candidate inputs, social URLs, custom question textareas, and resume attachment.',
      automatedActions: ['Name, Email, Phone', 'LinkedIn, GitHub, Portfolio', 'Location', 'Resume PDF Attachment', 'Screening Answers'],
      manualActionsRequired: ['CAPTCHA challenges if triggered', 'Diversity/EEO voluntary disclosures', 'Final submission click']
    },
    {
      portal: 'Lever',
      supportLevel: 'supported',
      description: 'Single-page application form pre-fill, resume upload, and custom screening questions.',
      automatedActions: ['Full Name, Email, Phone, Company', 'URLs (LinkedIn, GitHub, Portfolio)', 'Location', 'Resume Attachment', 'Custom questions'],
      manualActionsRequired: ['Voluntary EEO surveys', 'Consent checkboxes', 'Final submission click']
    },
    {
      portal: 'Ashby',
      supportLevel: 'supported',
      description: 'Modern single-page application form pre-fill and resume attachment.',
      automatedActions: ['Full Name, Email, Phone', 'Social URLs', 'Location', 'Resume Attachment'],
      manualActionsRequired: ['Any dynamic custom select dropdowns', 'Final submission click']
    },
    {
      portal: 'SmartRecruiters',
      supportLevel: 'supported',
      description: 'Standard candidate fields, location, and resume attachment on public career postings.',
      automatedActions: ['First/Last Name, Email, Phone', 'City', 'LinkedIn', 'Resume Attachment'],
      manualActionsRequired: ['Data privacy acknowledgment checkboxes', 'Final submission click']
    },
    {
      portal: 'Workday',
      supportLevel: 'partially_supported',
      description: 'Candidate portal with multi-step authentication. Detects login walls and pre-fills standard text inputs when open; provides structured side-panel copy/paste assist.',
      automatedActions: ['Standard Name, Email, Phone when form is public/unlocked', 'Resume file selection'],
      manualActionsRequired: ['Account creation / Sign-in', 'Step-by-step wizard navigation', 'Final submission click']
    },
    {
      portal: 'Custom / Other ATS',
      supportLevel: 'partially_supported',
      description: 'Heuristic selector detection for generic HTML career and application forms.',
      automatedActions: ['Standard inputs with common autocomplete/name/id attributes', 'Resume attachment'],
      manualActionsRequired: ['Proprietary custom fields', 'Final submission click']
    }
  ];
}
