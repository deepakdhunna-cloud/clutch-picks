import { definedApiResult, unwrapApiResponse } from '../response';

describe('unwrapApiResponse', () => {
  it('unwraps the normal API data envelope', () => {
    expect(unwrapApiResponse<{ value: number }>({ data: { value: 7 } })).toEqual({ value: 7 });
  });

  it('returns raw JSON when an older endpoint is missing the data envelope', () => {
    expect(
      unwrapApiResponse<{ isDrifting: boolean }>({
        isDrifting: false,
        rollingAccuracy7d: 58,
      }),
    ).toEqual({
      isDrifting: false,
      rollingAccuracy7d: 58,
    });
  });

  it('normalizes empty API results to null for React Query', () => {
    expect(definedApiResult(undefined)).toBeNull();
    expect(definedApiResult({ ok: true })).toEqual({ ok: true });
  });
});
