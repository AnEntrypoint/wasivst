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
  pathToFileURL(join(webixDir, "src/x86_64-blink.js")).href
);

// blinkenlib.wasm + glue live under the webix dir; createBlinkHost defaults to
// CWD-relative paths, so point it at the webix container assets explicitly.
const host = await createBlinkHost({
  wasmPath: join(webixDir, "containers/blinkenlib.wasm"),
  gluePath: join(webixDir, "containers/blinkenlib.js"),
});

host.mountTarBytes(readFileSync(rootfsPath));

// blink emits "unsupported syscall: __syscall_*" on stderr; collect them from
// each runElf result as the syscall-gap map.
const warnings = [];
const collectGaps = (stderr) => {
  for (const line of (stderr || "").split("\n")) {
    if (/unsupported syscall/i.test(line)) warnings.push(line.trim());
  }
};

// runElf has no env option, and blink has no fork -- but `exec` (no fork) works.
// So drive each loader variant through busybox `sh -c 'export ...; exec wine ...'`,
// which sets env in-process then execs wine over the same blink process.
const FS = host.Module.FS;
const busybox = (() => {
  for (const p of ["/bin/busybox", "/usr/bin/busybox"]) {
    try { return FS.readFile(p); } catch (_) {}
  }
  throw new Error("no busybox in rootfs");
})();

// Witnessed baseline (run 26642058472): plain wine64 --version =>
// "could not load ntdll.so: (null)", 0 unsupported syscalls. These variants
// probe whether the wine-preloader / lib-path / loader is the cause.
const variants = [
  { name: "plain wine64 --version", sh: "exec /usr/bin/wine64 --version" },
  { name: "WINELOADERNOEXEC (skip preloader)", sh: "export WINELOADERNOEXEC=1; exec /usr/bin/wine64 --version" },
  { name: "explicit WINEDLLPATH+LD_LIBRARY_PATH", sh: "export WINEDLLPATH=/usr/lib/wine/x86_64-windows:/usr/lib/wine/x86_64-unix; export LD_LIBRARY_PATH=/usr/lib/wine/x86_64-unix:/usr/lib; exec /usr/bin/wine64 --version" },
  { name: "unix wine loader directly", sh: "exec /usr/lib/wine/x86_64-unix/wine64 --version 2>&1 || exec /usr/lib/wine/wine64 --version" },
  { name: "WINEDEBUG=+loaddll wine64 --version", sh: "export WINEDEBUG=+loaddll,+module; exec /usr/bin/wine64 --version" },
];

const results = [];
for (const v of variants) {
  let r;
  try {
    r = await host.runElf(busybox, { argv: ["sh", "-c", v.sh], progname: "/bin/busybox" });
  } catch (e) {
    r = { exitCode: -1, stdout: "", stderr: "harness error: " + e.message, signal: null };
  }
  collectGaps(r.stderr);
  const past = !/could not load ntdll/i.test(r.stderr || "") && !/ntdll/i.test(r.stderr || "");
  results.push({ name: v.name, exit: r.exitCode, signal: r.signal ?? "none", pastNtdll: past });
  console.log(`--- variant: ${v.name}`);
  console.log("  exit:", r.exitCode, "signal:", r.signal ?? "none");
  console.log("  stdout:", JSON.stringify((r.stdout || "").slice(0, 512)));
  console.log("  stderr:", JSON.stringify((r.stderr || "").slice(0, 1024)));
}

// keep `ver` for the final verdict: any variant that printed a wine version
const ver = {
  exitCode: results.some((r) => r.exit === 0) ? 0 : 1,
  stdout: results.some((r) => r.pastNtdll) ? "wine (past ntdll)" : "",
};
console.log("\nvariant summary:");
for (const r of results) console.log(`  [${r.pastNtdll ? "PAST-NTDLL" : "ntdll-fail"}] exit=${r.exit} ${r.name}`);

if (pePath) {
  FS.writeFile("/trivial.exe", readFileSync(pePath));
  const run = await host.runElf(busybox, {
    argv: ["sh", "-c", "exec /usr/bin/wine64 /trivial.exe"],
    progname: "/bin/busybox",
  });
  collectGaps(run.stderr);
  console.log("wine64 /trivial.exe:");
  console.log("  exit:", run.exitCode, "stderr:", JSON.stringify((run.stderr || "").slice(0, 512)));
}

const uniqueGaps = [...new Set(warnings)].sort();
console.log(`\nunsupported-syscall gap map (${uniqueGaps.length}):`);
for (const g of uniqueGaps) console.log("  " + g);

const ran = ver.exitCode === 0 && /wine/i.test(ver.stdout || "");
console.log("\nVERDICT:", ran ? "wine ran under blink" : "wine did NOT run under blink");
process.exit(ran ? 0 : 1);
