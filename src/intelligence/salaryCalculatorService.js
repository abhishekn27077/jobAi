import { getDatabase } from '../db/schema.js';

export const SALARY_DISCLAIMER = 'Notice: Salary calculations are non-binding estimates based on official Indian income tax statutes and standard Indian corporate payroll structures. Actual net in-hand pay will vary based on your employer’s specific flexi-benefit plans, HRA exemptions, voluntary PF declarations, and final payroll processing.';

/**
 * Audits statutory tax accuracy and authority for a requested Indian Financial Year.
 * Strictly distinguishes enacted Finance Acts under the Income-tax Act, 1961 (FY 2024-25 & FY 2025-26)
 * from the structural transition to the Income-tax Act, 2025 effective 1 April 2026 (FY 2026-27 / Tax Year 2026-27).
 */
export function auditTaxAccuracyForFinancialYear(financialYear = 'FY 2025-26') {
  const fy = String(financialYear).trim().toUpperCase();

  // FY 2024-25 (PY 2024-25 / AY 2025-26)
  if (fy === 'FY 2024-25' || fy === '2024-25' || fy === 'AY 2025-26' || fy === 'FY24-25' || fy === '2024') {
    return {
      financialYear: 'FY 2024-25',
      assessmentYear: 'AY 2025-26',
      applicablePeriod: 'Previous Year 2024-25 (1 April 2024 to 31 March 2025)',
      verified: true,
      status: 'verified_statutory',
      governingAct: 'Income-tax Act, 1961 as amended by Finance (No. 2) Act, 2024 (Act No. 15 of 2024)',
      statutoryCertainty: 'enacted_and_notified',
      basicExemptionLimit: 300000,
      standardDeduction: 75000,
      rebateThreshold: 700000,
      maxRebate: 25000,
      cessRate: 0.04,
      governingSections: [
        'Section 115BAC(1A) — Slabs: 0-3L (0%), 3-7L (5%), 7-10L (10%), 10-12L (15%), 12-15L (20%), >15L (30%)',
        'Section 16(ia) — Enhanced Standard Deduction ₹75,000 for salaried employees under New Regime',
        'Section 115BAC(2)(i) — Express disallowance of Section 16(iii) Professional Tax deduction under New Regime',
        'Section 87A — Full Tax Rebate up to ₹25,000 for total taxable income up to ₹7,00,000',
        'Section 87A Proviso — Statutory Marginal Relief for total income marginally exceeding ₹7,00,000',
        'Section 2(11) — 4% Health and Education Cess on income tax and surcharge'
      ],
      disclaimer: 'Statutorily verified against Finance (No. 2) Act, 2024. Under Section 115BAC, Professional Tax is not deductible from taxable income. For salaried individuals, gross salary up to ₹7,75,000 incurs zero income tax after standard deduction.'
    };
  }

  // FY 2025-26 (PY 2025-26 / AY 2026-27)
  if (fy === 'FY 2025-26' || fy === '2025-26' || fy === 'AY 2026-27' || fy === 'FY25-26' || fy === '2025') {
    return {
      financialYear: 'FY 2025-26',
      assessmentYear: 'AY 2026-27',
      applicablePeriod: 'Previous Year 2025-26 (1 April 2025 to 31 March 2026)',
      verified: true,
      status: 'verified_statutory',
      governingAct: 'Income-tax Act, 1961 as amended by Finance Act, 2025',
      statutoryCertainty: 'enacted_and_notified',
      basicExemptionLimit: 400000,
      standardDeduction: 75000,
      rebateThreshold: 1200000,
      maxRebate: 60000,
      cessRate: 0.04,
      governingSections: [
        'Section 115BAC(1A) — Revised Slabs: 0-4L (0%), 4-8L (5%), 8-12L (10%), 12-16L (15%), 16-20L (20%), 20-24L (25%), >24L (30%)',
        'Section 16(ia) — Standard Deduction ₹75,000 for salaried employees under New Regime',
        'Section 115BAC(2)(i) — Express disallowance of Section 16(iii) Professional Tax deduction under New Regime',
        'Section 87A — Enhanced Tax Rebate up to ₹60,000 for total taxable income up to ₹12,00,000 (Nil tax liability)',
        'Section 87A Proviso — Statutory Marginal Relief for total income marginally exceeding ₹12,00,000',
        '4% Health and Education Cess on income tax and surcharge'
      ],
      disclaimer: 'Statutorily verified against Finance Act, 2025. Basic exemption raised to ₹4 Lakh. Under Section 115BAC, Professional Tax is not deductible from taxable income. For salaried individuals, gross salary up to ₹12,75,000 incurs zero income tax after standard deduction.'
    };
  }

  // FY 2026-27 (Tax Year 2026-27) — Income-tax Act, 2025 effective 1 April 2026
  if (fy === 'FY 2026-27' || fy === '2026-27' || fy === 'TAX YEAR 2026-27' || fy === 'TY 2026-27' || fy === 'FY26-27' || fy === '2026') {
    return {
      financialYear: 'FY 2026-27',
      taxYear: 'Tax Year 2026-27 (1 April 2026 to 31 March 2027)',
      verified: true,
      status: 'verified_statutory',
      governingAct: 'Income-tax Act, 2025 (Enacted 21 August 2025, Effective 1 April 2026)',
      statutoryCertainty: 'enacted_and_effective',
      basicExemptionLimit: 400000,
      standardDeduction: 75000,
      rebateThreshold: 1200000,
      maxRebate: 60000,
      cessRate: 0.04,
      actTransition: 'The Income-tax Act, 2025 formally repeals and replaces the Income-tax Act, 1961 effective 1 April 2026. It discontinues the dual Previous Year / Assessment Year framework in favor of a unified "Tax Year" (1 April to 31 March) while carrying forward the simplified New Tax Regime schedules.',
      governingSections: [
        'Income-tax Act, 2025 Default Personal Tax Slabs: 0-4L (0%), 4-8L (5%), 8-12L (10%), 12-16L (15%), 16-20L (20%), 20-24L (25%), >24L (30%)',
        'Section 19(1) Table Sl. No. 1 — Deduction for sum paid as tax on employment pursuant to Article 276(2) of the Constitution (Professional Tax)',
        'Section 19(1) Table Sl. No. 2 — Consolidated Standard Deduction of ₹75,000 for salaried employees and pensioners',
        'Tax Rebate up to ₹60,000 ensuring zero tax for taxable income up to ₹12,00,000',
        'Statutory Marginal Relief Mechanism capping tax on income marginally exceeding ₹12,00,000 to the excess amount',
        '4% Health and Education Cess'
      ],
      disclaimer: 'Statutorily verified against the Income-tax Act, 2025 effective 1 April 2026. Unified Tax Year 2026-27 framework with Section 19(1) employment-tax deduction and standard deduction ensuring zero tax on income up to ₹12,77,400 for salaried individuals paying ₹2,400 PT.'
    };
  }

  return {
    financialYear: fy,
    verified: false,
    status: 'unverified_period',
    governingAct: 'Unknown',
    statutoryCertainty: 'unverified',
    error: `Tax rules for period "${financialYear}" cannot be reliably verified against official Indian statutes.`
  };
}

