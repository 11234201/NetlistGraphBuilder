// Shared scheduling policy for Single and Compare. Callers supply scoped jobs
// and presentation callbacks; this boundary owns sync/async and stale commits.
export function createWorkspaceExecution({ jobs }) {
  return Object.freeze({
    execute({ provider, tasks, signal, onStarted = () => {}, onCommit, onError, onSettled = () => {} }) {
      const executions = [];
      let active = true;
      const cancel = () => {
        if (!active) return;
        active = false;
        signal?.removeEventListener("abort", abort);
        for (const execution of executions) execution?.cancel?.();
      };
      const abort = () => {
        if (!active) return;
        cancel();
        onSettled([{ status: "cancelled" }]);
      };
      const fail = (error) => {
        if (!active) return;
        cancel();
        onError(error);
      };
      const commit = (results) => {
        if (!active) return;
        signal?.removeEventListener("abort", abort);
        if (results.every((result) => result.status === "committed")) onCommit(results);
        onSettled(results);
      };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const asynchronous = provider.executionMode === "async";
        for (const task of tasks) {
          if (!active) break;
          const session = task.beginComputation();
          const request = { sessionId: session.sessionId, kind: task.kind, run: task.run };
          const execution = asynchronous ? jobs.start(request) : jobs.runSync(request);
          executions.push(execution);
          // A later task may fail during startup before Promise.all is attached.
          if (asynchronous) execution.promise.catch(() => {});
          if (!active) execution?.cancel?.();
        }
        if (!active) return;
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
