import { prisma } from '../utils/prisma';

export interface RawReadingInput {
  pointName?: string;
  referenceLoad: number;
  observedValue: number;
}

export interface EvaluatedReading {
  pointName: string;
  referenceLoad: number;
  observedValue: number;
  error: number;
  percentageError: number;
  maxPermissibleError: number;
  status: 'PASS' | 'FAIL';
}

export interface VerificationEvaluationResult {
  overallResult: 'PASS' | 'FAIL';
  ruleVersion: string;
  ruleDescription: string;
  maxPermissibleError: number;
  readings: EvaluatedReading[];
}

/**
 * Precise numeric rounding to prevent floating-point calculation artifacts.
 * e.g. 10.02 - 10.00 = 0.020000000000001439 -> 0.02
 */
export function preciseRound(value: number, decimals: number = 4): number {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Authoritative Legal Metrology Verification Engine.
 * Evaluates observations against statutory verification rules and tolerances.
 */
export async function evaluateVerificationReadings(
  instrumentType: string,
  verificationInterval: number,
  readingsInput: RawReadingInput[]
): Promise<VerificationEvaluationResult> {
  // 1. Fetch matching rule or fall back to default Class II rule
  let rule = await prisma.instrumentTypeRule.findFirst({
    where: {
      name: { contains: instrumentType }
    }
  });

  if (!rule) {
    rule = await prisma.instrumentTypeRule.findFirst({
      where: { typeCode: 'CLASS_II_SCALE' }
    });
  }

  const ruleVersion = rule?.ruleVersion || 'LM-RULE-2026.1';
  const mpeMultiplier = rule?.mpeMultiplier || 1.0;
  const maxAllowedErrorPct = rule?.maxAllowedErrorPct ?? null;
  const ruleDescription = rule?.description || 'Standard Legal Metrology NAWI Verification Rule';

  // Maximum Permissible Error (MPE) = Multiplier * verification interval (e)
  // Rounded precisely to 5 decimal places
  const mpe = preciseRound(mpeMultiplier * verificationInterval, 5);

  let overallResult: 'PASS' | 'FAIL' = 'PASS';
  const evaluatedReadings: EvaluatedReading[] = [];

  for (let i = 0; i < readingsInput.length; i++) {
    const r = readingsInput[i];
    const ref = preciseRound(Number(r.referenceLoad), 4);
    const obs = preciseRound(Number(r.observedValue), 4);

    // Absolute Error = Observed Value - Reference Load
    const error = preciseRound(obs - ref, 5);

    // Percentage Error = (Error / Reference Load) * 100 (if ref > 0)
    const percentageError = ref > 0 ? preciseRound((error / ref) * 100, 4) : 0;

    // Strict boundary tolerance check:
    // |Error| <= MPE (using epsilon precision guard)
    const isWithinMPE = Math.abs(error) <= (mpe + 0.000001);
    
    // Optional secondary percentage check
    const isWithinPct = maxAllowedErrorPct === null || Math.abs(percentageError) <= maxAllowedErrorPct;

    const pointPass = isWithinMPE && isWithinPct;
    if (!pointPass) {
      overallResult = 'FAIL';
    }

    evaluatedReadings.push({
      pointName: r.pointName || `Test Load Point #${i + 1} (${ref} kg)`,
      referenceLoad: ref,
      observedValue: obs,
      error,
      percentageError,
      maxPermissibleError: mpe,
      status: pointPass ? 'PASS' : 'FAIL',
    });
  }

  return {
    overallResult,
    ruleVersion,
    ruleDescription,
    maxPermissibleError: mpe,
    readings: evaluatedReadings,
  };
}