/**
 * Calculates Indian Income Tax under the New Tax Regime for FY 2024-25
 * Governing Law: Income-tax Act, 1961 as amended by Finance (No. 2) Act, 2024.
 *
 * Slabs (Section 115BAC(1A)):
 *   ₹0 to ₹3,00,000: Nil (0%)
 *   ₹3,00,001 to ₹7,00,000: 5% (₹4,00,000 @ 5% = ₹20,000)
 *   ₹7,00,001 to ₹10,00,000: 10% (₹3,00,000 @ 10% = ₹30,000)
 *   ₹10,00,001 to ₹12,00,000: 15% (₹2,00,000 @ 15% = ₹30,000)
 *   ₹12,00,001 to ₹15,00,000: 20% (₹3,00,000 @ 20% = ₹60,000)
 *   Above ₹15,00,000: 30%
 *
 * Section 87A Rebate:
 *   If taxable income <= ₹7,00,000, full rebate of tax payable (max ₹25,000) -> Tax is ₹0.
 *
 * Section 87A Marginal Relief:
 *   If taxable income marginally exceeds ₹7,00,000, tax payable cannot exceed
 *   the excess of taxable income over ₹7,00,000.
 */
export function calculateNewRegimeTaxForFY2024(taxableIncome) {
  if (taxableIncome <= 0) {
    return { baseTax: 0, rebate87A: 0, marginalRelief: 0, cess: 0, totalTax: 0, financialYear: 'FY 2024-25', governingAct: 'Finance (No. 2) Act, 2024' };
  }

  // 1. Calculate standard slab tax
  let unrebatedTax = 0;
  if (taxableIncome > 1500000) {
    unrebatedTax += (taxableIncome - 1500000) * 0.30;
    unrebatedTax += 300000 * 0.20; // 12L - 15L = 60,000
    unrebatedTax += 200000 * 0.15; // 10L - 12L = 30,000
    unrebatedTax += 300000 * 0.10; // 7L - 10L = 30,000
    unrebatedTax += 400000 * 0.05; // 3L - 7L = 20,000
  } else if (taxableIncome > 1200000) {
    unrebatedTax += (taxableIncome - 1200000) * 0.20;
    unrebatedTax += 200000 * 0.15;
    unrebatedTax += 300000 * 0.10;
    unrebatedTax += 400000 * 0.05;
  } else if (taxableIncome > 1000000) {
    unrebatedTax += (taxableIncome - 1000000) * 0.15;
    unrebatedTax += 300000 * 0.10;
    unrebatedTax += 400000 * 0.05;
  } else if (taxableIncome > 700000) {
    unrebatedTax += (taxableIncome - 700000) * 0.10;
    unrebatedTax += 400000 * 0.05;
  } else if (taxableIncome > 300000) {
    unrebatedTax += (taxableIncome - 300000) * 0.05;
  }

  // 2. Section 87A Rebate: if taxable income <= 7,00,000, 100% tax rebate (max ₹25,000)
  if (taxableIncome <= 700000) {
    return {
      baseTax: unrebatedTax,
      rebate87A: unrebatedTax,
      marginalRelief: 0,
      cess: 0,
      totalTax: 0,
      financialYear: 'FY 2024-25',
      governingAct: 'Finance (No. 2) Act, 2024'
    };
  }

  // 3. Section 87A Marginal Relief: tax payable cannot exceed excess income over ₹7,00,000
  const excessIncome = taxableIncome - 700000;
  let marginalRelief = 0;
  let taxPayableBeforeCess = unrebatedTax;

  if (unrebatedTax > excessIncome) {
    marginalRelief = unrebatedTax - excessIncome;
    taxPayableBeforeCess = excessIncome;
  }

  // 4. 4% Health & Education Cess
  const cess = Math.round(taxPayableBeforeCess * 0.04);
  const totalTax = Math.round(taxPayableBeforeCess + cess);

  return {
    baseTax: Math.round(unrebatedTax),
    rebate87A: 0,
    marginalRelief: Math.round(marginalRelief),
    cess,
    totalTax,
    financialYear: 'FY 2024-25',
    governingAct: 'Finance (No. 2) Act, 2024'
  };
}

