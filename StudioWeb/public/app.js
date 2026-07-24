const dom = Object.fromEntries([
  "engine-list", "engine-search", "workspace-title", "inspector-engine", "engine-summary",
  "settings-form", "script-text", "char-count", "clear-text", "generate-button", "cancel-button",
  "empty-result", "running-result", "audio-result", "error-result", "running-title", "running-detail",
  "result-title", "result-meta", "audio-player", "download-audio", "studio-enhance-button", "audio-variant-note", "command-output", "live-log",
  "error-message", "retry-button", "show-log", "raw-args", "command-preview", "reset-settings",
  "history-toggle", "history-close", "history-drawer", "drawer-backdrop", "history-list", "history-count",
  "system-status", "preset-select", "save-preset", "delete-preset", "preset-dialog", "preset-name", "confirm-preset", "help-dialog", "help-eyebrow", "help-title", "help-content", "toast",
].map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));

const state = {
  engines: [], system: {}, selected: localStorage.getItem("speech-studio-engine") || "qwen3",
  values: JSON.parse(localStorage.getItem("speech-studio-values") || "{}"),
  text: localStorage.getItem("speech-studio-text") || "",
  rawArgs: "", currentJob: null, enhancementJob: null, history: [], pollTimer: null, enhancementPollTimer: null,
  presets: JSON.parse(localStorage.getItem("speech-studio-presets") || "{}"),
};

const icons = {
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v4h14v-4"/></svg>',
};

function currentEngine() { return state.engines.find((engine) => engine.id === state.selected) || state.engines[0]; }
function engineValues(engine = currentEngine()) {
  if (!state.values[engine.id]) state.values[engine.id] = Object.fromEntries(engine.fields.map((field) => [field.key, field.default ?? ""]));
  return state.values[engine.id];
}

function persist() {
  localStorage.setItem("speech-studio-engine", state.selected);
  const persistentValues = structuredClone(state.values);
  for (const engine of state.engines) {
    for (const field of engine.fields.filter((item) => item.type === "file")) {
      if (persistentValues[engine.id]) persistentValues[engine.id][field.key] = "";
    }
  }
  localStorage.setItem("speech-studio-values", JSON.stringify(persistentValues));
  localStorage.setItem("speech-studio-text", state.text);
}

function toast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => dom.toast.classList.remove("show"), 2200);
}

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function engineReady(engine) {
  return engine.binary === "omni" ? state.system.omniReady : state.system.speechReady;
}

function renderEngines(filter = "") {
  const normalized = filter.trim().toLowerCase();
  const visible = state.engines.filter((engine) => `${engine.name} ${engine.badge} ${engine.description}`.toLowerCase().includes(normalized));
  dom.engine_list.innerHTML = visible.map((engine) => `
    <button class="engine-item ${engine.id === state.selected ? "active" : ""}" data-engine="${engine.id}" type="button">
      <span class="engine-avatar">${engine.name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2)}</span>
      <span class="engine-copy"><strong>${engine.name}</strong><small>${engine.badge}</small></span>
      <span class="ready-dot ${engineReady(engine) ? "" : "unavailable"}" title="${engineReady(engine) ? "Готов" : "Binary не найден"}"></span>
    </button>`).join("") || '<div class="history-empty">Ничего не найдено</div>';
  dom.engine_list.querySelectorAll("[data-engine]").forEach((button) => button.addEventListener("click", () => selectEngine(button.dataset.engine)));
}

function selectEngine(id) {
  state.selected = id;
  persist();
  renderEngines(dom.engine_search.value);
  renderWorkspace();
  renderSettings();
}

function renderWorkspace() {
  const engine = currentEngine();
  dom.workspace_title.textContent = engine.name;
  dom.inspector_engine.textContent = engine.name;
  dom.engine_summary.innerHTML = `<span class="model-badge">${engine.badge}</span><span>${engine.description}</span>`;
  dom.generate_button.disabled = !engineReady(engine) || state.currentJob?.status === "running";
  dom.command_preview.textContent = buildPreview();
}

function groupFields(fields) {
  return fields.reduce((groups, field) => {
    (groups[field.group || "Расширенные"] ||= []).push(field);
    return groups;
  }, {});
}

const sectionHelp = {
  "Основное": {
    title: "Главные настройки",
    what: "Здесь находятся параметры, которые сильнее всего меняют выбор модели и характер результата.",
    change: "Сначала настройте язык и модель, а затем переходите к голосу и генерации.",
    recommendation: "Для первого запуска оставьте значения по умолчанию и меняйте только один параметр за раз.",
  },
  "Голос": {
    title: "Голос и референс",
    what: "Эти параметры определяют, чей голос использовать и насколько точно повторять исходную запись.",
    change: "Референс влияет на тембр, акцент и подачу; числовые веса сильнее или слабее навязывают эту подачу.",
    recommendation: "Используйте чистую моно-запись одного человека без музыки и эха.",
  },
  "Генерация": {
    title: "Сэмплирование и длина",
    what: "Настройки управляют разнообразием, стабильностью и максимальной длительностью речи.",
    change: "Более смелые значения дают больше вариаций, но могут добавить ошибки; большие лимиты позволяют говорить дольше.",
    recommendation: "Начните с дефолтов, а для стабильного результата уменьшайте вариативность.",
  },
  "Поток": {
    title: "Потоковая генерация",
    what: "Эти параметры влияют на то, как модель отдаёт длинный или batch-текст частями.",
    change: "Меньшие чанки дают звук раньше, но требуют больше служебной работы; большие чанки эффективнее, но увеличивают ожидание первого звука.",
    recommendation: "Оставьте значения по умолчанию, если не синтезируете длинный текст или batch-файл.",
  },
  "Расширенные": {
    title: "Расширенные параметры",
    what: "Редкие настройки для особых моделей, локальных bundle-файлов, отладки и точной настройки.",
    change: "Изменяйте их, когда понимаете назначение конкретного флага или повторяете опубликованный рецепт модели.",
    recommendation: "Если не знаете, зачем параметр нужен, оставьте его пустым или выключенным.",
  },
  "CLI Advanced": {
    title: "CLI Advanced",
    what: "Запасной путь для новых флагов speech-swift, которых ещё нет отдельными контролами.",
    change: "Аргументы добавляются к команде напрямую; они не проходят через shell.",
    recommendation: "Используйте только флаги из `speech … --help`. `--output` зарезервирован студией.",
  },
};

