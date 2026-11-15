// The only runtime boundary allowed to import the pinned, self-contained vendor module.
// Its embedded WASM and dependency-free distribution are verified by the vendor manifest test.
import { instance, graphvizVersion } from "../../vendor/graphviz/viz.js";
export { instance, graphvizVersion };
