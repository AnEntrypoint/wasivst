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

with_vst3 = get_option('vst3')

cpp = meson.get_compiler('cpp')

if with_vst3
  vst3_dep = dependency('vst3', fallback : ['vst3', 'vst3_dep'])
endif

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
  dependencies : with_vst3 ? [vst3_dep] : [],
  cpp_args : with_vst3 ? ['-DWITH_VST3'] : [],
  include_directories : include_directories('src'),
  install : true,
)

subdir('tools/wasivstctl')