const parameterHelp = {
  language: ["Выбирает язык токенизации и произношения.", "Смена языка меняет фонемы, акцент и допустимые голоса; неверный язык часто даёт нечёткое произношение.", "Выберите язык самого текста, а не язык интерфейса."],
  stream: ["Включает выдачу и декодирование результата кусочками.", "Включение уменьшает задержку до первого звука, но может немного увеличить служебные расходы; качество обычно не меняет.", "Оставьте выключенным для коротких фраз."],
  play: ["Дополнительно отправляет результат на системный аудиовыход macOS.", "Меняет только воспроизведение на устройстве, не сам WAV.", "Включайте, если хотите слушать сразу через выбранный системный выход."],
  voiceSample: ["Аудиозапись, по которой модель подхватывает тембр и манеру речи.", "Более чистая и выразительная запись обычно даёт более похожий голос; шум и эхо переносятся в результат.", "10–30 секунд моно-речи одного человека, без музыки и фоновых разговоров."],
  cleanReference: ["Перед клонированием запускает шумоподавление и dereverb Sidon.", "Включение может убрать комнатный шум и эхо, но слишком агрессивная очистка иногда делает голос менее естественным.", "Оставьте выключенным для уже чистой студийной записи."],
  cleanReferenceVariant: ["Выбирает точность модели очистки референса.", "FP16 обычно сохраняет больше деталей; INT8 экономит память и может быть быстрее.", "FP16 — безопасный вариант для качества; INT8 — если не хватает памяти."],
  verbose: ["Печатает этапы загрузки модели и тайминги в лог.", "На звук не влияет, только делает диагностику подробной.", "Включайте при первом запуске или если нужно понять, где задержка."],
  model: ["Выбирает веса или принимает полный Hugging Face ID.", "Большая или более точная модель обычно лучше держит тембр и текст, но дольше загружается и требует больше памяти.", "Начните с INT8/0.6B; BF16 и 1.7B выбирайте, когда хватает unified memory."],
  speaker: ["Задаёт встроенный голос CustomVoice.", "Меняет базовый тембр; инструкция стилю затем меняет эмоцию и манеру.", "Используйте только с моделью CustomVoice и коротким описанием желаемой подачи."],
  instruct: ["Служебная инструкция Qwen3 CustomVoice для тембра, эмоции и просодии.", "Более конкретная инструкция сильнее направляет подачу; длинные или противоречивые инструкции могут ухудшить текст.", "1–2 коротких предложения: например «Говори спокойно, низко и медленно». Это инструкция, не текст для озвучки."],
  temperature: ["Управляет случайностью выбора следующего токена.", "Выше — больше выразительности и вариаций, но выше риск артефактов; ниже — стабильнее, но монотоннее.", "Для Qwen3 начните с 0.3; для некоторых неанглийских текстов может понадобиться 0.8–0.9."],
  topK: ["Ограничивает выбор следующего токена K наиболее вероятными кандидатами.", "Выше — больше разнообразия; ниже — более предсказуемая речь.", "50 — хороший нейтральный старт; меняйте вместе с Temperature небольшими шагами."],
  maxTokens: ["Ограничивает максимальную длину сгенерированной речи.", "Больше — можно синтезировать более длинный текст, но дольше ждать и больше расход памяти; слишком маленькое значение обрежет фразу.", "Поставьте запас выше ожидаемой длины и уменьшайте для быстрых проб."],
  batchSize: ["Количество строк batch-файла, обрабатываемых параллельно.", "Больше — выше пропускная способность, но больше пиковое потребление памяти; меньше — безопаснее.", "4 подходит для большинства Mac; при нехватке памяти поставьте 1–2."],
  firstChunkFrames: ["Сколько codec frames собрать перед первым звуком.", "Меньше — первый звук приходит раньше, но может быть менее ровным; больше — старт позже, зато стабильнее.", "3 — быстрый старт по умолчанию."],
  chunkFrames: ["Размер последующих потоковых чанков.", "Меньше — чаще обновления и ниже задержка; больше — эффективнее декодирование, но длиннее паузы между выдачами.", "25 — сбалансированный вариант."],
  batchFile: ["Текстовый файл, где каждая строка — отдельная реплика.", "Позволяет запускать серию фраз одной командой; на звучание одной строки не влияет.", "Одна реплика на строку, без лишних заголовков."],
  voice: ["Идентификатор встроенного голоса модели.", "Меняет тембр и характер готового пресета, но не добавляет клонирование.", "Для Kokoro используйте доступный voice ID из каталога модели."],
  cosyvoiceVariant: ["Выбирает точность и размер весов CosyVoice.", "BF16 обычно качественнее и тяжелее; INT8 экономит память, но может немного изменить тембр и детали.", "BF16 для качества, INT8 при ограниченной unified memory."],
  cosyInstruct: ["Задаёт общую манеру речи: эмоцию, темп, громкость и просодию.", "Это служебная инструкция, а не текст для озвучки.<br><br><strong>Примеры:</strong><br><code>Говори спокойно, тепло и немного медленнее обычного.</code><br><code>Speak slowly, warmly, with a low voice.</code><br><br>В основном тексте можно добавить локальные теги: <code>(happy)</code>, <code>(sad)</code>, <code>(calm)</code>, <code>(whispering)</code>, а также маркеры <code>[breath]</code>, <code>[laughter]</code> и <code>&lt;strong&gt;важное слово&lt;/strong&gt;</code>.", "Сочетайте одну общую инструкцию с 1–2 тегами в тексте. Не вставляйте сюда фразу, которую хотите услышать, и не добавляйте <code>&lt;|endofprompt|&gt;</code> вручную — разделитель добавляется автоматически."],
  cosyReferenceTranscript: ["Дословный текст, который произнесён в аудиореференсе.", "Помогает модели связать звук с содержимым и точнее клонировать произношение; несоответствие ухудшает результат.", "Перепишите референс слово в слово, включая знаки препинания по смыслу."],
  turnGap: ["Пауза между репликами в диалоговом режиме CosyVoice.", "Больше — диалог звучит раздельнее и спокойнее; меньше — реплики ближе друг к другу.", "0.2 секунды — естественный старт."],
  crossfade: ["Плавное перекрытие соседних аудиочастей.", "Больше убирает щелчки на стыках, но может смазать согласные; 0 оставляет части раздельными.", "Оставьте 0, если стыки чистые."],
  seed: ["Фиксирует случайность генерации.", "Одинаковый seed помогает повторить похожий результат; пусто или другой seed даст новую вариацию.", "Оставьте пустым для разнообразия, задайте число для сравнения настроек."],
  cosySpeechTokenizer: ["Опционально заменяет speech tokenizer CosyVoice локальным файлом.", "Меняет то, как аудио-референс кодируется в речевые токены; неправильный файл вызовет ошибку.", "Не заполняйте без конкретного bundle-рецепта."],
  voxcpm2Variant: ["Выбирает точность весов VoxCPM2.", "BF16 требует больше памяти и обычно лучше сохраняет детали; INT8 легче для Mac.", "INT8 для повседневных проб, BF16 для финального результата."],
  voxcpm2Instruct: ["Описывает желаемый голос для voice design.", "Более подробное описание сильнее влияет на тембр, возраст, акцент и настроение.", "Пишите описание голоса, а не текст, который нужно произнести."],
  voxcpm2CfgValue: ["Сила classifier-free guidance в VoxCPM2.", "Выше — сильнее следование условию, но выше риск неестественных артефактов; ниже — свободнее и мягче.", "2 — нейтральный старт."],
  voxcpm2Timesteps: ["Количество diffusion-шагов на patch.", "Больше — потенциально чище и стабильнее, но медленнее; меньше — быстрее, но грубее.", "10 для проб, 20–30 для финального результата."],
  f5ReferenceText: ["Точный текст аудиофрагмента F5-TTS.", "Связывает референс с фонемами; ошибка в тексте заметно ухудшает клонирование.", "Перепишите сказанное дословно."],
  f5Steps: ["Количество flow-шагов F5-TTS.", "Больше — обычно точнее и чище, но медленнее; меньше — быстрее для черновика.", "16 быстро, 32 — качественный финальный старт."],
  f5Speed: ["Множитель скорости речи F5-TTS.", "Меньше 1 — медленнее и протяжнее; больше 1 — быстрее, но может звучать торопливо.", "1.0 сохраняет естественный темп."],
  higgsTemperature: ["Случайность генерации Higgs TTS.", "Выше — живее и разнообразнее; ниже — стабильнее и аккуратнее.", "0.8 — безопасный старт для разговорной речи."],
  indicMioTopP: ["Nucleus sampling: оставляет минимальный набор кандидатов с общей вероятностью P.", "Выше — больше разнообразия; ниже — более консервативный выбор.", "0.9 — нейтральный старт."],
  indicMioRepetitionPenalty: ["Штраф за повторение уже использованных токенов.", "Выше — меньше повторов, но слишком большое значение ломает естественные повторы и окончания.", "1.0 отключает штраф; увеличивайте осторожно."],
  magpieTemperature: ["Случайность сэмплирования Magpie.", "Выше — больше вариаций; ниже — стабильнее, а 0 приближает greedy-режим.", "0.6 — рекомендованный баланс."],
  magpieMaxFrames: ["Максимальная длительность Magpie в acoustic frames.", "Больше — длиннее потенциальный результат и больше память; меньше — быстрее, но фраза может обрезаться.", "500 — около 23 секунд."],
  magpiePrephonemized: ["Сообщает, что текст уже записан в IPA.", "Включение пропускает обычную нормализацию; неверный IPA даст плохое произношение.", "Оставьте выключенным для обычного текста."],
  longForm: ["Переключает VibeVoice с Realtime 0.5B на Long-form 1.5B.", "Long-form принимает raw reference audio, но требует больше памяти и может скачать другую модель.", "Включайте для клонирования из обычной записи; Realtime требует готовый voice cache."],
  voiceCache: ["Готовый `.safetensors` cache для VibeVoice Realtime 0.5B.", "Меняет идентичность голоса; это не обычный WAV и не создаётся автоматически из поля референса.", "Нужен предвычисленный cache. Для WAV включите Long-form 1.5B."],
  referenceAudio: ["Обычная запись голоса для VibeVoice Long-form 1.5B.", "Более чистый и длинный естественный фрагмент лучше передаёт тембр; шум и эхо ухудшают клон.", "Используйте 10–30 секунд речи и обязательно добавьте точную расшифровку."],
  referenceTranscript: ["Текст, который произнесён в reference audio VibeVoice.", "Несовпадение текста и аудио ухудшает голосовой prompt и может сделать речь бессмысленной.", "Вставьте дословную расшифровку записи."],
  cfg: ["Сила classifier-free guidance в VibeVoice.", "Выше — строже следование условию, но больше риск искусственных артефактов; ниже — свободнее.", "1.3 — дефолт Realtime."],
  steps: ["Количество DPM diffusion-шагов.", "Больше — обычно чище, но медленнее; меньше — быстрый черновик с меньшей стабильностью.", "20 — сбалансированный старт."],
  duration: ["Фиксированная длительность OmniVoice в секундах.", "Больше — длиннее результат и больше вычисления; пусто позволяет модели оценить длительность по тексту.", "Оставьте пустым, если не нужна точная длительность."],
  referenceText: ["Текст, сказанный в аудиореференсе OmniVoice.", "Помогает выровнять ритм и произношение клонированного голоса.", "Заполняйте дословной расшифровкой референса."],
};

