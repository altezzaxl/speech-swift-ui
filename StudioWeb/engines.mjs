const select = (key, label, options, value, help, cli, group = "Основное") => ({
  key, label, type: "select", options, default: value, help, cli, group,
});
const text = (key, label, value, help, cli, group = "Расширенные", extra = {}) => ({
  key, label, type: "text", default: value, help, cli, group, ...extra,
});
const number = (key, label, value, min, max, step, help, cli, group = "Генерация") => ({
  key, label, type: "number", default: value, min, max, step, help, cli, group,
});
const toggle = (key, label, value, help, cli, group = "Расширенные") => ({
  key, label, type: "toggle", default: value, help, cli, group,
});
const file = (key, label, help, cli, group = "Голос", accept = "audio/*") => ({
  key, label, type: "file", help, cli, group, accept,
});
const textarea = (key, label, value, help, cli, group = "Голос") => ({
  key, label, type: "textarea", default: value, help, cli, group,
});

const languages = [
  ["english", "English"], ["russian", "Русский"], ["chinese", "中文"],
  ["german", "Deutsch"], ["japanese", "日本語"], ["spanish", "Español"],
  ["french", "Français"], ["korean", "한국어"], ["hindi", "हिन्दी"],
  ["italian", "Italiano"], ["portuguese", "Português"],
];
const commonSpeak = [
  select("language", "Язык", languages, "russian", "Язык синтеза", "--language"),
  toggle("stream", "Потоковый синтез", false, "Декодировать звук чанками", "--stream"),
  toggle("play", "Играть через macOS", false, "Также воспроизвести через системный аудиовыход", "--play"),
  file("voiceSample", "Референс голоса", "Аудио для клонирования голоса", "--voice-sample"),
  toggle("cleanReference", "Очистить референс", false, "Sidon: шумоподавление и dereverb перед клонированием", "--clean-reference", "Голос"),
  select("cleanReferenceVariant", "Sidon", [["fp16", "FP16"], ["int8", "INT8"]], "fp16", "Точность очистки", "--clean-reference-variant", "Голос"),
  toggle("verbose", "Подробный лог", false, "Печатать тайминги этапов", "--verbose"),
];