/**
 * Calculates Indian Income Tax under the Revised New Tax Regime for FY 2025-26
 * Governing Law: Income-tax Act, 1961 as amended by Finance Act, 2025.
 *
 * Slabs (Section 115BAC(1A)):
 *   ₹0 to ₹4,00,000: Nil (0%)
 *   ₹4,00,001 to ₹8,00,000: 5% (₹4,00,000 @ 5% = ₹20,000)
 *   ₹8,00,001 to ₹12,00,000: 10% (₹4,00,000 @ 10% = ₹40,000)
 *   ₹12,00,001 to ₹16,00,000: 15% (₹4,00,000 @ 15% = ₹60,000)
 *   ₹16,00,001 to ₹20,00,000: 20% (₹4,00,000 @ 20% = ₹80,000)
 *   ₹20,00,001 to ₹24,00,000: 25% (₹4,00,000 @ 25% = ₹1,00,000)
 *   Above ₹24,00,000: 30%
 *
 * Section 87A Rebate:
 *   If taxable income <= ₹12,00,000, full rebate of tax payable (max ₹60,000) -> Tax is ₹0.
 *
 * Section 87A Marginal Relief:
 *   If taxable income marginally exceeds ₹12,00,000, tax payable cannot exceed
 *   the excess of taxable income over ₹12,00,000.
 */