const engineParameterHelp = {
  "qwen3:voiceSample": ["Референс для Qwen3 Base voice cloning.", "Нужна чистая речь одного человека; тембр берётся из аудио, а частота и число каналов нормализуются автоматически.", "WAV, AIFF, CAF, M4A или MP3; лучше PCM WAV, 5–15 секунд, моно, без музыки, эха и длинной тишины. Жёсткого лимита размера нет — короткий файл быстрее обработается."],
  "qwen3:cleanReference": ["Опциональная очистка референса Qwen3.", "Sidon убирает шум и комнатное эхо перед извлечением тембра; на чистой записи может слегка изменить естественные детали.", "Включайте только для шумной записи. Формат тот же: лучше моно PCM WAV на 5–15 секунд."],
  "cosyvoice:voiceSample": ["Референс для zero-shot клонирования CosyVoice 3.", "CAM++ извлекает голосовой профиль; для точного zero-shot режима дополнительно заполните «Текст референса» дословной расшифровкой.", "WAV, AIFF, CAF, M4A или MP3; лучше чистый моно PCM WAV, 5–15 секунд, один говорящий, без музыки, эха и фоновых голосов. Размер не фиксирован, но длинные записи медленнее."],
  "cosyvoice:cleanReference": ["Опциональная очистка референса CosyVoice.", "Sidon делает шумоподавление и dereverb до извлечения голоса; сильная очистка может убрать часть естественной окраски.", "Используйте для шума или эха, а не для уже чистой студийной записи. Лучше моно WAV 5–15 секунд."],
  "voxcpm2:voiceSample": ["Основной референс VoxCPM2 для controllable cloning.", "Аудио задаёт тембр и манеру; runtime принимает запись с любой частотой и пересэмплирует её во внутренние 16 кГц.", "WAV, AIFF, CAF, M4A или MP3; лучше моно PCM WAV, 5–15 секунд чистой речи одного человека. Для обычного cloning достаточно этого файла; transcript нужен для режима continuation."],
  "voxcpm2:voxcpm2RefAudio": ["Отдельный референс VoxCPM2.", "Подменяет общий «Референс голоса» только для VoxCPM2 и задаёт голос controllable cloning.", "Используйте тот же чистый моно-файл 5–15 секунд. Частота 16 кГц предпочтительна, но runtime пересэмплирует автоматически."],
  "voxcpm2:voxcpm2PromptAudio": ["Prompt audio для ultimate cloning VoxCPM2.", "Это не просто голосовой образец: модель продолжает подачу из prompt-аудио, используя его вместе с точным prompt-текстом.", "Загрузите короткий чистый моно-фрагмент и обязательно заполните «Текст продолжения» дословно. Лучше WAV; запись должна содержать только речь одного человека."],
  "voxcpm2:cleanReference": ["Опциональная очистка референса VoxCPM2.", "Убирает шум и эхо перед загрузкой во внутренний 16 кГц тракт; слишком сильная очистка может сделать тембр менее естественным.", "Включайте только для проблемной записи. Для чистого WAV оставьте выключенным."],
  "indextts2:voiceSample": ["Обязательный голосовой референс IndexTTS2.", "IndexTTS2 — zero-shot cloning: без этого файла синтез не запускается. Из него извлекаются тембр, семантика и стиль говорящего.", "WAV, AIFF, CAF, M4A или MP3; лучше моно PCM WAV, 5–15 секунд чистой речи одного человека. `Очистить референс` для IndexTTS2 не поддерживается."],
  "indextts2:indextts2EmotionAudio": ["Отдельный emotion reference IndexTTS2.", "Задаёт эмоциональную подачу отдельно от голоса; без файла модель использует основной референс.", "Короткий чистый моно-фрагмент 3–10 секунд с нужной эмоцией, без музыки и посторонних голосов. Нельзя одновременно задать аудио и preset-эмоцию."],
  "f5:voiceSample": ["Обязательный голосовой референс F5-TTS.", "F5-TTS использует аудио вместе с обязательной точной расшифровкой; несоответствие текста и записи заметно ухудшает произношение.", "WAV, AIFF, CAF, M4A или MP3; лучше моно PCM WAV, примерно 3–12 секунд чистой речи. Модельный checkpoint рассчитан прежде всего на английский и китайский; размер файла не ограничен жёстко."],
  "f5:cleanReference": ["Опциональная очистка референса F5-TTS.", "Sidon очищает запись до подготовки mel; это помогает шумным клипам, но не исправляет неверную транскрипцию.", "Сначала исправьте «Текст референса», затем включайте очистку только при шуме или эхе."],
  "higgs:voiceSample": ["Необязательный референс Higgs TTS 3.", "Без файла модель выбирает голос сама; с файлом кодек извлекает тембр, а текст референса помогает точнее клонировать речь.", "WAV, AIFF, CAF, M4A или MP3; лучше моно PCM WAV, около 10–15 секунд чистой речи одного человека. Любая частота дискретизации принимается и нормализуется автоматически."],
  "higgs:higgsRefText": ["Текст Higgs reference audio.", "Транскрипт необязателен, но помогает модели точнее связать голос с содержанием записи.", "Введите дословный текст без имён говорящих и пояснений. Он нужен только вместе с «Референсом голоса»."],
  "higgs:cleanReference": ["Опциональная очистка референса Higgs.", "Убирает шум и dereverb перед кодированием голоса; на чистой записи может уменьшить естественные детали.", "Используйте только при заметном шуме или эхе. Текст референса всё равно должен соответствовать аудио."],
  "indic-mio:voiceSample": ["Референс голоса Indic-Mio.", "Из аудио извлекается глобальный embedding говорящего; для этого движка можно выбрать либо файл, либо готовый 128-значный embedding.", "WAV, AIFF, CAF, M4A или MP3; лучше моно PCM WAV, 5–15 секунд чистой речи. Модель ориентирована на Hindi/Indic; для других языков результат экспериментальный."],
  "indic-mio:cleanReference": ["Опциональная очистка референса Indic-Mio.", "Sidon снижает шум перед извлечением global embedding, но не меняет сам текст и эмоционные маркеры.", "Включайте только для шумной записи. Для чистого моно WAV оставьте выключенным."],
  "vibevoice:voiceCache": ["Готовый voice cache VibeVoice Realtime 0.5B.", "Realtime не принимает обычный WAV напрямую: ему нужен заранее вычисленный cache с голосовыми состояниями.", "Только файл `.safetensors`, созданный командой encoder VibeVoice. WAV, MP3 и M4A сюда не подходят. Для обычного аудиофайла включите `Long-form 1.5B`."],
  "vibevoice:referenceAudio": ["Аудиореференс VibeVoice Long-form 1.5B.", "Long-form кодирует обычную человеческую речь как voice prompt; в текущем UI вместе с ним нужен точный текст референса.", "WAV, AIFF, CAF, M4A или MP3; лучше моно PCM WAV, 10–30 секунд чистой речи одного человека, без музыки и эха. Поддержка модели — прежде всего English/Chinese; русский режим экспериментальный."],
  "vibevoice:referenceTranscript": ["Дословная расшифровка VibeVoice reference audio.", "Текст должен совпадать с аудио; ошибки ломают voice prompt и могут привести к бессмысленной генерации.", "Перепишите запись слово в слово. Одна реплика, без пояснений и имён говорящих."],
  "csm:refAudio": ["Обязательный референс CSM 1B.", "CSM продолжает текстовую последовательность в голосе из этого аудио; без референса модель не запускается.", "WAV, AIFF, CAF, M4A или MP3; лучше чистый моно PCM WAV, 10–15 секунд речи одного человека. Любая частота пересэмплируется во внутренние 24 кГц."],
  "csm:refText": ["Обязательная расшифровка CSM reference audio.", "CSM объединяет текст референса с целевым текстом, поэтому любая ошибка влияет на содержание и голосовой match.", "Перепишите аудио слово в слово, включая числа и сокращения. Одна реплика без служебных комментариев."],
  "omnivoice:referenceAudio": ["Обязательный референс OmniVoice.", "Diffusion-модель извлекает из него тембр и подачу; «Текст референса» помогает выровнять ритм и произношение.", "WAV, AIFF, CAF, M4A или MP3; лучше моно PCM WAV, 5–15 секунд чистой речи одного человека, без музыки, эха и тишины. Размер не ограничен жёстко."],
};

