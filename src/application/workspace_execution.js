// Shared scheduling policy for Single and Compare. Callers supply scoped jobs
// and presentation callbacks; this boundary owns sync/async and stale commits.
export function createWorkspaceExecution({ jobs }) {
  return Object.freeze({
    execute({ provider, tasks, onStarted = () => {}, onCommit, onError, onSettled = () => {} }) {
      const executions = [];
      let active = true;
      const cancel = () => {
        if (!active) return;
        active = false;
        for (const execution of executions) execution?.cancel?.();
      };
      const fail = (error) => {
        if (!active) return;
        cancel();
        onError(error);
      };
      const commit = (results) => {
        if (!active) return;
        if (results.every((result) => result.status === "committed")) onCommit(results);
        onSettled(results);
      };
      try {
        const asynchronous = provider.executionMode === "async";
        for (const task of tasks) {
          const session = task.beginComputation();
          const request = { sessionId: session.sessionId, kind: task.kind, run: task.run };
          const execution = asynchronous ? jobs.start(request) : jobs.runSync(request);
          executions.push(execution);
          // A later task may fail during startup before Promise.all is attached.
          if (asynchronous) execution.promise.catch(() => {});
        }
        if (asynchronous) {
          const completion = Promise.all(executions.map((execution) => execution.promise));
          const handled = completion.then(commit).catch(fail);
          try { onStarted(executions); } catch (error) { fail(error); }
          return handled;
        }
        commit(executions);
      } catch (error) { fail(error); }
    }
  });
}
