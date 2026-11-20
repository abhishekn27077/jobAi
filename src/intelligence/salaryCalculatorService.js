import { getDatabase } from '../db/schema.js';

export const SALARY_DISCLAIMER = 'Notice: Salary calculations are estimates based on standard Indian corporate compensation structures and FY 2024-25 tax provisions. Actual net take-home will vary depending on your employer’s specific allowances (HRA, LTA, flexi-benefits) and payroll declarations.';

/**
 * Calculates detailed in-hand take-home pay and net savings for an Indian job offer
 */
export function calculateOfferTakeHome({
  ctcAnnual,
  fixedBaseAnnual = null,
  variableAnnual = 0,
  joiningBonus = 0,
  workMode = 'onsite',
  location = 'Bengaluru',
  taxRegime = 'new_2024'
}) {
  const ctc = Number(ctcAnnual);
  if (!ctc || ctc <= 0) throw new Error('Valid annual CTC is required.');

  // If fixed base is not explicitly provided, standard Indian IT structure has fixed pay ~85-90% of CTC
  const fixedPay = fixedBaseAnnual !== null ? Number(fixedBaseAnnual) : Math.round(ctc * 0.90);
  const variablePay = Number(variableAnnual) || (ctc - fixedPay);
  const bonus = Number(joiningBonus) || 0;

  // Basic salary component (typically 40% of fixed pay in Indian tech)
  const basicAnnual = Math.round(fixedPay * 0.40);

  // Employee Provident Fund (EPF): standard 12% of basic, often capped at statutory ₹1,800/mo (₹21,600/yr)
  // For CTC > ₹6L, many firms cap PF at ₹21,600; for standard, 12% of basic
  const annualEpf = Math.min(Math.round(basicAnnual * 0.12), 21600);
  const monthlyEpf = Math.round(annualEpf / 12);

  // Professional Tax (PT): standard ₹200/month in Karnataka/Maharashtra
  const annualPt = 2400;
  const monthlyPt = 200;

  // Taxable income computation
  let standardDeduction = 75000; // FY 2024-25 New Regime
  if (taxRegime === 'old') {
    standardDeduction = 50000;
  }

  const taxableIncome = Math.max(0, fixedPay - standardDeduction - annualPt);

  // Compute Income Tax based on chosen regime
  const incomeTaxAnnual = calculateIndianIncomeTax(taxableIncome, taxRegime);
  const monthlyTax = Math.round(incomeTaxAnnual / 12);

  // Gross monthly from fixed compensation
  const monthlyGross = Math.round(fixedPay / 12);

  // Net Monthly In-Hand
  const monthlyInHand = Math.max(0, monthlyGross - monthlyEpf - monthlyPt - monthlyTax);
  const annualInHand = (monthlyInHand * 12) + bonus; // Bonus typically paid in first year

  // Cost of living estimates based on location and work mode
  const colEstimateMonthly = estimateCostOfLiving(location, workMode);
  const netMonthlySavings = Math.max(0, monthlyInHand - colEstimateMonthly);

  const assumptions = [
    `Tax Regime: ${taxRegime === 'new_2024' ? 'FY 2024-25 New Regime (Standard Deduction: ₹75,000, Section 87A rebate up to ₹7 LPA)' : 'Old Tax Regime (Standard Deduction: ₹50,000)'}`,
    `Basic Salary Assumption: 40% of Fixed Pay (₹${basicAnnual.toLocaleString('en-IN')}/year)`,
    `Provident Fund (EPF): 12% of Basic capped at statutory ₹1,800/mo (₹${annualEpf.toLocaleString('en-IN')}/year)`,
    `Professional Tax: ₹200/month (₹2,400/year standard in Karnataka/tech hubs)`,
    `Estimated Living Expenses: ₹${colEstimateMonthly.toLocaleString('en-IN')}/mo (${workMode.toUpperCase()} in ${location})`
  ];

  return {
    ctcAnnual: ctc,
    fixedPayAnnual: fixedPay,
    variablePayAnnual: variablePay,
    joiningBonus: bonus,
    taxRegime,
    location,
    workMode,
    monthlyBreakdown: {
      grossPay: monthlyGross,
      epfDeduction: monthlyEpf,
      professionalTax: monthlyPt,
      incomeTaxTds: monthlyTax,
      totalDeductions: monthlyEpf + monthlyPt + monthlyTax,
      netInHand: monthlyInHand
    },
    annualBreakdown: {
      grossPay: fixedPay,
      epfTotal: annualEpf,
      professionalTaxTotal: annualPt,
      incomeTaxTotal: incomeTaxAnnual,
      totalDeductions: annualEpf + annualPt + incomeTaxAnnual,
      netInHand: annualInHand
    },
    costOfLiving: {
      location,
      workMode,
      estimatedMonthlyExpense: colEstimateMonthly,
      estimatedNetMonthlySavings: netMonthlySavings,
      estimatedAnnualSavings: netMonthlySavings * 12
    },
    assumptions,
    disclaimer: SALARY_DISCLAIMER
  };
}