const fallbackChanges = {
  number: "Увеличение обычно усиливает или продлевает эффект, но требует больше времени; уменьшение делает результат осторожнее и быстрее.",
  select: "Каждый вариант выбирает отдельный режим, голос, язык или набор весов.",
  toggle: "Включение активирует этот режим; выключение возвращает обычный путь генерации.",
  file: "Качество результата зависит от содержания и чистоты загруженного файла.",
  text: "Более точное описание сильнее направляет модель; лишний текст может запутать условие.",
  textarea: "Более точное описание сильнее направляет модель; лишний текст может запутать условие.",
};

function defaultLabel(field) {
  if (field.default === "" || field.default == null) return "Пусто — автоматический режим или значение не задано.";
  if (field.type === "select") return `По умолчанию: ${field.options.find(([value]) => String(value) === String(field.default))?.[1] || field.default}.`;
  return `По умолчанию: ${field.default}.`;
}

function openHelp(content) {
  dom.help_eyebrow.textContent = content.eyebrow || "Подсказка";
  dom.help_title.textContent = content.title;
  dom.help_content.innerHTML = `<p>${content.what}</p><dl class="help-facts"><div><dt>Как влияет</dt><dd>${content.change}</dd></div><div><dt>Рекомендация</dt><dd>${content.recommendation}</dd></div></dl>${content.note ? `<p class="dialog-note">${content.note}</p>` : ""}`;
  dom.help_dialog.showModal();
}

