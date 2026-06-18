import AVFoundation
import ExpoModulesCore

public class AudioPlayerModule: Module {
  private var players: [String: [AVAudioPlayer]] = [:]
  private var nextPlayerIndex: [String: Int] = [:]
  private var maxVoices = 4

  public func definition() -> ModuleDefinition {
    Name("AudioPlayer")

    AsyncFunction("init") { (options: [String: Any]?) in
      self.teardownInternal()
      if let requestedVoices = options?["maxVoices"] as? Int {
        self.maxVoices = max(1, requestedVoices)
      } else {
        self.maxVoices = 4
      }
    }

    AsyncFunction("preload") { (voices: [[String: String]]) in
      for voice in voices {
        guard let id = voice["id"],
          let uri = voice["uri"],
          let url = URL(string: uri)
        else {
          continue
        }

        var pool: [AVAudioPlayer] = []
        for _ in 0..<self.maxVoices {
          let player = try AVAudioPlayer(contentsOf: url)
          player.prepareToPlay()
          pool.append(player)
        }
        self.players[id] = pool
        self.nextPlayerIndex[id] = 0
      }
    }

    Function("play") { (id: String) in
      guard let pool = self.players[id], !pool.isEmpty else {
        return
      }

      let index = self.nextPlayerIndex[id] ?? 0
      let player = pool[index]
      player.currentTime = 0
      player.play()
      self.nextPlayerIndex[id] = (index + 1) % pool.count
    }

    Function("stopAll") {
      for pool in self.players.values {
        for player in pool {
          player.stop()
          player.currentTime = 0
        }
      }
    }

    AsyncFunction("teardown") {
      self.teardownInternal()
    }
  }

  private func teardownInternal() {
    for pool in players.values {
      for player in pool {
        player.stop()
      }
    }
    players.removeAll()
    nextPlayerIndex.removeAll()
  }
}
