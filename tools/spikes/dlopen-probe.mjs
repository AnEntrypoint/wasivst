// Decisive isolating test: can blink dlopen a guest ELF .so at all?
//
// Wine fails under blink at "could not load ntdll.so: (null)" -- a dlopen of a
// guest ELF shared object. This strips that down to the smallest possible case:
// a tiny C program that dlopen()s ./libtrivial.so, dlsym()s a function, calls
// it, and prints the result. If this prints the answer, blink CAN dlopen guest
// .so and the Wine failure is something more specific. If dlopen returns NULL,
// blink's lack of a guest ELF .so loader is confirmed airtight, and a static
// (no-dlopen) Wine is the only path.
//
// The rootfs tar (argv[3]) must contain /probe (the dynamic ELF) and
// /libtrivial.so, built with musl on Linux/CI. See the workflow.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const webixDir = process.argv[2] || process.env.WEBIX_DIR || "../webix";
const rootfsPath = process.argv[3] || process.env.ROOTFS;
if (!rootfsPath) { console.error("need rootfs tar with /probe + /libtrivial.so"); process.exit(2); }

const { createBlinkHost } = await import(
  pathToFileURL(join(webixDir, "src/x86_64-blink.js")).href
);
const host = await createBlinkHost({
  wasmPath: join(webixDir, "containers/blinkenlib.wasm"),
  gluePath: join(webixDir, "containers/blinkenlib.js"),
});
host.mountTarBytes(readFileSync(rootfsPath));

// argv[4] optionally overrides the .so the in-guest probe dlopens (e.g. the
// real wine ntdll.so) -- passed to /probe as its first argument.
const target = process.argv[4] || process.env.TARGET_SO || "";
const r = await host.runElf(host.Module.FS.readFile("/probe"), {
  argv: target ? ["/probe", target] : ["/probe"],
  progname: "/probe",
});
console.log("dlopen probe:");
console.log("  exit:", r.exitCode, "signal:", r.signal ?? "none");
console.log("  stdout:", JSON.stringify(r.stdout));
console.log("  stderr:", JSON.stringify((r.stderr || "").slice(0, 1024)));

const ok = r.exitCode === 0 && /DLOPEN_OK/.test(r.stdout || "");
console.log("\nVERDICT:", ok ? "blink CAN dlopen a guest .so" : "blink CANNOT dlopen a guest .so");
process.exit(ok ? 0 : 1);