function fieldHelp(field, engine) {
  const text = engineParameterHelp[`${engine.id}:${field.key}`] || parameterHelp[field.key];
  return {
    eyebrow: `${engine.name} · параметр`,
    title: field.label,
    what: text?.[0] || field.help || `Настройка ${field.label}.`,
    change: text?.[1] || fallbackChanges[field.type] || "Меняйте небольшими шагами и сравнивайте результат.",
    recommendation: text?.[2] || `${defaultLabel(field)} ${field.help || "Оставьте значение по умолчанию для первого запуска."}`,
  };
}

function groupHelp(name, engine) {
  const content = sectionHelp[name] || sectionHelp["Расширенные"];
  return { ...content, eyebrow: `${engine.name} · раздел` };
}

function fieldMarkup(field, value) {
  const id = `field-${field.key}`;
  if (field.type === "toggle") return `
    <label class="toggle-field" for="${id}">
      <input id="${id}" data-field="${field.key}" type="checkbox" ${value ? "checked" : ""} />
      <span class="toggle-track"><span class="toggle-thumb"></span></span>
      <span class="toggle-copy"><strong>${field.label} <button class="help-button" type="button" data-help-field="${field.key}" aria-label="Подробнее: ${field.label}">?</button></strong><small>${field.help || ""}</small></span>
    </label>`;
  if (field.type === "file") return `
    <div class="field field-full"><div class="field-label"><span>${field.label}</span><button class="help-button" type="button" data-help-field="${field.key}" aria-label="Подробнее: ${field.label}">?</button></div>
      <label class="file-input">${icons.upload}<span class="file-input-copy"><strong>${value?.name || "Выбрать файл"}</strong><small>${field.help || "Локальный файл"}</small></span><input id="${id}" data-field="${field.key}" type="file" accept="${field.accept || "audio/*"}" /></label>
    </div>`;
  const full = field.type === "textarea" || field.type === "text" && ["instruct", "model", "modelId"].some((part) => field.key.includes(part));
  const attributes = field.type === "number" ? `min="${field.min}" max="${field.max}" step="${field.step}"` : "";
  const control = field.type === "select"
    ? `<select id="${id}" data-field="${field.key}">${field.options.map(([optionValue, label]) => `<option value="${optionValue}" ${String(value) === String(optionValue) ? "selected" : ""}>${label}</option>`).join("")}</select>`
    : field.type === "textarea"
      ? `<textarea id="${id}" data-field="${field.key}">${escapeHtml(value ?? "")}</textarea>`
      : `<input id="${id}" data-field="${field.key}" type="${field.type}" value="${escapeAttribute(value ?? "")}" ${attributes} />`;
  return `<label class="field ${full ? "field-full" : ""}"><span class="field-label"><span>${field.label}</span><button class="help-button" type="button" data-help-field="${field.key}" aria-label="Подробнее: ${field.label}">?</button></span>${control}<small>${field.help || ""}</small></label>`;
}

