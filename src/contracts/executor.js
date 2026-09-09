/** Defines the replaceable execution port used by synchronous and future worker jobs. */
export function defineExecutor(value) {
  if (!value || typeof value.execute !== "function") throw new Error("Executor requires execute()");
  if (value.cancel !== undefined && typeof value.cancel !== "function") throw new Error("Executor cancel must be a function");
  return Object.freeze({ ...value });
}

export function createImmediateExecutor() {
  return defineExecutor({
    execute(task, context) {
      if (typeof task !== "function") throw new Error("Executor task must be a function");
      return Promise.resolve().then(() => task(context));
    }
  });
}
