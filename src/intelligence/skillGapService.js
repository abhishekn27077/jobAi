import { getDatabase } from '../db/schema.js';
import { loadCandidateProfile } from '../profile/profileManager.js';

// Curated practical learning resources & mini-project recommendations
const SKILL_CATALOG = {
  docker: {
    category: 'devops',
    feasibility: 'high',
    resources: [
      { name: 'Docker Curriculum for Beginners', url: 'https://docker-curriculum.com', type: 'tutorial' },
      { name: 'Official Docker Get Started Docs', url: 'https://docs.docker.com/get-started/', type: 'documentation' }
    ],
    projectIdea: 'Containerize NearVia backend (Express/PostgreSQL) and frontend into a multi-container docker-compose setup.'
  },
  kubernetes: {
    category: 'devops',
    feasibility: 'medium',
    resources: [
      { name: 'Kubernetes Basics Official Guide', url: 'https://kubernetes.io/docs/tutorials/kubernetes-basics/', type: 'documentation' },
      { name: 'Minikube Local Cluster Tutorial', url: 'https://minikube.sigs.k8s.io/docs/start/', type: 'hands_on' }
    ],
    projectIdea: 'Deploy the containerized Employee Leave Management service onto a local Minikube cluster with a Deployment and Service spec.'
  },
  microservices: {
    category: 'backend',
    feasibility: 'high',
    resources: [
      { name: 'Spring Cloud Microservices Guide', url: 'https://spring.io/guides/gs/service-registration-and-discovery/', type: 'guide' },
      { name: 'Microservices Patterns by Chris Richardson', url: 'https://microservices.io', type: 'architecture' }
    ],
    projectIdea: 'Decompose Leave Management System into two independent services (Auth Service and Leave Service) communicating via REST or gRPC.'
  },
  kafka: {
    category: 'backend',
    feasibility: 'medium',
    resources: [
      { name: 'Apache Kafka Quickstart', url: 'https://kafka.apache.org/quickstart', type: 'tutorial' },
      { name: 'Spring for Apache Kafka Documentation', url: 'https://spring.io/projects/spring-kafka', type: 'documentation' }
    ],
    projectIdea: 'Implement asynchronous event publishing in NearVia when a new job is posted so candidate workers receive instant updates.'
  },
  redis: {
    category: 'databases',
    feasibility: 'high',
    resources: [
      { name: 'Redis University Free Courses', url: 'https://university.redis.io', type: 'course' },
      { name: 'Spring Data Redis Guide', url: 'https://spring.io/guides/gs/messaging-redis/', type: 'guide' }
    ],
    projectIdea: 'Add a Redis caching layer to NearVia to cache popular job searches within 5 km and throttle rate-limiting.'
  },
  aws: {
    category: 'cloud',
    feasibility: 'medium',
    resources: [
      { name: 'AWS Cloud Practitioner Essentials (Free)', url: 'https://explore.skillbuilder.aws/learn/course/external/view/elearning/134/aws-cloud-practitioner-essentials', type: 'course' },
      { name: 'Deploy a Spring Boot App on AWS Elastic Beanstalk', url: 'https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/create_deploy_Java.html', type: 'guide' }
    ],
    projectIdea: 'Host the Leave Management MySQL database on AWS RDS and deploy the Spring Boot backend on ECS / App Runner.'
  },
  ci_cd: {
    category: 'devops',
    feasibility: 'high',
    resources: [
      { name: 'GitHub Actions Documentation', url: 'https://docs.github.com/en/actions', type: 'documentation' },
      { name: 'Automating Java Builds with GitHub Actions', url: 'https://docs.github.com/en/actions/automating-builds-and-tests/building-and-testing-java-with-maven', type: 'guide' }
    ],
    projectIdea: 'Build a GitHub Actions workflow for NearVia that runs automated unit tests, linter, and builds the production bundle on pull requests.'
  },
  graphql: {
    category: 'backend',
    feasibility: 'high',
    resources: [
      { name: 'Introduction to GraphQL', url: 'https://graphql.org/learn/', type: 'tutorial' },
      { name: 'Spring for GraphQL Docs', url: 'https://docs.spring.io/spring-graphql/reference/', type: 'documentation' }
    ],
    projectIdea: 'Expose a GraphQL query endpoint for NearVia job listings allowing clients to request exact fields.'
  },
  nextjs: {
    category: 'frontend',
    feasibility: 'high',
    resources: [
      { name: 'Next.js App Router Learn Course', url: 'https://nextjs.org/learn', type: 'interactive' }
    ],
    projectIdea: 'Port the NearVia worker landing pages to Next.js with Server-Side Rendering for SEO and fast loading.'
  },
  junit_testing: {
    category: 'testing',
    feasibility: 'high',
    resources: [
      { name: 'JUnit 5 User Guide', url: 'https://junit.org/junit5/docs/current/user-guide/', type: 'documentation' },
      { name: 'Mockito Framework Tutorial', url: 'https://site.mockito.org', type: 'tutorial' }
    ],
    projectIdea: 'Write comprehensive JUnit 5 and Mockito service unit tests for the Leave Management transaction workflows.'
  }
};