export function calculateNewRegimeTaxForFY2025(taxableIncome) {
  if (taxableIncome <= 0) {
    return { baseTax: 0, rebate87A: 0, marginalRelief: 0, cess: 0, totalTax: 0, financialYear: 'FY 2025-26', governingAct: 'Finance Act, 2025' };
  }

  // 1. Calculate standard slab tax
  let unrebatedTax = 0;
  if (taxableIncome > 2400000) {
    unrebatedTax += (taxableIncome - 2400000) * 0.30;
    unrebatedTax += 400000 * 0.25; // 20L - 24L = 100,000
    unrebatedTax += 400000 * 0.20; // 16L - 20L = 80,000
    unrebatedTax += 400000 * 0.15; // 12L - 16L = 60,000
    unrebatedTax += 400000 * 0.10; // 8L - 12L = 40,000
    unrebatedTax += 400000 * 0.05; // 4L - 8L = 20,000
  } else if (taxableIncome > 2000000) {
    unrebatedTax += (taxableIncome - 2000000) * 0.25;
    unrebatedTax += 400000 * 0.20;
    unrebatedTax += 400000 * 0.15;
    unrebatedTax += 400000 * 0.10;
    unrebatedTax += 400000 * 0.05;
  } else if (taxableIncome > 1600000) {
    unrebatedTax += (taxableIncome - 1600000) * 0.20;
    unrebatedTax += 400000 * 0.15;
    unrebatedTax += 400000 * 0.10;
    unrebatedTax += 400000 * 0.05;
  } else if (taxableIncome > 1200000) {
    unrebatedTax += (taxableIncome - 1200000) * 0.15;
    unrebatedTax += 400000 * 0.10;
    unrebatedTax += 400000 * 0.05;
  } else if (taxableIncome > 800000) {
    unrebatedTax += (taxableIncome - 800000) * 0.10;
    unrebatedTax += 400000 * 0.05;
  } else if (taxableIncome > 400000) {
    unrebatedTax += (taxableIncome - 400000) * 0.05;
  }

  // 2. Section 87A Rebate: if taxable income <= 12,00,000, 100% tax rebate (max ₹60,000)
  if (taxableIncome <= 1200000) {
    return {
      baseTax: unrebatedTax,
      rebate87A: unrebatedTax,
      marginalRelief: 0,
      cess: 0,
      totalTax: 0,
      financialYear: 'FY 2025-26',
      governingAct: 'Finance Act, 2025'
    };
  }

  // 3. Section 87A Marginal Relief: tax payable cannot exceed excess income over ₹12,00,000
  const excessIncome = taxableIncome - 1200000;
  let marginalRelief = 0;
  let taxPayableBeforeCess = unrebatedTax;

  if (unrebatedTax > excessIncome) {
    marginalRelief = unrebatedTax - excessIncome;
    taxPayableBeforeCess = excessIncome;
  }

  // 4. 4% Health & Education Cess
  const cess = Math.round(taxPayableBeforeCess * 0.04);
  const totalTax = Math.round(taxPayableBeforeCess + cess);

  return {
    baseTax: Math.round(unrebatedTax),
    rebate87A: 0,
    marginalRelief: Math.round(marginalRelief),
    cess,
    totalTax,
    financialYear: 'FY 2025-26',
    governingAct: 'Finance Act, 2025'
  };
}

/**
 * Calculates Indian Income Tax under the Income-tax Act, 2025 for FY 2026-27 (Tax Year 2026-27).
 * Governing Law: Income-tax Act, 2025 (effective 1 April 2026).
 *
 * Employs the modern unified Tax Year framework with ₹4 Lakh basic exemption,
 * ₹12 Lakh rebate threshold, and marginal relief.
 */
export function calculateNewRegimeTaxForFY2026(taxableIncome) {
  const result = calculateNewRegimeTaxForFY2025(taxableIncome);
  return {
    ...result,
    financialYear: 'FY 2026-27',
    taxYear: 'Tax Year 2026-27',
    governingAct: 'Income-tax Act, 2025 (effective 1 April 2026)'
  };
}

