/** The shape of one entry in the generated operation table, and of the read-side response schemas. Written by hand because the generator imports it. */

/** A read-side schema: only what a tolerant reader checks (types, required fields, nesting). */
export interface Shape {
  ref?: string; const?: unknown; type?: readonly string[]; required?: readonly string[];
  properties?: Readonly<Record<string, Shape>>; items?: Shape; additionalProperties?: Shape; anyOf?: readonly Shape[]; allOf?: readonly Shape[];
}

export interface HttpOperationSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; scopes: readonly string[];
  /** `Idempotency-Key`: R required, A accepted, none (CT-PAGE, the Idem column of 02-rest-api.md) */
  idempotency: 'R' | 'A' | 'none';
  /** none: never send a token; optional: send one when we have it; required: always */
  auth: 'none' | 'optional' | 'required';
  pathParams: readonly string[]; queryParams: readonly string[]; requiredQuery: readonly string[]; ifMatch: boolean;
  body: 'none' | 'optional' | 'required'; requestType: string | null;
  success: readonly number[]; responseType: string | null; response: Shape | null;
  paginated: boolean; maxBodyBytes: number;
}
