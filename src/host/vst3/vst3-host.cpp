#include "vst3-host.h"

#include <dlfcn.h>
#include <stdexcept>
#include <cstdio>

#include <pluginterfaces/vst/ivstaudioprocessor.h>
#include <pluginterfaces/vst/ivstcomponent.h>
#include <public.sdk/source/vst/hosting/module.h>

using namespace Steinberg;
using namespace Steinberg::Vst;

Vst3Host::Vst3Host(const std::string& bundle_path, SerialChannel& ch)
    : ch_(ch)
{
    std::string err;
    auto module = VST3::Hosting::Module::create(bundle_path, err);
    if (!module)
        throw std::runtime_error("VST3 Module::create failed: " + err);

    factory_ = module->getFactory().get();
    ch_.write_log(1, "vst3-host", "VST3 module loaded");

}

Vst3Host::~Vst3Host() {}

void Vst3Host::run() {
    ch_.write_log(2, "vst3-host", "VST3 host run() — not yet fully implemented");
    while (true) {
        if (ch_.read_next_tag() != FrameTag::Process) continue;
        const ProcessFrame frame = ch_.read_process_frame_body();
        (void)frame;
        std::vector<float> silence(frame.sample_count, 0.0f);
        const float* ptrs[2] = { silence.data(), silence.data() };
        ch_.write_process_resp(frame.sample_count, 2, ptrs);
    }
}
