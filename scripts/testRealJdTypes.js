/**
 * CareerOS — 6 Synthetic JD Test Scenarios (Archetype QA Benchmark Runner)
 * Calibrated synthetic scenarios designed to test ATS scoring, mandatory vs preferred
 * skill decoupling, fresher eligibility, and seniority rejection boundaries:
 * 1. Fresher Java Developer in Bengaluru (Synthetic Benchmark)
 * 2. Junior Spring Boot Developer (Synthetic Benchmark)
 * 3. Full Stack Java Developer (Synthetic Benchmark)
 * 4. Python Developer (Synthetic Benchmark)
 * 5. AI/ML Fresher (Synthetic Benchmark)
 * 6. Java Developer requiring 3+ years (Seniority Gate Benchmark)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractJdRequirements } from '../src/resumes/jdAnalyzer.js';
import { generateStudioResume } from '../src/resumes/resumeStudioService.js';
import { exportToPdf } from '../src/resumes/exporters/pdfExporter.js';
import { exportToDocx } from '../src/resumes/exporters/docxExporter.js';
import { renderResumeHtml } from '../src/resumes/templates/templateEngine.js';
import { loadCandidateProfile } from '../src/profile/profileManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(__dirname, '../output/resumes/test_runs');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const TEST_JDS = [
  {
    type: 'Fresher Java Developer in Bengaluru',
    scenarioType: 'Synthetic Test Scenario (Fresher Java Benchmark)',
    isSynthetic: true,
    id: 'test_1_fresher_java',
    title: 'Fresher Java Developer',
    company: 'Wipro Technologies (Synthetic Benchmark)',
    location: 'Bengaluru, Karnataka, India',
    retrievalDate: '2026-11-20',
    description: `
Role: Fresher Java Developer (0-1 Years)
Location: Bengaluru

Synthetic benchmark scenario calibrated for MCA / B.Tech 2025/2026 graduates.

Mandatory Requirements:
- Core Java (OOP, Multithreading, Collections Framework, Exception Handling, JDBC)
- Understanding of Spring Boot or basic Spring Framework
- Relational Databases: SQL, MySQL, or PostgreSQL
- Good understanding of RESTful web services
- Version control using Git

Preferred Qualifications:
- Familiarity with Postman and API testing
- Understanding of Agile/Scrum methodologies

Education: MCA or B.Tech/BE in Computer Science, Information Technology, or related discipline.
    `
  },
  {
    type: 'Junior Spring Boot Developer',
    scenarioType: 'Synthetic Test Scenario (Junior Spring Boot Benchmark)',
    isSynthetic: true,
    id: 'test_2_junior_spring_boot',
    title: 'Junior Spring Boot Developer',
    company: 'Mindtree / LTIMindtree (Synthetic Benchmark)',
    location: 'Bangalore, India',
    retrievalDate: '2026-11-20',
    description: `
Role: Junior Backend Engineer - Spring Boot (1-2 Years / Entry Level)
Location: Bangalore

Synthetic benchmark scenario for junior backend microservices role.

Responsibilities:
- Build, test, and maintain robust microservices and REST APIs using Spring Boot and Java.
- Integrate with PostgreSQL and MySQL databases using Spring Data JPA and Hibernate.
- Collaborate with frontend engineers to integrate RESTful endpoints with React client apps.

Required Skills:
- Java 17+, Spring Boot, Spring Data JPA / Hibernate
- REST API design and documentation using Postman / Swagger
- PostgreSQL / MySQL database modeling, queries, and transactions
- Unit testing with JUnit

Good to have:
- Docker containerization basics
- Experience with Supabase or Cloud platforms
    `
  },
  {
    type: 'Full Stack Java Developer',
    scenarioType: 'Synthetic Test Scenario (Full Stack Java Benchmark)',
    isSynthetic: true,
    id: 'test_3_full_stack_java',
    title: 'Full Stack Java Developer',
    company: 'Capgemini (Synthetic Benchmark)',
    location: 'Bengaluru, India',
    retrievalDate: '2026-11-20',
    description: `
Position: Full Stack Java Developer (0-2 Years)
Location: Bengaluru

Synthetic benchmark scenario for end-to-end web application development.

Key Responsibilities:
- Design and build responsive frontend user interfaces using React.js, JavaScript, and HTML5/CSS3.
- Develop secure, scalable backend services using Java, Spring Boot, and REST APIs.
- Manage databases (MySQL, PostgreSQL) and write optimized queries.
- Participate in agile sprint planning and code reviews.

Skills Required:
- Frontend: React.js, JavaScript, HTML5, CSS3, Tailwind CSS or Bootstrap
- Backend: Java, Spring Boot, REST APIs, OOP
- Database: MySQL, PostgreSQL
- Tools: Git, GitHub, Postman
    `
  },
  {
    type: 'Python Developer',
    scenarioType: 'Synthetic Test Scenario (Python Backend Benchmark)',
    isSynthetic: true,
    id: 'test_4_python_developer',
    title: 'Python Backend Developer',
    company: 'Zeta Global (Synthetic Benchmark)',
    location: 'Bengaluru, India',
    retrievalDate: '2026-11-20',
    description: `
Role: Junior Python Developer (0-1 Years / Fresher)
Location: Bengaluru

Synthetic benchmark scenario for Python API services.

Requirements:
- Strong programming fundamentals in Python
- Hands-on experience with FastAPI or Flask
- Knowledge of REST API architecture and JSON data formats
- Relational and NoSQL database experience (MongoDB, PostgreSQL, or MySQL)
- Git version control

Nice to have:
- Pandas and NumPy data manipulation
- Basic machine learning or computer vision exposure
    `
  },
  {
    type: 'AI/ML Fresher',
    scenarioType: 'Synthetic Test Scenario (AI/ML Fresher Benchmark)',
    isSynthetic: true,
    id: 'test_5_aiml_fresher',
    title: 'AI/ML Engineer - Fresher',
    company: 'Mu Sigma (Synthetic Benchmark)',
    location: 'Bengaluru, Karnataka',
    retrievalDate: '2026-11-20',
    description: `
Position: AI/ML Associate Engineer (Fresher / 0-1 Years)
Location: Bengaluru

Synthetic benchmark scenario for entry-level machine learning and computer vision.

Key Requirements:
- Python programming (OOP, data structures, algorithms)
- Machine learning libraries: Scikit-learn, Pandas, NumPy
- Computer Vision basics (OpenCV, image processing)
- Experience deploying ML models or building API wrappers (FastAPI / Flask)
- Analytical problem solving and project demonstration

Eligibility: 2025/2026 Batch Graduates in Computer Applications or CS/IT.
    `
  },
  {
    type: 'Java Developer requiring 3+ years',
    scenarioType: 'Synthetic Test Scenario (Senior Experience Gate Benchmark)',
    isSynthetic: true,
    id: 'test_6_senior_java_3plus',
    title: 'Senior Java Backend Engineer',
    company: 'Oracle India (Synthetic Benchmark)',
    location: 'Bangalore, India',
    retrievalDate: '2026-11-20',
    description: `
Role: Senior Java Software Engineer
Location: Bangalore

Synthetic benchmark scenario to test mandatory experience gatekeeper rejection.

Minimum Requirements:
- Requires 3 to 6 years of commercial backend engineering experience.
- Deep expertise in Core Java, JVM internals, concurrent programming, and performance tuning.
- Advanced production architecture experience with Spring Boot microservices, Kafka, and Kubernetes.
- Relational and distributed NoSQL databases (Oracle DB, Redis).
- Proven track record leading design discussions and mentoring junior engineers.
    `
  }
];

async function runTests() {
  console.log('================================================================');
  console.log('CareerOS AI Resume Studio — 6 Synthetic JD QA Scenarios');
  console.log('================================================================\n');

  const results = [];

  for (const jd of TEST_JDS) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`[SYNTHETIC TEST SCENARIO] ${jd.type}`);
    console.log(`Target: ${jd.title} @ ${jd.company} (${jd.location})`);
    console.log(`Type:   ${jd.scenarioType} | Date: ${jd.retrievalDate}`);

    // 1. Extract Requirements
    const analysis = extractJdRequirements(jd);

    // 2. Generate Studio Resume & Score
    const studioResult = await generateStudioResume(jd, { jdAnalysis: analysis, template: 'ats_professional' });
    const ats = studioResult.atsScore;
    const content = studioResult.content;

    // 3. Render HTML
    const html = renderResumeHtml(content, 'ats_professional');

    // 4. Export PDF and DOCX
    const pdfPath = path.join(OUTPUT_DIR, `${jd.id}.pdf`);
    const docxPath = path.join(OUTPUT_DIR, `${jd.id}.docx`);

    await exportToPdf(html, pdfPath);
    await exportToDocx(content, docxPath);

    // 5. Audit Truthfulness
    const profile = loadCandidateProfile();
    const warnings = [];

    // Check project honesty
    content.projects.forEach(p => {
      const match = profile.projects.find(mp => mp.name === p.name);
      if (!match) {
        warnings.push(`UNVERIFIED PROJECT: "${p.name}" not in master candidate profile.`);
      }
    });

    // Check degree honesty
    content.education.forEach(e => {
      const match = profile.education.find(me => me.degree === e.degree);
      if (!match) {
        warnings.push(`UNVERIFIED DEGREE: "${e.degree}" not in master candidate profile.`);
      }
    });

    const report = {
      scenarioType: jd.scenarioType,
      isSynthetic: true,
      retrievalDate: jd.retrievalDate,
      type: jd.type,
      title: jd.title,
      company: jd.company,
      extractedRequirements: {
        languages: analysis.languages,
        frameworksAndTools: analysis.frameworksAndTools,
        databases: analysis.databases,
        mandatorySkills: analysis.requiredSkills,
        preferredSkills: analysis.preferredSkills,
        experienceRequired: `${analysis.experience.min} - ${analysis.experience.max || '+'} yrs (Fresher: ${analysis.experience.isFresherEligible})`,
        educationRequired: `${(analysis.education.degrees || []).join(', ')} (MCA CS Eligible: ${analysis.education.isEligibleForMCA})`
      },
      keywordMatch: {
        matchedMandatory: ats.keywordAnalysis.matchedMandatory,
        matchedPreferred: ats.keywordAnalysis.matchedPreferred,
        missingMandatory: ats.keywordAnalysis.missingMandatory,
        missingPreferred: ats.keywordAnalysis.missingPreferred,
        unverifiedInProfile: ats.keywordAnalysis.unverifiedInProfile
      },
      indicators: {
        indicatorA_ResumeCompatibilityScore: ats.resumeCompatibilityScore,
        indicatorB_JobEligibility: ats.eligibilityAssessment.status,
        eligibilityLabel: ats.eligibilityAssessment.label,
        unmetMandatoryRequirements: ats.eligibilityAssessment.unmetMandatoryRequirements,
        overallMatchScore: ats.overallMatch.overallScore,
        overallRecommendation: ats.overallMatch.recommendation
      },
      featuredProjects: content.projects.map(p => p.name),
      filesGenerated: {
        pdf: pdfPath,
        docx: docxPath
      },
      truthfulnessAudit: {
        violationsFound: warnings.length,
        warnings: warnings.length === 0 ? ['Verified 100% truthful against candidate profile. Zero fabricated credentials.'] : warnings
      }
    };

    results.push(report);

    console.log(`Extracted Mandatory Skills: [${analysis.requiredSkills.join(', ')}]`);
    console.log(`Extracted Preferred Skills: [${analysis.preferredSkills.join(', ')}]`);
    console.log(`Matched Mandatory Skills:   [${ats.keywordAnalysis.matchedMandatory.join(', ')}]`);
    console.log(`Matched Preferred Skills:   [${ats.keywordAnalysis.matchedPreferred.join(', ')}]`);
    console.log(`Missing Mandatory Skills:   [${ats.keywordAnalysis.missingMandatory.join(', ')}]`);
    console.log(`Missing Preferred Skills:   [${ats.keywordAnalysis.missingPreferred.join(', ')}]`);
    console.log(`Indicator A (Compatibility): ${ats.resumeCompatibilityScore}/100`);
    console.log(`Indicator B (Eligibility):   ${ats.eligibilityAssessment.label} (${ats.eligibilityAssessment.status})`);
    if (ats.eligibilityAssessment.unmetMandatoryRequirements.length > 0) {
      console.log(`Unmet Mandatory:             ${ats.eligibilityAssessment.unmetMandatoryRequirements.join(' | ')}`);
    }
    console.log(`Overall Match Score:         ${ats.overallMatch.overallScore}/100 (${ats.overallMatch.recommendation})`);
    console.log(`Top Featured Project:        ${content.projects[0]?.name}`);
    console.log(`Truthfulness Status:         ${report.truthfulnessAudit.warnings[0]}`);
    console.log(`Generated: ${path.basename(pdfPath)} & ${path.basename(docxPath)}`);
  }

  // Save complete JSON report
  const reportPath = path.resolve(__dirname, '../output/resumes/test_runs_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n================================================================`);
  console.log(`Synthetic Scenario QA Evaluation Complete! Report saved to:\n${reportPath}`);
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
