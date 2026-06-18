require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'AudioPlayer'
  s.version        = package['version']
  s.summary        = 'Low-latency one-shot audio playback for Book Effect.'
  s.description    = 'Low-latency one-shot audio playback for Book Effect.'
  s.license        = { :type => 'UNLICENSED' }
  s.author         = 'Book Effect'
  s.homepage       = 'https://example.invalid/book-effect'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