function renderSettings() {
  const engine = currentEngine();
  const values = engineValues(engine);
  const groups = groupFields(engine.fields);
  dom.settings_form.innerHTML = Object.entries(groups).map(([name, fields], index) => `
    <details class="settings-section" ${index < 2 ? "open" : ""}>
      <summary><span>${name}</span><small>${fields.length} ${plural(fields.length, "параметр", "параметра", "параметров")}</small><button class="help-button section-help-button" type="button" data-help-group="${name}" aria-label="Подробнее о разделе ${name}">?</button></summary>
      <div class="section-fields">${fields.map((field) => fieldMarkup(field, values[field.key])).join("")}</div>
    </details>`).join("");
  dom.settings_form.querySelectorAll("[data-field]").forEach((control) => {
    const field = engine.fields.find((item) => item.key === control.dataset.field);
    if (field.type === "file") control.addEventListener("change", () => handleFile(field, control));
    else control.addEventListener("input", () => {
      values[field.key] = field.type === "toggle" ? control.checked : control.value;
      persist(); renderWorkspace();
    });
  });
  dom.settings_form.querySelectorAll("[data-help-field]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openHelp(fieldHelp(engine.fields.find((field) => field.key === button.dataset.helpField), engine));
  }));
  dom.settings_form.querySelectorAll("[data-help-group]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openHelp(groupHelp(button.dataset.helpGroup, engine));
  }));
  renderPresets();
}

async function handleFile(field, input) {
  const selected = input.files[0];
  if (!selected) return;
  if (selected.size > 60 * 1024 * 1024) { toast("Файл больше 60 МБ"); input.value = ""; return; }
  const data = await fileToDataUrl(selected);
  engineValues()[field.key] = { name: selected.name, size: selected.size, data };
  persist();
  renderSettings();
}

function fileToDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }

function buildPreview() {
  const engine = currentEngine();
  const binary = engine.binary === "omni" ? "speech-omni" : "speech";
  const pieces = [binary];
  if (engine.command !== "speech-omni") pieces.push(engine.command);
  pieces.push('"…"', ...(engine.staticArgs || []));
  for (const field of engine.fields) {
    const value = engineValues(engine)[field.key];
    if (value === "" || value === false || value == null) continue;
    pieces.push(field.cli);
    if (field.type !== "toggle") pieces.push(field.type === "file" ? `<${value.name || "file"}>` : String(value));
  }
  if (state.rawArgs) pieces.push(state.rawArgs);
  return pieces.join(" ");
}

function validateGeneration() {
  const engine = currentEngine();
  const values = engineValues(engine);
  if (!state.text.trim() && !values.batchFile) {
    setResultState("empty");
    dom.script_text.focus();
    toast("Сначала введите текст");
    return false;
  }
  for (const field of engine.fields.filter((item) => item.type === "number")) {
    const rawValue = values[field.key];
    if (rawValue === "" || rawValue == null) continue;
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue) || (field.min != null && numericValue < Number(field.min)) || (field.max != null && numericValue > Number(field.max))) {
      const range = field.min != null || field.max != null ? ` в диапазоне ${field.min ?? "без нижней границы"}–${field.max ?? "без верхней границы"}` : "";
      showError(`${field.label}: укажите корректное число${range}.`);
      return false;
    }
  }
  if (engine.id === "omnivoice" && !values.referenceAudio) {
    showError("OmniVoice требует референс голоса. Нажмите «Выбрать файл» и добавьте WAV/AIFF/M4A/MP3 с чистой речью одного человека.");
    return false;
  }
  if (engine.id !== "vibevoice") return true;
  if (!values.longForm && !values.voiceCache) {
    showError("VibeVoice Realtime 0.5B требует Voice cache (.safetensors). Для клонирования из обычного аудиофайла включите Long-form 1.5B и укажите референс вместе с точной расшифровкой.");
    return false;
  }
  if (values.longForm && values.referenceAudio && !String(values.referenceTranscript || "").trim()) {
    showError("Для референса 1.5B добавьте точную расшифровку того, что сказано в аудиофайле.");
    return false;
  }
  if (values.longForm && !values.referenceAudio && !values.voiceCache) {
    showError("Для VibeVoice Long-form выберите референс 1.5B с текстом или готовый Voice cache.");
    return false;
  }
  return true;
}

async function startGeneration() {
  if (!validateGeneration()) return;
  try {
    setResultState("running");
    dom.generate_button.disabled = true;
    dom.cancel_button.classList.remove("hidden");
    dom.running_title.textContent = `Запускаю ${currentEngine().name}…`;
    dom.running_detail.textContent = "Модель работает локально на этом Mac";
    state.currentJob = await api("/api/jobs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine: state.selected, text: state.text, values: engineValues(), rawArgs: state.rawArgs }),
    });
    pollJob();
  } catch (error) {
    showError(error.message);
  }
}

