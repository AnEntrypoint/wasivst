#include "vst2-host.h"

#include <dlfcn.h>
#include <stdexcept>
#include <cstdio>
#include <vector>

#include "../../include/vestige/aeffectx.h"
#include "../../common/vst24.h"

static VstIntPtr audio_master_callback(
    AEffect* /*effect*/, int opcode, int /*index*/,
    VstIntPtr /*value*/, void* /*ptr*/, float /*opt*/)
{
    switch (opcode) {
        case audioMasterVersion: return 2400;
        case audioMasterGetSampleRate: return 44100;
        case audioMasterGetBlockSize: return 512;
        default: return 0;
    }
}

Vst2Host::Vst2Host(const std::string& dll_path, SerialChannel& ch)
    : ch_(ch)
{
    lib_handle_ = dlopen(dll_path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!lib_handle_)
        throw std::runtime_error(std::string("dlopen failed: ") + dlerror());

    using VSTPluginMain_t = AEffect*(*)(audioMasterCallback);
    auto entry = reinterpret_cast<VSTPluginMain_t>(dlsym(lib_handle_, "VSTPluginMain"));
    if (!entry)
        entry = reinterpret_cast<VSTPluginMain_t>(dlsym(lib_handle_, "main"));
    if (!entry)
        throw std::runtime_error("VST2 entry point not found");

    aeffect_ = entry(audio_master_callback);
    if (!aeffect_)
        throw std::runtime_error("VSTPluginMain returned null");

    auto* eff = static_cast<AEffect*>(aeffect_);
    eff->dispatcher(eff, effOpen, 0, 0, nullptr, 0.0f);
    eff->dispatcher(eff, effSetSampleRate, 0, 0, nullptr, 44100.0f);
    eff->dispatcher(eff, effSetBlockSize, 0, 512, nullptr, 0.0f);
    eff->dispatcher(eff, effMainsChanged, 0, 1, nullptr, 0.0f);

    ch_.write_log(1, "vst2-host", "plugin loaded and activated");
}

Vst2Host::~Vst2Host() {
    if (aeffect_) {
        auto* eff = static_cast<AEffect*>(aeffect_);
        eff->dispatcher(eff, effMainsChanged, 0, 0, nullptr, 0.0f);
        eff->dispatcher(eff, effClose, 0, 0, nullptr, 0.0f);
    }
    if (lib_handle_) dlclose(lib_handle_);
}

void Vst2Host::run() {
    while (true) {
        switch (ch_.read_next_tag()) {
            case FrameTag::Process:  process_block(ch_.read_process_frame_body()); break;
            case FrameTag::SetParam: handle_set_param(ch_.read_set_param_frame_body()); break;
            case FrameTag::GetParam: handle_get_param(ch_.read_get_param_frame_body()); break;
            default: ch_.write_log(3, "vst2-host", "unknown frame tag"); break;
        }
    }
}

void Vst2Host::process_block(const ProcessFrame& frame) {
    auto* eff = static_cast<AEffect*>(aeffect_);
    const uint32_t n = frame.sample_count;
    const uint32_t ch = frame.channel_count;

    std::vector<float*> inputs(ch), outputs(ch);
    std::vector<std::vector<float>> in_bufs(ch, std::vector<float>(n));
    std::vector<std::vector<float>> out_bufs(ch, std::vector<float>(n, 0.0f));

    for (uint32_t c = 0; c < ch; ++c) {
        for (uint32_t s = 0; s < n; ++s)
            in_bufs[c][s] = frame.samples[c * n + s];
        inputs[c]  = in_bufs[c].data();
        outputs[c] = out_bufs[c].data();
    }

    eff->processReplacing(eff, inputs.data(), outputs.data(), static_cast<int>(n));

    std::vector<const float*> out_ptrs(ch);
    for (uint32_t c = 0; c < ch; ++c) out_ptrs[c] = out_bufs[c].data();
    ch_.write_process_resp(n, ch, out_ptrs.data());
}

void Vst2Host::handle_set_param(const ParamFrame& p) {
    auto* eff = static_cast<AEffect*>(aeffect_);
    eff->setParameter(eff, static_cast<int>(p.id), static_cast<float>(p.value));
}

void Vst2Host::handle_get_param(uint32_t id) {
    auto* eff = static_cast<AEffect*>(aeffect_);
    const double val = eff->getParameter(eff, static_cast<int>(id));
    ch_.write_get_param_resp(id, val);
}
