
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <string>

#include "ipc/serial-channel.h"
#include "vst2/vst2-host.h"
#ifdef WITH_VST3
#include "vst3/vst3-host.h"
#endif

static bool is_vst3(const std::string& path) {
    return path.size() >= 5 &&
           path.substr(path.size() - 5) == ".vst3";
}

int main() {
    SerialChannel ch;

    if (ch.read_next_tag() != FrameTag::Load)
        throw std::runtime_error("expected LOAD frame at startup");
    const std::string plugin_path = ch.read_load_frame_body();
    fprintf(stderr, "[wasivst-host] loading %s\n", plugin_path.c_str());

#ifdef WITH_VST3
    if (is_vst3(plugin_path)) {
        Vst3Host host(plugin_path, ch);
        host.run();
        return 0;
    }
#endif

    Vst2Host host(plugin_path, ch);
    host.run();
    return 0;
}