/**
 * Compares multiple offers side-by-side with financial and qualitative metrics
 */
export function compareOffers(offers = []) {
  if (!Array.isArray(offers) || offers.length === 0) {
    return { offers: [], comparisonSummary: 'No offers provided for comparison.' };
  }

  const evaluated = offers.map(o => {
    const calc = calculateOfferTakeHome({
      ctcAnnual: o.ctcAnnual,
      fixedBaseAnnual: o.fixedBaseAnnual,
      variableAnnual: o.variableAnnual,
      joiningBonus: o.joiningBonus,
      workMode: o.workMode || 'onsite',
      location: o.location || 'Bengaluru',
      taxRegime: o.taxRegime || 'new_2024'
    });

    const learningScore = Number(o.learningScore) || 3; // 1-5 scale
    const noticePeriodDays = Number(o.noticePeriodDays) || 30;

    return {
      offerName: o.offerName || `${o.company} - ${o.role}`,
      company: o.company,
      role: o.role,
      location: o.location || 'Bengaluru',
      workMode: o.workMode || 'onsite',
      ctcAnnual: calc.ctcAnnual,
      fixedPayAnnual: calc.fixedPayAnnual,
      variablePayAnnual: calc.variablePayAnnual,
      monthlyInHand: calc.monthlyBreakdown.netInHand,
      annualInHand: calc.annualBreakdown.netInHand,
      monthlyLivingExpense: calc.costOfLiving.estimatedMonthlyExpense,
      netMonthlySavings: calc.costOfLiving.estimatedNetMonthlySavings,
      learningScore,
      noticePeriodDays,
      notes: o.notes || ''
    };
  });

  // Sort by net monthly savings descending
  evaluated.sort((a, b) => b.netMonthlySavings - a.netMonthlySavings);

  return {
    offers: evaluated,
    highestNetSavingsOffer: evaluated[0]?.offerName || null,
    totalCompared: evaluated.length,
    disclaimer: SALARY_DISCLAIMER
  };
}

/**
 * Saves an evaluated offer to the SQLite database
 */
