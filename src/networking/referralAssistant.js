import { loadCandidateProfile } from '../profile/profileManager.js';

export function generateReferralMessage(job, recipientType = 'engineer', recipientName = 'Hi') {
  const profile = loadCandidateProfile();
  const p = profile.personal;
  const company = job ? job.company : 'your company';
  const role = job ? job.title : 'Software Engineer';
  const jobUrl = job ? job.url : '';

  if (recipientType === 'alumni') {
    return {
      channel: 'LinkedIn / Email',
      subject: `AIMS Alumni reaching out regarding ${role} at ${company}`,
      message: `Hello ${recipientName},

Hope you are doing well! 

I noticed your engineering journey at ${company} and wanted to reach out. I recently completed my MCA from AIMS Institutes, Bangalore (Oct 2026), where I was awarded the Best AI Innovation medal at graduation.

I saw the opening for the ${role} role at ${company}${jobUrl ? ` (${jobUrl})` : ''} and my background in Java, Spring Boot, React, and PostgreSQL aligns closely with the role requirements. During my MCA, I built NearVia (a hyperlocal job marketplace with PostGIS and PostgreSQL row-level concurrency) and completed an Advanced Java Full Stack internship with Anudip Foundation.

If you feel my profile might be a strong fit, would you be open to referring me for this position or sharing any advice on the team's engineering process?

My portfolio is available at: ${p.portfolio}
GitHub: ${p.gitHub}

Thank you so much for your time!

Best regards,
${p.fullName}
${p.phone} | ${p.email}`
    };
  }

  if (recipientType === 'recruiter') {
    return {
      channel: 'LinkedIn InMail / Email',
      subject: `Application Inquiry: ${role} - ${p.fullName} (MCA 2026 / Java Full Stack)`,
      message: `Hello ${recipientName},

I hope this message finds you well.

I am writing to express my strong interest in the ${role} position at ${company}. As an MCA graduate (Oct 2026) based in Bangalore with advanced Java Full Stack training from Anudip Foundation, I have solid hands-on experience in Java, Spring Boot, React.js, and relational databases.

I have built full-stack applications, including:
1. NearVia: A hyperlocal jobs platform using React, TypeScript, Node.js, and PostgreSQL/PostGIS.
2. Employee Leave Management System: Java, Spring Boot, Hibernate/JPA, and React.
3. FinSight: AI personal finance tracker with Python FastAPI and React.

I would love to be considered for this opening. Please find my portfolio at ${p.portfolio} and GitHub at ${p.gitHub}.

Thank you for your consideration, and I look forward to hearing from you.

Sincerely,
${p.fullName}
${p.email} | ${p.phone} | Bangalore`
    };
  }

  // Default: Peer Engineer
  return {
    channel: 'LinkedIn Message',
    subject: `Connecting regarding engineering at ${company}`,
    message: `Hi ${recipientName},

I came across your profile and was impressed by the work you and the team are doing at ${company}. 

I am an entry-level Java Full Stack engineer (MCA 2026, Bangalore) with hands-on experience building full-stack web applications in Java, Spring Boot, React, and PostgreSQL. I recently noticed the ${role} opening at ${company} and would love to learn more about the engineering culture.

If you have a brief moment, would you be open to connecting or considering a referral? I have documented my full projects and code at ${p.portfolio} and github.com/abhishekn27077.

Thanks a lot for your time!

Best,
${p.fullName}`
  };
}
