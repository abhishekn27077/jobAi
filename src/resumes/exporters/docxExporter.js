/**
 * CareerOS — DOCX Resume Exporter
 * Generates an ATS-compliant, single-column Microsoft Word (.docx) document
 * with standard headings, clean typography, and zero tables or floating elements.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Document, Paragraph, TextRun, HeadingLevel, Packer, AlignmentType, UnderlineType } from 'docx';

export async function exportToDocx(resumeData, outputPath) {
  const p = resumeData.personal || {};
  const s = resumeData.summary || '';
  const skills = resumeData.technicalSkills || {};
  const exp = resumeData.experience || [];
  const projects = resumeData.projects || [];
  const edu = resumeData.education || [];
  const certs = resumeData.certificationsAndAwards || [];

  const children = [];

  // 1. Header (Name & Contact)
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [
        new TextRun({
          text: (p.fullName || 'Abhishek N').toUpperCase(),
          bold: true,
          size: 32, // 16pt
          font: 'Arial'
        })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `${p.location || 'Bangalore, India'} | Phone: ${p.phone || ''} | Email: ${p.email || ''}`,
          size: 19, // 9.5pt
          font: 'Arial'
        }),
        new TextRun({
          text: `\nLinkedIn: ${p.linkedIn || ''} | GitHub: ${p.gitHub || ''} | Portfolio: ${p.portfolio || ''}`,
          size: 19,
          font: 'Arial'
        })
      ]
    })
  );

  // Helper for Section Heading
  const addSectionHeader = (title) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
        children: [
          new TextRun({
            text: title.toUpperCase(),
            bold: true,
            size: 22, // 11pt
            font: 'Arial',
            underline: { type: UnderlineType.SINGLE }
          })
        ]
      })
    );
  };

  // 2. Professional Summary
  if (s) {
    addSectionHeader('Professional Summary');
    children.push(
      new Paragraph({
        spacing: { after: 150 },
        children: [
          new TextRun({
            text: s,
            size: 20, // 10pt
            font: 'Arial'
          })
        ]
      })
    );
  }

  // 3. Technical Skills
  addSectionHeader('Technical Skills');
  const addSkillLine = (label, arr) => {
    if (arr && arr.length) {
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: `${label}: `, bold: true, size: 20, font: 'Arial' }),
            new TextRun({ text: arr.join(', '), size: 20, font: 'Arial' })
          ]
        })
      );
    }
  };

  addSkillLine('Programming Languages', skills.languages);
  addSkillLine('Backend & Frameworks', skills.backend);
  addSkillLine('Frontend & Web', skills.frontend);
  addSkillLine('Databases', skills.databases);
  addSkillLine('Developer Tools & Concepts', skills.toolsAndConcepts);

  // 4. Professional Experience
  if (exp.length) {
    addSectionHeader('Professional Experience');
    for (const e of exp) {
      children.push(
        new Paragraph({
          spacing: { before: 100, after: 40 },
          children: [
            new TextRun({ text: `${e.role} — ${e.company}`, bold: true, size: 20, font: 'Arial' }),
            new TextRun({ text: ` | ${e.period}`, italics: true, size: 19, font: 'Arial' })
          ]
        })
      );
      for (const bullet of e.bullets || []) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 40 },
            children: [
              new TextRun({ text: bullet, size: 19, font: 'Arial' })
            ]
          })
        );
      }
    }
  }

  // 5. Relevant Projects
  if (projects.length) {
    addSectionHeader('Relevant Projects');
    for (const proj of projects) {
      children.push(
        new Paragraph({
          spacing: { before: 100, after: 40 },
          children: [
            new TextRun({ text: proj.name, bold: true, size: 20, font: 'Arial' }),
            new TextRun({
              text: ` (Stack: ${(proj.techStack || []).join(', ')})`,
              italics: true,
              size: 19,
              font: 'Arial'
            })
          ]
        })
      );
      if (proj.url || proj.github) {
        const links = [];
        if (proj.url) links.push(`Link: ${proj.url}`);
        if (proj.github) links.push(`GitHub: ${proj.github}`);
        children.push(
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: links.join(' | '), italics: true, size: 18, font: 'Arial' })
            ]
          })
        );
      }
      for (const bullet of proj.bullets || []) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 40 },
            children: [
              new TextRun({ text: bullet, size: 19, font: 'Arial' })
            ]
          })
        );
      }
    }
  }

  // 6. Education
  if (edu.length) {
    addSectionHeader('Education');
    for (const ed of edu) {
      children.push(
        new Paragraph({
          spacing: { before: 80, after: 40 },
          children: [
            new TextRun({ text: `${ed.degree} — ${ed.institution}`, bold: true, size: 20, font: 'Arial' }),
            new TextRun({ text: ` (${ed.period})`, size: 19, font: 'Arial' })
          ]
        })
      );
      if (ed.highlights) {
        children.push(
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: `Honors: ${ed.highlights}`, italics: true, size: 18, font: 'Arial' })
            ]
          })
        );
      }
    }
  }

  // 7. Certifications & Awards
  if (certs.length) {
    addSectionHeader('Certifications & Achievements');
    for (const c of certs) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 40 },
          children: [
            new TextRun({ text: c, size: 19, font: 'Arial' })
          ]
        })
      );
    }
  }

  // Build document
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720, // 0.5 in
              right: 720,
              bottom: 720,
              left: 720
            }
          }
        },
        children
      }
    ]
  });

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}
