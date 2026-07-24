# Speech Swift UI

<p align="center">
  <strong>Локальная студия для синтеза речи на Apple Silicon.</strong><br>
  Настройка голоса, клонирование референса, контроль загрузки моделей и финальная обработка WAV — в одном окне браузера.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%2015%2B-111827?style=flat-square" alt="macOS 15+">
  <img src="https://img.shields.io/badge/runtime-Node%2020%2B-111827?style=flat-square" alt="Node 20+">
  <img src="https://img.shields.io/badge/inference-local%20%2B%20offline--capable-0f766e?style=flat-square" alt="Локальный запуск">
  <img src="https://img.shields.io/badge/license-Apache--2.0-111827?style=flat-square" alt="Apache 2.0">
</p>

![Главный экран Speech Studio](docs/screenshots/studio-main.png)

## Что это

Speech Swift UI — лёгкий локальный интерфейс для CLI-движков [speech-swift](https://github.com/soniqo/speech-swift). В репозитории нет серверных зависимостей: только Node-сервер, статический UI в браузере и переиспользуемый Swift-модуль студийной обработки аудио.

Основной рабочий цикл:

- выбрать TTS-модель и увидеть её специфические параметры;
- написать текст, настроить голос и не запоминать CLI-флаги;
- загрузить референс и его расшифровку для клонирования голоса;
- видеть прогресс загрузки модели и этапы генерации в логе;
- прослушать, скачать и восстановить результаты из локальной истории;
- одной кнопкой сделать улучшенную «студийную версию» WAV-файла.

![Подсказка по референсу голоса](docs/screenshots/reference-help.png)

## Локальность и приватность

- Сервер слушает только `127.0.0.1`.
- Текст, референсы и готовое аудио передаются только локальным процессам.
- Нет npm-зависимостей во время работы и удалённого backend-сервиса.
- История, загруженные файлы и WAV сохраняются в игнорируемой папке `StudioWeb/.studio-data/`.
- В репозитории нет весов моделей и исходников MLX/CoreML-рантаймов.

## Быстрый запуск

1. Соберите release-бинарники `speech` и (для OmniVoice) `speech-omni` из [speech-swift](https://github.com/soniqo/speech-swift).
2. Клонируйте этот репозиторий и запустите UI:

   ```bash
   cd StudioWeb
   npm start
   ```

3. Откройте `http://127.0.0.1:4173/`.

Если бинарники находятся в другом месте, укажите их явно:

```bash
SPEECH_SWIFT_BIN=/path/to/speech \
SPEECH_OMNI_BIN=/path/to/speech-omni \
npm start
```

Требуется Node.js 20 или новее. Модели скачиваются выбранным speech-swift-рантаймом при первом запуске и хранятся в его стандартном локальном кэше.

## Модуль студийной обработки

`Sources/AudioCLILib/StudioEnhancer.swift` — детерминированная CPU-friendly DSP-цепочка для речевых WAV-файлов:

1. фильтр низких частот;
2. мягкая корректирующая эквализация;
3. адаптивный de-esser;
4. прозрачная компрессия;
5. лёгкая сатурация;
6. короткая комнатная реверберация;
7. нормализация громкости и peak-limiter.

CLI-команда находится в `StudioEnhanceCommand.swift`:

```bash
speech studio-enhance input.wav --output input_studio.wav
```

Swift-файлы предназначены для подключения к checkout-версии `speech-swift`, где уже доступны цели `AudioCLILib` и `AudioCommon`.

## Тесты

UI-тесты запускаются без моделей и сетевого доступа:

```bash
cd StudioWeb
npm test
```

Swift-тесты находятся в `Tests/StudioEnhancerTests.swift` и проверяют обработку тишины, сохранение длины сигнала и защиту от клиппинга при интеграции в родительский Swift-пакет.

## Ограничения

Репозиторий содержит только интерфейс и модуль улучшения звука. Здесь нет моделей, весов и MLX-рантайма. Доступные движки зависят от установленных release-бинарников и локального кэша моделей на Mac.

## Лицензия

Apache-2.0. См. [LICENSE](LICENSE).
