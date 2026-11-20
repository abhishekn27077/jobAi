let currentFilter = 'all';
let allJobs = [];

document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadJobs();
  setupEventListeners();
});

function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      applyFilters();
    });
  });

  // Search input
  document.getElementById('searchInput').addEventListener('input', () => {
    applyFilters();
  });

  // Advanced Discovery Filter Dropdowns
  ['sourceSelect', 'locationSelect', 'workModeSelect', 'verificationSelect'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        applyFilters();
      });
    }
  });

  // Scan History Telemetry Button
  const histBtn = document.getElementById('scanHistoryBtn');
  if (histBtn) {
    histBtn.addEventListener('click', openScanHistoryModal);
  }

  // Applications Pipeline Button
  const appsBtn = document.getElementById('viewApplicationsBtn');
  if (appsBtn) {
    appsBtn.addEventListener('click', openApplicationsModal);
  }

  // Portal Matrix Button
  const portalsBtn = document.getElementById('portalMatrixBtn');
  if (portalsBtn) {
    portalsBtn.addEventListener('click', openPortalMatrixModal);
  }

  // Communications & Calendar Hub Button
  const commsBtn = document.getElementById('commsHubBtn');
  if (commsBtn) {
    commsBtn.addEventListener('click', openCommsHubModal);
  }

  // Career Intelligence Button
  const careerIntelBtn = document.getElementById('careerIntelBtn');
  if (careerIntelBtn) {
    careerIntelBtn.addEventListener('click', () => openCareerIntelligenceModal());
  }

  const closeCareerIntelBtn = document.getElementById('closeCareerIntelBtn');
  if (closeCareerIntelBtn) {
    closeCareerIntelBtn.addEventListener('click', () => {
      document.getElementById('careerIntelModal').classList.add('hidden');
    });
  }

  // Automation & Backup Button
  const autoBackupBtn = document.getElementById('automationBackupBtn');
  if (autoBackupBtn) {
    autoBackupBtn.addEventListener('click', () => openAutomationBackupModal());
  }

  const closeAutoBackupBtn = document.getElementById('closeAutomationBackupBtn');
  if (closeAutoBackupBtn) {
    closeAutoBackupBtn.addEventListener('click', () => {
      document.getElementById('automationBackupModal').classList.add('hidden');
    });
  }

  const refreshAutoStatusBtn = document.getElementById('refreshAutoStatusBtn');
  if (refreshAutoStatusBtn) {
    refreshAutoStatusBtn.addEventListener('click', () => loadAndRenderAutomationModal());
  }

  // Scan Button
  document.getElementById('scanBtn').addEventListener('click', async () => {
    const scanBtn = document.getElementById('scanBtn');
    const loading = document.getElementById('loadingIndicator');
    scanBtn.disabled = true;
    scanBtn.textContent = '⏳ Scanning...';
    loading.classList.remove('hidden');

    try {
      const resp = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      await resp.json();
      await loadStats();
      await loadJobs();
    } catch (err) {
      alert('Error scanning jobs: ' + err.message);
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = '⚡ Scan Jobs';
      loading.classList.add('hidden');
    }
  });

  // Profile Modal
  document.getElementById('viewProfileBtn').addEventListener('click', async () => {
    openModal('Verified Candidate Profile', '<p>Loading profile...</p>');
    try {
      const resp = await fetch('/api/profile');
      const profile = await resp.json();
      document.getElementById('modalBody').innerHTML = renderProfileHtml(profile);
    } catch (err) {
      document.getElementById('modalBody').innerHTML = `<p class="text-danger">Failed to load profile: ${err.message}</p>`;
    }
  });

  // Audit Links Button
  document.getElementById('verifyLinksBtn').addEventListener('click', async () => {
    const btn = document.getElementById('verifyLinksBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Auditing...';
    openModal('Auditing Active Job Listings & Checking Ghost Postings...', '<div class="loading"><div class="spinner"></div><p>Performing HTTP liveness checks & scanning for closed vacancy markers...</p></div>');
    try {
      const resp = await fetch('/api/verify-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20 })
      });
      const result = await resp.json();
      document.getElementById('modalBody').innerHTML = `
        <div style="text-align: center; padding: 20px;">
          <div style="font-size: 40px; margin-bottom: 12px;">✅</div>
          <h3>Liveness & Ghost-Job Audit Complete</h3>
          <p style="color: #94a3b8; margin: 12px 0 20px 0; font-size: 14px; line-height: 1.6;">
            Audited <strong>${result.verifiedCount + result.expiredCount}</strong> listings from your active pipeline.<br>
            <span style="color: #4ade80;">Active & Verified: <strong>${result.verifiedCount}</strong></span> |
            <span style="color: #f87171;">Expired / Closed: <strong>${result.expiredCount}</strong></span>
          </p>
          <button class="btn btn-primary" onclick="closeModal()">Done</button>
        </div>
      `;
      await loadStats();
      await loadJobs();
    } catch (err) {
      document.getElementById('modalBody').innerHTML = `<p class="text-danger">Audit failed: ${err.message}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 Audit Links';
    }
  });

  // Export CSV Button
  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    window.location.href = '/api/export/csv';
  });

  // Export JSON Button
  document.getElementById('exportJsonBtn').addEventListener('click', () => {
    window.location.href = '/api/export/json';
  });

  async function openScanHistoryModal() {
    openModal('Job Discovery Telemetry & Scan History', '<div class="loading"><div class="spinner"></div><p>Loading scan telemetry...</p></div>');
    try {
      const resp = await fetch('/api/scan-history');
      const data = await resp.json();
      const list = data.history || [];

      if (list.length === 0) {
        document.getElementById('modalBody').innerHTML = `
          <div style="text-align: center; padding: 30px; color: #94a3b8;">
            <p>No recent scan history recorded yet.</p>
            <p style="margin-top: 8px;">Click "⚡ Scan Jobs" to execute a discovery run.</p>
          </div>
        `;
        return;
      }

      let rowsHtml = list.map(item => {
        const timeStr = item.scanned_at ? item.scanned_at.replace('T', ' ') : 'N/A';
        const statusBadge = item.status === 'success' 
          ? '<span style="color: #4ade80; font-weight: 600;">✓ Success</span>' 
          : `<span style="color: #f87171; font-weight: 600;" title="${escapeHtml(item.error_message || '')}">✗ Error</span>`;
        return `
          <tr style="border-bottom: 1px solid #334155; font-size: 13px;">
            <td style="padding: 10px 8px; color: #cbd5e1;">${timeStr}</td>
            <td style="padding: 10px 8px;"><span class="source-tag source-${escapeHtml(item.source)}">${escapeHtml(item.source)}</span></td>
            <td style="padding: 10px 8px; color: #f1f5f9;"><strong>${escapeHtml(item.target_name || item.query || 'Global')}</strong></td>
            <td style="padding: 10px 8px; text-align: right; color: #93c5fd;">${item.jobs_found}</td>
            <td style="padding: 10px 8px; text-align: right; color: #4ade80;">+${item.new_jobs_added}</td>
            <td style="padding: 10px 8px; text-align: right; color: #94a3b8;">${item.duration_ms}ms</td>
            <td style="padding: 10px 8px;">${statusBadge}</td>
          </tr>
        `;
      }).join('');

      document.getElementById('modalBody').innerHTML = `
        <div style="max-height: 500px; overflow-y: auto;">
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <thead>
              <tr style="border-bottom: 2px solid #475569; font-size: 12px; color: #94a3b8; text-transform: uppercase;">
                <th style="padding: 8px;">Timestamp</th>
                <th style="padding: 8px;">Source</th>
                <th style="padding: 8px;">Target / Query</th>
                <th style="padding: 8px; text-align: right;">Found</th>
                <th style="padding: 8px; text-align: right;">New</th>
                <th style="padding: 8px; text-align: right;">Latency</th>
                <th style="padding: 8px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      document.getElementById('modalBody').innerHTML = `<p class="text-danger">Failed to load scan history: ${err.message}</p>`;
    }
  }

  document.getElementById('closeModalBtn').addEventListener('click', () => {
    closeModal();
  });

  window.addEventListener('click', (e) => {
    const modal = document.getElementById('actionModal');
    if (e.target === modal) closeModal();
  });
}

function openModal(title, htmlContent) {
  const modal = document.getElementById('actionModal');
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = htmlContent;
  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('actionModal').classList.add('hidden');
}

async function loadStats() {
  try {
    const resp = await fetch('/api/stats');
    const stats = await resp.json();
    document.getElementById('statTotal').textContent = stats.totalScanned || 0;
    document.getElementById('statRecommended').textContent = stats.recommended || 0;
    document.getElementById('statConsider').textContent = stats.consider || 0;
    document.getElementById('statSaved').textContent = stats.saved || 0;
  } catch (e) {
    console.error('Failed to load stats:', e);
  }
}

async function loadJobs() {
  try {
    const resp = await fetch('/api/jobs?limit=150');
    const data = await resp.json();
    allJobs = data.jobs || [];
    applyFilters();
  } catch (e) {
    console.error('Failed to load jobs:', e);
  }
}

function applyFilters() {
  const searchTerm = (document.getElementById('searchInput').value || '').toLowerCase().trim();
  const sourceFilter = document.getElementById('sourceSelect') ? document.getElementById('sourceSelect').value.toLowerCase() : 'all';
  const locationFilter = document.getElementById('locationSelect') ? document.getElementById('locationSelect').value.toLowerCase() : 'all';
  const workModeFilter = document.getElementById('workModeSelect') ? document.getElementById('workModeSelect').value.toLowerCase() : 'all';
  const verifFilter = document.getElementById('verificationSelect') ? document.getElementById('verificationSelect').value.toLowerCase() : 'all';

  const grid = document.getElementById('jobGrid');
  grid.innerHTML = '';

  let filtered = allJobs.filter(job => {
    // Tab filters
    if (currentFilter === 'RECOMMENDED' && job.recommendation !== 'RECOMMENDED') return false;
    if (currentFilter === 'CONSIDER' && job.recommendation !== 'CONSIDER') return false;
    if (currentFilter === 'saved' && job.status !== 'saved') return false;
    if (currentFilter === 'ready_to_apply' && job.status !== 'ready_to_apply') return false;
    if (currentFilter === 'applied' && job.status !== 'applied') return false;

    // Source dropdown
    if (sourceFilter !== 'all') {
      const jSource = (job.source || 'direct').toLowerCase();
      if (jSource !== sourceFilter) return false;
    }

    // Work Mode dropdown
    if (workModeFilter !== 'all') {
      const jWp = (job.work_mode || 'onsite').toLowerCase();
      if (jWp !== workModeFilter) return false;
    }

    // Verification dropdown
    if (verifFilter !== 'all') {
      const jVerif = (job.verification_status || 'unverified').toLowerCase();
      if (jVerif !== verifFilter) return false;
    }

    // Location dropdown
    if (locationFilter !== 'all') {
      const jLoc = (job.location || '').toLowerCase();
      if (locationFilter === 'bengaluru') {
        const isBlr = jLoc.includes('bengaluru') || jLoc.includes('bangalore') || jLoc.includes('karnataka');
        if (!isBlr) return false;
      } else if (locationFilter === 'remote') {
        const isRem = jLoc.includes('remote') || (job.work_mode || '').toLowerCase() === 'remote';
        if (!isRem) return false;
      } else {
        if (!jLoc.includes(locationFilter)) return false;
      }
    }

    // Search term
    if (searchTerm) {
      const matchText = `${job.title} ${job.company} ${job.location} ${(job.skills_matched || []).join(' ')}`.toLowerCase();
      if (!matchText.includes(searchTerm)) return false;
    }
    return true;
  });

  document.getElementById('visibleCount').textContent = `${filtered.length} roles`;

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="text-align: center; padding: 50px; color: var(--text-muted); background: var(--surface); border-radius: 8px;">
        <h3>No jobs matching this filter</h3>
        <p style="margin-top: 8px;">Try adjusting your source, location, or work mode filters, or click "⚡ Scan Jobs" to discover new opportunities.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(job => {
    grid.appendChild(createJobCard(job));
  });
}

function createJobCard(job) {
  const card = document.createElement('div');
  const recClass = (job.recommendation || 'rejected').toLowerCase();
  card.className = `job-card ${recClass}`;

  const stars = '★'.repeat(job.rating || 1) + '☆'.repeat(5 - (job.rating || 1));
  const pillClass = `pill-${recClass}`;

  const matchedHtml = (job.skills_matched || []).map(s => `<span class="skill-tag skill-matched">${escapeHtml(s)}</span>`).join('');
  const missingHtml = (job.skills_missing || []).map(s => `<span class="skill-tag skill-missing">${escapeHtml(s)}</span>`).join('');

  const sourceName = (job.source || 'direct').toLowerCase();
  const workModeStr = (job.work_mode || 'onsite').toLowerCase();
  const verifStatus = (job.verification_status || 'unverified').toLowerCase();
  const verifText = verifStatus === 'verified_active' ? '✓ Verified' : (verifStatus === 'blocked' ? '🔒 Protected' : (verifStatus === 'expired' ? '✗ Expired' : '• Unverified'));

  card.innerHTML = `
    <div class="job-header">
      <div class="job-title-row">
        <a href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer" class="job-title">
          ${escapeHtml(job.title)}
        </a>
        <div class="job-company">${escapeHtml(job.company)}</div>
        <div class="job-meta-chips">
          <span class="source-tag source-${escapeHtml(sourceName)}">🏷 ${escapeHtml(job.source || 'direct')}</span>
          <span class="workmode-chip workmode-${escapeHtml(workModeStr)}">${workModeStr === 'remote' ? '🌐 Remote' : (workModeStr === 'hybrid' ? '🏢 Hybrid' : '📍 On-site')}</span>
          <span class="verif-chip verif-${escapeHtml(verifStatus)}">${verifText}</span>
          <span>📍 ${escapeHtml(job.location || 'India')}</span>
          ${job.salary ? `<span>💰 ${escapeHtml(job.salary)}</span>` : ''}
          ${job.experience_min !== null ? `<span>🎓 Exp: ${job.experience_min}${job.experience_max ? `-${job.experience_max}` : '+'} yrs</span>` : ''}
          <span>📅 ${job.posted_at ? job.posted_at.split('T')[0] : 'Recent'}</span>
        </div>
      </div>
      <div class="score-badge">
        <span class="score-num">${Math.round(job.score || 0)}/100</span>
        <span class="score-stars">${stars}</span>
        <span class="recommendation-pill ${pillClass}">${escapeHtml(job.recommendation || 'REJECTED')}</span>
      </div>
    </div>

    <div class="eval-box">
      <div class="eval-reason"><strong>Analysis:</strong> ${escapeHtml(job.summary_reason || 'N/A')}</div>
      <div class="tags-row">
        ${matchedHtml ? `<span class="tag-label">Matched:</span> ${matchedHtml}` : ''}
        ${missingHtml ? `<span class="tag-label" style="margin-left: 8px;">Missing:</span> ${missingHtml}` : ''}
      </div>
    </div>

    <div class="job-toolbar">
      <div class="pipeline-actions">
        <button class="btn btn-primary btn-sm" onclick="openResumeStudio(${job.id})" style="background: linear-gradient(135deg, #2563eb, #7c3aed); border: none;">✨ AI Resume Studio</button>
        <button class="btn btn-outline btn-sm" onclick="tailorDocuments(${job.id})">📝 Quick ATS Docs</button>
        <button class="btn btn-primary btn-sm" onclick="assistApplication(${job.id})">🚀 Assist Apply</button>
        <button class="btn btn-outline btn-sm" onclick="openInterviewPrep(${job.id})">🎯 Prep Dossier</button>
        <button class="btn btn-outline btn-sm" onclick="startMockInterview(${job.id})">🎤 Mock Practice</button>
        <button class="btn btn-outline btn-sm" onclick="openReferralAssistant(${job.id})">🤝 Referral Msg</button>
      </div>
      <div class="job-actions">
        ${job.status !== 'saved' ? `<button class="btn btn-outline btn-sm" onclick="setJobStatus(${job.id}, 'saved')">💾 Save</button>` : `<button class="btn btn-outline btn-sm" onclick="setJobStatus(${job.id}, 'discovered')">Unsave</button>`}
        ${job.status !== 'applied' ? `<button class="btn btn-outline btn-sm" onclick="setJobStatus(${job.id}, 'applied')">✅ Mark Applied</button>` : '<span style="color: var(--success); font-weight: 600; font-size: 12px; padding: 4px 8px;">Applied ✓</span>'}
        <a href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm">🔗 Link</a>
      </div>
    </div>
  `;

  return card;
}

window.tailorDocuments = async function(jobId) {
  openModal('Generating Tailored ATS Documents...', '<div class="loading"><div class="spinner"></div><p>Compiling ATS-optimized resume & cover letter...</p></div>');
  try {
    const resp = await fetch(`/api/job/${jobId}/tailor`, { method: 'POST' });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);

    const html = `
      <div style="display: flex; gap: 12px; margin-bottom: 16px;">
        <a href="${data.pdfUrl}" target="_blank" class="btn btn-primary" download>📥 Download ATS PDF Resume</a>
        <button class="btn btn-outline" onclick="navigator.clipboard.writeText(document.getElementById('resumeMdText').innerText); alert('Copied resume to clipboard!');">📋 Copy Resume Markdown</button>
      </div>
      <h3 style="color: #93c5fd; margin-bottom: 8px;">Tailored Resume Preview (ATS Format)</h3>
      <pre id="resumeMdText" style="background: #0f172a; padding: 14px; border-radius: 6px; overflow-x: auto; font-size: 12px; line-height: 1.4; white-space: pre-wrap; color: #e2e8f0; border: 1px solid #334155;">${escapeHtml(data.resumeMarkdown)}</pre>
      <h3 style="color: #93c5fd; margin: 20px 0 8px 0;">Tailored Cover Letter</h3>
      <pre style="background: #0f172a; padding: 14px; border-radius: 6px; overflow-x: auto; font-size: 12px; line-height: 1.4; white-space: pre-wrap; color: #e2e8f0; border: 1px solid #334155;">${escapeHtml(data.coverLetterMarkdown)}</pre>
    `;
    document.getElementById('modalBody').innerHTML = html;
  } catch (err) {
    document.getElementById('modalBody').innerHTML = `<p class="text-danger">Failed to tailor documents: ${err.message}</p>`;
  }
};