/**
 * Master dispatcher for New Tax Regime income tax calculation across financial years.
 * Accurately routes to FY 2024-25, FY 2025-26, or FY 2026-27 rules.
 */
export function calculateNewRegimeTax(taxableIncome, financialYear = 'FY 2025-26') {
  const fyStr = String(financialYear).trim().toUpperCase();

  if (fyStr.includes('2024')) {
    return calculateNewRegimeTaxForFY2024(taxableIncome);
  }

  if (fyStr.includes('2026')) {
    return calculateNewRegimeTaxForFY2026(taxableIncome);
  }

  // Default to FY 2025-26 (Finance Act, 2025)
  return calculateNewRegimeTaxForFY2025(taxableIncome);
}

/**
 * Calculates Indian Income Tax under the Old Tax Regime.
 * Available only when employee explicitly opts out of the default New Tax Regime.
 *
 * Slabs:
 *   ₹0 to ₹2,50,000: Nil (0%)
 *   ₹2,50,001 to ₹5,00,000: 5% (₹2,50,000 @ 5% = ₹12,500)
 *   ₹5,00,001 to ₹10,00,000: 20% (₹5,00,000 @ 20% = ₹1,00,000)
 *   Above ₹10,00,000: 30%
 *
 * Section 87A Rebate:
 *   If taxable income <= ₹5,00,000, rebate of 100% up to ₹12,500 -> Tax is ₹0.
 */
export function calculateOldRegimeTax(taxableIncome) {
  if (taxableIncome <= 0) {
    return { baseTax: 0, rebate87A: 0, marginalRelief: 0, cess: 0, totalTax: 0, regime: 'old_regime' };
  }

  if (taxableIncome <= 500000) {
    let unrebated = 0;
    if (taxableIncome > 250000) {
      unrebated = (taxableIncome - 250000) * 0.05;
    }
    return {
      baseTax: unrebated,
      rebate87A: unrebated,
      marginalRelief: 0,
      cess: 0,
      totalTax: 0,
      regime: 'old_regime'
    };
  }

  let tax = 0;
  if (taxableIncome > 1000000) {
    tax += (taxableIncome - 1000000) * 0.30;
    tax += 500000 * 0.20; // 5L - 10L = 100,000
    tax += 250000 * 0.05; // 2.5L - 5L = 12,500
  } else if (taxableIncome > 500000) {
    tax += (taxableIncome - 500000) * 0.20;
    tax += 250000 * 0.05;
  }

  const cess = Math.round(tax * 0.04);
  const totalTax = Math.round(tax + cess);

  return {
    baseTax: Math.round(tax),
    rebate87A: 0,
    marginalRelief: 0,
    cess,
    totalTax,
    regime: 'old_regime'
  };
}

/**
 * Calculates detailed in-hand take-home pay, employer contributions, and net savings for an Indian job offer.
 * Strictly distinguishes:
 *   1. CTC (Cost to Company): Total annual package including employer contributions & variable pay.
 *   2. Fixed Gross Salary: Employee's gross earnings before payroll deductions and tax exemptions.
 *   3. Taxable Income: Fixed Gross minus allowable statutory deductions (Standard Deduction & applicable employment tax).
 *      STATUTORY NOTE ON PROFESSIONAL TAX:
 *      - Under the New Tax Regime of the Income-tax Act, 1961 (FY 2024-25 & FY 2025-26), Section 115BAC(2)(i)
 *        expressly disallows Section 16(iii) Professional Tax deduction from taxable income.
 *      - Under the Income-tax Act, 2025 (FY 2026-27 / Tax Year 2026-27, effective 1 April 2026), Section 19(1) Table
 *        Serial No. 1 explicitly allows deduction of sum paid as tax on employment pursuant to Article 276(2)
 *        of the Constitution (Professional Tax, up to ₹2,500/year).
 *      - Under the Old Tax Regime (1961 Act), Professional Tax is deductible under Section 16(iii).
 *   4. Estimated Take-Home Pay (Net In-Hand): Fixed Gross minus Employee Payroll Deductions (EPF, PT, TDS).
 */
