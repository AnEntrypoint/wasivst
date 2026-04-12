
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <string>

static void cmd_pack(int argc, char** argv) {
    if (argc < 4) { fputs("usage: wasivstctl pack <dll> -o <out.wasivst>\n", stderr); return; }
    const std::string dll   = argv[2];
    const std::string out   = argv[4];
    fprintf(stdout, "packing %s -> %s (not yet implemented)\n", dll.c_str(), out.c_str());
}

static void cmd_validate(int argc, char** argv) {
    if (argc < 3) { fputs("usage: wasivstctl validate <bundle.wasivst>\n", stderr); return; }
    fprintf(stdout, "validating %s (not yet implemented)\n", argv[2]);
}

static void cmd_test(int argc, char** argv) {
    if (argc < 3) { fputs("usage: wasivstctl test <bundle.wasivst>\n", stderr); return; }
    fprintf(stdout, "test-running %s via headless QEMU (not yet implemented)\n", argv[2]);
}

static const struct { const char* name; void(*fn)(int, char**); } commands[] = {
    { "pack",     cmd_pack     },
    { "validate", cmd_validate },
    { "test",     cmd_test     },
};

int main(int argc, char** argv) {
    if (argc < 2) {
        fputs("wasivstctl <pack|validate|test> ...\n", stderr);
        return 1;
    }
    for (const auto& cmd : commands) {
        if (strcmp(argv[1], cmd.name) == 0) { cmd.fn(argc, argv); return 0; }
    }
    fprintf(stderr, "unknown command: %s\n", argv[1]);
    return 1;
}