window.assistApplication = async function(jobId) {
  openModal('Application Intelligence Workbench', '<div class="loading"><div class="spinner"></div><p>Compiling job application dossier, checking freshness, selecting resume, and grounding screening answers...</p></div>');
  try {
    const resp = await fetch(`/api/job/${jobId}/application`);
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);

    renderApplicationIntelligenceModal(data.dossier);
  } catch (err) {
    document.getElementById('modalBody').innerHTML = `<p class="text-danger">Failed to compile application dossier: ${err.message}</p>`;
  }
};

function renderApplicationIntelligenceModal(d) {
  const portalBadge = `<span class="source-tag source-${escapeHtml(d.portal.name.toLowerCase())}" style="font-size: 12px;">${escapeHtml(d.portal.name)}</span>`;
  const supportTag = d.portal.supportLevel === 'supported' 
    ? '<span style="background: rgba(34, 197, 94, 0.15); color: #4ade80; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">✓ Supported</span>' 
    : '<span style="background: rgba(234, 179, 8, 0.15); color: #facc15; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">⚡ Guided Assist</span>';

  // Checklist HTML
  const checklistHtml = (d.checklist || []).map(item => {
    const icon = item.completed ? '✅' : (item.required ? '🔒' : '⏳');
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 13px;">
        <span>${icon} ${escapeHtml(item.label)}</span>
        <span style="color: ${item.completed ? '#4ade80' : '#f59e0b'}; font-size: 11px; font-weight: 600;">${item.completed ? 'READY' : (item.required ? 'ACTION REQUIRED' : 'PENDING')}</span>
      </div>
    `;
  }).join('');

  // Screening Questions HTML
  const screeningKeys = Object.keys(d.screeningAnswers || {});
  const screeningHtml = screeningKeys.map(k => {
    const q = d.screeningAnswers[k];
    const confClass = q.confidence === 'high' ? 'color: #4ade80;' : (q.confidence === 'medium' ? 'color: #facc15;' : 'color: #f87171;');
    return `
      <div style="background: rgba(15,23,42,0.6); padding: 12px; border-radius: 6px; margin-bottom: 12px; border: 1px solid #334155;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <strong style="color: #93c5fd; font-size: 13px;">${escapeHtml(q.question.replace(/_/g, ' ').toUpperCase())}</strong>
          <span style="${confClass} font-size: 11px; font-weight: 600;">[Confidence: ${escapeHtml(q.confidence.toUpperCase())}]</span>
        </div>
        <p style="font-size: 11px; color: #94a3b8; margin-bottom: 6px;">Evidence: <em>${escapeHtml(q.evidence || 'Verified profile')}</em></p>
        <textarea id="screening_${escapeHtml(k)}" rows="2" style="width: 100%; background: #0f172a; border: 1px solid #475569; color: #f1f5f9; padding: 8px; border-radius: 4px; font-size: 12px; line-height: 1.4; resize: vertical;">${escapeHtml(q.answer || '')}</textarea>
      </div>
    `;
  }).join('');

  document.getElementById('modalBody').innerHTML = `
    <div style="max-height: 600px; overflow-y: auto; padding-right: 6px;">
      <!-- Job & Portal Meta Header -->
      <div style="background: #1e293b; padding: 16px; border-radius: 8px; margin-bottom: 16px; border-left: 4px solid #3b82f6;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <div>
            <h3 style="color: #f8fafc; font-size: 16px; margin-bottom: 2px;">${escapeHtml(d.job.title)}</h3>
            <p style="color: #94a3b8; font-size: 13px;">${escapeHtml(d.job.company)} • 📍 ${escapeHtml(d.job.location)}</p>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            ${portalBadge}
            ${supportTag}
          </div>
        </div>
        <div style="display: flex; gap: 12px; align-items: center; margin-top: 10px; font-size: 12px;">
          <a href="${escapeHtml(d.job.url)}" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; text-decoration: underline;">🔗 View Original Application URL</a>
          <span style="color: #64748b;">|</span>
          <span style="color: #4ade80;">ATS Compatibility: <strong>${d.evaluation.score}/100</strong></span>
          <span style="color: #64748b;">|</span>
          <span style="color: #a78bfa;">Fresher Eligible: <strong>${d.evaluation.fresherEligible ? 'YES' : 'NO'}</strong></span>
        </div>
      </div>

      <!-- Recommended Resume & Cover Letter -->
      <div style="background: #0f172a; padding: 14px; border-radius: 8px; margin-bottom: 16px; border: 1px solid #334155;">
        <h4 style="color: #38bdf8; margin-bottom: 8px; font-size: 14px;">📄 Recommended Verified Resume Version</h4>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
          <div>
            <span style="color: #f1f5f9; font-weight: 600;">Resume Version: v${d.resumeVersion.versionNumber || 1}</span>
            <span style="color: #94a3b8; margin-left: 8px;">(ATS Match: ${d.resumeVersion.atsScore}/100)</span>
          </div>
          <div style="display: flex; gap: 8px;">
            <a href="${d.resumeVersion.pdfUrl}" target="_blank" class="btn btn-outline btn-sm">👁 Preview PDF</a>
            <button class="btn btn-outline btn-sm" onclick="openResumeStudio(${d.jobId})">✏ Edit in Studio</button>
          </div>
        </div>
      </div>

      <!-- Application Preparation Checklist -->
      <div style="background: #1e293b; padding: 14px; border-radius: 8px; margin-bottom: 16px; border: 1px solid #334155;">
        <h4 style="color: #f8fafc; margin-bottom: 8px; font-size: 14px;">📋 Pre-Application Readiness Checklist</h4>
        ${checklistHtml}
      </div>

      <!-- Screening Questions -->
      <div style="margin-bottom: 16px;">
        <h4 style="color: #f8fafc; margin-bottom: 8px; font-size: 14px;">🧠 Verified Screening Intelligence (Editable Answers)</h4>
        <p style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">Answers are strictly generated using verified candidate master profile evidence. Review or edit any response prior to browser auto-fill:</p>
        ${screeningHtml}
      </div>

      <!-- Human-in-the-Loop Safety Banner -->
      <div style="background: rgba(30, 58, 138, 0.4); border: 1px solid #2563eb; padding: 14px; border-radius: 8px; margin-bottom: 20px;">
        <div style="display: flex; gap: 10px; align-items: center;">
          <span style="font-size: 24px;">🔒</span>
          <div style="font-size: 12px; color: #bfdbfe; line-height: 1.5;">
            <strong>Mandatory Human Approval Rule:</strong><br>
            CareerOS opens a visible Google Chrome browser and pre-fills only the approved fields above. CareerOS <strong>NEVER clicks Submit</strong> and never accepts legal agreements on your behalf. You review the open browser and click Submit manually on the employer portal.
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div style="display: flex; justify-content: space-between; gap: 12px; align-items: center; border-top: 1px solid #334155; padding-top: 16px;">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-outline" onclick="promptConfirmSubmission(${d.jobId}, '${escapeHtml(d.job.title)}', '${escapeHtml(d.job.company)}')">✅ Confirm I Submitted</button>
          <button class="btn btn-primary" onclick="executeApproveAndFill(${d.jobId}, '${escapeHtml(d.resumeVersion.pdfPath || '')}')" style="background: linear-gradient(135deg, #2563eb, #10b981); border: none;">
            🚀 Approve & Fill Application Form
          </button>
        </div>
      </div>
    </div>
  `;
}

window.executeApproveAndFill = async function(jobId, resumePdfPath) {
  const inputs = document.querySelectorAll('[id^="screening_"]');
  const gathered = {};
  inputs.forEach(el => {
    const key = el.id.replace('screening_', '');
    gathered[key] = { answer: el.value.trim() };
  });

  openModal('Launching Form Assistant...', '<div class="loading"><div class="spinner"></div><p>Launching visible Chrome browser with verified candidate data...</p></div>');
  try {
    const resp = await fetch(`/api/job/${jobId}/assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userConfirmedApproval: true,
        resumePdfPath,
        screeningAnswers: gathered
      })
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);

    document.getElementById('modalBody').innerHTML = `
      <div style="text-align: center; padding: 24px;">
        <div style="font-size: 44px; margin-bottom: 12px;">🚀</div>
        <h3 style="color: #4ade80;">Form Assistant Active in Browser</h3>
        <p style="color: #cbd5e1; margin: 12px 0 20px 0; font-size: 14px; line-height: 1.6;">
          ${escapeHtml(data.message)}
        </p>
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; text-align: left; font-size: 13px; color: #94a3b8; border: 1px solid #334155; margin-bottom: 20px;">
          <strong style="color: #f1f5f9;">Next Steps:</strong>
          <ol style="margin-top: 6px; padding-left: 20px; line-height: 1.6;">
            <li>Switch to your open Google Chrome browser window.</li>
            <li>Review all pre-filled fields and attachments.</li>
            <li>Complete any CAPTCHA or mandatory checkboxes.</li>
            <li>Click <strong>Submit Application</strong> manually on the employer portal.</li>
            <li>Return here and click <strong>"Confirm I Submitted"</strong> to record your confirmation.</li>
          </ol>
        </div>
        <div style="display: flex; justify-content: center; gap: 12px;">
          <button class="btn btn-outline" onclick="closeModal()">Dismiss</button>
          <button class="btn btn-primary" onclick="promptConfirmSubmission(${jobId})">✅ Confirm I Submitted</button>
        </div>
      </div>
    `;
    await loadJobs();
  } catch (err) {
    document.getElementById('modalBody').innerHTML = `<p class="text-danger">Failed to launch assistant: ${err.message}</p>`;
  }
};

window.promptConfirmSubmission = function(jobId, title = 'Role', company = 'Company') {
  document.getElementById('modalTitle').textContent = 'Confirm Application Submission';
  document.getElementById('modalBody').innerHTML = `
    <div style="padding: 10px;">
      <p style="color: #cbd5e1; font-size: 13px; line-height: 1.5; margin-bottom: 16px;">
        Confirming an application records it into your verified pipeline history and moves its status to <strong>Submitted</strong>.
      </p>
      <div style="margin-bottom: 14px;">
        <label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Confirmation / Application ID (optional):</label>
        <input type="text" id="confirmIdInput" placeholder="e.g. APP-94812 or GH-1823" style="width: 100%; background: #0f172a; border: 1px solid #475569; color: white; padding: 8px; border-radius: 6px; font-size: 13px;" />
      </div>
      <div style="margin-bottom: 20px;">
        <label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Submission Notes / Portal used:</label>
        <textarea id="confirmNotesInput" placeholder="Submitted via direct Greenhouse board after reviewing tailored resume." rows="2" style="width: 100%; background: #0f172a; border: 1px solid #475569; color: white; padding: 8px; border-radius: 6px; font-size: 13px;"></textarea>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="executeConfirmSubmission(${jobId})" style="background: #10b981; border: none;">
          ✓ Confirm Submission
        </button>
      </div>
    </div>
  `;
};

