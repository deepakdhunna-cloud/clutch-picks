export type CalibrationBadgeTone = 'neutral' | 'positive' | 'warning' | 'danger';

type CalibrationBucketInput = {
  count: number;
  calibrationErrorPts: number | null;
};

type CalibrationBadgeInput = {
  sampleSize: number;
  brierScore: number | null;
  logLoss: number | null;
  reliabilityCurve: CalibrationBucketInput[];
};

export function weightedCalibrationErrorPts(
  curve: CalibrationBucketInput[],
): number | null {
  const populated = curve.filter(
    (b) =>
      b.count > 0 &&
      b.calibrationErrorPts !== null &&
      Number.isFinite(b.calibrationErrorPts),
  );
  const total = populated.reduce((sum, b) => sum + b.count, 0);
  if (total === 0) return null;

  const weightedError = populated.reduce(
    (sum, b) => sum + Math.abs(b.calibrationErrorPts!) * b.count,
    0,
  );
  return weightedError / total;
}

export function getCalibrationBadge(
  calibration: CalibrationBadgeInput,
): { tone: CalibrationBadgeTone; label: string } {
  if (
    calibration.sampleSize <= 0 ||
    calibration.brierScore === null ||
    calibration.logLoss === null
  ) {
    return { tone: 'neutral', label: 'no data' };
  }

  if (calibration.sampleSize < 100) {
    return { tone: 'neutral', label: 'insufficient data' };
  }

  const weightedError = weightedCalibrationErrorPts(calibration.reliabilityCurve);
  if (weightedError !== null) {
    if (
      weightedError <= 2 &&
      calibration.brierScore <= 0.24 &&
      calibration.logLoss <= 0.7
    ) {
      return { tone: 'positive', label: 'calibrated' };
    }
    if (weightedError <= 6) {
      return { tone: 'warning', label: 'watching' };
    }
  }

  if (calibration.brierScore <= 0.22 && calibration.logLoss <= 0.7) {
    return { tone: 'positive', label: 'calibrated' };
  }
  if (calibration.brierScore <= 0.25 && calibration.logLoss <= 0.7) {
    return { tone: 'warning', label: 'watching' };
  }

  return { tone: 'danger', label: 'needs tuning' };
}
