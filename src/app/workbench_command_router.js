// The composition boundary chooses the active workspace. Legacy controllers
// retain their implementation and capabilities; alternate workspaces expose
// only the commands they support.
export function createWorkbenchCommandRouter() {
  let handler = null;
  return Object.freeze({
    connect(next) { handler = next; },
    route(name, action, args) { return handler ? handler(name, action, args) : action(...args); }
  });
}
