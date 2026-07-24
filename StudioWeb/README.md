# Speech Studio

Local web UI for the TTS runtimes in speech-swift.

## Start

Double-click `start.command`, or run:

```bash
cd StudioWeb
npm start
```

The server listens only on `127.0.0.1` and opens the studio in the default browser. It has no npm dependencies and sends no model input or audio to external services.

The server looks for the release binaries in the current worktree and in the sibling `speech-swift` checkout. Override them when needed:

```bash
SPEECH_SWIFT_BIN=/path/to/speech SPEECH_OMNI_BIN=/path/to/speech-omni npm start
```

Generated WAV files and uploaded references are kept under `StudioWeb/.studio-data/` for local history. Model weights continue to use the standard speech-swift cache in `~/Library/Caches/qwen3-speech/`.
