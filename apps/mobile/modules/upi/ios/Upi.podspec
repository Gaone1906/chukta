Pod::Spec.new do |s|
  s.name           = 'Upi'
  s.version        = '1.0.0'
  s.summary        = 'Discover and launch UPI apps'
  s.description    = 'Local Expo module. Android does the real work; iOS can only probe schemes.'
  s.author         = ''
  s.homepage       = 'https://github.com/Gaone1906/hisaab'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