window.executeConfirmSubmission = async function(jobId) {
  const confId = document.getElementById('confirmIdInput')?.value.trim() || null;
  const notes = document.getElementById('confirmNotesInput')?.value.trim() || 'Submitted manually by user';

  try {
    const resp = await fetch(`/api/job/${jobId}/application/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'submitted',
        userConfirmed: true,
        confirmationNumber: confId,
        notes
      })
    });
    const result = await resp.json();
    if (!result.success) throw new Error(result.error);

    document.getElementById('modalBody').innerHTML = `
      <div style="text-align: center; padding: 24px;">
        <div style="font-size: 40px; margin-bottom: 12px;">🎉</div>
        <h3 style="color: #4ade80;">Application Marked as Submitted!</h3>
        <p style="color: #94a3b8; margin: 12px 0 20px 0; font-size: 13px;">
          Job #${jobId} status is now recorded as <strong>Submitted</strong> in your Career Vault.<br>
          ${confId ? `Confirmation Number: <strong>${escapeHtml(confId)}</strong>` : ''}
        </p>
        <button class="btn btn-primary" onclick="closeModal()">Done</button>
      </div>
    `;
    await loadStats();
    await loadJobs();
  } catch (err) {
    alert('Failed to record submission: ' + err.message);
  }
};

async function openApplicationsModal() {
  openModal('Active Applications Pipeline', '<div class="loading"><div class="spinner"></div><p>Loading application tracker...</p></div>');
  try {
    const resp = await fetch('/api/applications');
    const data = await resp.json();
    const apps = data.applications || [];

    if (apps.length === 0) {
      document.getElementById('modalBody').innerHTML = `
        <div style="text-align: center; padding: 30px; color: #94a3b8;">
          <p>No applications prepared yet.</p>
          <p style="margin-top: 8px;">Click "🚀 Assist Apply" on any recommended role to prepare an application dossier.</p>
        </div>
      `;
      return;
    }

    const rowsHtml = apps.map(a => {
      const statusColors = {
        preparing: '#94a3b8',
        ready_for_review: '#facc15',
        submitted: '#4ade80',
        interview: '#38bdf8',
        offer: '#ec4899',
        rejected: '#f87171'
      };
      const color = statusColors[a.status] || '#cbd5e1';

      return `
        <tr style="border-bottom: 1px solid #334155; font-size: 13px;">
          <td style="padding: 10px 8px;">
            <strong style="color: #f1f5f9;">${escapeHtml(a.job_title)}</strong><br>
            <span style="color: #94a3b8; font-size: 11px;">${escapeHtml(a.job_company)}</span>
          </td>
          <td style="padding: 10px 8px;"><span class="source-tag source-${escapeHtml((a.portal_type || 'generic').toLowerCase())}">${escapeHtml(a.portal_type || 'Direct')}</span></td>
          <td style="padding: 10px 8px; color: #93c5fd; font-size: 12px;">${escapeHtml(a.resume_version || 'v1')}</td>
          <td style="padding: 10px 8px;"><span style="color: ${color}; font-weight: 700; text-transform: uppercase; font-size: 11px;">${escapeHtml(a.status)}</span></td>
          <td style="padding: 10px 8px; color: #94a3b8; font-size: 12px;">${a.applied_date ? a.applied_date.split('T')[0] : 'In Prep'}</td>
          <td style="padding: 10px 8px;">
            <button class="btn btn-outline btn-sm" onclick="assistApplication(${a.job_id})">Open Dossier</button>
          </td>
        </tr>
      `;
    }).join('');

    document.getElementById('modalBody').innerHTML = `
      <div style="max-height: 500px; overflow-y: auto;">
        <table style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead>
            <tr style="border-bottom: 2px solid #475569; font-size: 12px; color: #94a3b8; text-transform: uppercase;">
              <th style="padding: 8px;">Role & Company</th>
              <th style="padding: 8px;">Portal</th>
              <th style="padding: 8px;">Resume</th>
              <th style="padding: 8px;">Status</th>
              <th style="padding: 8px;">Date</th>
              <th style="padding: 8px;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    document.getElementById('modalBody').innerHTML = `<p class="text-danger">Failed to load applications: ${err.message}</p>`;
  }
}

async function openPortalMatrixModal() {
  openModal('ATS Portal Compatibility Matrix', '<div class="loading"><div class="spinner"></div><p>Loading compatibility matrix...</p></div>');
  try {
    const resp = await fetch('/api/portals');
    const data = await resp.json();
    const portals = data.portals || [];

    const rowsHtml = portals.map(p => {
      const isSupp = p.supportLevel === 'supported';
      const badge = isSupp
        ? '<span style="background: rgba(34, 197, 94, 0.15); color: #4ade80; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 11px;">✓ SUPPORTED</span>'
        : '<span style="background: rgba(234, 179, 8, 0.15); color: #facc15; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 11px;">⚡ GUIDED ASSIST</span>';

      return `
        <div style="background: #1e293b; padding: 14px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #334155;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <strong style="color: #f8fafc; font-size: 14px;">${escapeHtml(p.portal)}</strong>
            ${badge}
          </div>
          <p style="font-size: 12px; color: #cbd5e1; margin-bottom: 8px;">${escapeHtml(p.description)}</p>
          <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">
            <span style="color: #4ade80; font-weight: 600;">Automated Pre-Fill:</span> ${escapeHtml(p.automatedActions.join(' • ')}
          </div>
          <div style="font-size: 12px; color: #94a3b8;">
            <span style="color: #f59e0b; font-weight: 600;">Manual User Step:</span> ${escapeHtml(p.manualActionsRequired.join(' • ')}
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('modalBody').innerHTML = `
      <div style="max-height: 520px; overflow-y: auto;">
        <p style="font-size: 13px; color: #94a3b8; margin-bottom: 16px;">
          CareerOS provides dedicated, verified portal adapters for primary tech ATS systems. No universal or brittle claim is made.
        </p>
        ${rowsHtml}
      </div>
    `;
  } catch (err) {
    document.getElementById('modalBody').innerHTML = `<p class="text-danger">Failed to load portal matrix: ${err.message}</p>`;
  }
}

window.openInterviewPrep = async function(jobId) {
  openModal('Generating Interview Preparation Dossier...', '<div class="loading"><div class="spinner"></div><p>Preparing technical and STAR behavioral questions...</p></div>');
  try {
    const resp = await fetch(`/api/job/${jobId}/prep`);
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    const d = data.dossier;

    const topicsHtml = d.technicalTopics.map(t => `
      <div style="margin-bottom: 16px; background: rgba(15,23,42,0.6); padding: 12px; border-radius: 6px; border-left: 3px solid #3b82f6;">
        <h4 style="color: #93c5fd; margin-bottom: 4px;">${escapeHtml(t.topic)} <small style="color: #f59e0b; font-size: 11px;">[${t.importance}]</small></h4>
        <p style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">Key concepts: ${escapeHtml(t.keyConcepts.join(' • '))}</p>
        <ul style="padding-left: 18px; font-size: 13px;">
          ${t.practiceQuestions.map(q => `<li style="margin-bottom: 4px;">${escapeHtml(q)}</li>`).join('')}
        </ul>
      </div>
    `).join('');

    const projectsHtml = d.projectDeepDives.map(p => `
      <div style="margin-bottom: 16px; background: rgba(15,23,42,0.6); padding: 12px; border-radius: 6px; border-left: 3px solid #10b981;">
        <h4 style="color: #6ee7b7; margin-bottom: 4px;">${escapeHtml(p.projectName)}</h4>
        <p style="font-style: italic; font-size: 12px; color: #cbd5e1; margin-bottom: 8px;">"${escapeHtml(p.elevatorPitch)}"</p>
        ${p.likelyQuestions.map(q => `
          <div style="margin-top: 8px; font-size: 13px;">
            <p><strong>Q: ${escapeHtml(q.q)}</strong></p>
            <p style="color: #93c5fd; font-size: 12px; margin-top: 2px;">💡 Recommended Response Strategy: ${escapeHtml(q.modelAnswer)}</p>
          </div>
        `).join('')}
      </div>
    `).join('');

    const starHtml = d.behavioralQuestions.map(b => `
      <div style="margin-bottom: 16px; background: rgba(15,23,42,0.6); padding: 12px; border-radius: 6px; border-left: 3px solid #f59e0b;">
        <h4 style="color: #fbbf24; margin-bottom: 8px;">${escapeHtml(b.question)}</h4>
        <div style="font-size: 12px; display: flex; flex-direction: column; gap: 4px;">
          <p><strong style="color: #38bdf8;">Situation:</strong> ${escapeHtml(b.starFramework.situation)}</p>
          <p><strong style="color: #38bdf8;">Task:</strong> ${escapeHtml(b.starFramework.task)}</p>
          <p><strong style="color: #38bdf8;">Action:</strong> ${escapeHtml(b.starFramework.action)}</p>
          <p><strong style="color: #38bdf8;">Result:</strong> ${escapeHtml(b.starFramework.result)}</p>
        </div>
      </div>
    `).join('');

    document.getElementById('modalBody').innerHTML = `
      <div>
        <h3 style="margin-bottom: 6px;">${escapeHtml(d.role)} @ ${escapeHtml(d.company)}</h3>
        <p style="color: #94a3b8; font-size: 13px; margin-bottom: 16px;">${escapeHtml(d.executiveSummary)}</p>
        
        <h3 style="color: #93c5fd; border-bottom: 1px solid #334155; padding-bottom: 4px; margin-bottom: 12px;">Technical Focus Areas</h3>
        ${topicsHtml}

        <h3 style="color: #6ee7b7; border-bottom: 1px solid #334155; padding-bottom: 4px; margin: 20px 0 12px 0;">Project Deep Dives</h3>
        ${projectsHtml}

        <h3 style="color: #fbbf24; border-bottom: 1px solid #334155; padding-bottom: 4px; margin: 20px 0 12px 0;">Behavioral STAR Frameworks</h3>
        ${starHtml}
      </div>
    `;
  } catch (err) {
    document.getElementById('modalBody').innerHTML = `<p class="text-danger">Failed to load interview prep: ${err.message}</p>`;
  }
};

window.startMockInterview = async function(jobId) {
  openModal('Interactive Mock Interview Simulator', '<div class="loading"><div class="spinner"></div><p>Configuring customized mock interview session...</p></div>');
  try {
    const resp = await fetch(`/api/job/${jobId}/prep`);
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);

    const d = data.dossier;
    const questions = [
      {
        question: 'Can you tell me about NearVia, how you implemented 5 km location matching, and how you prevented double-booking?',
        topic: 'technical',
        hint: 'Highlight PostGIS ST_DWithin on geography types with GIST indexing, and row-level locks (SELECT FOR UPDATE) inside transactional boundaries.'
      },
      {
        question: 'How did you handle transactional leave approvals in your Spring Boot Employee Leave Management System?',
        topic: 'technical',
        hint: 'Mention @Transactional, optimistic/pessimistic locking, state validation, and clean rollback mechanics.'
      },
      {
        question: 'Tell me about a challenging technical bug or performance hurdle you faced and how you resolved it.',
        topic: 'behavioral',
        hint: 'Use the STAR structure (Situation, Task, Action, Result) with measurable technical metrics.'
      }
    ];

    let currentIndex = 0;
    const sessionLog = [];

    function renderQuestionStep() {
      const q = questions[currentIndex];
      const isLast = currentIndex === questions.length - 1;

      document.getElementById('modalBody').innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div style="background: rgba(30, 41, 59, 0.7); padding: 14px; border-radius: 8px; border: 1px solid #334155;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="color: #94a3b8; font-size: 13px;">Question ${currentIndex + 1} of ${questions.length} • Target: <strong style="color: #e2e8f0;">${escapeHtml(d.role)} @ ${escapeHtml(d.company)}</strong></span>
              <span class="skill-tag skill-matched">${q.topic.toUpperCase()}</span>
            </div>
            <h3 style="color: #f8fafc; font-size: 16px; line-height: 1.4;">"${escapeHtml(q.question)}"</h3>
            <div style="margin-top: 8px; font-size: 12px; color: #93c5fd;">
              💡 <strong>Candidate Recall Tip:</strong> ${escapeHtml(q.hint)}
            </div>
          </div>

          <div id="evalFeedbackBox"></div>

          <div>
            <label style="display: block; font-size: 13px; color: #cbd5e1; margin-bottom: 6px;">Your Spoken / Technical Response:</label>
            <textarea id="candidateAnswerInput" rows="5" placeholder="Type your answer as you would speak it in the technical screen..." style="width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 10px; color: #f8fafc; font-family: inherit; font-size: 13px; line-height: 1.5;"></textarea>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <button class="btn btn-outline" id="skipQBtn">⏩ Skip Question</button>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-primary" id="evaluateAnswerBtn">⚡ Score My Answer</button>
              <button class="btn btn-primary hidden" id="nextQBtn">${isLast ? '🎉 Finish & Save Session' : 'Next Question ➡️'}</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('skipQBtn').addEventListener('click', () => {
        currentIndex++;
        if (currentIndex < questions.length) {
          renderQuestionStep();
        } else {
          renderFinalSummary();
        }
      });

      document.getElementById('evaluateAnswerBtn').addEventListener('click', async () => {
        const answer = document.getElementById('candidateAnswerInput').value.trim();
        const evalBtn = document.getElementById('evaluateAnswerBtn');
        evalBtn.disabled = true;
        evalBtn.textContent = '⏳ Evaluating...';

        try {
          const evalResp = await fetch('/api/mock/evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: q.question, answer, topic: q.topic })
          });
          const evalData = await evalResp.json();
          const res = evalData.evalResult;

          sessionLog.push({ question: q.question, answer, res });

          const scoreColor = res.score >= 8 ? '#4ade80' : res.score >= 5 ? '#facc15' : '#f87171';
          document.getElementById('evalFeedbackBox').innerHTML = `
            <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid #334155; border-radius: 8px; padding: 14px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 600; font-size: 14px;">AI Evaluator Feedback</span>
                <span style="font-size: 18px; font-weight: 700; color: ${scoreColor};">${res.score}/10</span>
              </div>
              <p style="color: #cbd5e1; font-size: 13px; margin-bottom: 8px;">${escapeHtml(res.coachingSummary)}</p>
              ${res.strengths && res.strengths.length > 0 ? `<div style="color: #4ade80; font-size: 12px; margin-bottom: 4px;">✅ <strong>Strengths:</strong> ${escapeHtml(res.strengths.join(' '))}</div>` : ''}
              ${res.suggestions && res.suggestions.length > 0 ? `<div style="color: #fbbf24; font-size: 12px;">💡 <strong>Pro-Tip:</strong> ${escapeHtml(res.suggestions.join(' '))}</div>` : ''}
            </div>
          `;

          evalBtn.classList.add('hidden');
          const nextBtn = document.getElementById('nextQBtn');
          nextBtn.classList.remove('hidden');
          nextBtn.addEventListener('click', () => {
            currentIndex++;
            if (currentIndex < questions.length) {
              renderQuestionStep();
            } else {
              renderFinalSummary();
            }
          });
        } catch (e) {
          alert('Evaluation failed: ' + e.message);
          evalBtn.disabled = false;
          evalBtn.textContent = '⚡ Score My Answer';
        }
      });
    }

    async function renderFinalSummary() {
      const total = sessionLog.reduce((acc, cur) => acc + (cur.res ? cur.res.score : 0), 0);
      const avg = sessionLog.length > 0 ? (total / sessionLog.length).toFixed(1) : 0;

      // Save to server
      try {
        await fetch('/api/mock/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId,
            round: 'Interactive Mock Interview Session',
            feedbackJson: JSON.stringify({ avgScore: avg, sessionLog })
          })
        });
      } catch (err) {
        console.error('Failed to save session:', err);
      }

      document.getElementById('modalBody').innerHTML = `
        <div style="text-align: center; padding: 20px;">
          <div style="font-size: 48px; margin-bottom: 12px;">🏆</div>
          <h2>Mock Interview Complete!</h2>
          <p style="color: #94a3b8; margin: 8px 0 16px 0;">Target: <strong>${escapeHtml(d.role)} @ ${escapeHtml(d.company)}</strong></p>
          <div style="display: inline-block; background: #1e293b; padding: 12px 24px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #334155;">
            <span style="font-size: 13px; color: #94a3b8; display: block;">Overall Interview Score</span>
            <span style="font-size: 32px; font-weight: 800; color: #60a5fa;">${avg}/10</span>
          </div>
          <div style="text-align: left; background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #334155; font-size: 13px; color: #cbd5e1; margin-bottom: 20px;">
            <strong>Session Review Summary:</strong>
            <ul style="padding-left: 20px; margin-top: 8px;">
              <li>Completed ${sessionLog.length} real technical and STAR questions.</li>
              <li>Practice session logged and linked to Job #${jobId} in SQLite vault.</li>
              <li>Review the tailored dossier before your real technical screening call.</li>
            </ul>
          </div>
          <button class="btn btn-primary" onclick="closeModal()">Close</button>
        </div>
      `;
    }

    renderQuestionStep();
  } catch (err) {
    document.getElementById('modalBody').innerHTML = `<p class="text-danger">Failed to start mock interview: ${err.message}</p>`;
  }
};

window.openReferralAssistant = async function(jobId) {
  openModal('Generate Referral Outreach Message', '<div class="loading"><div class="spinner"></div><p>Drafting personalized referral messages...</p></div>');
  try {
    const fetchMsg = async (type) => {
      const resp = await fetch(`/api/job/${jobId}/referral`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientType: type, recipientName: 'Hi' })
      });
      return await resp.json();
    };

    const alumni = await fetchMsg('alumni');
    const recruiter = await fetchMsg('recruiter');
    const engineer = await fetchMsg('engineer');

    document.getElementById('modalBody').innerHTML = `
      <div>
        <p style="color: #94a3b8; font-size: 13px; margin-bottom: 16px;">Select a channel and copy the tailored referral message to reach out to contacts at this company.</p>
        
        <div style="margin-bottom: 20px;">
          <h4 style="color: #93c5fd; margin-bottom: 6px;">1. To College Alumni (AIMS Institutes Network)</h4>
          <pre id="alumniText" style="background: #0f172a; padding: 12px; border-radius: 6px; font-size: 12px; line-height: 1.4; white-space: pre-wrap; color: #e2e8f0; border: 1px solid #334155;">${escapeHtml(alumni.referral.message)}</pre>
          <button class="btn btn-outline btn-sm" style="margin-top: 6px;" onclick="navigator.clipboard.writeText(document.getElementById('alumniText').innerText); alert('Copied alumni outreach message!');">📋 Copy Alumni Message</button>
        </div>

        <div style="margin-bottom: 20px;">
          <h4 style="color: #6ee7b7; margin-bottom: 6px;">2. To Talent Acquisition / Recruiter</h4>
          <pre id="recruiterText" style="background: #0f172a; padding: 12px; border-radius: 6px; font-size: 12px; line-height: 1.4; white-space: pre-wrap; color: #e2e8f0; border: 1px solid #334155;">${escapeHtml(recruiter.referral.message)}</pre>
          <button class="btn btn-outline btn-sm" style="margin-top: 6px;" onclick="navigator.clipboard.writeText(document.getElementById('recruiterText').innerText); alert('Copied recruiter outreach message!');">📋 Copy Recruiter Message</button>
        </div>

        <div>
          <h4 style="color: #fbbf24; margin-bottom: 6px;">3. To Peer Engineer on LinkedIn</h4>
          <pre id="peerText" style="background: #0f172a; padding: 12px; border-radius: 6px; font-size: 12px; line-height: 1.4; white-space: pre-wrap; color: #e2e8f0; border: 1px solid #334155;">${escapeHtml(engineer.referral.message)}</pre>
          <button class="btn btn-outline btn-sm" style="margin-top: 6px;" onclick="navigator.clipboard.writeText(document.getElementById('peerText').innerText); alert('Copied peer message!');">📋 Copy Peer Message</button>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('modalBody').innerHTML = `<p class="text-danger">Failed to generate referral messages: ${err.message}</p>`;
  }
};

window.setJobStatus = async function(jobId, newStatus) {
  try {
    const resp = await fetch('/api/job/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, newStatus })
    });
    if (resp.ok) {
      await loadStats();
      await loadJobs();
    }
  } catch (err) {
    alert('Error updating status: ' + err.message);
  }
};

function renderProfileHtml(profile) {
  const p = profile.personal || {};
  const ed = (profile.education || []).map(e => `
    <li style="margin-bottom: 8px;">
      <strong>${escapeHtml(e.degree)}</strong> – ${escapeHtml(e.institution)} (${escapeHtml(e.period)})<br>
      <small style="color: var(--text-muted);">${escapeHtml(e.status)} ${e.highlights ? `• ${escapeHtml(e.highlights)}` : ''}</small>
    </li>
  `).join('');

  const exp = (profile.experience || []).map(x => `
    <li style="margin-bottom: 8px;">
      <strong>${escapeHtml(x.role)}</strong> – ${escapeHtml(x.company)} (${escapeHtml(x.period)})<br>
      <small style="color: var(--text-muted);">${(x.bullets || []).join(' ')}</small>
    </li>
  `).join('');

  const proj = (profile.projects || []).map(pr => `
    <li style="margin-bottom: 12px;">
      <strong>${escapeHtml(pr.name)}</strong> ${pr.url ? `(<a href="${escapeHtml(pr.url)}" target="_blank" style="color: var(--primary);">link</a>)` : ''}<br>
      <small style="color: #93c5fd;">Stack: ${(pr.techStack || []).join(', ')}</small><br>
      <small style="color: var(--text-muted);">${(pr.bullets || []).join(' ')}</small>
    </li>
  `).join('');

  return `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <div>
        <h3>${escapeHtml(p.fullName)}</h3>
        <p style="color: var(--text-muted); font-size: 13px;">${escapeHtml(p.email)} | ${escapeHtml(p.phone)} | ${escapeHtml(p.location)}</p>
        <p style="margin-top: 6px; font-style: italic; color: #cbd5e1;">"${escapeHtml(profile.summary)}"</p>
      </div>
      <div>
        <h4 style="color: #93c5fd; border-bottom: 1px solid var(--border); padding-bottom: 4px; margin-bottom: 8px;">Education</h4>
        <ul style="padding-left: 18px;">${ed}</ul>
      </div>
      <div>
        <h4 style="color: #93c5fd; border-bottom: 1px solid var(--border); padding-bottom: 4px; margin-bottom: 8px;">Experience</h4>
        <ul style="padding-left: 18px;">${exp}</ul>
      </div>
      <div>
        <h4 style="color: #93c5fd; border-bottom: 1px solid var(--border); padding-bottom: 4px; margin-bottom: 8px;">Projects</h4>
        <ul style="padding-left: 18px;">${proj}</ul>
      </div>
      <div>
        <h4 style="color: #93c5fd; border-bottom: 1px solid var(--border); padding-bottom: 4px; margin-bottom: 8px;">Certifications & Achievements</h4>
        <ul style="padding-left: 18px;">
          ${(profile.achievements || []).map(a => `<li>🏆 ${escapeHtml(a)}</li>`).join('')}
          ${(profile.certifications || []).map(c => `<li>📜 ${escapeHtml(c.title)} (${escapeHtml(c.issuer)})</li>`).join('')}
        </ul>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ========================================================
   AI RESUME STUDIO CLIENT CONTROLLER
   ======================================================== */
let studioState = {
  job: null,
  jdAnalysis: null,
  content: null,
  atsScore: null,
  template: 'ats_professional',
  versions: [],
  activeVersionId: null,
  comparison: null
};

window.openResumeStudio = async function(jobId) {
  const modal = document.getElementById('resumeStudioModal');
  modal.classList.remove('hidden');

  document.getElementById('studioJobTitle').textContent = 'Loading Job & JD Analysis...';
  const compatEl = document.getElementById('resumeCompatValue');
  if (compatEl) compatEl.textContent = '--';
  const overallEl = document.getElementById('overallScoreValue');
  if (overallEl) overallEl.textContent = '-- / 100';
  const legacyScoreEl = document.getElementById('atsScoreValue');
  if (legacyScoreEl) legacyScoreEl.textContent = '--';
  document.getElementById('atsScoreBar').style.width = '0%';
  document.getElementById('atsCategoryBreakdownList').innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const resp = await fetch(`/api/resume/studio-data/${jobId}`);
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);

    studioState.job = data.job;
    studioState.jdAnalysis = data.jdAnalysis;
    studioState.content = data.initialStudio.content;
    studioState.atsScore = data.initialStudio.atsScore;
    studioState.template = data.initialStudio.template || 'ats_professional';
    studioState.versions = data.versions || [];
    studioState.comparison = data.initialStudio.comparison;
    studioState.activeVersionId = data.versions.length > 0 ? data.versions[0].id : null;

    initStudioUi();
  } catch (err) {
    alert('Failed to load AI Resume Studio: ' + err.message);
    modal.classList.add('hidden');
  }
};

function initStudioUi() {
  const { job, jdAnalysis, content, atsScore, template, versions, comparison } = studioState;

  // Header
  document.getElementById('studioJobTitle').textContent = `${job.title} @ ${job.company}`;
  document.getElementById('studioLocation').textContent = `📍 ${job.location || 'India'}`;
  const jobUrlEl = document.getElementById('studioJobUrl');
  jobUrlEl.href = job.url;
  jobUrlEl.target = '_blank';

  // Template select
  const tmplSelect = document.getElementById('studioTemplateSelect');
  tmplSelect.value = template;
  tmplSelect.onchange = (e) => {
    studioState.template = e.target.value;
    updateResumePreview();
  };

  // Generation mode
  document.getElementById('atsGenerationMode').textContent = `Mode: Local Deterministic Engine (Zero Fabrication)`;

  // Scorecard
  renderAtsScorecard(atsScore);

  // Editor Inputs
  document.getElementById('editSummary').value = content.summary || '';
  const skills = content.technicalSkills || {};
  document.getElementById('editLanguages').value = (skills.languages || []).join(', ');
  document.getElementById('editBackend').value = (skills.backend || []).join(', ');
  document.getElementById('editFrontend').value = (skills.frontend || []).join(', ');
  document.getElementById('editDatabases').value = (skills.databases || []).join(', ');

  // Projects in editor
  const projContainer = document.getElementById('editProjectsContainer');
  projContainer.innerHTML = (content.projects || []).map((proj, idx) => `
    <div style="background: #0f172a; padding: 10px; border-radius: 6px; border: 1px solid #334155; margin-bottom: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
        <strong style="color: #93c5fd; font-size: 12px;">${escapeHtml(proj.name)}</strong>
        <small style="color: #64748b; font-size: 11px;">Stack: ${(proj.techStack || []).join(', ')}</small>
      </div>
      <textarea id="editProjBullets_${idx}" rows="2" style="width: 100%; font-size: 11px; background: #1e293b; border: 1px solid #334155; color: #e2e8f0; padding: 6px; border-radius: 4px;">${(proj.bullets || []).join('\n')}</textarea>
    </div>
  `).join('');

  // Before & After Diff
  renderDiffView(comparison);

  // Original JD Tab
  renderJdTab(job, jdAnalysis);

  // Live Preview Frame
  updateResumePreview();

  // Version Vault
  renderVersionVault(versions);

  // Setup tab buttons
  document.querySelectorAll('.studio-tab').forEach(tabBtn => {
    tabBtn.onclick = (e) => {
      document.querySelectorAll('.studio-tab').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const target = e.target.dataset.tab;
      document.getElementById('tabEditor').classList.toggle('hidden', target !== 'editor');
      document.getElementById('tabDiff').classList.toggle('hidden', target !== 'diff');
      document.getElementById('tabJd').classList.toggle('hidden', target !== 'jd');
    };
  });

  // Recalculate Score Button
  document.getElementById('recalculateScoreBtn').onclick = async () => {
    collectEditorContent();
    const btn = document.getElementById('recalculateScoreBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Recalculating...';

    try {
      const resp = await fetch('/api/resume/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jdAnalysis: studioState.jdAnalysis,
          resumeContent: studioState.content
        })
      });
      const data = await resp.json();
      if (data.success) {
        studioState.atsScore = data.atsScore;
        renderAtsScorecard(data.atsScore);
        updateResumePreview();
      }
    } catch (err) {
      alert('Recalculation error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '⚡ Recalculate ATS Score';
    }
  };

  // Save Version Button
  document.getElementById('studioSaveVersionBtn').onclick = async () => {
    collectEditorContent();
    const saveBtn = document.getElementById('studioSaveVersionBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = '💾 Saving...';

    try {
      const resp = await fetch('/api/resume/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: studioState.job.id,
          company: studioState.job.company,
          jobTitle: studioState.job.title,
          jdSnapshot: studioState.job.description,
          template: studioState.template,
          generationMode: 'Local Deterministic Engine',
          content: studioState.content,
          atsScore: studioState.atsScore.totalScore,
          atsBreakdown: studioState.atsScore.categories,
          missingKeywords: studioState.atsScore.keywordAnalysis.missingMandatory,
          matchedKeywords: studioState.atsScore.keywordAnalysis.matchedKeywords
        })
      });
      const data = await resp.json();
      if (data.success) {
        studioState.activeVersionId = data.version.id;
        // Refresh versions
        const vResp = await fetch(`/api/resume/versions/${studioState.job.id}`);
        const vData = await vResp.json();
        studioState.versions = vData.versions || [];
        renderVersionVault(studioState.versions);
        alert(`✅ Saved version v${data.version.version_number} with ATS Score: ${data.version.ats_score}/100!`);
      } else {
        const auditDetails = (data.audit && data.audit.warnings && data.audit.warnings.length > 0)
          ? '\n\nFlagged Claims:\n• ' + data.audit.warnings.join('\n• ')
          : '';
        alert(`⛔ Truthfulness Auditor Blocked Save:\n${data.error}${auditDetails}`);
      }
    } catch (err) {
      alert('Failed to save version: ' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Save Version';
    }
  };

  // Approve Version Button
  document.getElementById('studioApproveBtn').onclick = async () => {
    if (!studioState.activeVersionId) {
      alert('Please save this resume version first before approving.');
      return;
    }
    try {
      const resp = await fetch(`/api/resume/approve/${studioState.activeVersionId}`, { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        alert(`🎉 Resume v${data.version.version_number} approved! Job #${data.version.job_id} updated to "Ready to Apply".`);
        // Refresh version vault and dashboard
        const vResp = await fetch(`/api/resume/versions/${studioState.job.id}`);
        const vData = await vResp.json();
        studioState.versions = vData.versions || [];
        renderVersionVault(studioState.versions);
        await loadStats();
        await loadJobs();
      } else {
        const auditDetails = (data.audit && data.audit.warnings && data.audit.warnings.length > 0)
          ? '\n\nFlagged Claims:\n• ' + data.audit.warnings.join('\n• ')
          : '';
        alert(`⛔ Truthfulness Auditor Blocked Approval:\n${data.error}${auditDetails}`);
      }
    } catch (err) {
      alert('Approval failed: ' + err.message);
    }
  };

  // Download PDF / DOCX Buttons
  document.getElementById('downloadPdfBtn').onclick = () => {
    if (studioState.activeVersionId) {
      window.location.href = `/api/resume/download/${studioState.activeVersionId}/pdf`;
    } else {
      alert('Please click "💾 Save Version" first to compile and download your tailored PDF.');
    }
  };

  document.getElementById('downloadDocxBtn').onclick = () => {
    if (studioState.activeVersionId) {
      window.location.href = `/api/resume/download/${studioState.activeVersionId}/docx`;
    } else {
      alert('Please click "💾 Save Version" first to export your tailored DOCX.');
    }
  };

  // Close Studio Modal
  document.getElementById('closeStudioBtn').onclick = () => {
    document.getElementById('resumeStudioModal').classList.add('hidden');
  };
}

