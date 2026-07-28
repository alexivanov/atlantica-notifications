Pod::Spec.new do |s|
  s.name           = 'AtlanticaLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Live Activity (ActivityKit) bridge for the Atlantica app'
  s.description    = 'Starts and ends ActivityKit Live Activities from JS. ' \
                     'App Group storage and widget reloads are handled by ' \
                     "@bacons/apple-targets' ExtensionStorage instead."
  s.author         = ''
  s.homepage       = 'https://github.com/alexivanov/atlantica-notifications'
  s.platforms      = { :ios => '16.2' }
  s.source         = { git: '' }
  s.static_framework = true
  s.license        = { :type => 'MIT' }
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  # Without DEFINES_MODULE the pod compiles but does not export a Swift module,
  # so Expo's generated ExpoModulesProvider cannot see AtlanticaWidgetModule
  # even though it imports AtlanticaWidget. Matches how the first-party Expo
  # modules are configured.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }

  # ActivityAttributes.swift lives here, and targets/_shared/ symlinks to it so
  # the widget extension compiles the same file. CocoaPods silently ignores
  # source paths outside the pod root, so the canonical copy has to be inside.
  #
  # Compiling one source into both binaries is the standard ActivityKit
  # arrangement (Apple's guidance is to give the attributes file membership in
  # both targets). The app and the extension are separate processes and match
  # activities by the attributes type *name*, not by type identity -- whereas
  # two separate declarations would compile and then silently never match.
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