export const engines = [
  {
    id: "qwen3", name: "Qwen3 TTS", badge: "MLX", command: "speak", staticArgs: ["--engine", "qwen3"],
    description: "Универсальный мультиязычный синтез, streaming и клонирование.",
    installedHint: "aufklarer/Qwen3-TTS-12Hz-0.6B-Base-MLX-8bit",
    fields: [
      ...commonSpeak,
      select("model", "Модель", [["base", "0.6B Base · INT8"], ["1.7b", "1.7B Base · BF16"], ["1.7b-8bit", "1.7B Base · INT8"], ["customVoice", "0.6B CustomVoice · BF16"]], "base", "Можно вставить и полный Hugging Face ID", "--model"),
      text("speaker", "Встроенный голос", "", "Работает с CustomVoice", "--speaker", "Голос"),
      textarea("instruct", "Инструкция стилю", "", "Тембр, эмоция, манера речи для CustomVoice", "--instruct"),
      number("temperature", "Temperature", 0.3, 0, 2, 0.05, "Вариативность выборки", "--temperature"),
      number("topK", "Top K", 50, 1, 500, 1, "Ограничение кандидатов", "--top-k"),
      number("maxTokens", "Макс. токенов", 500, 1, 4000, 1, "500 ≈ 40 секунд", "--max-tokens"),
      number("batchSize", "Размер батча", 4, 1, 32, 1, "Параллельные строки batch-файла", "--batch-size", "Поток"),
      number("firstChunkFrames", "Первый чанк", 3, 1, 500, 1, "Codec frames до первого звука", "--first-chunk-frames", "Поток"),
      number("chunkFrames", "Размер чанка", 25, 1, 500, 1, "Codec frames в следующих чанках", "--chunk-frames", "Поток"),
      file("batchFile", "Batch-файл", "Одна реплика на строку", "--batch-file", "Поток", ".txt"),
    ],
  },
  {
    id: "qwen3-coreml", name: "Qwen3 TTS", badge: "Core ML", command: "qwen3-tts-coreml",
    description: "Энергоэффективный запуск на Neural Engine.", installedHint: "aufklarer/Qwen3-TTS-CoreML",
    fields: [
      select("language", "Язык", languages.slice(0, 8), "russian", "Язык синтеза", "--language"),
      text("model", "Model ID", "aufklarer/Qwen3-TTS-CoreML", "Hugging Face ID", "--model"),
      number("maxTokens", "Макс. токенов", 125, 1, 2000, 1, "1 токен ≈ 80 мс", "--max-tokens"),
      number("temperature", "Temperature", 0.8, 0, 2, 0.05, "Вариативность", "--temperature"),
      number("topK", "Top K", 50, 1, 500, 1, "Ограничение кандидатов", "--top-k"),
    ],
  },
  {
    id: "kokoro", name: "Kokoro 82M", badge: "Core ML", command: "kokoro",
    description: "Очень быстрый синтез с каталогом готовых голосов.", installedHint: "aufklarer/Kokoro-82M-CoreML",
    fields: [
      select("language", "Язык", [["en", "English"], ["fr", "Français"], ["es", "Español"], ["ja", "日本語"], ["zh", "中文"], ["hi", "हिन्दी"], ["pt", "Português"], ["ko", "한국어"]], "en", "Язык синтеза", "--language"),
      text("voice", "Голос", "af_heart", "Например af_heart", "--voice", "Голос"),
      text("model", "Model ID", "aufklarer/Kokoro-82M-CoreML", "Hugging Face ID", "--model"),
      toggle("verbose", "Подробный лог", false, "Печатать тайминги", "--verbose"),
    ],
  },
  {
    id: "cosyvoice", name: "CosyVoice 3", badge: "MLX", command: "speak", staticArgs: ["--engine", "cosyvoice"],
    description: "Диалоги, emotion prompts и zero-shot клонирование.", installedHint: "aufklarer/CosyVoice3-0.5B-MLX-bf16",
    fields: [
      ...commonSpeak,
      select("cosyvoiceVariant", "Точность", [["bf16", "BF16"], ["8bit", "INT8"], ["8bit-full", "INT8 Full"]], "bf16", "Вариант весов", "--cosyvoice-variant"),
      text("modelId", "Model ID", "", "Перекрывает вариант", "--model-id"),
      text("speakers", "Карта спикеров", "", "s1=alice.wav,s2=bob.wav", "--speakers", "Голос"),
      textarea("cosyReferenceTranscript", "Текст референса", "", "Что сказано в референс-аудио", "--cosy-reference-transcript"),
      textarea("cosyInstruct", "Инструкция стилю", "", "Эмоция и манера речи", "--cosy-instruct"),
      number("turnGap", "Пауза между репликами", 0.2, 0, 5, 0.05, "Секунды", "--turn-gap"),
      number("crossfade", "Crossfade", 0, 0, 2, 0.01, "Секунды", "--crossfade"),
      number("seed", "Seed", "", 0, 4294967295, 1, "Пусто = случайный", "--seed"),
      file("cosySpeechTokenizer", "S3 tokenizer", "Опциональный speech_tokenizer.safetensors", "--cosy-speech-tokenizer", "Расширенные", ".safetensors"),
      text("cosyBundleDir", "Локальный bundle", "", "Путь к локально конвертированной модели", "--cosy-bundle-dir"),
    ],
  },
  {
    id: "voxcpm2", name: "VoxCPM2", badge: "MLX · 48k", command: "speak", staticArgs: ["--engine", "voxcpm2"],
    description: "Студийные 48 кГц, voice design и continuation.", installedHint: "aufklarer/VoxCPM2-MLX-int8",
    fields: [
      ...commonSpeak,
      select("voxcpm2Variant", "Точность", [["bf16", "BF16"], ["int8", "INT8"]], "int8", "Вариант весов", "--voxcpm2-variant"),
      textarea("voxcpm2Instruct", "Voice design", "", "Описание желаемого голоса", "--voxcpm2-instruct"),
      file("voxcpm2RefAudio", "Отдельный референс", "Переопределяет общий референс", "--voxcpm2-ref-audio"),
      textarea("voxcpm2PromptText", "Текст продолжения", "", "Transcript prompt-аудио", "--voxcpm2-prompt-text"),
      file("voxcpm2PromptAudio", "Prompt audio", "Аудио для continuation", "--voxcpm2-prompt-audio"),
      number("voxcpm2CfgValue", "CFG", 2, 0, 10, 0.1, "Classifier-free guidance", "--voxcpm2-cfg-value"),
      number("voxcpm2Timesteps", "Diffusion steps", 10, 1, 100, 1, "Шаги на patch", "--voxcpm2-timesteps"),
      number("voxcpm2MaxTokens", "Макс. patches", 2000, 1, 10000, 1, "Лимит генерации", "--voxcpm2-max-tokens"),
      number("voxcpm2MinTokens", "Мин. patches", 2, 0, 1000, 1, "До early stop", "--voxcpm2-min-tokens"),
      number("voxcpm2StreamingPrefixLen", "Streaming prefix", 4, 0, 64, 1, "Patches для continuation", "--voxcpm2-streaming-prefix-len", "Поток"),
      number("voxcpm2WarmupPatches", "Warmup", 0, 0, 64, 1, "Patches до выдачи звука", "--voxcpm2-warmup-patches", "Поток"),
    ],
  },
  {
    id: "indextts2", name: "IndexTTS2", badge: "MLX", command: "speak", staticArgs: ["--engine", "indextts2"],
    description: "Клонирование, отдельный emotion reference и управление паузами.", installedHint: "aufklarer/IndexTTS2-MLX-fp16",
    fields: [
      ...commonSpeak,
      text("indextts2ModelId", "Model ID", "aufklarer/IndexTTS2-MLX-fp16", "Hugging Face ID", "--indextts2-model-id"),
      text("indextts2BundleDir", "Локальный bundle", "", "Путь к bundle", "--indextts2-bundle-dir"),
      file("indextts2EmotionAudio", "Emotion reference", "Отдельная эмоциональная подача", "--indextts2-emotion-audio"),
      text("indextts2Emotion", "Эмоция", "calm", "Preset или 8-значный вектор", "--indextts2-emotion", "Голос"),
      number("indextts2EmotionWeight", "Сила эмоции", 1, 0, 1, 0.05, "Вес emotion reference", "--indextts2-emotion-weight"),
      number("indextts2SpeakingRate", "Темп речи", 1, 0.5, 1.5, 0.05, "Множитель скорости", "--indextts2-speaking-rate"),
      number("indextts2MaxPause", "Макс. пауза", "", 0.05, 2, 0.05, "Пусто = без ограничения", "--indextts2-max-pause"),
      number("indextts2S2melSteps", "S2Mel steps", 15, 1, 50, 1, "25 соответствует upstream", "--indextts2-s2mel-steps"),
    ],
  },
  {
    id: "f5", name: "F5-TTS", badge: "MLX", command: "speak", staticArgs: ["--engine", "f5"],
    description: "Zero-shot клонирование из короткого референса.", installedHint: "aufklarer/F5TTS-v1-Base-MLX-fp16",
    fields: [
      ...commonSpeak,
      text("f5ModelId", "Model ID", "aufklarer/F5TTS-v1-Base-MLX-fp16", "Hugging Face ID", "--f5-model-id"),
      text("f5BundleDir", "Локальный bundle", "", "Путь к bundle", "--f5-bundle-dir"),
      textarea("f5ReferenceText", "Текст референса", "", "Обязателен для клонирования", "--f5-reference-text"),
      number("f5Steps", "Flow steps", 16, 1, 64, 1, "32 для максимальной точности", "--f5-steps"),
      number("f5CfgStrength", "CFG", 2, 0, 10, 0.1, "Guidance strength", "--f5-cfg-strength"),
      number("f5Sway", "Sway", -1, -5, 5, 0.1, "Sway sampling", "--f5-sway"),
      number("f5Speed", "Темп", 1, 0.5, 2, 0.05, "Множитель скорости", "--f5-speed"),
      number("f5Seed", "Seed", 0, 0, 4294967295, 1, "Детерминированная генерация", "--f5-seed"),
      number("f5TargetRms", "Target RMS", 0.1, 0.01, 1, 0.01, "Нормализация референса", "--f5-target-rms"),
    ],
  },
  {
    id: "higgs", name: "Higgs TTS 3", badge: "MLX · 4B", command: "speak", staticArgs: ["--engine", "higgs"],
    description: "Разговорная речь, управляющие теги и cloning.", installedHint: "aufklarer/Higgs-TTS-3-4B-MLX-bf16",
    fields: [
      ...commonSpeak,
      text("higgsModelId", "Model ID", "aufklarer/Higgs-TTS-3-4B-MLX-bf16", "Hugging Face ID", "--higgs-model-id"),
      text("higgsBundleDir", "Локальный bundle", "", "Путь к bundle", "--higgs-bundle-dir"),
      textarea("higgsRefText", "Текст референса", "", "Повышает fidelity", "--higgs-ref-text"),
      number("higgsTemperature", "Temperature", 0.8, 0, 2, 0.05, "Вариативность", "--higgs-temperature"),
      number("higgsTopP", "Top P", "", 0, 1, 0.05, "Пусто = выключено", "--higgs-top-p"),
      number("higgsTopK", "Top K", "", 1, 500, 1, "Пусто = выключено", "--higgs-top-k"),
      number("higgsMaxNewTokens", "Макс. frames", 2048, 1, 10000, 1, "25 frames/с", "--higgs-max-new-tokens"),
      number("higgsSeed", "Seed", 0, 0, 4294967295, 1, "MLX sampling seed", "--higgs-seed"),
    ],
  },
  {
    id: "indic-mio", name: "Indic-Mio", badge: "MLX", command: "speak", staticArgs: ["--engine", "indic-mio"],
    description: "Hindi/Indic, emotion markers и voice cloning.", installedHint: "aufklarer/Indic-Mio-MLX-fp16",
    fields: [
      ...commonSpeak.map((field) => field.key === "language" ? { ...field, default: "hindi" } : field),
      text("indicMioModelId", "Model ID", "aufklarer/Indic-Mio-MLX-fp16", "Hugging Face ID", "--indic-mio-model-id"),
      number("temperature", "Temperature", 0.3, 0, 2, 0.05, "Вариативность", "--temperature"),
      number("topK", "Top K", 50, 1, 500, 1, "Ограничение кандидатов", "--top-k"),
      number("maxTokens", "Макс. токенов", 500, 1, 4000, 1, "Лимит генерации", "--max-tokens"),
      number("indicMioTopP", "Top P", 0.9, 0, 1, 0.05, "Nucleus sampling", "--indic-mio-top-p"),
      number("indicMioRepetitionPenalty", "Repetition penalty", 1, 0.5, 3, 0.05, "Штраф повторов", "--indic-mio-repetition-penalty"),
      textarea("indicMioGlobalEmbedding", "Global embedding", "", "128 float через JSON или CSV", "--indic-mio-global-embedding"),
    ],
  },
  {
    id: "magpie", name: "Magpie", badge: "MLX", command: "speak", staticArgs: ["--engine", "magpie"],
    description: "Быстрый multilingual TTS с пятью готовыми голосами.", installedHint: "aufklarer/Magpie-TTS-Multilingual-357M-MLX-int8",
    fields: [
      select("language", "Язык", languages, "russian", "Язык синтеза", "--language"),
      select("magpieVariant", "Точность", [["int8", "INT8"]], "int8", "Опубликованный вариант", "--magpie-variant"),
      select("magpieSpeaker", "Голос", [["sofia", "Sofia"], ["aria", "Aria"], ["jason", "Jason"], ["leo", "Leo"], ["john", "John"]], "sofia", "Встроенный голос", "--magpie-speaker", "Голос"),
      number("magpieTemperature", "Temperature", 0.6, 0, 2, 0.05, "Вариативность", "--magpie-temperature"),
      number("magpieTopK", "Top K", 80, 1, 500, 1, "Ограничение кандидатов", "--magpie-top-k"),
      number("magpieMaxFrames", "Макс. frames", 500, 1, 4000, 1, "500 ≈ 23 секунды", "--magpie-max-frames"),
      number("magpieMinFrames", "Мин. frames", 4, 0, 500, 1, "До EOS", "--magpie-min-frames"),
      toggle("magpiePrephonemized", "Текст уже в IPA", false, "Пропустить нормализацию", "--magpie-prephonemized"),
      toggle("stream", "Потоковый синтез", false, "Декодировать чанками", "--stream"),
      toggle("verbose", "Подробный лог", false, "Печатать тайминги", "--verbose"),
    ],
  },
  {
    id: "magpie-coreml", name: "Magpie", badge: "Core ML", command: "speak", staticArgs: ["--engine", "magpie-coreml"],
    description: "Экономичный запуск Magpie на Neural Engine.", installedHint: "aufklarer/Magpie-TTS-Multilingual-357M-CoreML-int8",
    fields: [
      select("language", "Язык", languages, "russian", "Язык синтеза", "--language"),
      select("magpieSpeaker", "Голос", [["sofia", "Sofia"], ["aria", "Aria"], ["jason", "Jason"], ["leo", "Leo"], ["john", "John"]], "sofia", "Встроенный голос", "--magpie-speaker", "Голос"),
      number("magpieMaxFrames", "Макс. frames", 500, 1, 4000, 1, "Лимит генерации", "--magpie-max-frames"),
      toggle("magpiePrephonemized", "Текст уже в IPA", false, "Пропустить нормализацию", "--magpie-prephonemized"),
      toggle("verbose", "Подробный лог", false, "Печатать тайминги", "--verbose"),
    ],
  },
  {
    id: "vibevoice", name: "VibeVoice", badge: "MLX", command: "vibevoice",
    description: "Realtime 0.5B или long-form 1.5B для подкастов.", installedHint: "aufklarer/VibeVoice-Realtime-0.5B-MLX-INT4",
    fields: [
      toggle("longForm", "Long-form 1.5B", false, "До 90 минут, EN/ZH и raw reference", "--long-form", "Основное"),
      file("voiceCache", "Voice cache", "Обязателен для Realtime 0.5B", "--voice-cache", "Голос", ".safetensors"),
      file("referenceAudio", "Референс 1.5B", "Raw audio для long-form", "--reference-audio"),
      textarea("referenceTranscript", "Текст референса", "", "Обязателен вместе с raw reference", "--reference-transcript"),
      text("model", "Model ID", "", "Пусто = вариант по режиму", "--model"),
      text("tokenizer", "Tokenizer ID", "", "Пусто = Qwen2.5 по режиму", "--tokenizer"),
      number("steps", "DPM steps", 20, 1, 100, 1, "Выше = качественнее и медленнее", "--steps"),
      number("cfg", "CFG", 1.3, 0, 10, 0.1, "Classifier-free guidance", "--cfg"),
      number("maxTokens", "Макс. токенов", 500, 1, 10000, 1, "Лимит speech tokens", "--max-tokens"),
      toggle("verbose", "Подробный лог", false, "Печатать тайминги", "--verbose"),
    ],
  },
  {
    id: "csm", name: "CSM 1B", badge: "MLX", command: "csm",
    description: "Разговорная модель с обязательным voice reference.", installedHint: "aufklarer/CSM-1B-MLX-8bit",
    fields: [
      file("refAudio", "Референс голоса", "Обязательное аудио", "--ref-audio"),
      textarea("refText", "Текст референса", "", "Что сказано в аудио", "--ref-text"),
      text("model", "Model ID", "aufklarer/CSM-1B-MLX-8bit", "Hugging Face ID", "--model"),
      number("temperature", "Temperature", 0.9, 0, 2, 0.05, "0 = greedy", "--temperature"),
      number("topK", "Top K", 50, 1, 500, 1, "Ограничение кандидатов", "--top-k"),
    ],
  },
  {
    id: "omnivoice", name: "OmniVoice", badge: "MLX · 600+", command: "speech-omni", binary: "omni",
    description: "Diffusion TTS и zero-shot cloning для 600+ языков.", installedHint: "aufklarer/OmniVoice-MLX-int8",
    fields: [
      file("referenceAudio", "Референс голоса", "Обязательное аудио", "--reference-audio"),
      textarea("referenceText", "Текст референса", "", "Улучшает ритм и произношение", "--reference-text"),
      text("language", "Language ID", "ru", "Код языка OmniVoice", "--language", "Основное"),
      text("model", "Model ID", "aufklarer/OmniVoice-MLX-int8", "FP16 или INT8 bundle", "--model"),
      textarea("instruct", "Инструкция стилю", "", "Accent, age, gender, pitch или whisper", "--instruct"),
      number("duration", "Длительность", "", 0.2, 600, 0.1, "Пусто = оценить автоматически", "--duration"),
      number("steps", "Diffusion steps", 16, 1, 64, 1, "12 быстрее, 16 по умолчанию", "--steps"),
    ],
  },
];

export const engineMap = new Map(engines.map((engine) => [engine.id, engine]));