async function pollJob() {
  clearTimeout(state.pollTimer);
  try {
    state.currentJob = await api(`/api/jobs/${state.currentJob.id}`);
    const job = state.currentJob;
    dom.live_log.textContent = job.log || "Ожидаю вывод модели…";
    dom.running_detail.textContent = progressLine(job.log) || "Синтезирую речь…";
    if (job.status === "running") state.pollTimer = setTimeout(pollJob, 700);
    else if (job.status === "completed") {
      showAudio(job);
      await loadHistory();
    } else if (job.status === "cancelled") {
      setResultState("empty"); toast("Генерация отменена");
    } else showError([job.error, job.log].filter(Boolean).join("\n"));
  } catch (error) { showError(error.message); }
}

function progressLine(log = "") {
  return log.trim().split("\n").filter(Boolean).at(-1)?.slice(0, 120);
}

async function cancelGeneration() {
  if (!state.currentJob?.id) return;
  try { await api(`/api/jobs/${state.currentJob.id}`, { method: "DELETE" }); } catch {}
  clearTimeout(state.pollTimer);
  state.currentJob = null;
  setResultState("empty");
  toast("Генерация отменена");
}

function showAudio(job) {
  setResultState("audio");
  state.currentJob = job;
  state.enhancementJob = job.engine === "studio-enhance" ? job : null;
  dom.result_title.textContent = `${job.engineName} · готово`;
  dom.result_meta.textContent = formatTime(job.finishedAt);
  dom.audio_player.src = `${job.audioUrl}?t=${Date.now()}`;
  dom.download_audio.href = job.audioUrl;
  dom.download_audio.download = job.engine === "studio-enhance" ? "speech-studio-enhanced.wav" : "speech-studio.wav";
  dom.studio_enhance_button.classList.toggle("hidden", job.engine === "studio-enhance");
  dom.studio_enhance_button.disabled = false;
  dom.audio_variant_note.classList.toggle("hidden", job.engine !== "studio-enhance");
  dom.audio_variant_note.innerHTML = job.engine === "studio-enhance"
    ? `Локальная студийная обработка: EQ, контроль сибилянтов, компрессия, мягкая сатурация, короткая комната и лимитер. <button id="use-original-button" class="text-button" type="button">Вернуть оригинал</button>` : "";
  dom.audio_variant_note.querySelector("#use-original-button")?.addEventListener("click", () => {
    if (!job.originalAudioUrl) return;
    dom.audio_player.src = `${job.originalAudioUrl}?t=${Date.now()}`;
    dom.download_audio.href = job.originalAudioUrl;
    dom.download_audio.download = "speech-studio-original.wav";
    dom.result_title.textContent = "Оригинал · готово";
    dom.studio_enhance_button.classList.remove("hidden");
  });
  dom.command_output.textContent = `${job.command}\n\n${job.log || "Без дополнительного лога"}`;
}

async function enhanceCurrentAudio() {
  const sourceId = state.currentJob?.engine === "studio-enhance" ? state.currentJob.originalAudioUrl?.split("/").at(-1) : state.currentJob?.id;
  if (!sourceId) return;
  try {
    dom.studio_enhance_button.disabled = true;
    dom.studio_enhance_button.textContent = "Обрабатываю…";
    state.enhancementJob = await api(`/api/audio/${sourceId}/studio`, { method: "POST" });
    pollEnhancement();
  } catch (error) {
    dom.studio_enhance_button.disabled = false;
    dom.studio_enhance_button.textContent = "Сделать студийную версию";
    toast(error.message);
  }
}

async function pollEnhancement() {
  clearTimeout(state.enhancementPollTimer);
  try {
    state.enhancementJob = await api(`/api/jobs/${state.enhancementJob.id}`);
    const job = state.enhancementJob;
    dom.audio_variant_note.classList.remove("hidden");
    dom.audio_variant_note.textContent = job.status === "running" ? progressLine(job.log) || "Обрабатываю локально…" : "";
    if (job.status === "running") state.enhancementPollTimer = setTimeout(pollEnhancement, 450);
    else if (job.status === "completed") {
      dom.studio_enhance_button.textContent = "Сделать студийную версию";
      showAudio(job);
      await loadHistory();
    } else {
      dom.studio_enhance_button.disabled = false;
      dom.studio_enhance_button.textContent = "Сделать студийную версию";
      toast(job.error || "Студийная обработка не завершилась");
    }
  } catch (error) {
    dom.studio_enhance_button.disabled = false;
    dom.studio_enhance_button.textContent = "Сделать студийную версию";
    toast(error.message);
  }
}

function showError(message) {
  clearTimeout(state.pollTimer);
  setResultState("error");
  dom.error_message.textContent = message || "Неизвестная ошибка";
}

function setResultState(mode) {
  dom.empty_result.classList.toggle("hidden", mode !== "empty");
  dom.running_result.classList.toggle("hidden", mode !== "running");
  dom.audio_result.classList.toggle("hidden", mode !== "audio");
  dom.error_result.classList.toggle("hidden", mode !== "error");
  if (mode !== "error") dom.error_message.textContent = "";
  if (mode !== "running") {
    dom.cancel_button.classList.add("hidden");
    dom.generate_button.disabled = !engineReady(currentEngine());
  }
}

async function loadHistory() {
  state.history = await api("/api/history");
  dom.history_count.textContent = state.history.length;
  dom.history_list.innerHTML = state.history.length ? state.history.map((item) => `
    <button class="history-item" data-history="${item.id}" type="button">
      <span class="history-item-top"><strong>${escapeHtml(item.engineName)}</strong><time>${formatTime(item.finishedAt)}</time></span>
      <p>${escapeHtml(item.text || "Batch generation")}</p><small>Прослушать →</small>
    </button>`).join("") : '<div class="history-empty">Генераций пока нет.<br>Первый результат появится здесь.</div>';
  dom.history_list.querySelectorAll("[data-history]").forEach((button) => button.addEventListener("click", () => {
    const item = state.history.find((entry) => entry.id === button.dataset.history);
    showAudio(item); closeHistory();
  }));
}

