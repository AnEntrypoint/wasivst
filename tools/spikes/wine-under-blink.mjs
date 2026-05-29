// Feasibility spike: does Wine64 run under webix/blink (NOJIT interpreter)?
//
// This is the architecture-gating test for the webix-based wasivst (see
// docs/adr/0001-performance-architecture.md). It mounts an Alpine + Wine64
// rootfs tar into webix and runs `wine64 --version`, then a trivial Win64 PE,
// capturing stdout/stderr and the list of unsupported-syscall warnings blink
// emits. Those warnings are the syscall-gap map that feeds the
// webix-syscall-coverage-map work item.
//
// Prereqs (not produced here -- this is the runner, the rootfs is the input):
//   1. webix installed and importable (npm i in c:/dev/webix, or add as a dep).
//   2. An Alpine+Wine64 musl rootfs tar at the path given by ROOTFS env or
//      argv[2]. Build it on a Linux host / CI with apk, e.g.:
//        apk add --root /rootfs --initdb -X <alpine-community> wine
//        tar -C /rootfs -cf alpine-wine64.tar .
//      Alpine v3.19 community ships wine for x86_64 (witnessed:
//      pkgs.alpinelinux.org). Wine pulls a large dep closure (freetype,
//      fontconfig, X libs); expect hundreds of MB.
//   3. Optionally a trivial Win64 PE at PE env / argv[3] to LoadLibrary-test.
//
// Usage:
//   node tools/spikes/wine-under-blink.mjs <webixDir> <rootfs.tar> [trivial.exe]
//
// Exit 0 = wine ran and reported a version. Non-zero = it did not; the captured
// warnings tell you which blink syscalls Wine needs that are missing.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const webixDir = process.argv[2] || process.env.WEBIX_DIR || "../webix";
const rootfsPath = process.argv[3] || process.env.ROOTFS;
const pePath = process.argv[4] || process.env.PE;

if (!rootfsPath) {
  console.error("need an Alpine+Wine64 rootfs tar: argv[3] or ROOTFS env");
  process.exit(2);
}

const { createBlinkHost } = await import(
  pathToFileURL(join(webixDir, "src/index.js")).href
);

const warnings = [];
const host = await createBlinkHost({
  // capture blink's "unsupported syscall: __syscall_*" lines as the gap map
  onStderr: (line) => {
    if (/unsupported syscall/i.test(line)) warnings.push(line.trim());
  },
});

host.mountTarBytes(readFileSync(rootfsPath));

const ver = await host.runElf(host.Module.FS.readFile("/usr/bin/wine64"), {
  argv: ["wine64", "--version"],
  progname: "/usr/bin/wine64",
});
console.log("wine64 --version:");
console.log("  exit:", ver.exitCode, "signal:", ver.signal ?? "none");
console.log("  stdout:", JSON.stringify(ver.stdout));
console.log("  stderr (first 2KB):", JSON.stringify((ver.stderr || "").slice(0, 2048)));

if (pePath) {
  host.Module.FS.writeFile("/trivial.exe", readFileSync(pePath));
  const run = await host.runElf(host.Module.FS.readFile("/usr/bin/wine64"), {
    argv: ["wine64", "/trivial.exe"],
    progname: "/usr/bin/wine64",
  });
  console.log("wine64 /trivial.exe:");
  console.log("  exit:", run.exitCode, "signal:", run.signal ?? "none");
  console.log("  stdout:", JSON.stringify(run.stdout));
}

const uniqueGaps = [...new Set(warnings)].sort();
console.log(`\nunsupported-syscall gap map (${uniqueGaps.length}):`);
for (const g of uniqueGaps) console.log("  " + g);

const ran = ver.exitCode === 0 && /wine/i.test(ver.stdout || "");
console.log("\nVERDICT:", ran ? "wine ran under blink" : "wine did NOT run under blink");
process.exit(ran ? 0 : 1);