export function saveOfferComparisonRecord(offerData) {
  const calc = calculateOfferTakeHome(offerData);
  const db = getDatabase();

  const insert = db.prepare(`
    INSERT INTO salary_comparisons
    (offer_name, company, role, location, work_mode, ctc_annual, fixed_base_annual, variable_annual, joining_bonus, tax_regime, monthly_in_hand_est, annual_in_hand_est, monthly_deductions_json, cost_of_living_est, net_monthly_savings_est, learning_score, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const info = insert.run(
    offerData.offerName || `${offerData.company} Offer`,
    offerData.company || 'Unknown',
    offerData.role || 'Software Engineer',
    offerData.location || 'Bengaluru',
    offerData.workMode || 'onsite',
    calc.ctcAnnual,
    calc.fixedPayAnnual,
    calc.variablePayAnnual,
    calc.joiningBonus,
    calc.taxRegime,
    calc.monthlyBreakdown.netInHand,
    calc.annualBreakdown.netInHand,
    JSON.stringify(calc.monthlyBreakdown),
    calc.costOfLiving.estimatedMonthlyExpense,
    calc.costOfLiving.estimatedNetMonthlySavings,
    offerData.learningScore || 3,
    offerData.notes || ''
  );

  return {
    id: info.lastInsertRowid,
    ...calc
  };
}

/**
 * Returns saved offer comparisons
 */
export function getSavedOfferComparisons() {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM salary_comparisons ORDER BY id DESC').all();
  return rows.map(r => ({
    id: r.id,
    offerName: r.offer_name,
    company: r.company,
    role: r.role,
    location: r.location,
    workMode: r.work_mode,
    ctcAnnual: r.ctc_annual,
    fixedBaseAnnual: r.fixed_base_annual,
    monthlyInHandEst: r.monthly_in_hand_est,
    annualInHandEst: r.annual_in_hand_est,
    costOfLivingEst: r.cost_of_living_est,
    netMonthlySavingsEst: r.net_monthly_savings_est,
    learningScore: r.learning_score,
    notes: r.notes,
    createdAt: r.created_at
  }));
}

function calculateIndianIncomeTax(taxableIncome, regime) {
  if (taxableIncome <= 0) return 0;

  if (regime === 'new_2024') {
    // Slabs:
    // 0 - 3,00,000: 0%
    // 3,00,001 - 7,00,000: 5%
    // 7,00,001 - 10,00,000: 10%
    // 10,00,001 - 12,00,000: 15%
    // 12,00,001 - 15,00,000: 20%
    // Above 15,00,000: 30%
    // Sec 87A rebate: zero tax if taxable income <= 7,00,000
    if (taxableIncome <= 700000) {
      return 0; // Section 87A full rebate
    }

    let tax = 0;
    if (taxableIncome > 1500000) {
      tax += (taxableIncome - 1500000) * 0.30;
      tax += 300000 * 0.20; // 12-15L
      tax += 200000 * 0.15; // 10-12L
      tax += 300000 * 0.10; // 7-10L
      tax += 400000 * 0.05; // 3-7L
    } else if (taxableIncome > 1200000) {
      tax += (taxableIncome - 1200000) * 0.20;
      tax += 200000 * 0.15;
      tax += 300000 * 0.10;
      tax += 400000 * 0.05;
    } else if (taxableIncome > 1000000) {
      tax += (taxableIncome - 1000000) * 0.15;
      tax += 300000 * 0.10;
      tax += 400000 * 0.05;
    } else if (taxableIncome > 700000) {
      tax += (taxableIncome - 700000) * 0.10;
      tax += 400000 * 0.05;
    }

    // 4% Health & Education Cess
    const cess = tax * 0.04;
    return Math.round(tax + cess);
  } else {
    // Old Regime
    if (taxableIncome <= 500000) return 0; // Sec 87A rebate up to 5L

    let tax = 0;
    if (taxableIncome > 1000000) {
      tax += (taxableIncome - 1000000) * 0.30;
      tax += 500000 * 0.20;
      tax += 250000 * 0.05;
    } else if (taxableIncome > 500000) {
      tax += (taxableIncome - 500000) * 0.20;
      tax += 250000 * 0.05;
    }
    const cess = tax * 0.04;
    return Math.round(tax + cess);
  }
}

function estimateCostOfLiving(location = '', workMode = 'onsite') {
  const loc = (location || '').toLowerCase();
  const mode = (workMode || '').toLowerCase();

  if (mode === 'remote') {
    return 8000; // Minimal home utilities, food, and internet
  }

  if (loc.includes('bangalore') || loc.includes('bengaluru')) {
    return mode === 'hybrid' ? 18000 : 22000; // Rent, food, commute in tech corridor
  }

  if (loc.includes('hyderabad') || loc.includes('pune')) {
    return mode === 'hybrid' ? 15000 : 18000;
  }

  if (loc.includes('mumbai') || loc.includes('gurgaon') || loc.includes('delhi')) {
    return 24000;
  }

  return 15000; // Tier 2 / Default
}
