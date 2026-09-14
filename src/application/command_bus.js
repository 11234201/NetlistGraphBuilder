export function createCommandBus(handlers = {}, options = {}) {
  const handlerByType = new Map(Object.entries(handlers));
  const onDispatch = typeof options.onDispatch === "function" ? options.onDispatch : null;
  return Object.freeze({
    dispatch(command) {
      if (!command?.type) throw new Error("Command type is required");
      const handler = handlerByType.get(command.type);
      if (!handler) throw new Error(`Unknown command: ${command.type}`);
      const result = handler(command);
      onDispatch?.(command, result);
      return result;
    },
    types() {
      return [...handlerByType.keys()];
    }
  });
}
