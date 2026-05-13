export type SetupWizardStepId = 'welcome' | 'obs-websocket' | 'obs-replay' | 'folders' | 'trade-source' | 'test-clip' | 'done'

export type SetupWizardStep = {
  id: SetupWizardStepId
  title: string
  goal: string
  actions: string[]
}

export const setupWizardSteps: SetupWizardStep[] = [
  {
    id: 'welcome',
    title: 'Быстрый старт Trade Clipper',
    goal: 'За 5–10 минут пройти все обязательные настройки, чтобы приложение могло сохранять клипы сделок.',
    actions: [
      'Проверим OBS WebSocket',
      'Укажем папку OBS replay и папку готовых клипов',
      'Сделаем тестовый клип перед подключением реального дневника или биржи'
    ]
  },
  {
    id: 'obs-websocket',
    title: 'Подключите OBS WebSocket',
    goal: 'Trade Clipper должен уметь отправлять OBS команду SaveReplayBuffer.',
    actions: [
      'Откройте OBS → Tools → WebSocket Server Settings',
      'Включите Enable WebSocket server',
      'Оставьте host 127.0.0.1 и порт 4455 или впишите свои значения ниже',
      'Введите пароль OBS WebSocket, он сохранится в системном keychain'
    ]
  },
  {
    id: 'obs-replay',
    title: 'Включите Replay Buffer в OBS',
    goal: 'OBS должен держать последние минуты записи в памяти, чтобы после закрытия сделки сохранить нужный фрагмент.',
    actions: [
      'OBS → Settings → Output → Replay Buffer',
      'Включите Replay Buffer и поставьте длительность больше максимальной сделки',
      'Перед торговлей нажмите Start Replay Buffer',
      'После настройки нажмите проверку системы'
    ]
  },
  {
    id: 'folders',
    title: 'Укажите папки и отступы клипа',
    goal: 'Приложение должно знать, где искать replay-файлы OBS и куда складывать готовые MP4 + JSON.',
    actions: [
      'Папка OBS replay должна совпадать с Recording Path в OBS',
      'Папка клипов — место для готовых обрезанных видео',
      'Отступ до входа и после выхода добавляет запас по краям сделки'
    ]
  },
  {
    id: 'trade-source',
    title: 'Источник сделок',
    goal: 'На MVP можно проверить pipeline тестовой сделкой, а дальше подключить дневник или read-only API биржи.',
    actions: [
      'Для дневника понадобится API Trader Make Money или документация',
      'Для биржи нужны только read-only ключи без торговли и вывода',
      'Минимальные данные: монета, биржа, рынок, направление, время входа и выхода'
    ]
  },
  {
    id: 'test-clip',
    title: 'Создайте тестовый клип',
    goal: 'Проверить весь локальный pipeline до подключения реальных сделок.',
    actions: [
      'Trade Clipper отправит SaveReplayBuffer в OBS',
      'Найдет свежий replay-файл в папке OBS replay',
      'Обрежет его через ffmpeg по тестовой сделке BTCUSDT',
      'Добавит клип в очередь проверки'
    ]
  },
  {
    id: 'done',
    title: 'Готово к работе',
    goal: 'Локальная часть настроена: OBS сохраняет replay, ffmpeg режет клип, очередь проверки показывает результат.',
    actions: [
      'Перед торговлей убедитесь, что OBS и Replay Buffer запущены',
      'Дальше можно подключать дневник, биржу и YouTube OAuth',
      'Если что-то сломается, снова откройте пошаговую настройку сверху'
    ]
  }
]
