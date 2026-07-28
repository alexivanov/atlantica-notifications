Pod::Spec.new do |s|
  s.name           = 'AtlanticaWidget'
  s.version        = '1.0.0'
  s.summary        = 'Live Activity bridge for the Atlantica app'
  s.description    = 'Starts and ends ActivityKit Live Activities from JS. ' \
                     'App Group storage and widget reloads are handled by ' \
                     "@bacons/apple-targets' ExtensionStorage instead."
  s.author         = ''
  s.homepage       = 'https://github.com/alexivanov/atlantica-notifications'
  s.platforms      = { :ios => '16.2' }
  s.source         = { git: '' }
  s.static_framework = true
  s.license        = { :type => 'MIT' }

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
