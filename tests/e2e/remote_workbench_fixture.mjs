import { mkdtemp, mkdir, writeFile, copyFile, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const dir = await mkdtemp(join(tmpdir(),"ngb-acceptance-"));
for (const sub of ["inputs/base","inputs/eco","inputs/中文 timing","second","deploy"]) await mkdir(join(dir,sub),{recursive:true});
const inputs = join(dir,"inputs");
const files = {
 "top.v":"module top(input a, output y); BUF u_buf (.A(a),.Y(y)); endmodule",
 "extra.v":"module extra(input a, output y); assign y = a; endmodule",
 "T1.rpt":"@module top\npoint at rt slack\na 0.10 0.20 0.10\n",
 "中文 timing/T2.rpt":"@module top\npoint at rt slack\ny 0.30 0.25 -0.05\n",
 "eco/top.blif":".model eco\n.inputs n0 n1\n.outputs z_eco\n.names n0 n1 z_eco\n11 1\n.end\n",
 "broken.blif":".model broken\n.inputs a\n.outputs y\n.names missing a y\n11 1\n.end\n"
};
for (const [path,body] of Object.entries(files)) await writeFile(join(inputs,path),body);
await copyFile("examples/aig_mapped_names.blif",join(inputs,"base/top.blif"));
await copyFile("tests/fixtures/aig/shared_cone.dot",join(inputs,"shared_cone.dot"));
if (process.argv[2] !== "--no-elf") {
  await copyFile(resolve(process.argv[2] || "build/native/ngb"),join(dir,"deploy/ngb"));
  await chmod(join(dir,"deploy/ngb"),0o700);
}
console.log(dir);