export function calculateOfferTakeHome({
  ctcAnnual,
  fixedBaseAnnual = null,
  variableAnnual = 0,
  joiningBonus = 0,
  workMode = 'onsite',
  location = 'Bengaluru',
  taxRegime = 'new_regime',
  financialYear = null,
  deductions80C = 0,
  otherDeductions = 0,
  professionalTaxAnnual = null
}) {
  const ctc = Number(ctcAnnual);
  if (!ctc || ctc <= 0) throw new Error('Valid annual CTC is required.');

  // Normalize financial year and regime
  const isOldRegime = taxRegime === 'old' || taxRegime === 'old_regime';
  const effectiveRegime = isOldRegime ? 'old_regime' : 'new_regime';

  let effectiveFy = financialYear;
  if (!effectiveFy) {
    if (String(taxRegime).includes('2024')) {
      effectiveFy = 'FY 2024-25';
    } else if (String(taxRegime).includes('2026')) {
      effectiveFy = 'FY 2026-27';
    } else {
      effectiveFy = 'FY 2025-26';
    }
  }

  const taxAudit = auditTaxAccuracyForFinancialYear(effectiveFy);

  const variablePay = Number(variableAnnual) || 0;
  const bonus = Number(joiningBonus) || 0;

  // 1. Basic Salary Component (~40% of fixed gross in standard Indian IT payroll)
  let fixedGross = fixedBaseAnnual !== null ? Number(fixedBaseAnnual) : Math.round((ctc - variablePay) * 0.90);
  if (fixedGross <= 0) fixedGross = Math.round(ctc * 0.90);

  const basicAnnual = Math.round(fixedGross * 0.40);

  // 2. Employer Contributions (Part of CTC, NOT received as monthly take-home):
  // - Employer EPF: 12% of basic, capped at statutory ₹1,800/mo (₹21,600/year) in standard corporate structures
  const employerEpfAnnual = Math.min(Math.round(basicAnnual * 0.12), 21600);
  // - Gratuity: ~4.81% of basic salary accrued under Payment of Gratuity Act, 1972
  const gratuityAnnual = Math.round(basicAnnual * 0.0481);
  const totalEmployerContributions = employerEpfAnnual + gratuityAnnual;

  // 3. Employee Payroll Deductions (Deducted on monthly payslip from gross salary):
  // - Employee EPF: Matches employer EPF contribution
  const employeeEpfAnnual = employerEpfAnnual;
  const employeeEpfMonthly = Math.round(employeeEpfAnnual / 12);

  // - Professional Tax (PT): ₹200/mo (₹2,400/year standard in Karnataka & Maharashtra tech hubs; capped at ₹2,500 under Art 276(2))
  const ptAnnual = professionalTaxAnnual !== null
    ? Math.min(Math.max(0, Number(professionalTaxAnnual) || 0), 2500)
    : 2400;
  const ptMonthly = Math.round(ptAnnual / 12);

  // 4. Taxable Salary & Income Tax Computation:
  // - Standard Deduction: ₹75,000 for New Regime (Finance (No. 2) Act, 2024 / Finance Act, 2025 / Income-tax Act, 2025); ₹50,000 for Old Regime
  const standardDeduction = isOldRegime ? 50000 : 75000;
  const declared80C = isOldRegime ? Math.min(Number(deductions80C) || 0, 150000) : 0;
  const declaredOther = isOldRegime ? (Number(otherDeductions) || 0) : 0;

  // IMPORTANT STATUTORY DISTINCTION FOR PROFESSIONAL TAX:
  // - Under the Old Tax Regime (1961 Act), Professional Tax is deductible under Section 16(iii).
  // - Under the New Tax Regime for FY 2024-25 and FY 2025-26, Section 115BAC(2)(i) of the Income-tax Act, 1961
  //   expressly disallows Section 16(iii) Professional Tax deduction from taxable income.
  // - Under the Income-tax Act, 2025 (FY 2026-27 / Tax Year 2026-27, effective 1 April 2026), Section 19(1) Table
  //   Sl. No. 1 explicitly allows deduction of sum paid as tax on employment pursuant to Article 276(2)
  //   of the Constitution from salary income.
  const isFy2026 = ['FY 2026-27', '2026-27', 'TAX YEAR 2026-27', 'TY 2026-27', 'FY26-27', '2026'].includes(String(effectiveFy).trim().toUpperCase()) || String(effectiveFy).includes('2026');

  let eligibleEmploymentTaxDeduction = 0;
  if (isOldRegime) {
    eligibleEmploymentTaxDeduction = ptAnnual; // Section 16(iii) of Income-tax Act, 1961
  } else if (isFy2026) {
    eligibleEmploymentTaxDeduction = ptAnnual; // Section 19(1) Table Sl. No. 1 of Income-tax Act, 2025
  } else {
    eligibleEmploymentTaxDeduction = 0; // Section 115BAC(2)(i) of Income-tax Act, 1961 disallows for FY 2024-25 and FY 2025-26 under New Regime
  }

  let taxableIncome = 0;
  if (isOldRegime) {
    taxableIncome = Math.max(0, fixedGross - standardDeduction - eligibleEmploymentTaxDeduction - declared80C - declaredOther);
  } else {
    taxableIncome = Math.max(0, fixedGross - standardDeduction - eligibleEmploymentTaxDeduction);
  }

  const taxDetails = isOldRegime
    ? calculateOldRegimeTax(taxableIncome)
    : calculateNewRegimeTax(taxableIncome, effectiveFy);

  const annualIncomeTax = taxDetails.totalTax;
  const monthlyIncomeTax = Math.round(annualIncomeTax / 12);

  // 5. Monthly & Annual Take-Home (Net In-Hand) Pay:
  // Order of operations: Gross salary -> Deductions on payslip (EPF + PT + TDS).
  // Notice: PT is deducted once on the payslip as an actual payroll deduction, and
  // (where eligible in FY 2026-27 / Old Regime) used to reduce taxable income for TDS.
  // PT is never deducted twice from cash take-home pay.
  const monthlyGross = Math.round(fixedGross / 12);
  const totalMonthlyDeductions = employeeEpfMonthly + ptMonthly + monthlyIncomeTax;
  const monthlyInHand = Math.max(0, monthlyGross - totalMonthlyDeductions);
  const annualInHand = (monthlyInHand * 12) + bonus;

  // 6. Cost of Living & Net Savings Estimates
  const colEstimateMonthly = estimateCostOfLiving(location, workMode);
  const netMonthlySavings = Math.max(0, monthlyInHand - colEstimateMonthly);

  const assumptions = [
    `Governing Tax Statute: ${taxAudit.governingAct}`,
    `Applicable Period: ${taxAudit.applicablePeriod || taxAudit.taxYear}`,
    `Standard Deduction: ₹${standardDeduction.toLocaleString('en-IN')} (Statutory for salaried employees)`,
    isOldRegime
      ? `Old Tax Regime: Professional Tax (₹${ptAnnual.toLocaleString('en-IN')}) and Chapter VI-A deductions allowed; Section 87A rebate up to ₹5 LPA.`
      : (isFy2026
          ? `New Tax Regime (Income-tax Act, 2025): Section 19(1) Table Sl. No. 1 employment-tax deduction (₹${eligibleEmploymentTaxDeduction.toLocaleString('en-IN')}) and Sl. No. 2 standard deduction (₹${standardDeduction.toLocaleString('en-IN')}) allowed; full rebate up to ₹${taxAudit.rebateThreshold.toLocaleString('en-IN')} with statutory marginal relief.`
          : `New Tax Regime (Section 115BAC): Professional Tax is NOT deductible from taxable income; standard deduction ₹${standardDeduction.toLocaleString('en-IN')}; full rebate up to ₹${taxAudit.rebateThreshold.toLocaleString('en-IN')} with statutory marginal relief.`),
    `Basic Salary: 40% of Fixed Gross (₹${basicAnnual.toLocaleString('en-IN')}/year)`,
    `Provident Fund (EPF): 12% of Basic capped at statutory ₹1,800/mo (₹${employeeEpfAnnual.toLocaleString('en-IN')}/year)`,
    `Professional Tax: ₹${ptMonthly.toLocaleString('en-IN')}/month (₹${ptAnnual.toLocaleString('en-IN')}/year${isFy2026 ? ', eligible as Section 19(1) deduction' : ''})`,
    `Health & Education Cess: 4% applied to net income tax`,
    `Estimated Living Expenses: ₹${colEstimateMonthly.toLocaleString('en-IN')}/mo (${workMode.toUpperCase()} in ${location})`
  ];

  if (taxAudit.actTransition) {
    assumptions.push(`Statutory Transition Note: ${taxAudit.actTransition}`);
  }

  return {
    ctcAnnual: ctc,
    fixedGrossAnnual: fixedGross,
    variablePayAnnual: variablePay,
    joiningBonus: bonus,
    taxRegime: effectiveRegime,
    location,
    workMode,
    employerContributions: {
      employerEpf: employerEpfAnnual,
      gratuity: gratuityAnnual,
      totalEmployerContributions
    },
    employeeDeductions: {
      monthly: {
        epf: employeeEpfMonthly,
        professionalTax: ptMonthly,
        incomeTaxTds: monthlyIncomeTax,
        totalDeductions: totalMonthlyDeductions
      },
      annual: {
        epf: employeeEpfAnnual,
        professionalTax: ptAnnual,
        incomeTaxTotal: annualIncomeTax,
        totalDeductions: employeeEpfAnnual + ptAnnual + annualIncomeTax
      }
    },
    taxBreakdown: {
      financialYear: effectiveFy,
      taxableIncome,
      standardDeduction,
      employmentTaxDeduction: eligibleEmploymentTaxDeduction,
      baseTax: taxDetails.baseTax,
      rebate87A: taxDetails.rebate87A,
      marginalRelief: taxDetails.marginalRelief || 0,
      cess: taxDetails.cess,
      finalTaxPayable: annualIncomeTax,
      governingAct: taxAudit.governingAct
    },
    monthlyBreakdown: {
      grossPay: monthlyGross,
      epfDeduction: employeeEpfMonthly,
      professionalTax: ptMonthly,
      incomeTaxTds: monthlyIncomeTax,
      totalDeductions: totalMonthlyDeductions,
      netInHand: monthlyInHand
    },
    annualBreakdown: {
      grossPay: fixedGross,
      epfTotal: employeeEpfAnnual,
      professionalTaxTotal: ptAnnual,
      incomeTaxTotal: annualIncomeTax,
      totalDeductions: employeeEpfAnnual + ptAnnual + annualIncomeTax,
      netInHand: annualInHand
    },
    costOfLiving: {
      location,
      workMode,
      estimatedMonthlyExpense: colEstimateMonthly,
      estimatedNetMonthlySavings: netMonthlySavings,
      estimatedAnnualSavings: netMonthlySavings * 12
    },
    financialYear: effectiveFy,
    taxAudit,
    assumptions,
    disclaimer: SALARY_DISCLAIMER,
    statutoryDisclaimer: taxAudit.disclaimer
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
      taxRegime: o.taxRegime || 'new_regime',
      financialYear: o.financialYear || null,
      professionalTaxAnnual: o.professionalTaxAnnual !== undefined ? o.professionalTaxAnnual : null
    });

    const learningScore = Number(o.learningScore) || 3;
    const noticePeriodDays = Number(o.noticePeriodDays) || 30;

    return {
      offerName: o.offerName || `${o.company} - ${o.role}`,
      company: o.company,
      role: o.role,
      location: o.location || 'Bengaluru',
      workMode: o.workMode || 'onsite',
      ctcAnnual: calc.ctcAnnual,
      fixedPayAnnual: calc.fixedGrossAnnual,
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
    calc.fixedGrossAnnual,
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

function estimateCostOfLiving(location = '', workMode = 'onsite') {
  const loc = (location || '').toLowerCase();
  const mode = (workMode || '').toLowerCase();

  if (mode === 'remote') {
    return 8000;
  }

  if (loc.includes('bangalore') || loc.includes('bengaluru')) {
    return mode === 'hybrid' ? 18000 : 22000;
  }

  if (loc.includes('hyderabad') || loc.includes('pune')) {
    return mode === 'hybrid' ? 15000 : 18000;
  }

  if (loc.includes('mumbai') || loc.includes('gurgaon') || loc.includes('delhi')) {
    return 24000;
  }

  return 15000;
}
