export type WorkerEnvironment = {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
};

const worker = {
  fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
    return environment.ASSETS.fetch(request);
  },
};

export default worker;
