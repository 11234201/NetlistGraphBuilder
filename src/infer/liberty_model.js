import { LIBERTY_LIMITS } from "../contracts/liberty.js";
import { immutableSnapshot } from "../foundation/immutable_snapshot.js";
import { analyzeLibertyFunction } from "./liberty_function.js";

const DIRECTIONS = new Set(["input", "output", "inout", "internal"]);
const own = (object, key) => Object.hasOwn(object || {}, key) ? object[key] : null;

export function* buildLibertyModelSteps(parsed) {
  const cells = Object.create(null), libraries = [], diagnostics = [], libraryNames = new Set();
  const fail = (message, group) => { throw new Error(`${parsed.sourceName}:${group.span.start.line}:${group.span.start.column}: ${message}`); };
  const warn = (code, message, group, cellName) => {
    if (diagnostics.length >= LIBERTY_LIMITS.maxDiagnostics) fail("maxDiagnostics exceeded", group);
    diagnostics.push({ code, severity: "warning", message, cellName, sourceName: parsed.sourceName, span: group.span });
  };
  for (const library of parsed.libraries) {
    if (library.args.length !== 1 || !library.args[0]) fail("Library requires one name", library);
    const libraryName = library.args[0];
    if (libraryNames.has(libraryName)) fail(`Duplicate library ${libraryName}`, library);
    libraryNames.add(libraryName);
    libraries.push(immutableSnapshot({ name: libraryName, attributes: library.attributes, span: library.span }));
    const types = new Map();
    for (const group of library.groups.filter((item) => item.type === "type")) {
      if (group.args.length !== 1 || types.has(group.args[0])) fail("Invalid or duplicate bus type", group);
      types.set(group.args[0], group.attributes);
    }
    for (const group of library.groups.filter((item) => item.type === "cell").sort((a, b) => compare(a.args[0], b.args[0]))) {
      if (group.args.length !== 1 || !group.args[0]) fail("Cell requires one name", group);
      const name = group.args[0];
      if (own(cells, name)) fail(`Ambiguous cell ${name}; load one process corner at a time`, group);
      const pins = Object.create(null), powerPins = Object.create(null), buses = [];
      let pinCount = 0;
      const addPin = (pinName, attributes, pinGroup, inherited = null) => {
        if (!pinName || own(pins, pinName) || own(powerPins, pinName)) fail(`Duplicate or empty pin ${pinName} in ${name}`, pinGroup);
        if (++pinCount > LIBERTY_LIMITS.maxPinsPerCell) fail("maxPinsPerCell exceeded", pinGroup);
        const direction = attributes.direction ?? inherited?.direction ?? "unknown";
        if (!DIRECTIONS.has(direction)) warn("invalid-direction", `${name}.${pinName}: missing or invalid direction`, pinGroup, name);
        pins[pinName] = {
          name: pinName, displayName: pinName, direction: DIRECTIONS.has(direction) ? direction : "unknown",
          function: attributes.function ?? inherited?.function ?? null,
          threeState: attributes.three_state ?? inherited?.three_state ?? null,
          clock: attributes.clock === "true", span: pinGroup.span
        };
      };
      for (const child of group.groups) {
        if (["pin", "pg_pin"].includes(child.type) && child.args.length === 0)
          fail(`${child.type} requires at least one name`, child);
        if (child.type === "pin") for (const pinName of child.args) addPin(pinName, child.attributes, child);
        if (child.type === "pg_pin") for (const pinName of child.args) {
          if (!pinName || own(powerPins, pinName) || own(pins, pinName)) fail(`Duplicate or empty pg_pin ${pinName}`, child);
          if (++pinCount > LIBERTY_LIMITS.maxPinsPerCell) fail("maxPinsPerCell exceeded", child);
          powerPins[pinName] = { name: pinName, type: child.attributes.pg_type || "unknown", span: child.span };
        }
        if (child.type === "bundle") warn("unsupported-bundle", `${name}: bundle interface is not interpreted`, child, name);
        if (child.type !== "bus") continue;
        const busName = child.args[0], type = types.get(child.attributes.bus_type);
        const from = Number(type?.bit_from), to = Number(type?.bit_to), width = Math.abs(from - to) + 1;
        if (child.args.length !== 1 || !type || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
            !Number.isSafeInteger(width) || width > LIBERTY_LIMITS.maxPinsPerCell ||
            (type.bit_width !== undefined && Number(type.bit_width) !== width)) {
          fail(`Unsupported or invalid bus range ${name}.${busName}`, child);
        }
        const naming = library.attributes.bus_naming_style || "%s[%d]";
        if (!/^%s[^%]*%d[^%]*$/.test(naming)) fail(`Unsupported bus_naming_style ${naming}`, child);
        const members = new Map();
        for (const member of child.groups) {
          if (member.args.length === 0) fail("Bus member pin requires at least one name", member);
          for (const memberName of member.args) {
            if (members.has(memberName)) fail(`Duplicate bus member ${memberName}`, member);
            members.set(memberName, member);
          }
        }
        const memberNames = [];
        for (let bit = from; ; bit += from <= to ? 1 : -1) {
          const bitName = naming.replace(/%[sd]/g, (placeholder) => placeholder === "%s" ? busName : String(bit));
          memberNames.push(bitName);
          const member = members.get(bitName);
          addPin(bitName, member?.attributes || {}, member || child, child.attributes);
          members.delete(bitName);
          if (memberNames.length % 256 === 0) yield { cellName: name, pinCount };
          if (bit === to) break;
        }
        if (members.size) fail(`Unsupported bus member or range ${[...members.keys()].join(", ")}`, child);
        const directions = new Set(memberNames.map((key) => pins[key].direction));
        if (directions.size !== 1) fail(`Mixed-direction bus ${name}.${busName} requires explicit bit mapping`, child);
        addPin(busName, { direction: [...directions][0] }, child);
        buses.push({ name: busName, from, to, members: memberNames });
      }
      const sequentialGroups = group.groups.filter((item) => ["ff", "latch", "ff_bank", "latch_bank"].includes(item.type));
      const sequential = sequentialGroups.map((item) => ({ type: item.type, args: item.args, attributes: item.attributes }));
      const outputs = Object.values(pins).filter((pin) => pin.direction === "output");
      const inputs = Object.values(pins).filter((pin) => pin.direction === "input").map((pin) => pin.name);
      let logic = { kind: "blackbox", status: "interface-only" };
      if (Object.values(pins).some((pin) => pin.threeState !== null || pin.direction === "inout")) {
        logic = { kind: "blackbox", status: "three-state-or-inout" };
      } else if (sequential.length) {
        const simpleFf = sequential.length === 1 && sequential[0].type === "ff" &&
          sequential[0].attributes.clocked_on && sequential[0].attributes.next_state;
        logic = { kind: simpleFf ? "dff" : "blackbox", status: "sequential" };
      } else if (!buses.length && outputs.length === 1 && outputs[0].function !== null) {
        logic = analyzeLibertyFunction(outputs[0].function, inputs);
        if (logic.status === "unsupported") warn("unsupported-function", `${name}: ${logic.reason}`, group, name);
      }
      cells[name] = immutableSnapshot({ name, displayName: name, libraryName, sourceName: parsed.sourceName,
        pins, powerPins, buses, sequential, logic, span: group.span });
      yield { cellName: name };
    }
  }
  return Object.freeze({ kind: "liberty-library", version: 1, sourceName: parsed.sourceName,
    sizeBytes: parsed.sizeBytes, libraries: Object.freeze(libraries), cells: Object.freeze(cells),
    diagnostics: immutableSnapshot(diagnostics), cellCount: Object.keys(cells).length });
}

export function buildLibertyModel(parsed) {
  const steps = buildLibertyModelSteps(parsed);
  let result;
  do { result = steps.next(); } while (!result.done);
  return result.value;
}

export function findLibertyCell(dataset, name) { return own(dataset?.cells, name); }
function compare(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