function collectEditorContent() {
  const content = studioState.content;
  content.summary = document.getElementById('editSummary').value.trim();

  const parseCsv = (val) => val.split(',').map(s => s.trim()).filter(Boolean);
  content.technicalSkills.languages = parseCsv(document.getElementById('editLanguages').value);
  content.technicalSkills.backend = parseCsv(document.getElementById('editBackend').value);
  content.technicalSkills.frontend = parseCsv(document.getElementById('editFrontend').value);
  content.technicalSkills.databases = parseCsv(document.getElementById('editDatabases').value);

  // Collect project bullets
  (content.projects || []).forEach((proj, idx) => {
    const el = document.getElementById(`editProjBullets_${idx}`);
    if (el) {
      proj.bullets = el.value.split('\n').map(s => s.trim()).filter(Boolean);
    }
  });
}

function renderAtsScorecard(ats) {
  const compatVal = ats.resumeCompatibilityScore || ats.totalScore || 0;
  const overallVal = ats.overallMatch?.overallScore || ats.totalScore || 0;
  const elig = ats.eligibilityAssessment || {
    status: 'ELIGIBLE',
    label: 'Eligible',
    badgeClass: 'eligible',
    unmetMandatoryRequirements: []
  };

  // Indicator A: Resume Compatibility Score
  const compatEl = document.getElementById('resumeCompatValue');
  if (compatEl) {
    compatEl.textContent = compatVal;
    compatEl.style.color = compatVal >= 80 ? '#10b981' : compatVal >= 60 ? '#38bdf8' : compatVal >= 40 ? '#f59e0b' : '#ef4444';
  }

  const legacyScoreEl = document.getElementById('atsScoreValue');
  if (legacyScoreEl) {
    legacyScoreEl.textContent = compatVal;
  }

  // Indicator B: Eligibility Assessment
  const eligBadge = document.getElementById('eligibilityBadge');
  const eligSummary = document.getElementById('eligibilitySummary');
  if (eligBadge) {
    eligBadge.className = `eligibility-badge ${elig.badgeClass || 'eligible'}`;
    eligBadge.textContent = elig.label || 'Eligible';
  }
  if (eligSummary) {
    if (elig.status === 'MANDATORY_NOT_MET') {
      eligSummary.textContent = 'Screening filter rejection likely';
      eligSummary.style.color = '#f87171';
    } else if (elig.status === 'POTENTIAL_STRETCH') {
      eligSummary.textContent = '2 yrs exp required (Stretch opportunity)';
      eligSummary.style.color = '#fbbf24';
    } else if (elig.status === 'INSUFFICIENT_INFO') {
      eligSummary.textContent = 'Experience unstated in posting';
      eligSummary.style.color = '#93c5fd';
    } else {
      eligSummary.textContent = 'Fresher / 0–1 yrs verified';
      eligSummary.style.color = '#4ade80';
    }
  }

  // Mandatory Unmet Alert Banner
  const alertBox = document.getElementById('mandatoryAlertBox');
  const alertList = document.getElementById('mandatoryUnmetList');
  if (alertBox && alertList) {
    if (elig.unmetMandatoryRequirements && elig.unmetMandatoryRequirements.length > 0) {
      alertBox.classList.remove('hidden');
      alertList.innerHTML = elig.unmetMandatoryRequirements.map(u => `<li>${escapeHtml(u)}</li>`).join('');
    } else {
      alertBox.classList.add('hidden');
      alertList.innerHTML = '';
    }
  }

  // Overall Match Score & Progress Bar
  const overallEl = document.getElementById('overallScoreValue');
  const barEl = document.getElementById('atsScoreBar');
  if (overallEl) {
    overallEl.textContent = `${overallVal} / 100`;
    overallEl.style.color = overallVal >= 75 ? '#10b981' : overallVal >= 50 ? '#38bdf8' : overallVal >= 40 ? '#f59e0b' : '#ef4444';
  }
  if (barEl) {
    barEl.style.width = `${Math.min(100, Math.max(0, overallVal))}%`;
    barEl.style.background = overallVal >= 75 ? '#10b981' : overallVal >= 50 ? '#38bdf8' : overallVal >= 40 ? '#f59e0b' : '#ef4444';
  }

  // Categories
  const cats = ats.categories || {};
  const catList = document.getElementById('atsCategoryBreakdownList');
  const categoryNames = [
    { key: 'requiredSkillCoverage', label: 'Required Skills Coverage', max: 30 },
    { key: 'technicalRelevance', label: 'Technical Stack Relevance', max: 20 },
    { key: 'experienceEligibility', label: 'Experience & Seniority Fit', max: 15 },
    { key: 'educationMatch', label: 'Education / Qualification', max: 10 },
    { key: 'projectRelevance', label: 'Hands-on Project Evidence', max: 10 },
    { key: 'atsReadability', label: 'ATS Structure & Readability', max: 10 },
    { key: 'achievementsAndClarity', label: 'Achievements & Verified Honors', max: 5 }
  ];

  catList.innerHTML = categoryNames.map(c => {
    const catData = cats[c.key] || { score: 0, reason: '' };
    const pct = Math.round((catData.score / c.max) * 100);
    return `
      <div class="cat-item">
        <div class="cat-item-top">
          <span>${c.label}</span>
          <strong style="color: ${pct >= 70 ? '#4ade80' : pct >= 40 ? '#facc15' : '#f87171'};">${catData.score} / ${c.max}</strong>
        </div>
        <div class="cat-item-bar">
          <div class="cat-item-fill" style="width: ${pct}%; background: ${pct >= 70 ? '#4ade80' : pct >= 40 ? '#facc15' : '#f87171'};"></div>
        </div>
        <div class="cat-item-reason">${escapeHtml(catData.reason || '')}</div>
      </div>
    `;
  }).join('');

  // Keywords
  const kw = ats.keywordAnalysis || {};
  const renderTags = (id, list, cls) => {
    const container = document.getElementById(id);
    if (!list || list.length === 0) {
      container.innerHTML = '<span style="color: #64748b; font-size: 11px;">None</span>';
      return;
    }
    container.innerHTML = list.map(item => `<span class="skill-tag ${cls}">${escapeHtml(item)}</span>`).join('');
  };

  renderTags('matchedKeywordsTags', kw.matchedKeywords, 'skill-matched');
  renderTags('missingMandatoryTags', kw.missingMandatory, 'skill-missing');
  renderTags('missingPreferredTags', kw.missingPreferred, 'skill-missing');
  renderTags('omittedProfileTags', kw.presentInProfileButOmitted, 'skill-matched');

  // Suggestions
  const sugList = document.getElementById('atsSuggestionsList');
  const sugs = ats.suggestions || [];
  if (sugs.length === 0) {
    sugList.innerHTML = '<li>🌟 Outstanding resume alignment! All mandatory requirements verified.</li>';
  } else {
    sugList.innerHTML = sugs.map(s => `<li>${escapeHtml(s)}</li>`).join('');
  }
}

function renderDiffView(comp) {
  const container = document.getElementById('diffContainer');
  if (!comp || !comp.changes || comp.changes.length === 0) {
    container.innerHTML = '<p style="color: #94a3b8; font-size: 12px;">No structural changes from master profile.</p>';
    return;
  }

  container.innerHTML = comp.changes.map(c => `
    <div class="diff-card">
      <h4>${escapeHtml(c.section)}</h4>
      <div class="diff-row">
        <div class="diff-col">
          <strong>Master Profile</strong>
          <div style="color: #94a3b8;">${escapeHtml(c.master)}</div>
        </div>
        <div class="diff-col">
          <strong style="color: #38bdf8;">JD Tailored Version</strong>
          <div style="color: #f8fafc;">${escapeHtml(c.tailored)}</div>
        </div>
      </div>
      <div class="diff-reason">💡 <strong>Reason for Modification:</strong> ${escapeHtml(c.reason)}</div>
    </div>
  `).join('');
}

function renderJdTab(job, jd) {
  const metaEl = document.getElementById('jdExtractedMeta');
  metaEl.innerHTML = `
    <div style="background: #1e293b; padding: 12px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 12px; font-size: 12px;">
      <div style="color: #38bdf8; font-weight: 600; margin-bottom: 6px;">Parsed JD Requirements:</div>
      <p><strong>Required Skills:</strong> ${(jd.requiredSkills || []).join(', ') || 'N/A'}</p>
      <p><strong>Preferred Skills:</strong> ${(jd.preferredSkills || []).join(', ') || 'N/A'}</p>
      <p><strong>Experience:</strong> ${jd.experience.rawText} (${jd.experience.isFresherEligible ? '✅ Fresher Eligible' : '❌ Senior Level'})</p>
      <p><strong>Education:</strong> ${(jd.education.degrees || []).join(', ')}</p>
    </div>
  `;
  document.getElementById('jdFullText').textContent = job.description || 'No job description text provided.';
}

function updateResumePreview() {
  const iframe = document.getElementById('resumePreviewIframe');
  const html = buildClientPreviewHtml(studioState.content, studioState.template);
  iframe.srcdoc = html;
}