/**
 * Extract all verified skills from the candidate profile
 */
export function getVerifiedCandidateSkills(profile = null) {
  const p = profile || loadCandidateProfile();
  const verified = new Set();
  const partiallyDemonstrated = new Set();

  if (p.skills) {
    for (const group of Object.values(p.skills)) {
      if (Array.isArray(group)) {
        group.forEach(s => verified.add(s.toLowerCase().trim()));
      }
    }
  }

  if (p.projects && Array.isArray(p.projects)) {
    p.projects.forEach(proj => {
      if (proj.techStack && Array.isArray(proj.techStack)) {
        proj.techStack.forEach(t => verified.add(t.toLowerCase().trim()));
      }
      if (proj.name.toLowerCase().includes('rover') || proj.name.toLowerCase().includes('aquaponics')) {
        partiallyDemonstrated.add('iot');
        partiallyDemonstrated.add('embedded systems');
      }
    });
  }

  // Partially demonstrated categories
  partiallyDemonstrated.add('fastapi');
  partiallyDemonstrated.add('opencv');
  partiallyDemonstrated.add('scikit-learn');
  partiallyDemonstrated.add('postgis');

  return { verified, partiallyDemonstrated };
}

/**
 * Analyzes skill gaps by comparing verified profile against active job descriptions
 */
