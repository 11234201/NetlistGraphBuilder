import { verifyStandaloneSvgStyles } from "./standalone_svg_styles.mjs";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {join} from "node:path";

export async function verifyTimingPresentation({run,page,dir}) {
  const type = "R16CUSTOM";
  const [first,second] = ["u_first","u_second"];
  const design = "module r16(input a,output z); wire mid; " +
    "R16CUSTOM u_first(.Y(a),.A(mid)); R16CUSTOM u_second(.Y(mid),.A(z)); endmodule";
  const libraryName = "r16-pins.lib";
  const library = 'library(r16lib){cell(R16CUSTOM){pin(Y){direction:input;}pin(A){direction:output;function:"Y";}}}';
  const report = "@module r16\npoint at rt slack delay slew edge kind\n" +
    "u_first/Y 0.375 0.520 0.145 0.062 0.120 r pin\n" +
    "u_first/A 0.415 0.520 0.105 0.040 0.081 r pin\n";
  async function ok(...argv) {
    const receipt = await run(...argv);
    assert.equal(receipt.status,"committed",JSON.stringify({command:argv.slice(0,2),receipt}));
    return receipt.result;
  }
  async function inspect(instance) {
    const {connections,summary,properties} = await ok("inspect","show",instance);
    return {pins:Object.fromEntries(connections.map(row => [row.pin,row.direction])),
      gate:Object.fromEntries(summary).Gate,properties:Object.fromEntries(properties)};
  }

  await ok("design","open","--text",design,"--name","r16.v");
  const baseline = await inspect(first);
  assert.deepEqual(baseline.pins,{Y:"output",A:"input"});
  await ok("liberty","load","--text",library,"--name",libraryName);
  const inferred = await inspect(first);
  assert.deepEqual(inferred.pins,{Y:"input",A:"output"});
  assert.equal(inferred.properties.Inference,"library");
  assert.equal(inferred.properties["Library file"],libraryName);
  await ok("liberty","unload");
  assert.deepEqual((await inspect(first)).pins,baseline.pins);
  await ok("liberty","load","--text",library,"--name",libraryName);

  await ok("timing","open","--text",report,"--name","r16.rpt");
  await ok("timing","metric","slack");
  await ok("timing","threshold","0.2");
  await ok("selection","set",first);
  await ok("ui","tab","inspector","timing");
  const inspector = page.locator("#inspectorPanel .timing-list:visible");
  const choice = inspector.locator('[data-timing-pin="Y"][data-timing-metric="slew"]');
  const badge = page.locator('#schematicMount [data-node-id="cell:u_first"] .timing-badge');
  const values = await ok("timing","show","u_first/Y");
  assert.ok(values.some(point => point.slew === 0.12 && point.at === 0.375 && point.slack === 0.145));
  assert.equal(await choice.isChecked(),false);
  await ok("timing","metric","all");
  await ok("timing","badge",first,"Y","slew","off");
  await ok("timing","badge",first,"Y","slew","on");
  await ok("timing","badge-position",first,"top-left");
  assert.ok(await choice.isChecked());
  assert.equal(await inspector.locator("#timingBadgePositionSelect").inputValue(),"top-left");
  assert.ok((await badge.getAttribute("class")).includes("timing-badge-top-left"));
  assert.match(await badge.textContent(),/Y[^Y]*slew 0\.120/);

  async function exportedBadge(label) {
    const file = join(dir,"r16-" + label + ".svg");
    await ok("svg","export","--out",file);
    const text = await readFile(file,"utf8");
    await verifyStandaloneSvgStyles(page, text, "#schematicMount", [".timing-badge", ".pin-critical, .pin-timing",
      ".node.is-selected .node-shape", ".node.is-selected .node-selection-outline"]);
    return page.evaluate(svg => {
      const xml = new DOMParser().parseFromString(svg,"image/svg+xml");
      const match = xml.querySelector('[data-node-id="cell:u_first"] .timing-badge');
      return match && {label:match.textContent,style:match.getAttribute("class")};
    },text);
  }
  const on = await exportedBadge("on");
  assert.ok(on?.style.includes("timing-badge-top-left"));
  assert.match(on.label,/Y[^Y]*slew 0\.120/);
  await ok("timing","badge",first,"Y","slew","off");
  assert.equal(await choice.isChecked(),false);
  const off = await exportedBadge("off");
  assert.doesNotMatch(off?.label || "",/slew 0\.120/);
  assert.deepEqual(await ok("timing","show","u_first/Y"),values);

  assert.equal((await ok("cell-config","edit",type)).instances,2);
  await ok("cell-config","gate","INV");
  await ok("cell-config","pin","Y","output");
  await ok("cell-config","pin","A","input");
  await ok("cell-config","save");
  const pins = {A:"input",Y:"output"};
  for (const id of [first,second]) {
    const configured = await inspect(id);
    assert.deepEqual(configured.pins,pins);
    assert.equal(configured.gate.toLowerCase(),"inv");
    assert.equal(configured.properties.Inference,"user-config");
  }
  await ok("adjust","mode","on");
  await ok("adjust","pin",first,"Y","input");
  assert.deepEqual((await inspect(first)).pins,{A:"input",Y:"input"});
  assert.deepEqual((await inspect(second)).pins,pins);
  assert.deepEqual((await ok("cell-config","show",type)).saved.pins,pins);
  await ok("adjust","mode","off");
  await ok("design","open","--text","module r16_empty(input a,output z); assign z=a; endmodule","--name","r16-empty.v");
  const orphan = await ok("cell-config","edit",type);
  assert.equal(orphan.instances,0);
  for (const [pin,dir] of Object.entries(pins)) {
    assert.equal(await page.locator('#cellDefinitionForm [data-cell-config-pin="' + pin + '"]').inputValue(),dir);
  }
  await ok("cell-config","gate","BUF");
  await ok("cell-config","save");
  const saved = (await ok("cell-config","show",type)).saved;
  assert.deepEqual(saved.pins,pins);
  assert.equal(saved.gateKind,"BUF");
  await ok("cell-config","delete",type);
  await ok("liberty","unload");
  const shapeDesign = "module shapes(input a, output z); wire n; CUSTOM_MACRO unknown(.A(missing),.B(1'b0),.Y(z)); " +
    Array.from({ length: 12 }, (_, i) => "BUF u" + i + "(.A(a),.Y(o" + i + "));").join(" ") + " endmodule";
  await ok("design", "open", "--text", shapeDesign, "--name", "export-shapes.v");
  const shapeFile = join(dir, "shapes.svg");
  await ok("svg", "export", "--out", shapeFile);
  await verifyStandaloneSvgStyles(page, await readFile(shapeFile, "utf8"), "#schematicMount", [
    ".node.blackbox .node-shape", ".node.constant .node-shape", ".node.implicit .node-shape", ".node.hub .node-shape"
  ]);
  return {libraryPin:"Y input",pinBadge:"Y slew 0.120",exportMatches:true,
    instances:2,instanceOverrideIsolated:true,pinsAfterOrphanEdit:Object.keys(saved.pins).sort()};
}
