project(
  'wasivst',
  'cpp',
  version : '0.1.0',
  meson_version : '>=0.56',
  default_options : [
    'warning_level=3',
    'cpp_std=c++20',
    'build.cpp_std=c++20',
  ],
)

#
# Build options
#

with_vst3 = get_option('vst3')

#
# Compiler setup
#

cpp = meson.get_compiler('cpp')

#
# Dependencies (subprojects)
#

bitsery_dep = dependency('bitsery', fallback : ['bitsery', 'bitsery_dep'])
asio_dep = dependency('asio', fallback : ['asio', 'asio_dep'])
ghc_filesystem_dep = dependency('ghc_filesystem', fallback : ['ghc_filesystem', 'ghc_filesystem_dep'])
function2_dep = dependency('function2', fallback : ['function2', 'function2_dep'])

if with_vst3
  vst3_dep = dependency('vst3', fallback : ['vst3', 'vst3_dep'])
endif

#
# Common serialization library (shared between host and tooling)
#

common_sources = files(
  'src/common/audio-shm.cpp',
  'src/common/configuration.cpp',
  'src/common/linking.cpp',
  'src/common/notifications.cpp',
  'src/common/plugins.cpp',
  'src/common/process.cpp',
  'src/common/utils.cpp',
)

common_lib = static_library(
  'wasivst-common',
  sources : common_sources,
  dependencies : [bitsery_dep, asio_dep, ghc_filesystem_dep, function2_dep],
  include_directories : include_directories('src'),
)

common_dep = declare_dependency(
  link_with : common_lib,
  dependencies : [bitsery_dep, asio_dep, ghc_filesystem_dep, function2_dep],
  include_directories : include_directories('src'),
)

#
# wasivst-host: headless VST2/VST3 host that runs inside the QEMU guest
#

host_sources = files(
  'src/host/main.cpp',
  'src/host/ipc/serial-channel.cpp',
  'src/host/vst2/vst2-host.cpp',
)

if with_vst3
  host_sources += files('src/host/vst3/vst3-host.cpp')
endif

executable(
  'wasivst-host',
  sources : host_sources,
  dependencies : [common_dep] + (with_vst3 ? [vst3_dep] : []),
  cpp_args : with_vst3 ? ['-DWITH_VST3'] : [],
  install : true,
)

#
# wasivstctl: CLI packaging tool
#

subdir('tools/wasivstctl')
