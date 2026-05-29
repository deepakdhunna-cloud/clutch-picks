import { getCalibrationBadge, weightedCalibrationErrorPts } from '../model-calibration-display';

const curveFromScreenshot = [
  { count: 9, calibrationErrorPts: 4.2 },
  { count: 34, calibrationErrorPts: -4.6 },
  { count: 50, calibrationErrorPts: -8.5 },
  { count: 647, calibrationErrorPts: -0.4 },
  { count: 338, calibrationErrorPts: -0.8 },
  { count: 120, calibrationErrorPts: 10.0 },
  { count: 41, calibrationErrorPts: -13.0 },
  { count: 15, calibrationErrorPts: 5.8 },
  { count: 5, calibrationErrorPts: 17.5 },
  { count: 1, calibrationErrorPts: -17.5 },
];

describe('model calibration display helpers', () => {
  it('weights bucket error by sample count', () => {
    expect(weightedCalibrationErrorPts(curveFromScreenshot)).toBeCloseTo(2.4, 1);
  });

  it('does not call the model miscalibrated from Brier score alone', () => {
    const badge = getCalibrationBadge({
      sampleSize: 1260,
      brierScore: 0.245,
      logLoss: 0.683,
      reliabilityCurve: curveFromScreenshot,
    });

    expect(badge.label).toBe('watching');
    expect(badge.tone).toBe('warning');
  });

  it('shows no data instead of random-baseline scores for empty leagues', () => {
    expect(
      getCalibrationBadge({
        sampleSize: 0,
        brierScore: null,
        logLoss: null,
        reliabilityCurve: [],
      }),
    ).toEqual({ tone: 'neutral', label: 'no data' });
  });
});