export function analyzeSkillGaps({ limit = 50, suitableOnly = true } = {}) {
  const profile = loadCandidateProfile();
  const { verified, partiallyDemonstrated } = getVerifiedCandidateSkills(profile);
  const db = getDatabase();

  // Query jobs
  let query = 'SELECT * FROM jobs';
  const params = [];
  if (suitableOnly) {
    query += ' WHERE (experience_min <= 2 OR experience_min IS NULL)';
  }
  query += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);

  const jobs = db.prepare(query).all(...params);
  const totalJobsAnalyzed = jobs.length;

  const skillFrequency = {};
  const mandatoryFrequency = {};
  const preferredFrequency = {};

  // Count skill requirements across jobs
  for (const job of jobs) {
    let reqSkills = [];
    let prefSkills = [];

    try {
      reqSkills = job.required_skills ? JSON.parse(job.required_skills) : [];
    } catch {
      reqSkills = (job.required_skills || '').split(',').map(s => s.trim()).filter(Boolean);
    }

    try {
      prefSkills = job.preferred_skills ? JSON.parse(job.preferred_skills) : [];
    } catch {
      prefSkills = (job.preferred_skills || '').split(',').map(s => s.trim()).filter(Boolean);
    }

    // Also extract common tech mentions from JD text
    const descText = (job.description || '').toLowerCase();
    const commonKeywords = [
      'java', 'spring boot', 'react', 'javascript', 'typescript', 'sql', 'mysql', 'postgresql',
      'python', 'docker', 'kubernetes', 'aws', 'kafka', 'redis', 'microservices', 'ci/cd',
      'graphql', 'next.js', 'junit', 'git', 'rest api', 'mongodb', 'hibernate'
    ];

    for (const kw of commonKeywords) {
      if (descText.includes(kw)) {
        if (!reqSkills.map(s => s.toLowerCase()).includes(kw) && !prefSkills.map(s => s.toLowerCase()).includes(kw)) {
          prefSkills.push(kw);
        }
      }
    }

    reqSkills.forEach(s => {
      const norm = s.toLowerCase().trim();
      if (!norm) return;
      skillFrequency[norm] = (skillFrequency[norm] || 0) + 1;
      mandatoryFrequency[norm] = (mandatoryFrequency[norm] || 0) + 1;
    });

    prefSkills.forEach(s => {
      const norm = s.toLowerCase().trim();
      if (!norm) return;
      skillFrequency[norm] = (skillFrequency[norm] || 0) + 1;
      preferredFrequency[norm] = (preferredFrequency[norm] || 0) + 1;
    });
  }

  // Evaluate each skill into Existing, Partially Demonstrated, Missing
  const analyzedSkills = [];

  for (const [skill, count] of Object.entries(skillFrequency)) {
    const isVerified = isSkillVerified(skill, verified);
    const isPartial = !isVerified && isSkillPartial(skill, partiallyDemonstrated);

    let status = 'missing';
    if (isVerified) status = 'existing';
    else if (isPartial) status = 'partially_demonstrated';

    const mandCount = mandatoryFrequency[skill] || 0;
    const prefCount = preferredFrequency[skill] || 0;
    const marketPct = totalJobsAnalyzed > 0 ? Math.round((count / totalJobsAnalyzed) * 100) : 0;

    // Prioritization: mandatory count has 2x weight
    const score = (mandCount * 2) + prefCount;
    let priority = 'low';
    if (score >= 10 || mandCount >= 5) priority = 'critical';
    else if (score >= 5 || mandCount >= 2) priority = 'high';
    else if (score >= 2) priority = 'medium';

    const catalogKey = findCatalogKey(skill);
    const catalogInfo = catalogKey ? SKILL_CATALOG[catalogKey] : null;

    analyzedSkills.push({
      skill,
      status,
      totalDemand: count,
      mandatoryDemand: mandCount,
      preferredDemand: prefCount,
      marketPercentage: marketPct,
      priority,
      category: catalogInfo?.category || guessCategory(skill),
      learningResources: catalogInfo?.resources || [
        { name: `Official ${skill} Documentation`, url: `https://www.google.com/search?q=${encodeURIComponent(skill + ' documentation')}`, type: 'docs' }
      ],
      recommendedProject: catalogInfo?.projectIdea || `Build a small proof-of-concept integrating ${skill} with an existing Java or React project.`
    });
  }

  // Sort: missing & partially demonstrated by priority, then existing
  analyzedSkills.sort((a, b) => {
    const statusOrder = { missing: 0, partially_demonstrated: 1, existing: 2 };
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    return b.totalDemand - a.totalDemand;
  });

  const existingSkills = analyzedSkills.filter(s => s.status === 'existing');
  const partialSkills = analyzedSkills.filter(s => s.status === 'partially_demonstrated');
  const missingSkills = analyzedSkills.filter(s => s.status === 'missing');

  return {
    totalJobsAnalyzed,
    summary: {
      totalSkillsTracked: analyzedSkills.length,
      existingCount: existingSkills.length,
      partialCount: partialSkills.length,
      missingCount: missingSkills.length
    },
    topGaps: missingSkills.slice(0, 10),
    partiallyDemonstrated: partialSkills,
    verifiedStrengths: existingSkills,
    allSkills: analyzedSkills
  };
}

/**
 * Returns or initializes the skill roadmap in the database
 */
export function getSkillRoadmap() {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM skill_roadmap ORDER BY priority DESC, market_frequency DESC').all();

  if (rows.length > 0) {
    return rows.map(formatRoadmapRow);
  }

  // If empty, auto-seed with top gaps
  const analysis = analyzeSkillGaps({ limit: 40 });
  const toSeed = [...analysis.topGaps.slice(0, 6), ...analysis.partiallyDemonstrated.slice(0, 3)];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO skill_roadmap 
    (skill_name, category, status, priority, market_frequency, is_mandatory_demand, learning_resources_json, recommended_project_idea)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const item of toSeed) {
    insert.run(
      item.skill,
      item.category,
      item.status === 'partially_demonstrated' ? 'in_progress' : 'missing',
      item.priority,
      item.totalDemand,
      item.mandatoryDemand > 0 ? 1 : 0,
      JSON.stringify(item.learningResources),
      item.recommendedProject
    );
  }

  return db.prepare('SELECT * FROM skill_roadmap ORDER BY priority DESC, market_frequency DESC').all().map(formatRoadmapRow);
}

