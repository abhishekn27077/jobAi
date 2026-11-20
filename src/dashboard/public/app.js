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
  const grid = document.getElementById('jobGrid');
  grid.innerHTML = '';

  let filtered = allJobs.filter(job => {
    if (currentFilter === 'RECOMMENDED' && job.recommendation !== 'RECOMMENDED') return false;
    if (currentFilter === 'CONSIDER' && job.recommendation !== 'CONSIDER') return false;
    if (currentFilter === 'saved' && job.status !== 'saved') return false;
    if (currentFilter === 'ready_to_apply' && job.status !== 'ready_to_apply') return false;
    if (currentFilter === 'applied' && job.status !== 'applied') return false;

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
        <p style="margin-top: 8px;">Click "⚡ Scan Jobs" to fetch the latest Indian tech job listings.</p>
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

  card.innerHTML = `
    <div class="job-header">
      <div class="job-title-row">
        <a href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer" class="job-title">
          ${escapeHtml(job.title)}
        </a>
        <div class="job-company">${escapeHtml(job.company)}</div>
        <div class="job-meta-chips">
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
  openModal('Launching Form Assistant...', '<div class="loading"><div class="spinner"></div><p>Opening visible Google Chrome session via Playwright...</p></div>');
  try {
    const resp = await fetch(`/api/job/${jobId}/assist`, { method: 'POST' });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);

    document.getElementById('modalBody').innerHTML = `
      <div style="text-align: center; padding: 20px;">
        <div style="font-size: 40px; margin-bottom: 12px;">🚀</div>
        <h3>Visible Chrome Session Active</h3>
        <p style="color: #94a3b8; margin: 12px 0 20px 0; line-height: 1.5;">${escapeHtml(data.message)}</p>
        <div style="background: #1e3a8a; color: white; padding: 12px; border-radius: 8px; font-size: 13px; text-align: left;">
          <strong>Human-in-the-Loop Safety Rule:</strong><br>
          CareerOS pre-fills your verified candidate data and attaches your tailored resume PDF. Review all fields in your open Chrome browser window and click <strong>Submit</strong> manually.
        </div>
      </div>
    `;
    await loadJobs();
  } catch (err) {
    document.getElementById('modalBody').innerHTML = `<p class="text-danger">Failed to launch form assistant: ${err.message}</p>`;
  }
};

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

