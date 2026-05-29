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

// Witnessed (CI 26642496885): blink cannot execve a different ELF over a
// running guest ("Exec format error", hangs), and exposes no guest-env setter.
// So the ONLY working path is a direct runElf of the wine binary with argv;
// any loader env (WINEDLLPATH, WINEDEBUG, WINELOADERNOEXEC) must be BAKED into
// the rootfs (e.g. /etc/environment) at build time, not injected here.
const FS = host.Module.FS;

// Try each candidate wine entry binary directly. wine64 -> wine (a small
// launcher); also probe the unix loader and the real wine64 ELF if present.
const candidates = [
  "/usr/bin/wine64",
  "/usr/bin/wine",
  "/usr/lib/wine/x86_64-unix/wine64",
  "/usr/lib/wine/x86_64-unix/wine",
];

let ver = { exitCode: 1, stdout: "" };
for (const bin of candidates) {
  let bytes;
  try { bytes = FS.readFile(bin); } catch (_) { console.log(`(skip ${bin}: not in rootfs)`); continue; }
  let r;
  try {
    r = await host.runElf(bytes, { argv: [bin, "--version"], progname: bin });
  } catch (e) {
    r = { exitCode: -1, stdout: "", stderr: "harness error: " + e.message, signal: null };
  }
  collectGaps(r.stderr);
  const past = !/ntdll/i.test(r.stderr || "");
  console.log(`--- direct runElf: ${bin} --version`);
  console.log("  exit:", r.exitCode, "signal:", r.signal ?? "none", past ? "[PAST-NTDLL]" : "[ntdll-fail]");
  console.log("  stdout:", JSON.stringify((r.stdout || "").slice(0, 512)));
  console.log("  stderr:", JSON.stringify((r.stderr || "").slice(0, 1024)));
  if (r.exitCode === 0 && /wine/i.test(r.stdout || "")) { ver = r; break; }
  if (past) ver = { exitCode: 0, stdout: "wine (past ntdll via " + bin + ")" };
}

if (pePath) {
  FS.writeFile("/trivial.exe", readFileSync(pePath));
  let wb;
  try { wb = FS.readFile("/usr/bin/wine64"); } catch (_) {}
  if (wb) {
    const run = await host.runElf(wb, { argv: ["/usr/bin/wine64", "/trivial.exe"], progname: "/usr/bin/wine64" });
    collectGaps(run.stderr);
    console.log("wine64 /trivial.exe:");
    console.log("  exit:", run.exitCode, "stderr:", JSON.stringify((run.stderr || "").slice(0, 512)));
  }
}

const uniqueGaps = [...new Set(warnings)].sort();
console.log(`\nunsupported-syscall gap map (${uniqueGaps.length}):`);
for (const g of uniqueGaps) console.log("  " + g);

const ran = ver.exitCode === 0 && /wine/i.test(ver.stdout || "");
console.log("\nVERDICT:", ran ? "wine ran under blink" : "wine did NOT run under blink");
process.exit(ran ? 0 : 1);