/**
 * Updates a roadmap item.
 * STRICT SAFETY RULE:
 * Never mark a skill as acquired simply because it appears in a resume or suggestion.
 * verifiedEvidence MUST be provided if transitioning to 'acquired'.
 */
export function updateSkillRoadmapItem(skillName, { status, priority, targetCompletionDate, verifiedEvidence }) {
  if (!skillName) throw new Error('Skill name is required.');

  if (status === 'acquired') {
    if (!verifiedEvidence || verifiedEvidence.trim().length < 10) {
      throw new Error(
        'Strict Verification Rule: You cannot mark a skill as acquired without providing tangible proof or verified project evidence (minimum 10 characters).'
      );
    }
  }

  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM skill_roadmap WHERE LOWER(skill_name) = LOWER(?)').get(skillName);

  if (!existing) {
    // Insert new item
    db.prepare(`
      INSERT INTO skill_roadmap (skill_name, status, priority, target_completion_date, verified_evidence, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(
      skillName,
      status || 'missing',
      priority || 'medium',
      targetCompletionDate || null,
      verifiedEvidence || null
    );
  } else {
    db.prepare(`
      UPDATE skill_roadmap
      SET status = COALESCE(?, status),
          priority = COALESCE(?, priority),
          target_completion_date = COALESCE(?, target_completion_date),
          verified_evidence = COALESCE(?, verified_evidence),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      status || null,
      priority || null,
      targetCompletionDate || null,
      verifiedEvidence || null,
      existing.id
    );
  }

  const updated = db.prepare('SELECT * FROM skill_roadmap WHERE LOWER(skill_name) = LOWER(?)').get(skillName);
  return formatRoadmapRow(updated);
}

function isSkillVerified(skill, verifiedSet) {
  const s = skill.toLowerCase();
  if (verifiedSet.has(s)) return true;
  // Substring or variant matching
  for (const v of verifiedSet) {
    if (v === s || v.includes(s) || s.includes(v)) return true;
  }
  return false;
}

function isSkillPartial(skill, partialSet) {
  const s = skill.toLowerCase();
  if (partialSet.has(s)) return true;
  for (const p of partialSet) {
    if (p === s || p.includes(s) || s.includes(p)) return true;
  }
  return false;
}

function findCatalogKey(skill) {
  const s = skill.toLowerCase();
  if (s.includes('docker')) return 'docker';
  if (s.includes('k8s') || s.includes('kubernetes')) return 'kubernetes';
  if (s.includes('microservice')) return 'microservices';
  if (s.includes('kafka')) return 'kafka';
  if (s.includes('redis')) return 'redis';
  if (s.includes('aws') || s.includes('cloud')) return 'aws';
  if (s.includes('ci/cd') || s.includes('jenkins') || s.includes('github actions')) return 'ci_cd';
  if (s.includes('graphql')) return 'graphql';
  if (s.includes('next.js') || s.includes('nextjs')) return 'nextjs';
  if (s.includes('junit') || s.includes('mockito') || s.includes('testing')) return 'junit_testing';
  return null;
}

function guessCategory(skill) {
  const s = skill.toLowerCase();
  if (s.includes('sql') || s.includes('db') || s.includes('postgres') || s.includes('mongo') || s.includes('data')) return 'databases';
  if (s.includes('react') || s.includes('css') || s.includes('html') || s.includes('front') || s.includes('ui')) return 'frontend';
  if (s.includes('cloud') || s.includes('docker') || s.includes('k8s') || s.includes('deploy') || s.includes('ops')) return 'devops';
  return 'backend';
}

function formatRoadmapRow(row) {
  let resources = [];
  try {
    resources = row.learning_resources_json ? JSON.parse(row.learning_resources_json) : [];
  } catch {
    resources = [];
  }
  return {
    id: row.id,
    skillName: row.skill_name,
    category: row.category,
    status: row.status,
    priority: row.priority,
    marketFrequency: row.market_frequency,
    isMandatoryDemand: Boolean(row.is_mandatory_demand),
    targetCompletionDate: row.target_completion_date,
    verifiedEvidence: row.verified_evidence,
    learningResources: resources,
    recommendedProjectIdea: row.recommended_project_idea,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
