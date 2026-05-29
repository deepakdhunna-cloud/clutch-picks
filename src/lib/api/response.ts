interface ApiResponse<T> {
  data: T;
}

export function unwrapApiResponse<T>(json: unknown): T {
  if (
    json !== null &&
    typeof json === 'object' &&
    Object.prototype.hasOwnProperty.call(json, 'data')
  ) {
    return (json as ApiResponse<T>).data;
  }

  return json as T;
}

export function definedApiResult<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}
