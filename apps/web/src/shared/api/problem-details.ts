export type ProblemDetails = {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  code?: string;
  requestId?: string;
  errors?: Record<string, string[]>;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly errors?: Record<string, string[]>;
  readonly problem?: ProblemDetails;

  constructor(status: number, problem?: ProblemDetails, fallbackMessage?: string) {
    super(problem?.detail || problem?.title || fallbackMessage || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = problem?.code;
    this.requestId = problem?.requestId;
    this.errors = problem?.errors;
    this.problem = problem;
  }
}