function buildClientPreviewHtml(content, template) {
  const p = content.personal || {};
  const s = content.summary || '';
  const skills = content.technicalSkills || {};
  const exp = content.experience || [];
  const projects = content.projects || [];
  const edu = content.education || [];
  const certs = content.certificationsAndAwards || [];

  const isModern = template === 'modern_professional';
  const isCompact = template === 'compact_one_page';

  const font = isModern ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' : 'Arial, sans-serif';
  const primaryColor = isModern ? '#1e3a8a' : '#000000';
  const baseSize = isCompact ? '8.5pt' : '9.5pt';
  const lineH = isCompact ? '1.25' : '1.35';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: ${font}; color: #111; line-height: ${lineH}; font-size: ${baseSize}; margin: 0; padding: 16px 20px; background: #fff; }
  h1 { font-size: ${isCompact ? '14pt' : '17pt'}; margin: 0 0 2px 0; text-transform: uppercase; color: #000; text-align: center; }
  .contact { font-size: 8.5pt; color: #333; text-align: center; margin-bottom: 8px; border-bottom: 1.5px solid ${primaryColor}; padding-bottom: 6px; }
  h2 { font-size: ${isCompact ? '9pt' : '10.5pt'}; color: ${primaryColor}; text-transform: uppercase; border-bottom: 1px solid #444; margin: 8px 0 3px 0; padding-bottom: 1px; }
  .title-row { font-size: ${baseSize}; font-weight: bold; margin-top: 4px; }
  .sub-row { font-size: 8pt; font-style: italic; color: #444; margin-bottom: 2px; }
  ul { margin: 1px 0 4px 16px; padding: 0; }
  li { margin-bottom: 1px; }
  p { margin: 2px 0; }
</style>
</head>
<body>
  <h1>${escapeHtml(p.fullName || 'Abhishek N')}</h1>
  <div class="contact">
    ${escapeHtml(p.location || 'Bangalore, India')} | ${escapeHtml(p.phone || '')} | ${escapeHtml(p.email || '')}<br>
    ${escapeHtml(p.linkedIn || '')} | ${escapeHtml(p.gitHub || '')} | ${escapeHtml(p.portfolio || '')}
  </div>

  <h2>Professional Summary</h2>
  <p>${escapeHtml(s)}</p>

  <h2>Technical Skills</h2>
  <p><strong>Languages:</strong> ${(skills.languages || []).join(', ')}</p>
  <p><strong>Backend & Java:</strong> ${(skills.backend || []).join(', ')}</p>
  <p><strong>Frontend:</strong> ${(skills.frontend || []).join(', ')}</p>
  <p><strong>Databases:</strong> ${(skills.databases || []).join(', ')}</p>

  <h2>Professional Experience</h2>
  ${exp.map(e => `
    <div class="title-row">${escapeHtml(e.role)} — ${escapeHtml(e.company)} (${escapeHtml(e.period)})</div>
    <ul>${(e.bullets || []).map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
  `).join('')}

  <h2>Relevant Projects</h2>
  ${projects.map(pr => `
    <div class="title-row">${escapeHtml(pr.name)} ${pr.url ? `| ${escapeHtml(pr.url)}` : ''}</div>
    <div class="sub-row">Stack: ${(pr.techStack || []).join(', ')}</div>
    <ul>${(pr.bullets || []).map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
  `).join('')}

  <h2>Education</h2>
  ${edu.map(ed => `
    <div class="title-row">${escapeHtml(ed.degree)} — ${escapeHtml(ed.institution)} (${escapeHtml(ed.period)})</div>
    ${ed.highlights ? `<div class="sub-row">${escapeHtml(ed.highlights)}</div>` : ''}
  `).join('')}

  <h2>Certifications & Awards</h2>
  <ul>${certs.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
</body>
</html>`;
}

function renderVersionVault(versions) {
  const countTag = document.getElementById('versionCountTag');
  countTag.textContent = `${versions.length} version(s)`;

  const listEl = document.getElementById('versionList');
  if (versions.length === 0) {
    listEl.innerHTML = '<div style="color: #64748b; font-size: 11px; padding: 6px;">No saved versions yet. Click "💾 Save Version" above.</div>';
    return;
  }

  listEl.innerHTML = versions.map(v => `
    <div class="version-item ${v.is_approved ? 'approved' : ''}">
      <div class="version-item-left">
        <span class="v-badge">v${v.version_number}</span>
        <span class="v-score">ATS: ${v.ats_score}/100</span>
        <span style="font-size: 10px; color: #94a3b8;">${escapeHtml(v.template)}</span>
        ${v.is_approved ? '<span class="v-approved-badge">✓ Approved</span>' : ''}
      </div>
      <div class="version-item-actions">
        <a href="/api/resume/download/${v.id}/pdf" class="btn btn-outline btn-sm" style="font-size: 10px; padding: 2px 6px;">PDF</a>
        <a href="/api/resume/download/${v.id}/docx" class="btn btn-outline btn-sm" style="font-size: 10px; padding: 2px 6px;">DOCX</a>
        <button class="btn btn-outline btn-sm" style="font-size: 10px; padding: 2px 6px;" onclick="duplicateVersion(${v.id})">📋 Copy</button>
        <button class="btn btn-outline btn-sm" style="font-size: 10px; padding: 2px 6px; color: #ef4444;" onclick="deleteVersion(${v.id})">🗑️</button>
      </div>
    </div>
  `).join('');
}

window.duplicateVersion = async function(versionId) {
  try {
    const resp = await fetch(`/api/resume/duplicate/${versionId}`, { method: 'POST' });
    const data = await resp.json();
    if (data.success) {
      const vResp = await fetch(`/api/resume/versions/${studioState.job.id}`);
      const vData = await vResp.json();
      studioState.versions = vData.versions || [];
      renderVersionVault(studioState.versions);
    }
  } catch (err) {
    alert('Duplicate error: ' + err.message);
  }
};

window.deleteVersion = async function(versionId) {
  if (!confirm('Are you sure you want to delete this resume version?')) return;
  try {
    const resp = await fetch(`/api/resume/version/${versionId}`, { method: 'DELETE' });
    const data = await resp.json();
    if (data.success) {
      const vResp = await fetch(`/api/resume/versions/${studioState.job.id}`);
      const vData = await vResp.json();
      studioState.versions = vData.versions || [];
      renderVersionVault(studioState.versions);
    }
  } catch (err) {
    alert('Delete error: ' + err.message);
  }
};

/* ========================================================
   PHASE 4: COMMUNICATIONS & CALENDAR HUB CONTROLLER
   ======================================================== */
let commsHubState = {
  activeTab: 'emails',
  summary: null,
  recentEmails: [],
  pendingDrafts: [],
  upcomingInterviews: [],
  pendingReminders: []
};

// Wire modal close and action buttons
document.addEventListener('DOMContentLoaded', () => {
  const closeCommsBtn = document.getElementById('closeCommsBtn');
  if (closeCommsBtn) {
    closeCommsBtn.addEventListener('click', () => {
      document.getElementById('commsModal').classList.add('hidden');
    });
  }

  const syncBtn = document.getElementById('syncEmailsBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', syncEmails);
  }

  const oauthBtn = document.getElementById('oauthSettingsBtn');
  if (oauthBtn) {
    oauthBtn.addEventListener('click', openOAuthModal);
  }
});

window.openCommsHubModal = async function(activeTab = 'emails') {
  commsHubState.activeTab = activeTab;
  const modal = document.getElementById('commsModal');
  modal.classList.remove('hidden');

  const bodyEl = document.getElementById('commsModalBody');
  bodyEl.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading communication hub & calendar data...</p></div>';

  try {
    const resp = await fetch('/api/communications/summary');
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);

    commsHubState.summary = data.summary;
    commsHubState.recentEmails = data.recentEmails || [];
    commsHubState.pendingDrafts = data.pendingDrafts || [];
    commsHubState.upcomingInterviews = data.upcomingInterviews || [];
    commsHubState.pendingReminders = data.pendingReminders || [];

    renderCommsHub();
  } catch (err) {
    bodyEl.innerHTML = `<p class="text-danger">Failed to load communications hub: ${err.message}</p>`;
  }
};

function renderCommsHub() {
  const bodyEl = document.getElementById('commsModalBody');
  const s = commsHubState.summary || {};
  const oauth = s.oauth || {};

  const oauthBadge = oauth.authenticated
    ? '<span style="background: rgba(34, 197, 94, 0.15); color: #4ade80; padding: 4px 10px; border-radius: 4px; font-weight: 600; font-size: 12px;">🟢 Google Connected (Gmail + Calendar)</span>'
    : '<span style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; padding: 4px 10px; border-radius: 4px; font-size: 12px;">⚪ Local Mode (Synthetic / Offline Active)</span>';

  bodyEl.innerHTML = `
    <!-- Top Summary Strip -->
    <div style="background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 14px; margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div>
          <span style="font-size: 13px; color: #94a3b8;">OAuth Status:</span>
          ${oauthBadge}
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-outline btn-sm" onclick="syncEmails()">🔄 Sync Now</button>
          <button class="btn btn-outline btn-sm" onclick="openOAuthModal()">⚙️ Settings</button>
        </div>
      </div>

      <!-- Quick Metrics Grid -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
        <div style="background: #1e293b; padding: 10px; border-radius: 6px; text-align: center; border-left: 3px solid #3b82f6;">
          <div style="font-size: 20px; font-weight: 700; color: #93c5fd;">${commsHubState.recentEmails.length}</div>
          <div style="font-size: 11px; color: #94a3b8;">Recruiter Emails</div>
        </div>
        <div style="background: #1e293b; padding: 10px; border-radius: 6px; text-align: center; border-left: 3px solid #10b981;">
          <div style="font-size: 20px; font-weight: 700; color: #6ee7b7;">${commsHubState.upcomingInterviews.length}</div>
          <div style="font-size: 11px; color: #94a3b8;">Scheduled Interviews</div>
        </div>
        <div style="background: #1e293b; padding: 10px; border-radius: 6px; text-align: center; border-left: 3px solid #f59e0b;">
          <div style="font-size: 20px; font-weight: 700; color: #fcd34d;">${commsHubState.pendingReminders.length}</div>
          <div style="font-size: 11px; color: #94a3b8;">Pending Follow-Ups</div>
        </div>
        <div style="background: #1e293b; padding: 10px; border-radius: 6px; text-align: center; border-left: 3px solid #a855f7;">
          <div style="font-size: 20px; font-weight: 700; color: #d8b4fe;">${commsHubState.pendingDrafts.length}</div>
          <div style="font-size: 11px; color: #94a3b8;">Drafts Awaiting Approval</div>
        </div>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div style="display: flex; gap: 8px; border-bottom: 1px solid #334155; margin-bottom: 16px;">
      <button class="filter-tab ${commsHubState.activeTab === 'emails' ? 'active' : ''}" onclick="switchCommsTab('emails')">📬 Recruiter Emails (${commsHubState.recentEmails.length})</button>
      <button class="filter-tab ${commsHubState.activeTab === 'calendar' ? 'active' : ''}" onclick="switchCommsTab('calendar')">📅 Interviews & Calendar (${commsHubState.upcomingInterviews.length})</button>
      <button class="filter-tab ${commsHubState.activeTab === 'reminders' ? 'active' : ''}" onclick="switchCommsTab('reminders')">⏰ Follow-Ups (${commsHubState.pendingReminders.length})</button>
      <button class="filter-tab ${commsHubState.activeTab === 'drafts' ? 'active' : ''}" onclick="switchCommsTab('drafts')">✍️ Pending Drafts (${commsHubState.pendingDrafts.length})</button>
    </div>

    <!-- Tab Content -->
    <div id="commsTabContent">
      ${renderTabContent()}
    </div>
  `;
}

window.switchCommsTab = function(tabName) {
  commsHubState.activeTab = tabName;
  renderCommsHub();
};

function renderTabContent() {
  switch (commsHubState.activeTab) {
    case 'calendar':
      return renderCalendarTab();
    case 'reminders':
      return renderRemindersTab();
    case 'drafts':
      return renderDraftsTab();
    case 'emails':
    default:
      return renderEmailsTab();
  }
}

function renderEmailsTab() {
  const emails = commsHubState.recentEmails;
  if (emails.length === 0) {
    return `
      <div style="text-align: center; padding: 40px; color: #94a3b8;">
        <p>No recruiter emails synchronized yet.</p>
        <button class="btn btn-outline btn-sm" style="margin-top: 12px;" onclick="syncEmails()">🔄 Sync Now</button>
      </div>
    `;
  }

  return emails.map(e => {
    let ext = {};
    try { ext = e.extracted_data_json ? JSON.parse(e.extracted_data_json) : {}; } catch {}

    const categoryBadges = {
      INTERVIEW_INVITATION: '<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">🎉 INTERVIEW INVITATION</span>',
      ASSESSMENT: '<span style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">💻 CODING ASSESSMENT</span>',
      OFFER: '<span style="background: rgba(168, 85, 247, 0.15); color: #c084fc; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">🌟 JOB OFFER</span>',
      REJECTION: '<span style="background: rgba(239, 68, 68, 0.15); color: #f87171; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">⛔ REJECTION</span>',
      APPLICATION_ACKNOWLEDGED: '<span style="background: rgba(148, 163, 184, 0.15); color: #cbd5e1; padding: 2px 8px; border-radius: 4px; font-size: 11px;">📄 ACKNOWLEDGED</span>',
      RECRUITER_REQUEST: '<span style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">❓ RECRUITER REQUEST</span>',
      UNCERTAIN_MANUAL_REVIEW: '<span style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">⚠️ MANUAL REVIEW</span>'
    };

    const badge = categoryBadges[e.category] || '<span style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 11px;">GENERAL</span>';
    const comp = e.job_company || ext.company || 'Unknown Company';
    const role = e.job_title || ext.role || 'Software Role';

    return `
      <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 14px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <div>
            <span style="font-weight: 600; font-size: 14px; color: #f1f5f9;">${escapeHtml(e.subject)}</span>
            <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">
              From: <strong style="color: #cbd5e1;">${escapeHtml(e.sender)}</strong> • ${new Date(e.received_at || e.created_at).toLocaleDateString()}
            </div>
          </div>
          <div>${badge}</div>
        </div>

        <!-- Extracted Metadata -->
        <div style="background: #0f172a; padding: 10px; border-radius: 6px; margin: 8px 0; font-size: 12px; color: #cbd5e1; display: flex; flex-wrap: wrap; gap: 14px;">
          <div>🏢 <strong>Company:</strong> ${escapeHtml(comp)}</div>
          <div>💼 <strong>Role:</strong> ${escapeHtml(role)}</div>
          ${ext.recruiter?.name ? `<div>👤 <strong>Recruiter:</strong> ${escapeHtml(ext.recruiter.name)}</div>` : ''}
          ${ext.interview?.rawTime ? `<div>🕒 <strong>Schedule:</strong> ${escapeHtml(ext.interview.rawDate || '')} at ${escapeHtml(ext.interview.rawTime)} (${ext.interview.timezone})</div>` : ''}
          ${ext.meetingLink ? `<div>🔗 <a href="${escapeHtml(ext.meetingLink)}" target="_blank" style="color: #38bdf8;">Join Meeting Link</a></div>` : ''}
        </div>

        ${ext.nextAction ? `<div style="font-size: 12px; color: #38bdf8; margin-bottom: 10px;">👉 <strong>Action Required:</strong> ${escapeHtml(ext.nextAction)}</div>` : ''}

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #334155; padding-top: 8px;">
          <small style="color: #64748b; font-size: 11px;">Confidence: <strong>${e.confidence || 'high'}</strong></small>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-primary btn-sm" onclick="openDraftModal(${e.id}, 'recruiter_reply', ${e.job_id || 'null'}, '${escapeHtml(comp)}', '${escapeHtml(role)}', '${escapeHtml(ext.recruiter?.name || 'Hiring Team')}', '${escapeHtml(ext.recruiter?.email || e.sender)}')">
              ✍️ Generate Draft Reply
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderCalendarTab() {
  const events = commsHubState.upcomingInterviews;
  if (events.length === 0) {
    return `
      <div style="text-align: center; padding: 40px; color: #94a3b8;">
        <p>No upcoming interviews on your calendar.</p>
        <p style="font-size: 12px; margin-top: 6px;">Interviews detected in recruiter emails will be proposed here automatically.</p>
      </div>
    `;
  }

  return events.map(ev => {
    const isApproved = ev.status === 'approved_created';
    const statusBadge = isApproved
      ? '<span style="background: rgba(34, 197, 94, 0.15); color: #4ade80; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">✓ ADDED TO CALENDAR</span>'
      : '<span style="background: rgba(234, 179, 8, 0.15); color: #facc15; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">⚡ PROPOSED (REVIEW REQUIRED)</span>';

    return `
      <div style="background: #1e293b; border: 1px solid ${ev.conflict_detected ? '#ef4444' : '#334155'}; border-radius: 8px; padding: 14px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <div>
            <strong style="color: #f8fafc; font-size: 14px;">${escapeHtml(ev.title)}</strong>
            <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">
              🏢 ${escapeHtml(ev.company || 'Company')} • 💼 ${escapeHtml(ev.role || 'Software Role')}
            </div>
          </div>
          <div>${statusBadge}</div>
        </div>

        ${ev.conflict_detected ? `
          <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #fca5a5; padding: 8px 12px; border-radius: 6px; font-size: 12px; margin: 8px 0;">
            ⚠️ <strong>Scheduling Conflict Detected:</strong> ${escapeHtml(ev.conflict_details || 'Overlaps with another calendar event')}
          </div>
        ` : ''}

        <div style="background: #0f172a; padding: 10px; border-radius: 6px; margin: 8px 0; font-size: 12px; color: #cbd5e1; display: flex; flex-wrap: wrap; gap: 14px;">
          <div>🕒 <strong>Time:</strong> ${new Date(ev.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} IST</div>
          ${ev.recruiter_name ? `<div>👤 <strong>Recruiter:</strong> ${escapeHtml(ev.recruiter_name)}</div>` : ''}
          ${ev.meeting_link ? `<div>🔗 <a href="${escapeHtml(ev.meeting_link)}" target="_blank" style="color: #38bdf8;">Join Google Meet / Zoom</a></div>` : ''}
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid #334155; padding-top: 8px;">
          ${!isApproved ? `
            <button class="btn btn-primary btn-sm" onclick="executeApproveCalendarEvent(${ev.id})" style="background: #10b981; border: none;">
              ✅ Approve & Add to Calendar
            </button>
          ` : `
            <button class="btn btn-outline btn-sm" onclick="executeCancelCalendarEvent(${ev.id})" style="color: #ef4444;">
              ❌ Cancel Event
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

function renderRemindersTab() {
  const reminders = commsHubState.pendingReminders;
  if (reminders.length === 0) {
    return `
      <div style="text-align: center; padding: 40px; color: #94a3b8;">
        <p>No pending follow-ups or reminders. You are completely caught up!</p>
      </div>
    `;
  }

  return reminders.map(r => {
    const priorityColors = { high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };
    const pColor = priorityColors[r.priority] || '#94a3b8';

    return `
      <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 14px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <strong style="color: #f8fafc; font-size: 14px;">${escapeHtml(r.title)}</strong>
          <span style="border: 1px solid ${pColor}; color: ${pColor}; font-size: 11px; padding: 1px 6px; border-radius: 4px; text-transform: uppercase;">
            ${r.priority}
          </span>
        </div>
        <p style="font-size: 12px; color: #cbd5e1; margin-bottom: 6px;">${escapeHtml(r.notes || '')}</p>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #334155; padding-top: 8px;">
          <div>📅 Due: <strong style="color: #f1f5f9;">${new Date(r.due_date).toLocaleDateString()}</strong></div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline btn-sm" onclick="executeCompleteReminder(${r.id}, 'dismissed')">Dismiss</button>
            <button class="btn btn-primary btn-sm" onclick="executeCompleteReminder(${r.id}, 'completed')" style="background: #10b981; border: none;">✓ Complete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderDraftsTab() {
  const drafts = commsHubState.pendingDrafts;
  if (drafts.length === 0) {
    return `
      <div style="text-align: center; padding: 40px; color: #94a3b8;">
        <p>No email drafts awaiting approval.</p>
        <p style="font-size: 12px; margin-top: 6px;">When drafts are prepared for follow-ups or replies, they will appear here for review.</p>
      </div>
    `;
  }

  return drafts.map(d => `
    <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 14px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <strong style="color: #f1f5f9; font-size: 14px;">${escapeHtml(d.subject)}</strong>
        <span style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; padding: 2px 8px; border-radius: 4px; font-size: 11px;">PENDING APPROVAL</span>
      </div>
      <div style="font-size: 12px; color: #94a3b8; margin-bottom: 8px;">
        To: <strong style="color: #cbd5e1;">${escapeHtml(d.recipient || 'Recruiter')}</strong>
      </div>
      <pre style="background: #0f172a; padding: 10px; border-radius: 6px; font-size: 12px; color: #cbd5e1; max-height: 140px; overflow-y: auto; white-space: pre-wrap; margin-bottom: 10px;">${escapeHtml(d.body)}</pre>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn btn-primary btn-sm" onclick="executeApproveDraft(${d.id})" style="background: #2563eb; border: none;">
          🚀 Approve & Stage to Gmail
        </button>
      </div>
    </div>
  `).join('');
}

window.syncEmails = async function() {
  const btn = document.getElementById('syncEmailsBtn');
  if (btn) btn.textContent = '⏳ Syncing...';
  try {
    const resp = await fetch('/api/communications/sync', { method: 'POST' });
    const data = await resp.json();
    alert(`Sync complete!\nFound: ${data.messagesFound || 0} messages\nImported: ${data.messagesImported || 0}\nSkipped (Duplicates): ${data.messagesSkippedDuplicate || 0}`);
    await openCommsHubModal(commsHubState.activeTab);
  } catch (err) {
    alert('Sync error: ' + err.message);
  } finally {
    if (btn) btn.textContent = '🔄 Sync Inbox';
  }
};

window.openDraftModal = async function(commId, draftType = 'recruiter_reply', jobId = null, comp = '', role = '', recName = 'Hiring Team', recEmail = '') {
  openModal('Generate Communication Draft', '<div class="loading"><div class="spinner"></div><p>Generating evidence-grounded draft...</p></div>');
  try {
    const resp = await fetch('/api/communications/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draftType,
        jobId,
        recruiterName: recName,
        recruiterEmail: recEmail
      })
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);

    const draft = data.draft;
    document.getElementById('modalBody').innerHTML = `
      <div>
        <div style="margin-bottom: 12px;">
          <label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Recipient Email:</label>
          <input type="email" id="draftRecipientInput" value="${escapeHtml(draft.to || recEmail)}" style="width: 100%; background: #0f172a; border: 1px solid #475569; color: white; padding: 8px; border-radius: 6px; font-size: 13px;" />
        </div>
        <div style="margin-bottom: 12px;">
          <label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Subject:</label>
          <input type="text" id="draftSubjectInput" value="${escapeHtml(draft.subject)}" style="width: 100%; background: #0f172a; border: 1px solid #475569; color: white; padding: 8px; border-radius: 6px; font-size: 13px;" />
        </div>
        <div style="margin-bottom: 16px;">
          <label style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Message Body:</label>
          <textarea id="draftBodyInput" rows="12" style="width: 100%; background: #0f172a; border: 1px solid #475569; color: white; padding: 8px; border-radius: 6px; font-size: 13px; font-family: monospace;">${escapeHtml(draft.body)}</textarea>
        </div>

        <!-- Safety Notice -->
        <div style="background: rgba(30, 58, 138, 0.4); border: 1px solid #2563eb; padding: 10px; border-radius: 6px; font-size: 12px; color: #bfdbfe; margin-bottom: 16px;">
          🔒 <strong>Mandatory Human Approval Rule:</strong> Outbound emails require explicit candidate approval. CareerOS will never transmit emails automatically.
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px;">
          <button class="btn btn-outline" onclick="closeModal()">Close</button>
          <button class="btn btn-primary" onclick="executeApproveDraft(${data.draftId})">
            🚀 Approve & Stage to Gmail
          </button>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('modalBody').innerHTML = `<p class="text-danger">Failed to generate draft: ${err.message}</p>`;
  }
};

window.executeApproveDraft = async function(draftId) {
  try {
    const resp = await fetch(`/api/communications/draft/${draftId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userConfirmedApproval: true })
    });
    const result = await resp.json();
    if (!result.success) throw new Error(result.error);

    alert('Draft approved successfully and saved to your Gmail drafts inbox!');
    closeModal();
    if (!document.getElementById('commsModal').classList.contains('hidden')) {
      await openCommsHubModal('drafts');
    }
  } catch (err) {
    alert('Approval error: ' + err.message);
  }
};

window.executeApproveCalendarEvent = async function(eventId) {
  try {
    const resp = await fetch(`/api/calendar/event/${eventId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userConfirmed: true })
    });
    const result = await resp.json();
    if (!result.success) throw new Error(result.error);

    alert('Interview event approved and scheduled in Google Calendar!');
    await openCommsHubModal('calendar');
  } catch (err) {
    alert('Calendar error: ' + err.message);
  }
};

window.executeCancelCalendarEvent = async function(eventId) {
  if (!confirm('Are you sure you want to cancel this interview calendar event?')) return;
  try {
    const resp = await fetch(`/api/calendar/event/${eventId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userConfirmed: true })
    });
    const result = await resp.json();
    if (!result.success) throw new Error(result.error);

    alert('Calendar event cancelled.');
    await openCommsHubModal('calendar');
  } catch (err) {
    alert('Cancel error: ' + err.message);
  }
};

window.executeCompleteReminder = async function(reminderId, status = 'completed') {
  try {
    const resp = await fetch(`/api/reminders/${reminderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const result = await resp.json();
    if (!result.success) throw new Error(result.error);

    await openCommsHubModal('reminders');
  } catch (err) {
    alert('Reminder error: ' + err.message);
  }
};

window.openOAuthModal = async function() {
  openModal('Google OAuth & Security Settings', '<div class="loading"><div class="spinner"></div><p>Checking OAuth status...</p></div>');
  try {
    const resp = await fetch('/api/oauth/status');
    const status = await resp.json();

    document.getElementById('modalBody').innerHTML = `
      <div style="padding: 10px;">
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; margin-bottom: 16px; border: 1px solid #334155;">
          <h4 style="margin-bottom: 8px; color: #f1f5f9;">Connected Google Scopes (Minimum Required)</h4>
          <ul style="padding-left: 20px; font-size: 12px; color: #94a3b8; line-height: 1.6;">
            <li><code>gmail.readonly</code> — Read recruiter emails and application confirmations</li>
            <li><code>gmail.compose</code> — Create draft replies requiring candidate review</li>
            <li><code>calendar.events</code> — Schedule and review interview events</li>
            <li><code>calendar.readonly</code> — Check for interview time conflicts</li>
          </ul>
        </div>

        <div style="margin-bottom: 20px; font-size: 13px; color: #cbd5e1;">
          Status: <strong>${status.authenticated ? '<span style="color: #4ade80;">Authenticated & Active</span>' : '<span style="color: #94a3b8;">Not Connected (Offline / Synthetic Mode)</span>'}</strong><br>
          ${status.expiresAt ? `Token Expiry: <span>${new Date(status.expiresAt).toLocaleString()}</span>` : ''}
        </div>

        <div style="display: flex; justify-content: space-between; gap: 10px; border-top: 1px solid #334155; padding-top: 16px;">
          <button class="btn btn-outline" onclick="closeModal()">Close</button>
          <div style="display: flex; gap: 10px;">
            ${status.authenticated ? `
              <button class="btn btn-outline" onclick="executeDisconnectOAuth()" style="color: #ef4444;">
                Disconnect Google Account
              </button>
            ` : `
              <a href="/api/oauth/url" target="_blank" class="btn btn-primary">
                🔗 Connect Google Account
              </a>
            `}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('modalBody').innerHTML = `<p class="text-danger">Failed to load OAuth status: ${err.message}</p>`;
  }
};

window.executeDisconnectOAuth = async function() {
  if (!confirm('Are you sure you want to disconnect your Google account and revoke OAuth tokens?')) return;
  try {
    const resp = await fetch('/api/oauth/disconnect', { method: 'POST' });
    const result = await resp.json();
    alert(result.message || 'Disconnected successfully.');
    closeModal();
    if (!document.getElementById('commsModal').classList.contains('hidden')) {
      await openCommsHubModal();
    }
  } catch (err) {
    alert('Disconnect error: ' + err.message);
  }
};

// ==========================================
// PHASE 5: CAREER INTELLIGENCE & GROWTH
// ==========================================

const careerIntelState = {
  activeTab: 'skills',
  gaps: null,
  roadmap: [],
  stories: [],
  storyCategory: 'all',
  analytics: null,
  rejections: null,
  mockSession: null,
  mockHistory: [],
  salaryCalc: null
};

window.openCareerIntelligenceModal = async function(activeTab = 'skills') {
  careerIntelState.activeTab = activeTab;
  const modal = document.getElementById('careerIntelModal');
  modal.classList.remove('hidden');

  const bodyEl = document.getElementById('careerIntelModalBody');
  bodyEl.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading Career Intelligence & Growth Engine...</p></div>';

  try {
    // Preload roadmap and gaps
    const [gapRes, roadRes] = await Promise.all([
      fetch('/api/intelligence/skill-gaps').then(r => r.json()),
      fetch('/api/intelligence/roadmap').then(r => r.json())
    ]);

    careerIntelState.gaps = gapRes;
    careerIntelState.roadmap = roadRes.roadmap || [];

    renderCareerIntelHub();
  } catch (err) {
    bodyEl.innerHTML = `<p class="text-danger">Failed to load career intelligence: ${err.message}</p>`;
  }
};

function renderCareerIntelHub() {
  const bodyEl = document.getElementById('careerIntelModalBody');
  bodyEl.innerHTML = `
    <!-- Navigation Tabs -->
    <div style="display: flex; gap: 8px; border-bottom: 1px solid #334155; margin-bottom: 20px;">
      <button class="filter-tab ${careerIntelState.activeTab === 'skills' ? 'active' : ''}" onclick="switchCareerIntelTab('skills')">🎯 Skill Gaps & Roadmap</button>
      <button class="filter-tab ${careerIntelState.activeTab === 'stories' ? 'active' : ''}" onclick="switchCareerIntelTab('stories')">📚 STAR Story Bank</button>
      <button class="filter-tab ${careerIntelState.activeTab === 'mock' ? 'active' : ''}" onclick="switchCareerIntelTab('mock')">🎙️ Mock Interview</button>
      <button class="filter-tab ${careerIntelState.activeTab === 'analytics' ? 'active' : ''}" onclick="switchCareerIntelTab('analytics')">📊 Funnel & Rejections</button>
      <button class="filter-tab ${careerIntelState.activeTab === 'salary' ? 'active' : ''}" onclick="switchCareerIntelTab('salary')">💰 Salary & Offer Calculator</button>
    </div>

    <!-- Active Tab Container -->
    <div id="careerIntelTabContent">
      ${renderCareerIntelTabContent()}
    </div>
  `;
}

window.switchCareerIntelTab = async function(tabName) {
  careerIntelState.activeTab = tabName;
  const bodyEl = document.getElementById('careerIntelTabContent');
  bodyEl.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading section...</p></div>';

  try {
    if (tabName === 'stories' && careerIntelState.stories.length === 0) {
      const res = await fetch('/api/intelligence/stories').then(r => r.json());
      careerIntelState.stories = res.stories || [];
    } else if (tabName === 'analytics' && !careerIntelState.analytics) {
      const [anRes, rejRes] = await Promise.all([
        fetch('/api/intelligence/analytics').then(r => r.json()),
        fetch('/api/intelligence/rejections').then(r => r.json())
      ]);
      careerIntelState.analytics = anRes.analytics;
      careerIntelState.rejections = rejRes.rejections;
    } else if (tabName === 'mock' && careerIntelState.mockHistory.length === 0) {
      const res = await fetch('/api/intelligence/mock/history').then(r => r.json());
      careerIntelState.mockHistory = res.history || [];
    } else if (tabName === 'salary' && !careerIntelState.salaryCalc) {
      const res = await fetch('/api/intelligence/salary/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ctcAnnual: 500000, location: 'Bengaluru', workMode: 'onsite' })
      }).then(r => r.json());
      careerIntelState.salaryCalc = res.calculation;
    }
  } catch (err) {
    console.error('Tab load error:', err);
  }

  renderCareerIntelHub();
};

function renderCareerIntelTabContent() {
  switch (careerIntelState.activeTab) {
    case 'stories':
      return renderStoriesTabHtml();
    case 'mock':
      return renderMockTabHtml();
    case 'analytics':
      return renderAnalyticsTabHtml();
    case 'salary':
      return renderSalaryTabHtml();
    case 'skills':
    default:
      return renderSkillsTabHtml();
  }
}

// ----------------------------------------------------
// TAB 1: SKILL GAPS & ROADMAP
// ----------------------------------------------------
function renderSkillsTabHtml() {
  const g = careerIntelState.gaps || {};
  const s = g.summary || {};
  const roadmap = careerIntelState.roadmap || [];

  return `
    <div style="display: flex; flex-direction: column; gap: 20px;">
      <!-- Summary Strip -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #334155; border-left: 4px solid #10b981;">
          <div style="font-size: 24px; font-weight: 700; color: #4ade80;">${s.existingCount || 0}</div>
          <div style="font-size: 12px; color: #94a3b8; font-weight: 600;">Verified Strengths</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Java, Spring Boot, React, SQL, PostGIS, REST</div>
        </div>
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #334155; border-left: 4px solid #38bdf8;">
          <div style="font-size: 24px; font-weight: 700; color: #38bdf8;">${roadmap.filter(r => r.status === 'in_progress').length}</div>
          <div style="font-size: 12px; color: #94a3b8; font-weight: 600;">In Progress Roadmap</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Active practical project targets</div>
        </div>
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #334155; border-left: 4px solid #f59e0b;">
          <div style="font-size: 24px; font-weight: 700; color: #fcd34d;">${s.missingCount || 0}</div>
          <div style="font-size: 12px; color: #94a3b8; font-weight: 600;">Market Gap Demand</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Requested in active Fresher/Junior JDs</div>
        </div>
      </div>

      <!-- Priority Learning Roadmap -->
      <div style="background: #0f172a; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div>
            <h3 style="margin: 0; font-size: 15px; color: #f8fafc;">Priority Learning Roadmap & Practical Targets</h3>
            <span style="font-size: 12px; color: #94a3b8;">Strict Gatekeeper: Skills can only be marked acquired with verified evidence</span>
          </div>
          <button class="btn btn-primary btn-sm" onclick="promptAddRoadmapSkill()">+ Add Skill Target</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${roadmap.map(item => `
            <div style="background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 12px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <strong style="color: #f1f5f9; font-size: 14px;">${item.skillName.toUpperCase()}</strong>
                  <span style="font-size: 10px; padding: 2px 8px; border-radius: 4px; font-weight: 600; text-transform: uppercase; ${item.priority === 'critical' ? 'background: rgba(239, 68, 68, 0.2); color: #f87171;' : item.priority === 'high' ? 'background: rgba(245, 158, 11, 0.2); color: #fbbf24;' : 'background: rgba(56, 189, 248, 0.2); color: #38bdf8;'}">${item.priority}</span>
                  <span style="font-size: 10px; padding: 2px 8px; border-radius: 4px; font-weight: 600; ${item.status === 'acquired' ? 'background: rgba(34, 197, 94, 0.2); color: #4ade80;' : item.status === 'in_progress' ? 'background: rgba(56, 189, 248, 0.2); color: #38bdf8;' : 'background: rgba(148, 163, 184, 0.2); color: #94a3b8;'}">${item.status.toUpperCase()}</span>
                </div>
                <div style="font-size: 12px; color: #cbd5e1; margin-top: 4px;">
                  💡 <strong>Project:</strong> ${item.recommendedProjectIdea || 'Build proof-of-concept prototype'}
                </div>
                ${item.verifiedEvidence ? `<div style="font-size: 11px; color: #4ade80; margin-top: 3px;">✅ <strong>Verified Proof:</strong> ${item.verifiedEvidence}</div>` : ''}
              </div>
              <div style="display: flex; gap: 6px;">
                ${item.status !== 'acquired' ? `
                  <button class="btn btn-outline btn-sm" onclick="promptMarkAcquired('${item.skillName}')" style="color: #4ade80;">Mark Acquired</button>
                ` : '<span style="font-size: 12px; color: #4ade80; font-weight: 600;">Verified ✅</span>'}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Top Missing Market Gaps with Free Resources -->
      <div style="background: #0f172a; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
        <h3 style="margin: 0 0 10px 0; font-size: 15px; color: #f8fafc;">Top Market Gaps & Free Learning Resources</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
          ${(g.topGaps || []).slice(0, 6).map(gap => `
            <div style="background: #1e293b; padding: 10px; border-radius: 6px; border: 1px solid #334155;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="color: #93c5fd; font-size: 13px;">${gap.skill.toUpperCase()}</strong>
                <span style="font-size: 11px; color: #94a3b8;">${gap.totalDemand} JDs (${gap.marketPercentage}%)</span>
              </div>
              <div style="font-size: 11px; color: #cbd5e1; margin: 4px 0;">${gap.recommendedProject}</div>
              <div style="margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap;">
                ${(gap.learningResources || []).map(r => `<a href="${r.url}" target="_blank" style="font-size: 11px; color: #38bdf8; text-decoration: none; background: rgba(56, 189, 248, 0.1); padding: 2px 6px; border-radius: 3px;">🔗 ${r.name}</a>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

window.promptMarkAcquired = async function(skillName) {
  const evidence = prompt(`Strict Verification Gatekeeper:\nEnter verified proof or tangible project evidence where you implemented "${skillName}" (e.g. "Containerized NearVia in docker-compose" or GitHub commit):`);
  if (!evidence) return;

  try {
    const resp = await fetch('/api/intelligence/roadmap/item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillName, status: 'acquired', verifiedEvidence: evidence })
    });
    const result = await resp.json();
    if (!result.success) throw new Error(result.error);

    alert(`Successfully verified and marked "${skillName}" as acquired!`);
    await openCareerIntelligenceModal('skills');
  } catch (err) {
    alert('Verification Error: ' + err.message);
  }
};

window.promptAddRoadmapSkill = async function() {
  const skill = prompt('Enter the skill name you want to target (e.g. Docker, Kafka, AWS, Next.js):');
  if (!skill) return;

  try {
    const resp = await fetch('/api/intelligence/roadmap/item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillName: skill, status: 'in_progress', priority: 'high' })
    });
    const result = await resp.json();
    if (!result.success) throw new Error(result.error);

    await openCareerIntelligenceModal('skills');
  } catch (err) {
    alert('Error: ' + err.message);
  }
};

// ----------------------------------------------------
// TAB 2: STAR STORY BANK
// ----------------------------------------------------
function renderStoriesTabHtml() {
  const stories = careerIntelState.stories || [];

  return `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h3 style="margin: 0; font-size: 15px; color: #f8fafc;">Evidence-Backed STAR Interview Story Bank</h3>
          <span style="font-size: 12px; color: #94a3b8;">Reusable, verified accomplishments formatted in Situation, Task, Action, and Result</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <input type="text" id="storySearchInput" placeholder="Filter stories..." oninput="filterStoriesUi(this.value)" style="background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 4px 8px; border-radius: 4px; font-size: 12px;" />
        </div>
      </div>

      <div id="storiesContainer" style="display: flex; flex-direction: column; gap: 12px;">
        ${stories.map((s, idx) => `
          <div class="story-card" style="background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <div>
                <strong style="font-size: 14px; color: #93c5fd;">#${idx + 1} — ${s.title}</strong>
                <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                  Context: <strong>${s.contextSource}</strong> • Category: <span style="color: #fcd34d;">${s.category}</span>
                </div>
              </div>
              <button class="btn btn-outline btn-sm" onclick="copyStoryText(${s.id})">📋 Copy STAR</button>
            </div>

            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 12px; margin-top: 8px;">
              <div style="background: #1e293b; padding: 8px; border-radius: 4px; border-left: 3px solid #38bdf8;">
                <strong style="color: #38bdf8;">S (Situation):</strong>
                <p style="margin: 4px 0 0 0; color: #cbd5e1;">${s.situation}</p>
              </div>
              <div style="background: #1e293b; padding: 8px; border-radius: 4px; border-left: 3px solid #f59e0b;">
                <strong style="color: #f59e0b;">T (Task):</strong>
                <p style="margin: 4px 0 0 0; color: #cbd5e1;">${s.task}</p>
              </div>
              <div style="background: #1e293b; padding: 8px; border-radius: 4px; border-left: 3px solid #a855f7;">
                <strong style="color: #a855f7;">A (Action):</strong>
                <p style="margin: 4px 0 0 0; color: #cbd5e1;">${s.action}</p>
              </div>
              <div style="background: #1e293b; padding: 8px; border-radius: 4px; border-left: 3px solid #10b981;">
                <strong style="color: #10b981;">R (Result):</strong>
                <p style="margin: 4px 0 0 0; color: #cbd5e1;">${s.result}</p>
              </div>
            </div>

            ${s.technologies ? `<div style="font-size: 11px; color: #94a3b8; margin-top: 8px;">🛠️ <strong>Technologies:</strong> ${s.technologies}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

window.copyStoryText = function(storyId) {
  const story = (careerIntelState.stories || []).find(s => s.id === storyId);
  if (!story) return;

  const text = `STAR Interview Story: ${story.title} (${story.contextSource})\n\n[Situation]: ${story.situation}\n[Task]: ${story.task}\n[Action]: ${story.action}\n[Result]: ${story.result}\n\nTechnologies: ${story.technologies}`;
  navigator.clipboard.writeText(text);
  alert('Copied STAR Story to clipboard!');
};

// ----------------------------------------------------
// TAB 3: MOCK INTERVIEW SIMULATOR
// ----------------------------------------------------
function renderMockTabHtml() {
  const session = careerIntelState.mockSession;

  if (!session) {
    // Session setup view
    return `
      <div style="background: #0f172a; padding: 20px; border-radius: 8px; border: 1px solid #334155; max-width: 600px; margin: 0 auto; text-align: center;">
        <h3 style="margin-top: 0; color: #f8fafc;">Interactive Mock Interview Simulator</h3>
        <p style="font-size: 13px; color: #94a3b8;">Practice one question at a time. The evaluator assesses relevance, technical correctness, and STAR structure, providing strengths and concrete coaching suggestions.</p>

        <div style="margin: 20px 0; text-align: left;">
          <label style="font-size: 12px; color: #cbd5e1; font-weight: 600; display: block; margin-bottom: 6px;">Select Interview Focus:</label>
          <select id="mockInterviewType" style="width: 100%; background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 8px; border-radius: 6px;">
            <option value="technical">Technical: Java, Spring Boot, React, SQL & Architecture</option>
            <option value="project">Project Deep Dive: NearVia, Leave Management, Smart Rover</option>
            <option value="behavioral">Behavioral & HR: Teamwork, Challenges & Transition</option>
            <option value="mixed">Mixed Round: 2 Technical, 1 Project, 1 Behavioral</option>
          </select>
        </div>

        <button class="btn btn-primary" onclick="startMockUiSession()">🚀 Start Practice Round</button>
        <p style="font-size: 11px; color: #64748b; margin-top: 16px;">Notice: Automated scores are for self-coaching and do not represent official employer assessments.</p>
      </div>
    `;
  }

  // Active or Finished Session View
  const isDone = session.isFinished;
  const currQ = session.nextQuestion || session.currentQuestion;

  return `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; background: #0f172a; padding: 12px 16px; border-radius: 6px; border: 1px solid #334155;">
        <div>
          <strong style="color: #93c5fd;">Mock Interview Session #${session.sessionId}</strong> • <span style="font-size: 12px; color: #cbd5e1;">${session.targetRole || 'Software Engineer'}</span>
        </div>
        <div>
          <span style="font-size: 12px; color: #94a3b8;">Progress: ${session.completedQuestionNumber || 0} / ${session.totalQuestions}</span>
        </div>
      </div>

      ${session.questionEvaluation ? `
        <!-- Previous Question Feedback -->
        <div style="background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 14px; border-left: 4px solid #10b981;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: #4ade80; font-size: 14px;">Question Feedback: ${session.questionEvaluation.overallScore}/10</strong>
            <span style="font-size: 11px; color: #94a3b8;">Relevance: ${session.questionEvaluation.scores?.relevance} • Depth: ${session.questionEvaluation.scores?.correctness} • Clarity: ${session.questionEvaluation.scores?.clarity} • Structure: ${session.questionEvaluation.scores?.structure}</span>
          </div>
          <div style="font-size: 12px; color: #cbd5e1; margin-top: 6px;">
            ${(session.questionEvaluation.strengths || []).map(s => `<div style="color: #4ade80;">✅ ${s}</div>`).join('')}
            ${(session.questionEvaluation.improvements || []).map(i => `<div style="color: #fcd34d;">💡 ${i}</div>`).join('')}
          </div>
          <div style="margin-top: 8px; background: #1e293b; padding: 10px; border-radius: 6px; font-size: 12px; color: #cbd5e1;">
            <strong style="color: #38bdf8;">Model Benchmark Answer:</strong>
            <p style="margin: 4px 0 0 0;">${session.questionEvaluation.improvedAnswer}</p>
          </div>
        </div>
      ` : ''}

      ${!isDone && currQ ? `
        <!-- Current Question Prompt -->
        <div style="background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 16px;">
          <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600;">Question ${(session.completedQuestionNumber || 0) + 1} of ${session.totalQuestions} [${currQ.category}]</div>
          <h3 style="margin: 8px 0 12px 0; color: #f8fafc; font-size: 16px;">"${currQ.question}"</h3>
          <div style="display: flex; gap: 6px; margin-bottom: 12px;">
            ${(currQ.keyConcepts || []).map(c => `<span style="font-size: 10px; background: #1e293b; color: #93c5fd; padding: 2px 8px; border-radius: 4px; border: 1px solid #334155;">🔑 ${c}</span>`).join('')}
          </div>

          <textarea id="mockAnswerInput" rows="5" placeholder="Type your answer as you would explain it in an interview (explain context, mechanisms, and real project examples)..." style="width: 100%; background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 10px; border-radius: 6px; font-size: 13px;"></textarea>

          <div style="margin-top: 10px; display: flex; justify-content: flex-end; gap: 8px;">
            <button class="btn btn-outline btn-sm" onclick="submitMockAnswerUi('Skipped by candidate.')">Skip</button>
            <button class="btn btn-primary" onclick="submitMockAnswerUi()">Submit Answer ➡️</button>
          </div>
        </div>
      ` : `
        <!-- Completed Session Summary -->
        <div style="background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 20px; text-align: center;">
          <h2 style="color: #4ade80; margin-top: 0;">🎉 Session Complete! Average Score: ${session.overallScore}/10</h2>
          <p style="font-size: 13px; color: #cbd5e1; max-width: 600px; margin: 0 auto;">${session.feedbackSummary}</p>
          <div style="margin-top: 20px;">
            <button class="btn btn-primary" onclick="careerIntelState.mockSession = null; switchCareerIntelTab('mock');">Start Another Practice Session</button>
          </div>
        </div>
      `}
    </div>
  `;
}

window.startMockUiSession = async function() {
  const type = document.getElementById('mockInterviewType')?.value || 'technical';
  try {
    const resp = await fetch('/api/intelligence/mock/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interviewType: type, questionCount: 3 })
    });
    const result = await resp.json();
    careerIntelState.mockSession = result.session;
    renderCareerIntelHub();
  } catch (err) {
    alert('Failed to start mock session: ' + err.message);
  }
};

window.submitMockAnswerUi = async function(overrideText = null) {
  const text = overrideText !== null ? overrideText : document.getElementById('mockAnswerInput')?.value;
  if (!text || text.trim().length === 0) {
    alert('Please type an answer or click Skip.');
    return;
  }

  try {
    const resp = await fetch('/api/intelligence/mock/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: careerIntelState.mockSession.sessionId, answer: text })
    });
    const result = await resp.json();
    careerIntelState.mockSession = {
      ...careerIntelState.mockSession,
      ...result.result
    };
    renderCareerIntelHub();
  } catch (err) {
    alert('Submission error: ' + err.message);
  }
};

// ----------------------------------------------------
// TAB 4: APPLICATION FUNNEL & REJECTIONS
// ----------------------------------------------------
function renderAnalyticsTabHtml() {
  const an = careerIntelState.analytics || {};
  const m = an.metrics || {};
  const f = an.funnel || {};
  const rej = careerIntelState.rejections || {};

  return `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      ${an.hasSmallSampleWarning ? `
        <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; padding: 12px 16px; border-radius: 6px; font-size: 13px; color: #fbbf24;">
          ⚠️ <strong>${an.smallSampleWarning}</strong>
        </div>
      ` : ''}

      <!-- Funnel Metrics -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #334155; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #93c5fd;">${an.totalApplications || 0}</div>
          <div style="font-size: 11px; color: #94a3b8;">Total Applications</div>
        </div>
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #334155; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #38bdf8;">${m.responseRatePct || 0}%</div>
          <div style="font-size: 11px; color: #94a3b8;">Response Rate</div>
        </div>
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #334155; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #4ade80;">${m.interviewConversionRatePct || 0}%</div>
          <div style="font-size: 11px; color: #94a3b8;">Interview Conversion</div>
        </div>
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #334155; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #a855f7;">${m.averageResponseDays !== null ? m.averageResponseDays + ' days' : 'N/A'}</div>
          <div style="font-size: 11px; color: #94a3b8;">Avg Response Latency</div>
        </div>
      </div>

      <!-- Funnel Stages Bar -->
      <div style="background: #0f172a; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
        <h4 style="margin: 0 0 12px 0; color: #f8fafc; font-size: 14px;">Application Funnel Progression</h4>
        <div style="display: flex; gap: 8px; text-align: center;">
          <div style="flex: 1; background: #1e293b; padding: 10px; border-radius: 4px;">
            <div style="color: #94a3b8; font-size: 11px;">Interested / Draft</div>
            <div style="font-size: 18px; font-weight: 700; color: #cbd5e1;">${(f.interested || 0) + (f.preparing || 0)}</div>
          </div>
          <div style="display: flex; align-items: center; color: #475569;">➔</div>
          <div style="flex: 1; background: #1e293b; padding: 10px; border-radius: 4px;">
            <div style="color: #94a3b8; font-size: 11px;">Submitted</div>
            <div style="font-size: 18px; font-weight: 700; color: #38bdf8;">${f.submitted || 0}</div>
          </div>
          <div style="display: flex; align-items: center; color: #475569;">➔</div>
          <div style="flex: 1; background: #1e293b; padding: 10px; border-radius: 4px;">
            <div style="color: #94a3b8; font-size: 11px;">Assessment / Screen</div>
            <div style="font-size: 18px; font-weight: 700; color: #f59e0b;">${f.assessment || 0}</div>
          </div>
          <div style="display: flex; align-items: center; color: #475569;">➔</div>
          <div style="flex: 1; background: #1e293b; padding: 10px; border-radius: 4px;">
            <div style="color: #94a3b8; font-size: 11px;">Interview</div>
            <div style="font-size: 18px; font-weight: 700; color: #10b981;">${f.interview || 0}</div>
          </div>
          <div style="display: flex; align-items: center; color: #475569;">➔</div>
          <div style="flex: 1; background: #1e293b; padding: 10px; border-radius: 4px;">
            <div style="color: #94a3b8; font-size: 11px;">Offer</div>
            <div style="font-size: 18px; font-weight: 700; color: #4ade80;">${f.offer || 0}</div>
          </div>
        </div>
      </div>

      <!-- Rejection Breakdown & Next Actions -->
      <div style="background: #0f172a; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
        <h4 style="margin: 0 0 8px 0; color: #f8fafc; font-size: 14px;">Rejection Pattern Intelligence (Strict Known vs Inferred)</h4>
        <p style="font-size: 12px; color: #94a3b8; margin: 0 0 12px 0;">CareerOS never guesses company motives: explicit recruiter reasons are clearly separated from JD criteria mismatch hypotheses.</p>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div style="background: #1e293b; padding: 12px; border-radius: 6px;">
            <strong style="font-size: 13px; color: #f87171;">Explicit Recruiter Reasons (${rej.knownRejectionsCount || 0})</strong>
            ${(rej.knownRejections || []).length > 0 ? (rej.knownRejections || []).map(r => `
              <div style="font-size: 12px; color: #cbd5e1; margin-top: 6px; padding-left: 8px; border-left: 2px solid #ef4444;">
                <strong>${r.company}:</strong> "${r.reasonText}"
              </div>
            `).join('') : '<div style="font-size: 12px; color: #94a3b8; margin-top: 6px;">No explicit rejection messages recorded yet.</div>'}
          </div>

          <div style="background: #1e293b; padding: 12px; border-radius: 6px;">
            <strong style="font-size: 13px; color: #f59e0b;">Actionable Recommendations</strong>
            <ul style="margin: 6px 0 0 0; padding-left: 18px; font-size: 12px; color: #cbd5e1; line-height: 1.6;">
              ${(rej.actionRecommendations || []).map(a => `<li>${a}</li>`).join('')}
            </ul>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ----------------------------------------------------
// TAB 5: SALARY & OFFER CALCULATOR
// ----------------------------------------------------
function renderSalaryTabHtml() {
  const calc = careerIntelState.salaryCalc || {};
  const m = calc.monthlyBreakdown || {};
  const a = calc.annualBreakdown || {};
  const c = calc.costOfLiving || {};

  return `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <!-- Input Controls -->
      <div style="background: #0f172a; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
        <h4 style="margin: 0 0 12px 0; color: #f8fafc; font-size: 14px;">Indian Take-Home Pay & Net Savings Calculator</h4>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
          <div>
            <label style="font-size: 11px; color: #94a3b8; font-weight: 600;">Annual CTC (₹):</label>
            <input type="number" id="calcCtcInput" value="${calc.ctcAnnual || 500000}" step="25000" style="width: 100%; background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 6px 10px; border-radius: 4px; font-size: 13px;" />
          </div>
          <div>
            <label style="font-size: 11px; color: #94a3b8; font-weight: 600;">Location:</label>
            <select id="calcLocationInput" style="width: 100%; background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 6px 10px; border-radius: 4px; font-size: 13px;">
              <option value="Bengaluru" selected>Bengaluru, KA</option>
              <option value="Remote">Remote (India)</option>
              <option value="Hyderabad">Hyderabad, TS</option>
              <option value="Pune">Pune, MH</option>
            </select>
          </div>
          <div>
            <label style="font-size: 11px; color: #94a3b8; font-weight: 600;">Work Mode:</label>
            <select id="calcWorkModeInput" style="width: 100%; background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 6px 10px; border-radius: 4px; font-size: 13px;">
              <option value="onsite" selected>On-site</option>
              <option value="hybrid">Hybrid</option>
              <option value="remote">Fully Remote</option>
            </select>
          </div>
          <div style="display: flex; align-items: flex-end;">
            <button class="btn btn-primary" style="width: 100%;" onclick="executeSalaryCalculation()">Calculate ⚡</button>
          </div>
        </div>
      </div>

      <!-- Financial Metrics Grid -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #334155; border-left: 4px solid #38bdf8;">
          <div style="font-size: 12px; color: #94a3b8;">Estimated Monthly Gross</div>
          <div style="font-size: 22px; font-weight: 700; color: #38bdf8;">₹${(m.grossPay || 0).toLocaleString('en-IN')}</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Based on ₹${(calc.fixedPayAnnual || 0).toLocaleString('en-IN')} Fixed CTC</div>
        </div>
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #334155; border-left: 4px solid #4ade80;">
          <div style="font-size: 12px; color: #94a3b8;">Estimated Net Monthly In-Hand</div>
          <div style="font-size: 22px; font-weight: 700; color: #4ade80;">₹${(m.netInHand || 0).toLocaleString('en-IN')}</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">After EPF, PT & Income Tax TDS</div>
        </div>
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #334155; border-left: 4px solid #f59e0b;">
          <div style="font-size: 12px; color: #94a3b8;">Est. Net Monthly Savings</div>
          <div style="font-size: 22px; font-weight: 700; color: #fbbf24;">₹${(c.estimatedNetMonthlySavings || 0).toLocaleString('en-IN')}</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">After ₹${(c.estimatedMonthlyExpense || 0).toLocaleString('en-IN')}/mo Living Expenses</div>
        </div>
      </div>

      <!-- Deductions Breakdown -->
      <div style="background: #0f172a; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
        <h4 style="margin: 0 0 10px 0; color: #f8fafc; font-size: 14px;">Monthly Deductions Itemization</h4>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; font-size: 12px;">
          <div style="background: #1e293b; padding: 10px; border-radius: 4px;">
            <div style="color: #94a3b8;">Employee PF (EPF):</div>
            <strong style="color: #f87171;">- ₹${(m.epfDeduction || 0).toLocaleString('en-IN')}</strong>
          </div>
          <div style="background: #1e293b; padding: 10px; border-radius: 4px;">
            <div style="color: #94a3b8;">Professional Tax (PT):</div>
            <strong style="color: #f87171;">- ₹${(m.professionalTax || 0).toLocaleString('en-IN')}</strong>
          </div>
          <div style="background: #1e293b; padding: 10px; border-radius: 4px;">
            <div style="color: #94a3b8;">Income Tax (TDS):</div>
            <strong style="color: #f87171;">- ₹${(m.incomeTaxTds || 0).toLocaleString('en-IN')}</strong>
          </div>
          <div style="background: #1e293b; padding: 10px; border-radius: 4px;">
            <div style="color: #94a3b8;">Total Monthly Deductions:</div>
            <strong style="color: #f87171;">- ₹${(m.totalDeductions || 0).toLocaleString('en-IN')}</strong>
          </div>
        </div>

        <div style="margin-top: 14px; font-size: 11px; color: #94a3b8; line-height: 1.6;">
          <strong>Transparent Assumptions:</strong>
          ${(calc.assumptions || []).map(a => `<div>• ${a}</div>`).join('')}
          <div style="margin-top: 6px; color: #64748b;">${calc.disclaimer}</div>
        </div>
      </div>
    </div>
  `;
}

window.executeSalaryCalculation = async function() {
  const ctc = document.getElementById('calcCtcInput')?.value || 500000;
  const loc = document.getElementById('calcLocationInput')?.value || 'Bengaluru';
  const mode = document.getElementById('calcWorkModeInput')?.value || 'onsite';

  try {
    const res = await fetch('/api/intelligence/salary/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctcAnnual: ctc, location: loc, workMode: mode })
    }).then(r => r.json());

    careerIntelState.salaryCalc = res.calculation;
    renderCareerIntelHub();
  } catch (err) {
    alert('Calculation error: ' + err.message);
  }
};

// ==========================================
// PHASE 6: AUTOMATION & LOCAL BACKUP HUB UI
// ==========================================

let automationState = {
  status: null,
  backups: [],
  activeTab: 'engine',
  integrityStatus: null
};

async function openAutomationBackupModal() {
  const modal = document.getElementById('automationBackupModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  await loadAndRenderAutomationModal();
}

async function loadAndRenderAutomationModal() {
  const container = document.getElementById('automationBackupModalBody');
  if (!container) return;

  container.innerHTML = '<div style="padding: 30px; text-align: center; color: #94a3b8;">Loading automation status & backups...</div>';

  try {
    const [statusRes, backupsRes] = await Promise.all([
      fetch('/api/automation/status').then(r => r.json()),
      fetch('/api/backup/list').then(r => r.json())
    ]);

    automationState.status = statusRes;
    automationState.backups = backupsRes.backups || [];
    renderAutomationModal();
  } catch (err) {
    container.innerHTML = `<div style="padding: 20px; color: #f87171;">Failed to load automation data: ${err.message}</div>`;
  }
}

function renderAutomationModal() {
  const container = document.getElementById('automationBackupModalBody');
  if (!container || !automationState.status) return;

  const { isEnginePaused, tasks = [], recentRuns = [], runningLocks = [] } = automationState.status;
  const activeCount = tasks.filter(t => t.is_enabled).length;

  container.innerHTML = `
    <!-- Top System Overview Cards -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px;">
      <div style="background: #1e293b; padding: 14px; border-radius: 8px; border: 1px solid #334155;">
        <div style="color: #94a3b8; font-size: 11px; text-transform: uppercase;">Master Engine State</div>
        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 6px;">
          <span style="font-size: 16px; font-weight: 700; color: ${isEnginePaused ? '#f87171' : '#34d399'};">
            ${isEnginePaused ? '⏸️ PAUSED' : '⚡ ACTIVE'}
          </span>
          <button class="btn btn-sm ${isEnginePaused ? 'btn-primary' : 'btn-outline'}" 
                  onclick="toggleMasterEngine(${!isEnginePaused})">
            ${isEnginePaused ? 'Resume Engine' : 'Pause All'}
          </button>
        </div>
      </div>

      <div style="background: #1e293b; padding: 14px; border-radius: 8px; border: 1px solid #334155;">
        <div style="color: #94a3b8; font-size: 11px; text-transform: uppercase;">Scheduled Tasks</div>
        <div style="font-size: 20px; font-weight: 700; color: #f8fafc; margin-top: 4px;">
          ${activeCount} <span style="font-size: 13px; color: #94a3b8; font-weight: 400;">/ ${tasks.length} Enabled</span>
        </div>
        <div style="font-size: 11px; color: #38bdf8; margin-top: 2px;">
          ${runningLocks.length > 0 ? `Running: ${runningLocks.join(', ')}` : 'Idle / Waiting next tick'}
        </div>
      </div>

      <div style="background: #1e293b; padding: 14px; border-radius: 8px; border: 1px solid #334155;">
        <div style="color: #94a3b8; font-size: 11px; text-transform: uppercase;">Local Backups Vault</div>
        <div style="font-size: 20px; font-weight: 700; color: #a78bfa; margin-top: 4px;">
          ${automationState.backups.length} <span style="font-size: 13px; color: #94a3b8; font-weight: 400;">snapshots</span>
        </div>
        <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
          Directory: <code>data/backups/</code>
        </div>
      </div>

      <div style="background: #1e293b; padding: 14px; border-radius: 8px; border: 1px solid #334155;">
        <div style="color: #94a3b8; font-size: 11px; text-transform: uppercase;">Production Host Profile</div>
        <div style="font-size: 13px; font-weight: 600; color: #fbbf24; margin-top: 4px;">
          💻 8GB RAM Laptop Ready
        </div>
        <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
          SQLite WAL • 127.0.0.1 • Low RSS
        </div>
      </div>
    </div>

    <!-- Sub-tab Navigation -->
    <div style="display: flex; gap: 10px; border-bottom: 1px solid #334155; margin-bottom: 20px;">
      <button class="filter-tab ${automationState.activeTab === 'engine' ? 'active' : ''}" 
              onclick="setAutomationTab('engine')">⚙️ Configurable Tasks (${tasks.length})</button>
      <button class="filter-tab ${automationState.activeTab === 'backups' ? 'active' : ''}" 
              onclick="setAutomationTab('backups')">💾 Backups & Safety</button>
      <button class="filter-tab ${automationState.activeTab === 'logs' ? 'active' : ''}" 
              onclick="setAutomationTab('logs')">📜 Run Telemetry (${recentRuns.length})</button>
    </div>

    <!-- Active Tab Body -->
    <div id="automationTabContent">
      ${renderAutomationTabContent()}
    </div>
  `;
}

function setAutomationTab(tab) {
  automationState.activeTab = tab;
  renderAutomationModal();
}

function renderAutomationTabContent() {
  const { tasks = [], recentRuns = [] } = automationState.status;

  if (automationState.activeTab === 'engine') {
    return `
      <div style="display: flex; flex-direction: column; gap: 14px;">
        ${tasks.map(t => {
          const isFailing = t.failure_count > 0;
          const statusColor = t.last_status === 'SUCCESS' ? '#34d399' : (isFailing ? '#f87171' : '#94a3b8');
          return `
            <div style="background: #0f172a; padding: 16px; border-radius: 8px; border: 1px solid ${isFailing ? '#ef4444' : '#334155'}; display: flex; justify-content: space-between; align-items: center;">
              <div style="flex: 1; margin-right: 20px;">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                  <strong style="color: #f8fafc; font-size: 15px;">${t.task_name}</strong>
                  <span style="background: ${t.is_enabled ? '#065f46' : '#374151'}; color: ${t.is_enabled ? '#6ee7b7' : '#9ca3af'}; font-size: 11px; padding: 2px 8px; border-radius: 12px;">
                    ${t.is_enabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                  <span style="background: #1e293b; color: #94a3b8; font-size: 11px; padding: 2px 8px; border-radius: 12px;">
                    Every ${t.interval_minutes} mins
                  </span>
                  ${isFailing ? `<span style="background: #7f1d1d; color: #fca5a5; font-size: 11px; padding: 2px 8px; border-radius: 12px;">⚠️ ${t.failure_count} Backoff Failures</span>` : ''}
                </div>
                <div style="color: #94a3b8; font-size: 12px; margin-bottom: 8px;">${t.description || 'Configurable background routine'}</div>
                <div style="display: flex; gap: 18px; font-size: 11px; color: #64748b;">
                  <div>Last Run: <span style="color: #cbd5e1;">${t.last_run_at ? new Date(t.last_run_at).toLocaleString() : 'Never'}</span></div>
                  <div>Status: <strong style="color: ${statusColor};">${t.last_status || 'IDLE'}</strong></div>
                  <div>Next Scheduled: <span style="color: #cbd5e1;">${t.next_run_at ? new Date(t.next_run_at).toLocaleTimeString() : 'Pending'}</span></div>
                </div>
                ${t.last_error ? `<div style="margin-top: 6px; font-size: 11px; color: #f87171; background: #450a0a; padding: 4px 8px; border-radius: 4px;">Error: ${t.last_error}</div>` : ''}
              </div>

              <div style="display: flex; align-items: center; gap: 8px;">
                <button class="btn btn-outline btn-sm" onclick="triggerTaskRun('${t.task_key}')">▶ Run Now</button>
                <button class="btn btn-outline btn-sm" onclick="toggleTask('${t.task_key}', ${t.is_enabled ? 1 : 0})">
                  ${t.is_enabled ? 'Disable' : 'Enable'}
                </button>
                <button class="btn btn-outline btn-sm" onclick="updateTaskFreq('${t.task_key}', ${t.interval_minutes})">⏱️ Interval</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  if (automationState.activeTab === 'backups') {
    return `
      <div>
        <!-- Backup Action Bar -->
        <div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h4 style="margin: 0 0 4px 0; color: #f8fafc; font-size: 14px;">Local-First Data Protection & SQLite Safety</h4>
            <p style="margin: 0; color: #94a3b8; font-size: 12px;">Create point-in-time database snapshots, verify physical integrity, or export full JSON career archives.</p>
          </div>
          <div style="display: flex; gap: 10px;">
            <button class="btn btn-outline btn-sm" onclick="checkDatabaseIntegrity()">🔍 Check Integrity</button>
            <button class="btn btn-outline btn-sm" onclick="exportFullArchive()">📦 Export JSON Archive</button>
            <button class="btn btn-primary btn-sm" onclick="createManualBackup()">⚡ Create Backup</button>
          </div>
        </div>

        ${automationState.integrityStatus ? `
          <div style="background: #0f172a; padding: 12px 16px; border-radius: 6px; border: 1px solid #38bdf8; margin-bottom: 20px; font-size: 12px; color: #e2e8f0;">
            <strong style="color: #38bdf8;">Integrity Status:</strong> ${automationState.integrityStatus.ok ? '✅ ' + automationState.integrityStatus.message : '❌ ' + automationState.integrityStatus.message}
            <span style="color: #94a3b8; margin-left: 10px;">Checked at ${new Date(automationState.integrityStatus.timestamp).toLocaleTimeString()}</span>
          </div>
        ` : ''}

        <!-- Backups List -->
        <div style="background: #0f172a; border-radius: 8px; border: 1px solid #334155; overflow: hidden;">
          <div style="padding: 12px 16px; background: #1e293b; border-bottom: 1px solid #334155; font-size: 12px; font-weight: 600; color: #cbd5e1; display: grid; grid-template-columns: 2fr 1fr 1fr 1fr;">
            <div>Snapshot File</div>
            <div>Label</div>
            <div>File Size</div>
            <div style="text-align: right;">Recovery</div>
          </div>
          ${automationState.backups.length === 0 ? `
            <div style="padding: 30px; text-align: center; color: #64748b; font-size: 13px;">No backups found in <code>data/backups/</code>. Click "Create Backup" above.</div>
          ` : automationState.backups.map(b => `
            <div style="padding: 12px 16px; border-bottom: 1px solid #1e293b; font-size: 12px; color: #cbd5e1; display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; align-items: center;">
              <div>
                <strong style="color: #f8fafc;">${b.filename}</strong>
                <div style="color: #64748b; font-size: 11px;">${new Date(b.created_at).toLocaleString()}</div>
              </div>
              <div><span style="background: #1e293b; padding: 2px 8px; border-radius: 4px; color: #a78bfa;">${b.label || 'manual'}</span></div>
              <div style="color: #94a3b8;">${(b.size_bytes / 1024).toFixed(1)} KB</div>
              <div style="text-align: right;">
                <button class="btn btn-outline btn-sm" style="color: #f87171; border-color: #ef4444;" onclick="promptRestore('${b.path.replace(/\\/g, '\\\\')}')">
                  🔄 Restore
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  if (automationState.activeTab === 'logs') {
    return `
      <div style="background: #0f172a; border-radius: 8px; border: 1px solid #334155; overflow: hidden;">
        <div style="padding: 12px 16px; background: #1e293b; border-bottom: 1px solid #334155; font-size: 12px; font-weight: 600; color: #cbd5e1; display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr 2fr;">
          <div>Task Key</div>
          <div>Status</div>
          <div>Duration</div>
          <div>Timestamp</div>
          <div>Details</div>
        </div>
        ${recentRuns.length === 0 ? `
          <div style="padding: 30px; text-align: center; color: #64748b; font-size: 13px;">No background runs recorded yet.</div>
        ` : recentRuns.map(r => {
          const isSuccess = r.status === 'SUCCESS';
          return `
            <div style="padding: 10px 16px; border-bottom: 1px solid #1e293b; font-size: 12px; color: #cbd5e1; display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr 2fr; align-items: center;">
              <div><strong style="color: #f8fafc;">${r.task_key}</strong></div>
              <div>
                <span style="background: ${isSuccess ? '#065f46' : '#7f1d1d'}; color: ${isSuccess ? '#6ee7b7' : '#fca5a5'}; font-size: 10px; padding: 2px 6px; border-radius: 4px;">
                  ${r.status}
                </span>
              </div>
              <div style="color: #94a3b8;">${r.duration_ms} ms</div>
              <div style="color: #64748b; font-size: 11px;">${new Date(r.started_at).toLocaleTimeString()}</div>
              <div style="color: ${r.error_message ? '#f87171' : '#94a3b8'}; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${r.error_message || (r.summary_json ? JSON.stringify(JSON.parse(r.summary_json)) : 'Completed')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
}

window.setAutomationTab = setAutomationTab;

window.triggerTaskRun = async function(taskKey) {
  try {
    const res = await fetch(`/api/automation/task/${taskKey}/run`, { method: 'POST' }).then(r => r.json());
    if (res.success) {
      alert(`Task [${taskKey}] executed successfully!`);
      await loadAndRenderAutomationModal();
    } else {
      alert(`Task [${taskKey}] execution failed: ` + res.error);
    }
  } catch (err) {
    alert('Task execution error: ' + err.message);
  }
};

window.toggleTask = async function(taskKey, currentStatus) {
  try {
    const res = await fetch(`/api/automation/task/${taskKey}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !currentStatus })
    }).then(r => r.json());
    if (res.success) {
      await loadAndRenderAutomationModal();
    }
  } catch (err) {
    alert('Error toggling task: ' + err.message);
  }
};

window.updateTaskFreq = async function(taskKey, currentInterval) {
  const newInterval = prompt(`Enter new interval in minutes for [${taskKey}]:`, currentInterval);
  if (!newInterval) return;
  const num = parseInt(newInterval, 10);
  if (isNaN(num) || num < 1) {
    alert('Invalid interval. Must be at least 1 minute.');
    return;
  }
  try {
    const res = await fetch(`/api/automation/task/${taskKey}/interval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervalMinutes: num })
    }).then(r => r.json());
    if (res.success) {
      await loadAndRenderAutomationModal();
    }
  } catch (err) {
    alert('Error updating interval: ' + err.message);
  }
};

window.toggleMasterEngine = async function(paused) {
  try {
    const res = await fetch('/api/automation/master-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused })
    }).then(r => r.json());
    if (res.success) {
      await loadAndRenderAutomationModal();
    }
  } catch (err) {
    alert('Error setting master pause: ' + err.message);
  }
};

window.createManualBackup = async function() {
  const label = prompt('Enter a label for this backup (optional):', 'manual_snapshot') || 'manual_snapshot';
  try {
    const res = await fetch('/api/backup/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label })
    }).then(r => r.json());

    if (res.success) {
      alert(`Backup created successfully:\n${res.backup.filename}`);
      await loadAndRenderAutomationModal();
    } else {
      alert('Backup failed: ' + res.error);
    }
  } catch (err) {
    alert('Backup error: ' + err.message);
  }
};

window.checkDatabaseIntegrity = async function() {
  try {
    const res = await fetch('/api/backup/integrity').then(r => r.json());
    if (res.success) {
      automationState.integrityStatus = res.integrity;
      renderAutomationModal();
    }
  } catch (err) {
    alert('Integrity check error: ' + err.message);
  }
};

window.exportFullArchive = async function() {
  try {
    const res = await fetch('/api/backup/export-full', { method: 'POST' }).then(r => r.json());
    if (res.success) {
      const blob = new Blob([JSON.stringify(res.archive, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `careeros_full_archive_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      alert('Export failed: ' + res.error);
    }
  } catch (err) {
    alert('Export error: ' + err.message);
  }
};

window.promptRestore = async function(backupPath) {
  const confirmText = prompt(`⚠️ CAUTION: RESTORING WILL REPLACE YOUR CURRENT DATABASE WITH THIS SNAPSHOT.\n\nType "RESTORE" to confirm:`);
  if (confirmText !== 'RESTORE') {
    alert('Restore cancelled. Confirmation text did not match.');
    return;
  }

  try {
    const res = await fetch('/api/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupPath, userConfirmed: true })
    }).then(r => r.json());

    if (res.success) {
      alert('Database restored successfully! Dashboard will now reload.');
      window.location.reload();
    } else {
      alert('Restore failed: ' + res.error);
    }
  } catch (err) {
    alert('Restore error: ' + err.message);
  }
};



