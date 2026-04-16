import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/api';

// Shape mirrors backend routes/calibration.ts GET /api/calibration response.
// Keep this in sync with LeagueCalibrationSnapshot / ReliabilityBucketWithError
// in backend/src/scripts/runWeeklyCalibration.ts.

export interface ReliabilityBucket {
  bucket: string;                    // e.g. "50-55"
  midpoint: number;                  // 0..1, bucket center
  predictedWinRate: number;          // 0..1
  actualWinRate: number;             // 0..1 (0 when count=0)
  count: number;
  calibrationErrorPts: number | null; // signed (predicted - actual) * 100; null when count=0
}

export interface LeagueCalibration {
  league: string;                    // "NFL" | ... | "ALL"
  brierScore: number;
  logLoss: number;
  sampleSize: number;
  overallAccuracy: number | null;    // 0..100 with 1 decimal
  reliabilityCurve: ReliabilityBucket[];
  note?: string;
}

export interface CalibrationResponse {
  generatedAt: string;               // ISO timestamp
  description: string;
  perLeague: LeagueCalibration[];
  warnings?: string[];
}

const STALE_MS = 5 * 60 * 1000; // 5 min — calibration doesn't change intra-day

export function useCalibration() {
  return useQuery<CalibrationResponse>({
    queryKey: ['model-calibration'],
    queryFn: () => api.get<CalibrationResponse>('/api/calibration'),
    staleTime: STALE_MS,
  });
}