function openHistory() { dom.history_drawer.classList.add("open"); dom.history_drawer.setAttribute("aria-hidden", "false"); dom.drawer_backdrop.classList.remove("hidden"); }
function closeHistory() { dom.history_drawer.classList.remove("open"); dom.history_drawer.setAttribute("aria-hidden", "true"); dom.drawer_backdrop.classList.add("hidden"); }

function renderPresets() {
  const entries = Object.entries(state.presets).filter(([, preset]) => preset.engine === state.selected);
  const selectedId = dom.preset_select.value;
  dom.preset_select.innerHTML = '<option value="">Без пресета</option>' + entries.map(([id, preset]) => `<option value="${id}">${escapeHtml(preset.name)}</option>`).join("");
  if (entries.some(([id]) => id === selectedId)) dom.preset_select.value = selectedId;
  dom.delete_preset.disabled = !dom.preset_select.value;
}

function savePreset() {
  const name = dom.preset_name.value.trim();
  if (!name) return;
  const id = `${state.selected}-${Date.now()}`;
  state.presets[id] = { name, engine: state.selected, values: structuredClone(engineValues()), rawArgs: state.rawArgs };
  localStorage.setItem("speech-studio-presets", JSON.stringify(state.presets));
  dom.preset_dialog.close(); dom.preset_name.value = "";
  renderPresets(); dom.preset_select.value = id; toast("Пресет сохранён");
  dom.delete_preset.disabled = false;
}

function applyPreset(id) {
  const preset = state.presets[id];
  if (!preset) return;
  state.values[state.selected] = structuredClone(preset.values);
  state.rawArgs = preset.rawArgs || ""; dom.raw_args.value = state.rawArgs;
  persist(); renderSettings(); renderWorkspace(); toast("Пресет применён");
  dom.delete_preset.disabled = false;
}

function deletePreset() {
  const id = dom.preset_select.value;
  if (!id || !state.presets[id]) return;
  delete state.presets[id];
  localStorage.setItem("speech-studio-presets", JSON.stringify(state.presets));
  renderPresets();
  toast("Пресет удалён");
}

function resetSettings() {
  const engine = currentEngine();
  state.values[engine.id] = Object.fromEntries(engine.fields.map((field) => [field.key, field.default ?? ""]));
  state.rawArgs = ""; dom.raw_args.value = ""; persist(); renderSettings(); renderWorkspace(); toast("Настройки сброшены");
}

function updateTextMeta() {
  state.text = dom.script_text.value; persist();
  dom.char_count.textContent = `${state.text.length} ${plural(state.text.length, "знак", "знака", "знаков")}`;
}

function plural(number, one, few, many) { const n = Math.abs(number) % 100, n1 = n % 10; if (n > 10 && n < 20) return many; if (n1 > 1 && n1 < 5) return few; if (n1 === 1) return one; return many; }
function formatTime(value) { return value ? new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }).format(new Date(value)) : ""; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character])); }
function escapeAttribute(value) { return escapeHtml(value).replaceAll("`", "&#096;"); }

async function init() {
  const config = await api("/api/config");
  state.engines = config.engines; state.system = config.system;
  if (!state.engines.some((engine) => engine.id === state.selected)) state.selected = state.engines[0].id;
  dom.script_text.value = state.text;
  dom.raw_args.value = state.rawArgs;
  updateTextMeta(); renderEngines(); renderWorkspace(); renderSettings(); await loadHistory();
  const ready = state.system.speechReady && state.system.metalReady;
  dom.system_status.classList.toggle("ready", ready);
  dom.system_status.innerHTML = `<span></span>${ready ? "Speech runtime готов" : "Нужна сборка runtime"}`;
}

dom.engine_search.addEventListener("input", () => renderEngines(dom.engine_search.value));
dom.script_text.addEventListener("input", updateTextMeta);
dom.script_text.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); startGeneration(); } });
dom.clear_text.addEventListener("click", () => { dom.script_text.value = ""; updateTextMeta(); dom.script_text.focus(); });
dom.generate_button.addEventListener("click", startGeneration);
dom.studio_enhance_button.addEventListener("click", enhanceCurrentAudio);
dom.cancel_button.addEventListener("click", cancelGeneration);
dom.retry_button.addEventListener("click", startGeneration);
dom.show_log.addEventListener("click", () => dom.live_log.classList.toggle("hidden"));
dom.raw_args.addEventListener("input", () => { state.rawArgs = dom.raw_args.value; renderWorkspace(); });
dom.reset_settings.addEventListener("click", resetSettings);
dom.history_toggle.addEventListener("click", openHistory);
dom.history_close.addEventListener("click", closeHistory);
dom.drawer_backdrop.addEventListener("click", closeHistory);
dom.save_preset.addEventListener("click", () => dom.preset_dialog.showModal());
dom.confirm_preset.addEventListener("click", (event) => { event.preventDefault(); savePreset(); });
dom.preset_select.addEventListener("change", () => applyPreset(dom.preset_select.value));
dom.delete_preset.addEventListener("click", deletePreset);
document.querySelectorAll("[data-help-group='CLI Advanced']").forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  openHelp(groupHelp("CLI Advanced", currentEngine()));
}));
document.querySelectorAll("[data-help-field='rawArgs']").forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  openHelp({
    eyebrow: "Speech Studio · параметр",
    title: "Raw arguments",
    what: "Дополнительные аргументы командной строки для флагов, которых ещё нет отдельным контролом.",
    change: "Они добавляются к команде как есть и могут изменить поведение выбранного движка.",
    recommendation: "Используйте только проверенные флаги из `speech … --help`; не добавляйте `--output`.",
  });
}));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeHistory(); });

init().catch((error) => showError(error.message));
